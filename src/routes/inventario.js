import { Router } from 'express';
import { consulta, conTransaccion } from '../db/pool.js';
import { autenticar, requiereRol, tiendaObjetivo, tiendaSeleccionada } from '../middleware/auth.js';
import { ErrorHttp } from '../middleware/errores.js';
import { requerido, aNumero, aEntero } from '../utils/validacion.js';

const router = Router();
router.use(autenticar);

const limpiar = (v) => (v === undefined || v === null ? null : String(v).trim() || null);

// ---------------------------------------------------------------------------
// POST /api/inventario/entrada  — ingreso de mercadería (sube stock)
//   body: { tienda_id?, referencia?, items: [{ variante_id, cantidad, costo_unitario? }] }
// ---------------------------------------------------------------------------
router.post('/entrada', requiereRol('admin', 'bodega'), async (req, res) => {
  const tiendaId = tiendaObjetivo(req);
  if (!tiendaId) throw new ErrorHttp(400, 'Debe indicar la tienda del ingreso');

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) throw new ErrorHttp(400, 'Debe incluir al menos un ítem');
  const referencia = req.body.referencia ? String(req.body.referencia).trim() : 'Ingreso de mercadería';

  const movimientos = await conTransaccion(async (cli) => {
    const resultado = [];
    for (const it of items) {
      const varianteId = aEntero(it.variante_id, 'items.variante_id');
      const cantidad = aEntero(it.cantidad, 'items.cantidad', { min: 1 });

      const { rows: vr } = await cli.query(
        `SELECT id FROM producto_variantes WHERE id = $1`,
        [varianteId],
      );
      if (!vr[0]) throw new ErrorHttp(404, `La variante ${varianteId} no existe`);

      const { rows: sr } = await cli.query(
        `INSERT INTO stock (variante_id, tienda_id, cantidad) VALUES ($1, $2, $3)
         ON CONFLICT (variante_id, tienda_id)
         DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad
         RETURNING cantidad`,
        [varianteId, tiendaId, cantidad],
      );
      const nueva = sr[0].cantidad;

      if (it.costo_unitario !== undefined) {
        await cli.query(
          `UPDATE producto_variantes SET precio_compra = $1 WHERE id = $2`,
          [aNumero(it.costo_unitario, 'items.costo_unitario', { min: 0 }), varianteId],
        );
      }

      const { rows: mr } = await cli.query(
        `INSERT INTO movimientos_inventario
           (variante_id, tienda_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, referencia, usuario_id)
         VALUES ($1, $2, 'entrada', $3, $4, $5, $6, $7)
         RETURNING *`,
        [varianteId, tiendaId, cantidad, nueva - cantidad, nueva, referencia, req.usuario.id],
      );
      resultado.push(mr[0]);
    }
    return resultado;
  });

  res.status(201).json({ tienda_id: tiendaId, referencia, movimientos });
});

// ---------------------------------------------------------------------------
// POST /api/inventario/ajuste  — fija el stock a un valor exacto
//   body: { tienda_id?, variante_id, cantidad_nueva, motivo }
// ---------------------------------------------------------------------------
router.post('/ajuste', requiereRol('admin', 'bodega'), async (req, res) => {
  const tiendaId = tiendaObjetivo(req);
  if (!tiendaId) throw new ErrorHttp(400, 'Debe indicar la tienda del ajuste');
  const varianteId = aEntero(req.body.variante_id, 'variante_id');
  const cantidadNueva = aEntero(req.body.cantidad_nueva, 'cantidad_nueva', { min: 0 });
  const motivo = String(requerido(req.body.motivo, 'motivo')).trim();

  const movimiento = await conTransaccion(async (cli) => {
    const { rows: sr } = await cli.query(
      `SELECT cantidad FROM stock WHERE variante_id = $1 AND tienda_id = $2 FOR UPDATE`,
      [varianteId, tiendaId],
    );
    const anterior = sr[0]?.cantidad ?? 0;

    await cli.query(
      `INSERT INTO stock (variante_id, tienda_id, cantidad) VALUES ($1, $2, $3)
       ON CONFLICT (variante_id, tienda_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
      [varianteId, tiendaId, cantidadNueva],
    );

    const { rows: mr } = await cli.query(
      `INSERT INTO movimientos_inventario
         (variante_id, tienda_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, referencia, usuario_id)
       VALUES ($1, $2, 'ajuste', $3, $4, $5, $6, $7)
       RETURNING *`,
      [varianteId, tiendaId, Math.abs(cantidadNueva - anterior), anterior, cantidadNueva, motivo, req.usuario.id],
    );
    return mr[0];
  });

  res.status(201).json(movimiento);
});

// ---------------------------------------------------------------------------
// GET /api/inventario/stock  — stock actual de la tienda
// ---------------------------------------------------------------------------
router.get('/stock', async (req, res) => {
  const tiendaId = await tiendaSeleccionada(req);
  const { rows } = await consulta(
    `SELECT v.id AS variante_id, p.nombre AS producto, v.talla, v.color,
            v.codigo_barras, v.precio_venta,
            COALESCE(s.cantidad, 0)::int AS stock
       FROM producto_variantes v
       JOIN productos p  ON p.id = v.producto_id
       LEFT JOIN stock s ON s.variante_id = v.id AND s.tienda_id = $1
      WHERE v.activo = true AND p.activo = true
      ORDER BY p.nombre, v.talla, v.color`,
    [tiendaId],
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// GET /api/inventario/stock-bajo?umbral=5
// ---------------------------------------------------------------------------
router.get('/stock-bajo', async (req, res) => {
  const tiendaId = await tiendaSeleccionada(req);
  const umbral = Number(req.query.umbral) || Number(process.env.STOCK_BAJO_UMBRAL) || 5;
  const { rows } = await consulta(
    `SELECT v.id AS variante_id, p.nombre AS producto, v.talla, v.color, v.codigo_barras,
            COALESCE(s.cantidad, 0)::int AS stock
       FROM producto_variantes v
       JOIN productos p  ON p.id = v.producto_id
       LEFT JOIN stock s ON s.variante_id = v.id AND s.tienda_id = $1
      WHERE v.activo = true AND p.activo = true
        AND COALESCE(s.cantidad, 0) <= $2
      ORDER BY stock ASC, p.nombre`,
    [tiendaId, umbral],
  );
  res.json({ umbral, items: rows });
});

// ---------------------------------------------------------------------------
// GET /api/inventario/movimientos  — kardex
//   ?variante_id=  ?tipo=  ?desde=  ?hasta=  ?limite=100
// ---------------------------------------------------------------------------
router.get('/movimientos', async (req, res) => {
  const tiendaId = await tiendaSeleccionada(req);
  const params = [tiendaId];
  const filtros = ['m.tienda_id = $1'];

  if (req.query.variante_id) {
    params.push(Number(req.query.variante_id));
    filtros.push(`m.variante_id = $${params.length}`);
  }
  if (req.query.tipo) {
    params.push(String(req.query.tipo));
    filtros.push(`m.tipo = $${params.length}`);
  }
  if (req.query.desde) {
    params.push(req.query.desde);
    filtros.push(`m.creado_en >= $${params.length}`);
  }
  if (req.query.hasta) {
    params.push(req.query.hasta);
    filtros.push(`m.creado_en <= $${params.length}`);
  }
  const limite = Math.min(500, Math.max(1, Number(req.query.limite) || 100));
  params.push(limite);

  const { rows } = await consulta(
    `SELECT m.id, m.tipo, m.cantidad, m.cantidad_anterior, m.cantidad_nueva,
            m.referencia, m.venta_id, m.creado_en,
            p.nombre AS producto, v.talla, v.color, v.codigo_barras,
            u.nombre AS usuario
       FROM movimientos_inventario m
       JOIN producto_variantes v ON v.id = m.variante_id
       JOIN productos p          ON p.id = v.producto_id
       LEFT JOIN usuarios u      ON u.id = m.usuario_id
      WHERE ${filtros.join(' AND ')}
      ORDER BY m.creado_en DESC
      LIMIT $${params.length}`,
    params,
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// POST /api/inventario/importar/previsualizar
//   Recibe los ítems parseados del XML del SRI y los cruza con la base.
//   body: { items: [{ codigo, descripcion, cantidad, costo_unitario }] }
// ---------------------------------------------------------------------------
router.post('/importar/previsualizar', requiereRol('admin', 'bodega'), async (req, res) => {
  const tiendaId = tiendaObjetivo(req);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const codigos = [...new Set(items.map((i) => String(i.codigo || '').trim()).filter(Boolean))];

  const porCodigo = {};
  if (codigos.length) {
    const { rows } = await consulta(
      `SELECT v.id AS variante_id, v.codigo_barras, v.sku, v.talla, v.color,
              v.precio_venta, v.precio_compra, p.nombre AS producto,
              COALESCE(s.cantidad, 0)::int AS stock
         FROM producto_variantes v
         JOIN productos p ON p.id = v.producto_id
         LEFT JOIN stock s ON s.variante_id = v.id AND s.tienda_id = $2
        WHERE v.codigo_barras = ANY($1) OR v.sku = ANY($1)`,
      [codigos, tiendaId],
    );
    for (const r of rows) {
      if (r.codigo_barras) porCodigo[r.codigo_barras] = r;
      if (r.sku) porCodigo[r.sku] = r;
    }
  }

  const resultado = items.map((i) => {
    const m = porCodigo[String(i.codigo || '').trim()] || null;
    return {
      codigo: i.codigo || null,
      descripcion: i.descripcion || '',
      cantidad: Number(i.cantidad) || 0,
      costo_unitario: Number(i.costo_unitario) || 0,
      match: m
        ? {
          variante_id: m.variante_id, producto: m.producto, talla: m.talla, color: m.color,
          stock: m.stock, precio_venta: Number(m.precio_venta), precio_compra: Number(m.precio_compra),
        }
        : null,
    };
  });
  res.json({ items: resultado });
});

// ---------------------------------------------------------------------------
// POST /api/inventario/importar  — aplica el ingreso desde la factura XML
//   body: {
//     tienda_id?, referencia?,
//     factura?: { proveedor, ruc, numero, fecha },
//     items: [{
//       accion: 'existente' | 'nuevo',
//       variante_id?, cantidad, costo_unitario, precio_venta?,
//       nuevo?: { nombre, categoria_id?, talla?, color?, codigo_barras?, sku?, descripcion? }
//     }]
//   }
// ---------------------------------------------------------------------------
router.post('/importar', requiereRol('admin', 'bodega'), async (req, res) => {
  const tiendaId = tiendaObjetivo(req);
  if (!tiendaId) throw new ErrorHttp(400, 'Debe indicar la tienda del ingreso');
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) throw new ErrorHttp(400, 'No hay ítems para importar');

  const fac = req.body.factura || {};
  const referencia = limpiar(req.body.referencia)
    || `Factura ${[fac.proveedor, fac.numero].filter(Boolean).join(' ')}`.trim()
    || 'Importación de factura';

  // Pre-chequeo: códigos de barras nuevos que ya existen
  const codigosNuevos = items
    .filter((i) => i.accion === 'nuevo')
    .map((i) => limpiar(i.nuevo?.codigo_barras) || limpiar(i.codigo))
    .filter(Boolean);
  if (codigosNuevos.length) {
    const { rows } = await consulta(
      `SELECT codigo_barras FROM producto_variantes WHERE codigo_barras = ANY($1)`, [codigosNuevos],
    );
    if (rows.length) {
      throw new ErrorHttp(409, `Estos códigos ya existen en tu inventario: ${rows.map((r) => r.codigo_barras).join(', ')}. Márcalos como "producto existente".`);
    }
  }

  const resultado = await conTransaccion(async (cli) => {
    let creados = 0;
    let actualizados = 0;
    const movimientos = [];

    for (const it of items) {
      const cantidad = aEntero(it.cantidad, 'cantidad', { min: 1 });
      const costo = aNumero(it.costo_unitario ?? 0, 'costo_unitario', { min: 0 });
      const precioVenta = it.precio_venta !== undefined && it.precio_venta !== null && it.precio_venta !== ''
        ? aNumero(it.precio_venta, 'precio_venta', { min: 0 })
        : null;
      let varianteId;

      if (it.accion === 'nuevo') {
        const n = it.nuevo || {};
        const nombre = String(requerido(n.nombre || it.descripcion, 'nombre del producto')).trim();
        const { rows: p } = await cli.query(
          `INSERT INTO productos (nombre, categoria_id, descripcion) VALUES ($1, $2, $3) RETURNING id`,
          [nombre, n.categoria_id || null, limpiar(n.descripcion)],
        );
        const { rows: v } = await cli.query(
          `INSERT INTO producto_variantes
             (producto_id, talla, color, codigo_barras, sku, precio_compra, precio_venta)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            p[0].id, limpiar(n.talla), limpiar(n.color),
            limpiar(n.codigo_barras) || limpiar(it.codigo), limpiar(n.sku),
            costo, precioVenta ?? costo,
          ],
        );
        varianteId = v[0].id;
        creados++;
      } else {
        varianteId = aEntero(it.variante_id, 'variante_id');
        const sets = ['precio_compra = $1'];
        const vals = [costo];
        if (precioVenta !== null) { vals.push(precioVenta); sets.push(`precio_venta = $${vals.length}`); }
        vals.push(varianteId);
        const { rowCount } = await cli.query(
          `UPDATE producto_variantes SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals,
        );
        if (!rowCount) throw new ErrorHttp(404, `La variante ${varianteId} no existe`);
        actualizados++;
      }

      const { rows: sr } = await cli.query(
        `INSERT INTO stock (variante_id, tienda_id, cantidad) VALUES ($1, $2, $3)
         ON CONFLICT (variante_id, tienda_id)
         DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad
         RETURNING cantidad`,
        [varianteId, tiendaId, cantidad],
      );
      const nueva = sr[0].cantidad;
      const { rows: mr } = await cli.query(
        `INSERT INTO movimientos_inventario
           (variante_id, tienda_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, referencia, usuario_id)
         VALUES ($1, $2, 'entrada', $3, $4, $5, $6, $7) RETURNING id`,
        [varianteId, tiendaId, cantidad, nueva - cantidad, nueva, referencia, req.usuario.id],
      );
      movimientos.push(mr[0].id);
    }

    return { creados, actualizados, movimientos };
  });

  res.status(201).json({ referencia, ...resultado });
});

export default router;

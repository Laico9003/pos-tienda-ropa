import { Router } from 'express';
import { consulta, conTransaccion } from '../db/pool.js';
import { autenticar, requiereRol, tiendaObjetivo } from '../middleware/auth.js';
import { ErrorHttp } from '../middleware/errores.js';
import { requerido, aNumero, aEntero } from '../utils/validacion.js';

const router = Router();
router.use(autenticar);

function limpiar(valor) {
  return valor === undefined || valor === null ? null : String(valor).trim() || null;
}

// ---------------------------------------------------------------------------
// GET /api/productos  — listado con stock de la tienda y sus variantes
//   ?q= texto (nombre o código de barras)   ?categoria_id=   ?activo=true|false
//   ?pagina=1  ?limite=50
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const tiendaId = tiendaObjetivo(req);
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const limite = Math.min(100, Math.max(1, Number(req.query.limite) || 50));

  // params sólo para los filtros ($1, $2, ...)
  const params = [];
  const filtros = [];

  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    filtros.push(`(p.nombre ILIKE $${params.length} OR EXISTS (
      SELECT 1 FROM producto_variantes vx
       WHERE vx.producto_id = p.id
         AND (vx.codigo_barras ILIKE $${params.length} OR vx.sku ILIKE $${params.length})))`);
  }
  if (req.query.categoria_id) {
    params.push(Number(req.query.categoria_id));
    filtros.push(`p.categoria_id = $${params.length}`);
  }
  if (req.query.activo === 'true' || req.query.activo === 'false') {
    params.push(req.query.activo === 'true');
    filtros.push(`p.activo = $${params.length}`);
  } else {
    filtros.push('p.activo = true');
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  const totalRes = await consulta(
    `SELECT COUNT(*)::int AS total FROM productos p ${where}`,
    params,
  );
  const total = totalRes.rows[0].total;

  const idxTienda = params.push(tiendaId);
  const idxLimite = params.push(limite);
  const idxOffset = params.push((pagina - 1) * limite);

  const { rows } = await consulta(
    `SELECT p.id, p.nombre, p.descripcion, p.activo, p.imagen_url,
            p.categoria_id, c.nombre AS categoria,
            COALESCE(SUM(s.cantidad), 0)::int AS stock_total,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', v.id,
                  'talla', v.talla,
                  'color', v.color,
                  'codigo_barras', v.codigo_barras,
                  'sku', v.sku,
                  'precio_compra', v.precio_compra,
                  'precio_venta', v.precio_venta,
                  'activo', v.activo,
                  'stock', COALESCE(s.cantidad, 0)
                ) ORDER BY v.talla NULLS FIRST, v.color NULLS FIRST
              ) FILTER (WHERE v.id IS NOT NULL),
              '[]'
            ) AS variantes
       FROM productos p
       LEFT JOIN categorias c         ON c.id = p.categoria_id
       LEFT JOIN producto_variantes v ON v.producto_id = p.id
       LEFT JOIN stock s              ON s.variante_id = v.id AND s.tienda_id = $${idxTienda}
       ${where}
      GROUP BY p.id, c.nombre
      ORDER BY p.nombre
      LIMIT $${idxLimite} OFFSET $${idxOffset}`,
    params,
  );

  const total_paginas = Math.max(1, Math.ceil(total / limite));
  res.json({ pagina, limite, total, total_paginas, productos: rows });
});

// ---------------------------------------------------------------------------
// GET /api/productos/buscar?codigo=XXX  — lectura de código de barras
// ---------------------------------------------------------------------------
router.get('/buscar', async (req, res) => {
  const codigo = String(requerido(req.query.codigo, 'codigo')).trim();
  const tiendaId = tiendaObjetivo(req);

  const { rows } = await consulta(
    `SELECT v.id AS variante_id, v.talla, v.color, v.codigo_barras, v.sku,
            v.precio_venta, v.precio_compra, v.activo AS variante_activa,
            p.id AS producto_id, p.nombre AS producto, p.activo AS producto_activo,
            p.imagen_url,
            c.nombre AS categoria,
            COALESCE(s.cantidad, 0)::int AS stock
       FROM producto_variantes v
       JOIN productos p        ON p.id = v.producto_id
       LEFT JOIN categorias c  ON c.id = p.categoria_id
       LEFT JOIN stock s       ON s.variante_id = v.id AND s.tienda_id = $2
      WHERE v.codigo_barras = $1 OR v.sku = $1`,
    [codigo, tiendaId],
  );
  if (!rows[0]) throw new ErrorHttp(404, 'No se encontró un producto con ese código');
  res.json(rows[0]);
});

// ---------------------------------------------------------------------------
// GET /api/productos/:id  — detalle con stock por tienda
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const { rows: prod } = await consulta(
    `SELECT p.*, c.nombre AS categoria
       FROM productos p LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE p.id = $1`,
    [req.params.id],
  );
  if (!prod[0]) throw new ErrorHttp(404, 'Producto no encontrado');

  const { rows: variantes } = await consulta(
    `SELECT v.*,
            COALESCE(
              json_agg(
                json_build_object('tienda_id', s.tienda_id, 'tienda', t.nombre, 'cantidad', s.cantidad)
                ORDER BY s.tienda_id
              ) FILTER (WHERE s.id IS NOT NULL), '[]'
            ) AS stock
       FROM producto_variantes v
       LEFT JOIN stock s   ON s.variante_id = v.id
       LEFT JOIN tiendas t ON t.id = s.tienda_id
      WHERE v.producto_id = $1
      GROUP BY v.id
      ORDER BY v.talla NULLS FIRST, v.color NULLS FIRST`,
    [req.params.id],
  );

  res.json({ ...prod[0], variantes });
});

// ---------------------------------------------------------------------------
// POST /api/productos  — crea el producto y sus variantes (talla/color)
// ---------------------------------------------------------------------------
router.post('/', requiereRol('admin', 'bodega'), async (req, res) => {
  const nombre = String(requerido(req.body.nombre, 'nombre')).trim();
  const categoriaId = req.body.categoria_id ? aEntero(req.body.categoria_id, 'categoria_id') : null;
  const descripcion = limpiar(req.body.descripcion);
  const imagenUrl = req.body.imagen_url ? String(req.body.imagen_url) : null;
  const variantes = Array.isArray(req.body.variantes) ? req.body.variantes : [];
  if (variantes.length === 0) throw new ErrorHttp(400, 'Debe incluir al menos una variante (talla / color)');

  const creado = await conTransaccion(async (cli) => {
    const { rows: p } = await cli.query(
      `INSERT INTO productos (nombre, categoria_id, descripcion, imagen_url) VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, categoriaId, descripcion, imagenUrl],
    );
    const producto = p[0];
    const variantesCreadas = [];

    for (const v of variantes) {
      const { rows: vr } = await cli.query(
        `INSERT INTO producto_variantes
           (producto_id, talla, color, codigo_barras, sku, precio_compra, precio_venta)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          producto.id,
          limpiar(v.talla),
          limpiar(v.color),
          limpiar(v.codigo_barras),
          limpiar(v.sku),
          aNumero(v.precio_compra ?? 0, 'precio_compra', { min: 0 }),
          aNumero(v.precio_venta ?? 0, 'precio_venta', { min: 0 }),
        ],
      );
      const variante = vr[0];

      // Stock inicial opcional: [{ tienda_id, cantidad }]
      for (const si of Array.isArray(v.stock_inicial) ? v.stock_inicial : []) {
        const tId = aEntero(si.tienda_id, 'stock_inicial.tienda_id');
        const cant = aEntero(si.cantidad, 'stock_inicial.cantidad', { min: 0 });
        if (cant === 0) continue;
        await cli.query(
          `INSERT INTO stock (variante_id, tienda_id, cantidad) VALUES ($1, $2, $3)
           ON CONFLICT (variante_id, tienda_id)
           DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad`,
          [variante.id, tId, cant],
        );
        await cli.query(
          `INSERT INTO movimientos_inventario
             (variante_id, tienda_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, referencia, usuario_id)
           VALUES ($1, $2, 'entrada', $3, 0, $3, 'Stock inicial', $4)`,
          [variante.id, tId, cant, req.usuario.id],
        );
      }
      variantesCreadas.push(variante);
    }

    return { ...producto, variantes: variantesCreadas };
  });

  res.status(201).json(creado);
});

// ---------------------------------------------------------------------------
// PUT /api/productos/:id
// ---------------------------------------------------------------------------
router.put('/:id', requiereRol('admin', 'bodega'), async (req, res) => {
  const { nombre, categoria_id, descripcion, activo } = req.body;
  const tocaImagen = req.body.imagen_url !== undefined; // permite fijarla o borrarla (null)
  const { rows } = await consulta(
    `UPDATE productos SET
        nombre       = COALESCE($1, nombre),
        categoria_id = COALESCE($2, categoria_id),
        descripcion  = COALESCE($3, descripcion),
        activo       = COALESCE($4, activo),
        imagen_url   = CASE WHEN $5::boolean THEN $6 ELSE imagen_url END
      WHERE id = $7
      RETURNING *`,
    [
      nombre ? String(nombre).trim() : null,
      categoria_id ?? null,
      descripcion ?? null,
      typeof activo === 'boolean' ? activo : null,
      tocaImagen,
      tocaImagen ? (req.body.imagen_url || null) : null,
      req.params.id,
    ],
  );
  if (!rows[0]) throw new ErrorHttp(404, 'Producto no encontrado');
  res.json(rows[0]);
});

// ---------------------------------------------------------------------------
// POST /api/productos/:id/variantes  — añade una variante a un producto
// ---------------------------------------------------------------------------
router.post('/:id/variantes', requiereRol('admin', 'bodega'), async (req, res) => {
  const existe = await consulta(`SELECT 1 FROM productos WHERE id = $1`, [req.params.id]);
  if (existe.rowCount === 0) throw new ErrorHttp(404, 'Producto no encontrado');

  const v = req.body;
  const { rows } = await consulta(
    `INSERT INTO producto_variantes
       (producto_id, talla, color, codigo_barras, sku, precio_compra, precio_venta)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      req.params.id,
      limpiar(v.talla),
      limpiar(v.color),
      limpiar(v.codigo_barras),
      limpiar(v.sku),
      aNumero(v.precio_compra ?? 0, 'precio_compra', { min: 0 }),
      aNumero(v.precio_venta ?? 0, 'precio_venta', { min: 0 }),
    ],
  );
  res.status(201).json(rows[0]);
});

// ---------------------------------------------------------------------------
// PUT /api/productos/variantes/:varianteId  — edita precios / datos
//   (el stock NO se toca aquí; se maneja desde /api/inventario)
// ---------------------------------------------------------------------------
router.put('/variantes/:varianteId', requiereRol('admin', 'bodega'), async (req, res) => {
  const v = req.body;
  const { rows } = await consulta(
    `UPDATE producto_variantes SET
        talla         = COALESCE($1, talla),
        color         = COALESCE($2, color),
        codigo_barras = COALESCE($3, codigo_barras),
        sku           = COALESCE($4, sku),
        precio_compra = COALESCE($5, precio_compra),
        precio_venta  = COALESCE($6, precio_venta),
        activo        = COALESCE($7, activo)
      WHERE id = $8
      RETURNING *`,
    [
      v.talla !== undefined ? limpiar(v.talla) : null,
      v.color !== undefined ? limpiar(v.color) : null,
      v.codigo_barras !== undefined ? limpiar(v.codigo_barras) : null,
      v.sku !== undefined ? limpiar(v.sku) : null,
      v.precio_compra !== undefined ? aNumero(v.precio_compra, 'precio_compra', { min: 0 }) : null,
      v.precio_venta !== undefined ? aNumero(v.precio_venta, 'precio_venta', { min: 0 }) : null,
      typeof v.activo === 'boolean' ? v.activo : null,
      req.params.varianteId,
    ],
  );
  if (!rows[0]) throw new ErrorHttp(404, 'Variante no encontrada');
  res.json(rows[0]);
});

export default router;

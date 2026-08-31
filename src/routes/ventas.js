import { Router } from 'express';
import { consulta, conTransaccion } from '../db/pool.js';
import { autenticar, requiereRol, tiendaObjetivo } from '../middleware/auth.js';
import { ErrorHttp } from '../middleware/errores.js';
import { aNumero, aEntero, redondear2 } from '../utils/validacion.js';
import { upsertCliente } from './clientes.js';

const router = Router();
router.use(autenticar);

const TOLERANCIA = 0.005; // margen para comparaciones de centavos

// ---------------------------------------------------------------------------
// POST /api/ventas  — registra una venta completa (transacción atómica)
//   body: {
//     tienda_id?,                          // solo admin
//     cliente?: { nombre, identificacion, email, direccion },
//     items: [{ variante_id, cantidad, precio_unitario?, descuento? }],
//     descuento_total?,                    // descuento a nivel de venta
//     pagos: [{ metodo: 'efectivo'|'transferencia', monto, referencia? }]
//   }
// ---------------------------------------------------------------------------
router.post('/', requiereRol('admin', 'vendedor'), async (req, res) => {
  const tiendaId = tiendaObjetivo(req);
  if (!tiendaId) throw new ErrorHttp(400, 'No se pudo determinar la tienda de la venta');

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) throw new ErrorHttp(400, 'La venta debe tener al menos un producto');

  const pagos = Array.isArray(req.body.pagos) ? req.body.pagos : [];
  if (pagos.length === 0) throw new ErrorHttp(400, 'Debe registrar al menos un pago');

  // No permitir la misma variante en dos líneas (evita descuentos de stock confusos).
  const ids = items.map((it) => Number(it.variante_id));
  if (new Set(ids).size !== ids.length) {
    throw new ErrorHttp(400, 'Un producto aparece varias veces; combínalo en una sola línea con la cantidad total');
  }

  const descuentoTotal = redondear2(aNumero(req.body.descuento_total ?? 0, 'descuento_total', { min: 0 }));
  const cliente = req.body.cliente || {};

  // Caja: se vincula la venta con la caja abierta de la tienda (y se exige si el negocio lo pide).
  const [{ rows: cajaRows }, { rows: negRows }] = await Promise.all([
    consulta(`SELECT id FROM cajas WHERE tienda_id = $1 AND estado = 'abierta'`, [tiendaId]),
    consulta(`SELECT exigir_caja FROM negocio WHERE id = 1`),
  ]);
  const cajaId = cajaRows[0]?.id || null;
  if (!cajaId && negRows[0]?.exigir_caja) {
    throw new ErrorHttp(409, 'Debes abrir la caja antes de registrar ventas');
  }

  const venta = await conTransaccion(async (cli) => {
    let subtotal = 0;
    const lineas = [];

    for (const it of items) {
      const varianteId = aEntero(it.variante_id, 'items.variante_id');
      const cantidad = aEntero(it.cantidad, 'items.cantidad', { min: 1 });
      const descLinea = redondear2(aNumero(it.descuento ?? 0, 'items.descuento', { min: 0 }));

      const { rows: info } = await cli.query(
        `SELECT v.precio_venta, v.codigo_barras, v.talla, v.color,
                v.activo AS variante_activa,
                p.nombre AS producto, p.activo AS producto_activo
           FROM producto_variantes v
           JOIN productos p ON p.id = v.producto_id
          WHERE v.id = $1`,
        [varianteId],
      );
      const prod = info[0];
      if (!prod) throw new ErrorHttp(404, `La variante ${varianteId} no existe`);
      if (!prod.variante_activa || !prod.producto_activo) {
        throw new ErrorHttp(409, `El producto "${prod.producto}" está inactivo y no se puede vender`);
      }

      // Asegura que exista la fila de stock y la bloquea para evitar sobreventa concurrente.
      await cli.query(
        `INSERT INTO stock (variante_id, tienda_id, cantidad) VALUES ($1, $2, 0)
         ON CONFLICT (variante_id, tienda_id) DO NOTHING`,
        [varianteId, tiendaId],
      );
      const { rows: st } = await cli.query(
        `SELECT cantidad FROM stock WHERE variante_id = $1 AND tienda_id = $2 FOR UPDATE`,
        [varianteId, tiendaId],
      );
      const disponible = st[0].cantidad;

      if (disponible < cantidad) {
        const etiqueta = [prod.producto, prod.talla, prod.color].filter(Boolean).join(' ');
        throw new ErrorHttp(
          409,
          `Stock insuficiente de "${etiqueta}". Disponible: ${disponible}, solicitado: ${cantidad}`,
        );
      }

      const precioUnitario =
        it.precio_unitario !== undefined
          ? redondear2(aNumero(it.precio_unitario, 'items.precio_unitario', { min: 0 }))
          : Number(prod.precio_venta);

      const totalLinea = redondear2(precioUnitario * cantidad - descLinea);
      if (totalLinea < 0) throw new ErrorHttp(400, 'El descuento de una línea no puede superar su valor');
      subtotal = redondear2(subtotal + totalLinea);

      lineas.push({
        varianteId,
        cantidad,
        precioUnitario,
        descLinea,
        totalLinea,
        stockPrevio: disponible,
        codigoBarras: prod.codigo_barras,
        descripcion: [prod.producto, prod.talla, prod.color].filter(Boolean).join(
          prod.talla || prod.color ? ' - ' : '',
        ),
      });
    }

    const total = redondear2(subtotal - descuentoTotal);
    if (total < 0) throw new ErrorHttp(400, 'El descuento total no puede superar el subtotal');

    // ---- Validación de pagos ----
    let totalPagado = 0;
    let totalEfectivo = 0;
    const pagosLimpios = pagos.map((p) => {
      const metodo = String(p.metodo || '').toLowerCase();
      if (!['efectivo', 'transferencia'].includes(metodo)) {
        throw new ErrorHttp(400, `Método de pago inválido: "${p.metodo}". Use efectivo o transferencia`);
      }
      const monto = redondear2(aNumero(p.monto, 'pagos.monto', { min: 0.01 }));
      totalPagado = redondear2(totalPagado + monto);
      if (metodo === 'efectivo') totalEfectivo = redondear2(totalEfectivo + monto);
      const limpio = (x) => (x ? String(x).trim() || null : null);
      return {
        metodo, monto,
        banco: limpio(p.banco),
        documento: limpio(p.documento),
        referencia: limpio(p.referencia),
      };
    });

    if (totalPagado + TOLERANCIA < total) {
      throw new ErrorHttp(400, `El pago recibido (${totalPagado}) no cubre el total de la venta (${total})`);
    }
    const cambio = redondear2(totalPagado - total);
    if (cambio > totalEfectivo + TOLERANCIA) {
      throw new ErrorHttp(400, 'El vuelto solo puede darse contra el pago en efectivo, no en transferencia');
    }

    // ---- Inserta la venta ----
    const { rows: vr } = await cli.query(
      `INSERT INTO ventas
         (tienda_id, usuario_id, cliente_nombre, cliente_identificacion, cliente_email, cliente_direccion,
          cliente_telefono, subtotal, descuento_total, total, total_pagado, cambio, caja_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        tiendaId,
        req.usuario.id,
        cliente.nombre ? String(cliente.nombre).trim() : null,
        cliente.identificacion ? String(cliente.identificacion).replace(/\D/g, '').slice(0, 13) || null : null,
        cliente.email ? String(cliente.email).trim() : null,
        cliente.direccion ? String(cliente.direccion).trim() : null,
        cliente.telefono ? String(cliente.telefono).trim() : null,
        subtotal,
        descuentoTotal,
        total,
        totalPagado,
        cambio,
        cajaId,
      ],
    );
    const nuevaVenta = vr[0];

    // ---- Ítems + descuento de stock + kardex ----
    for (const l of lineas) {
      await cli.query(
        `INSERT INTO venta_items
           (venta_id, variante_id, descripcion, codigo_barras, cantidad, precio_unitario, descuento, total_linea)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [nuevaVenta.id, l.varianteId, l.descripcion, l.codigoBarras, l.cantidad, l.precioUnitario, l.descLinea, l.totalLinea],
      );
      await cli.query(
        `UPDATE stock SET cantidad = cantidad - $1 WHERE variante_id = $2 AND tienda_id = $3`,
        [l.cantidad, l.varianteId, tiendaId],
      );
      await cli.query(
        `INSERT INTO movimientos_inventario
           (variante_id, tienda_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, referencia, venta_id, usuario_id)
         VALUES ($1, $2, 'venta', $3, $4, $5, $6, $7, $8)`,
        [
          l.varianteId,
          tiendaId,
          l.cantidad,
          l.stockPrevio,
          l.stockPrevio - l.cantidad,
          `Venta #${nuevaVenta.id}`,
          nuevaVenta.id,
          req.usuario.id,
        ],
      );
    }

    // ---- Pagos ----
    for (const p of pagosLimpios) {
      await cli.query(
        `INSERT INTO pagos (venta_id, metodo, monto, banco, documento, referencia)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [nuevaVenta.id, p.metodo, p.monto, p.banco, p.documento, p.referencia],
      );
    }

    return { ...nuevaVenta, items: lineas, pagos: pagosLimpios };
  });

  res.status(201).json(venta);

  // Guarda/actualiza el cliente para autocompletar la próxima vez (sin bloquear).
  if (cliente.identificacion) {
    upsertCliente(cliente).catch((e) => console.error('[cliente]', e.message));
  }
  // Factura electrónica automática (si está activada), sin bloquear la respuesta.
  encolarFacturaAuto(venta.id).catch((e) => console.error('[SRI auto]', e.message));
});

/** Crea el comprobante SRI si el negocio tiene activada la emisión automática. */
async function encolarFacturaAuto(ventaId) {
  const { rows: n } = await consulta(
    `SELECT emitir_factura_auto, ruc, certificado_p12, ambiente_sri FROM negocio WHERE id = 1`,
  );
  if (!n[0]?.emitir_factura_auto || !n[0].ruc || !n[0].certificado_p12) return;

  const { rows: v } = await consulta(
    `SELECT v.tienda_id, v.cliente_email, t.codigo_establecimiento, t.punto_emision
       FROM ventas v JOIN tiendas t ON t.id = v.tienda_id WHERE v.id = $1`, [ventaId],
  );
  if (!v[0]) return;
  const ex = await consulta(`SELECT 1 FROM comprobantes_sri WHERE venta_id = $1 LIMIT 1`, [ventaId]);
  if (ex.rowCount) return;

  const ambiente = n[0].ambiente_sri === 'produccion' ? '2' : '1';
  await conTransaccion(async (cli) => {
    const { rows: sec } = await cli.query(
      `INSERT INTO secuencias (tienda_id, tipo, secuencial) VALUES ($1, '01', 1)
       ON CONFLICT (tienda_id, tipo) DO UPDATE SET secuencial = secuencias.secuencial + 1
       RETURNING secuencial`,
      [v[0].tienda_id],
    );
    await cli.query(
      `INSERT INTO comprobantes_sri (venta_id, tipo, ambiente, estab, pto_emi, secuencial, correo_destino)
       VALUES ($1, '01', $2, $3, $4, $5, $6)`,
      [
        ventaId, ambiente,
        String(v[0].codigo_establecimiento || '001').padStart(3, '0'),
        String(v[0].punto_emision || '001').padStart(3, '0'),
        String(sec[0].secuencial).padStart(9, '0'),
        v[0].cliente_email || null,
      ],
    );
  });
  await consulta(`UPDATE ventas SET estado_sri = 'pendiente' WHERE id = $1`, [ventaId]);
}

// ---------------------------------------------------------------------------
// GET /api/ventas  — historial
//   ?desde=  ?hasta=  ?usuario_id=  ?estado=  ?tienda_id= (admin)  ?pagina=  ?limite=
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const params = [];
  const filtros = [];

  if (req.usuario.rol === 'admin') {
    if (req.query.tienda_id) {
      params.push(Number(req.query.tienda_id));
      filtros.push(`v.tienda_id = $${params.length}`);
    }
  } else {
    params.push(req.usuario.tienda_id);
    filtros.push(`v.tienda_id = $${params.length}`);
  }
  if (req.query.usuario_id) {
    params.push(Number(req.query.usuario_id));
    filtros.push(`v.usuario_id = $${params.length}`);
  }
  if (req.query.estado) {
    params.push(String(req.query.estado));
    filtros.push(`v.estado = $${params.length}`);
  }
  if (req.query.desde) {
    params.push(req.query.desde);
    filtros.push(`v.creado_en >= $${params.length}`);
  }
  if (req.query.hasta) {
    params.push(req.query.hasta);
    filtros.push(`v.creado_en <= $${params.length}`);
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 50));
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  params.push(limite, (pagina - 1) * limite);

  const { rows } = await consulta(
    `SELECT v.id, v.creado_en, v.tienda_id, t.nombre AS tienda, u.nombre AS vendedor,
            v.cliente_nombre, v.subtotal, v.descuento_total, v.total,
            v.total_pagado, v.cambio, v.estado, v.estado_sri,
            COALESCE(
              json_agg(json_build_object('metodo', pg.metodo, 'monto', pg.monto))
                FILTER (WHERE pg.id IS NOT NULL), '[]'
            ) AS pagos
       FROM ventas v
       JOIN tiendas t   ON t.id = v.tienda_id
       JOIN usuarios u  ON u.id = v.usuario_id
       LEFT JOIN pagos pg ON pg.venta_id = v.id
       ${where}
      GROUP BY v.id, t.nombre, u.nombre
      ORDER BY v.creado_en DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ pagina, limite, ventas: rows });
});

// ---------------------------------------------------------------------------
// POST /api/ventas/:id/anular  — solo admin. Repone stock.
// ---------------------------------------------------------------------------
router.post('/:id/anular', requiereRol('admin'), async (req, res) => {
  const ventaId = aEntero(req.params.id, 'id');
  const motivo = req.body.motivo ? String(req.body.motivo).trim() : 'Anulación';

  const resultado = await conTransaccion(async (cli) => {
    const { rows } = await cli.query(`SELECT * FROM ventas WHERE id = $1 FOR UPDATE`, [ventaId]);
    const venta = rows[0];
    if (!venta) throw new ErrorHttp(404, 'Venta no encontrada');
    if (venta.estado === 'anulada') throw new ErrorHttp(409, 'La venta ya está anulada');
    if (['recibida', 'autorizada'].includes(venta.estado_sri)) {
      throw new ErrorHttp(409, 'La venta ya tiene comprobante electrónico; corresponde emitir una nota de crédito (Fase SRI)');
    }

    const { rows: items } = await cli.query(`SELECT * FROM venta_items WHERE venta_id = $1`, [ventaId]);
    for (const it of items) {
      const { rows: sr } = await cli.query(
        `INSERT INTO stock (variante_id, tienda_id, cantidad) VALUES ($1, $2, $3)
         ON CONFLICT (variante_id, tienda_id)
         DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad
         RETURNING cantidad`,
        [it.variante_id, venta.tienda_id, it.cantidad],
      );
      const nueva = sr[0].cantidad;
      await cli.query(
        `INSERT INTO movimientos_inventario
           (variante_id, tienda_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, referencia, venta_id, usuario_id)
         VALUES ($1, $2, 'anulacion_venta', $3, $4, $5, $6, $7, $8)`,
        [it.variante_id, venta.tienda_id, it.cantidad, nueva - it.cantidad, nueva, `Anulación venta #${ventaId}`, ventaId, req.usuario.id],
      );
    }

    const { rows: vr } = await cli.query(
      `UPDATE ventas
          SET estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3
        WHERE id = $1
        RETURNING *`,
      [ventaId, req.usuario.id, motivo],
    );
    return vr[0];
  });

  res.json(resultado);
});

// ---------------------------------------------------------------------------
// PUT /api/ventas/:id/nota  — agrega o cambia una nota interna
// ---------------------------------------------------------------------------
router.put('/:id/nota', requiereRol('admin', 'vendedor'), async (req, res) => {
  const nota = req.body.nota ? String(req.body.nota).trim() : null;
  const { rows } = await consulta(`SELECT tienda_id FROM ventas WHERE id = $1`, [req.params.id]);
  if (!rows[0]) throw new ErrorHttp(404, 'Venta no encontrada');
  if (req.usuario.rol !== 'admin' && rows[0].tienda_id !== req.usuario.tienda_id) {
    throw new ErrorHttp(403, 'No puedes modificar ventas de otra tienda');
  }
  const { rows: upd } = await consulta(
    `UPDATE ventas SET nota = $1 WHERE id = $2 RETURNING id, nota`,
    [nota, req.params.id],
  );
  res.json(upd[0]);
});

// ---------------------------------------------------------------------------
// PUT /api/ventas/pagos/:pagoId/verificado  — marca/desmarca un pago como conciliado
// ---------------------------------------------------------------------------
router.put('/pagos/:pagoId/verificado', requiereRol('admin', 'vendedor'), async (req, res) => {
  const verificado = !!req.body.verificado;
  const { rows } = await consulta(
    `SELECT pg.id, v.tienda_id FROM pagos pg JOIN ventas v ON v.id = pg.venta_id WHERE pg.id = $1`,
    [req.params.pagoId],
  );
  if (!rows[0]) throw new ErrorHttp(404, 'Pago no encontrado');
  if (req.usuario.rol !== 'admin' && rows[0].tienda_id !== req.usuario.tienda_id) {
    throw new ErrorHttp(403, 'No puedes modificar pagos de otra tienda');
  }
  const { rows: upd } = await consulta(
    `UPDATE pagos SET verificado = $1, verificado_en = CASE WHEN $1 THEN now() ELSE NULL END
      WHERE id = $2 RETURNING id, verificado, verificado_en`,
    [verificado, req.params.pagoId],
  );
  res.json(upd[0]);
});

// ---------------------------------------------------------------------------
// POST /api/ventas/:id/facturar  — encola la factura electrónica (Fase SRI)
//   body opcional: { email } o { cliente: { identificacion, nombre, email, telefono, direccion } }
// ---------------------------------------------------------------------------
router.post('/:id/facturar', requiereRol('admin', 'vendedor'), async (req, res) => {
  const { rows: vr } = await consulta(
    `SELECT v.*, t.codigo_establecimiento, t.punto_emision
       FROM ventas v JOIN tiendas t ON t.id = v.tienda_id WHERE v.id = $1`,
    [req.params.id],
  );
  const venta = vr[0];
  if (!venta) throw new ErrorHttp(404, 'Venta no encontrada');
  if (req.usuario.rol !== 'admin' && venta.tienda_id !== req.usuario.tienda_id) {
    throw new ErrorHttp(403, 'No puedes facturar ventas de otra tienda');
  }
  if (venta.estado !== 'completada') throw new ErrorHttp(409, 'Solo se pueden facturar ventas completadas');

  const { rows: neg } = await consulta(`SELECT ruc, certificado_p12, ambiente_sri FROM negocio WHERE id = 1`);
  if (!neg[0]?.ruc || !neg[0]?.certificado_p12) {
    throw new ErrorHttp(400, 'Configura el RUC y el certificado .p12 en "Datos del negocio" antes de facturar');
  }

  // Si vienen datos del cliente, se guardan en la venta y en la libreta de clientes.
  const cli = req.body.cliente;
  if (cli && (cli.identificacion || cli.nombre)) {
    const idLimpia = cli.identificacion ? String(cli.identificacion).replace(/\D/g, '').slice(0, 13) : null;
    await consulta(
      `UPDATE ventas SET
         cliente_identificacion = COALESCE($2, cliente_identificacion),
         cliente_nombre         = COALESCE($3, cliente_nombre),
         cliente_email          = COALESCE($4, cliente_email),
         cliente_telefono       = COALESCE($5, cliente_telefono),
         cliente_direccion      = COALESCE($6, cliente_direccion)
       WHERE id = $1`,
      [venta.id, idLimpia, cli.nombre || null, cli.email || null, cli.telefono || null, cli.direccion || null],
    );
    venta.cliente_email = cli.email || venta.cliente_email;
    upsertCliente({ ...cli, identificacion: idLimpia }).catch((e) => console.error('[cliente]', e.message));
  }

  // ¿Ya existe un comprobante utilizable?
  const { rows: ex } = await consulta(
    `SELECT * FROM comprobantes_sri WHERE venta_id = $1 ORDER BY id DESC LIMIT 1`, [venta.id],
  );
  if (ex[0] && !['devuelta', 'no_autorizada', 'error'].includes(ex[0].estado)) {
    return res.status(200).json({ ya_existe: true, comprobante: ex[0] });
  }

  const emailDestino = (req.body.email || req.body.cliente?.email || venta.cliente_email || '').trim() || null;
  const ambiente = neg[0].ambiente_sri === 'produccion' ? '2' : '1';

  const comprobante = await conTransaccion(async (cli) => {
    const { rows: sec } = await cli.query(
      `INSERT INTO secuencias (tienda_id, tipo, secuencial) VALUES ($1, '01', 1)
       ON CONFLICT (tienda_id, tipo) DO UPDATE SET secuencial = secuencias.secuencial + 1
       RETURNING secuencial`,
      [venta.tienda_id],
    );
    const secuencial = String(sec[0].secuencial).padStart(9, '0');
    const { rows: c } = await cli.query(
      `INSERT INTO comprobantes_sri
         (venta_id, tipo, ambiente, estab, pto_emi, secuencial, correo_destino, proximo_intento)
       VALUES ($1, '01', $2, $3, $4, $5, $6, now())
       RETURNING *`,
      [
        venta.id, ambiente,
        String(venta.codigo_establecimiento || '001').padStart(3, '0'),
        String(venta.punto_emision || '001').padStart(3, '0'),
        secuencial, emailDestino,
      ],
    );
    return c[0];
  });

  await consulta(`UPDATE ventas SET estado_sri = 'pendiente', cliente_email = COALESCE(cliente_email, $2) WHERE id = $1`,
    [venta.id, emailDestino]);

  res.status(201).json({ comprobante });
});

// ---------------------------------------------------------------------------
// GET /api/ventas/:id  — detalle con ítems y pagos
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const { rows } = await consulta(
    `SELECT v.*, t.nombre AS tienda, u.nombre AS vendedor
       FROM ventas v
       JOIN tiendas t  ON t.id = v.tienda_id
       JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.id = $1`,
    [req.params.id],
  );
  const venta = rows[0];
  if (!venta) throw new ErrorHttp(404, 'Venta no encontrada');
  if (req.usuario.rol !== 'admin' && venta.tienda_id !== req.usuario.tienda_id) {
    throw new ErrorHttp(403, 'No puedes ver ventas de otra tienda');
  }

  const { rows: items } = await consulta(
    `SELECT * FROM venta_items WHERE venta_id = $1 ORDER BY id`,
    [req.params.id],
  );
  const { rows: pagos } = await consulta(
    `SELECT * FROM pagos WHERE venta_id = $1 ORDER BY id`,
    [req.params.id],
  );
  const { rows: comp } = await consulta(
    `SELECT id, estado, estab, pto_emi, secuencial, clave_acceso, numero_autorizacion,
            fecha_autorizacion, correo_destino, correo_enviado, mensajes
       FROM comprobantes_sri WHERE venta_id = $1 ORDER BY id DESC LIMIT 1`,
    [req.params.id],
  );
  res.json({ ...venta, items, pagos, comprobante: comp[0] || null });
});

export default router;

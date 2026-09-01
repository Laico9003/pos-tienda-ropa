import { Router } from 'express';
import { consulta } from '../db/pool.js';
import { autenticar, requiereRol } from '../middleware/auth.js';
import { ErrorHttp } from '../middleware/errores.js';
import { procesarComprobante } from '../sri/emisor.js';
import { construirFactura } from '../sri/construirFactura.js';
import { generarRidePDF } from '../sri/ride.js';

const router = Router();
router.use(autenticar);

// GET /api/comprobantes?estado=&desde=&hasta=&pagina=
router.get('/', async (req, res) => {
  const params = [];
  const filtros = [];
  if (req.usuario.rol !== 'admin') {
    params.push(req.usuario.tienda_id);
    filtros.push(`v.tienda_id = $${params.length}`);
  } else if (req.query.tienda_id) {
    params.push(Number(req.query.tienda_id));
    filtros.push(`v.tienda_id = $${params.length}`);
  }
  if (req.query.estado) { params.push(String(req.query.estado)); filtros.push(`c.estado = $${params.length}`); }
  if (req.query.desde) { params.push(req.query.desde); filtros.push(`c.creado_en >= $${params.length}`); }
  if (req.query.hasta) { params.push(req.query.hasta); filtros.push(`c.creado_en <= $${params.length}`); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 50));
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  params.push(limite, (pagina - 1) * limite);

  const { rows } = await consulta(
    `SELECT c.id, c.venta_id, c.estab, c.pto_emi, c.secuencial, c.clave_acceso,
            c.estado, c.numero_autorizacion, c.fecha_autorizacion, c.intentos,
            c.correo_destino, c.correo_enviado, c.mensajes, c.creado_en,
            v.total, v.cliente_nombre, v.creado_en AS venta_fecha, t.nombre AS tienda
       FROM comprobantes_sri c
       JOIN ventas v  ON v.id = c.venta_id
       JOIN tiendas t ON t.id = v.tienda_id
       ${where}
      ORDER BY c.creado_en DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ pagina, limite, comprobantes: rows });
});

async function traer(id, usuario) {
  const { rows } = await consulta(
    `SELECT c.*, v.tienda_id FROM comprobantes_sri c JOIN ventas v ON v.id = c.venta_id WHERE c.id = $1`,
    [id],
  );
  const comp = rows[0];
  if (!comp) throw new ErrorHttp(404, 'Comprobante no encontrado');
  if (usuario.rol !== 'admin' && comp.tienda_id !== usuario.tienda_id) {
    throw new ErrorHttp(403, 'No puedes ver comprobantes de otra tienda');
  }
  return comp;
}

// GET /api/comprobantes/:id
router.get('/:id', async (req, res) => {
  const comp = await traer(req.params.id, req.usuario);
  res.json(comp);
});

// POST /api/comprobantes/:id/reintentar  — vuelve a poner el comprobante en cola
router.post('/:id/reintentar', requiereRol('admin'), async (req, res) => {
  const comp = await traer(req.params.id, req.usuario);
  if (comp.estado === 'autorizada') throw new ErrorHttp(409, 'El comprobante ya está autorizado');
  // Reinicia desde cero: descarta clave/XML viejos para regenerarlos (evita desfases de fecha).
  await consulta(
    `UPDATE comprobantes_sri SET
        estado = 'pendiente', intentos = 0, proximo_intento = now(), mensajes = NULL, actualizado_en = now(),
        clave_acceso = NULL, xml_firmado = NULL, xml_autorizado = NULL,
        numero_autorizacion = NULL, fecha_autorizacion = NULL
      WHERE id = $1`,
    [comp.id],
  );
  procesarComprobante({ ...comp, estado: 'pendiente', intentos: 0, clave_acceso: null, xml_firmado: null })
    .catch(() => {});
  res.json({ ok: true, estado: 'pendiente' });
});

// POST /api/comprobantes/:id/reenviar-correo  — reintenta SOLO el envío del correo
router.post('/:id/reenviar-correo', requiereRol('admin'), async (req, res) => {
  const comp = await traer(req.params.id, req.usuario);
  if (comp.estado !== 'autorizada') {
    throw new ErrorHttp(409, 'El comprobante todavía no está autorizado por el SRI');
  }
  const destino = String(req.body?.correo || comp.correo_destino || '').trim();
  if (!destino) throw new ErrorHttp(400, 'No hay correo de destino para este comprobante');
  await consulta(
    `UPDATE comprobantes_sri SET
        correo_enviado = false, correo_destino = $2,
        intentos = 0, proximo_intento = now(), mensajes = NULL, actualizado_en = now()
      WHERE id = $1`,
    [comp.id, destino],
  );
  procesarComprobante({ ...comp, correo_enviado: false, correo_destino: destino, intentos: 0 })
    .catch(() => {});
  res.json({ ok: true });
});

// GET /api/comprobantes/:id/xml  — XML autorizado (o el firmado si aún no)
router.get('/:id/xml', async (req, res) => {
  const comp = await traer(req.params.id, req.usuario);
  const xml = comp.xml_autorizado || comp.xml_firmado;
  if (!xml) throw new ErrorHttp(404, 'Todavía no hay XML generado');
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="factura-${comp.secuencial}.xml"`);
  res.send(xml);
});

// GET /api/comprobantes/:id/ride  — PDF
router.get('/:id/ride', async (req, res) => {
  const comp = await traer(req.params.id, req.usuario);
  const { rows: v } = await consulta(
    `SELECT ve.*, t.nombre AS tienda, u.nombre AS vendedor
       FROM ventas ve JOIN tiendas t ON t.id = ve.tienda_id JOIN usuarios u ON u.id = ve.usuario_id
      WHERE ve.id = $1`, [comp.venta_id],
  );
  const { rows: items } = await consulta(`SELECT * FROM venta_items WHERE venta_id = $1 ORDER BY id`, [comp.venta_id]);
  const { rows: pagos } = await consulta(`SELECT * FROM pagos WHERE venta_id = $1 ORDER BY id`, [comp.venta_id]);
  const { rows: neg } = await consulta(`SELECT * FROM negocio WHERE id = 1`);

  const { resumen } = construirFactura({ venta: v[0], items, pagos, negocio: neg[0], comprobante: comp });
  const pdf = await generarRidePDF({ negocio: neg[0], venta: { ...v[0], items, pagos }, comprobante: comp, resumen });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="factura-${comp.secuencial}.pdf"`);
  res.send(pdf);
});

export default router;

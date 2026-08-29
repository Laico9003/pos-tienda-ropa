import { Router } from 'express';
import { consulta, conTransaccion } from '../db/pool.js';
import { autenticar, requiereRol, tiendaObjetivo } from '../middleware/auth.js';
import { ErrorHttp } from '../middleware/errores.js';
import { aNumero, redondear2 } from '../utils/validacion.js';

const router = Router();
router.use(autenticar);

const puedeCaja = requiereRol('admin', 'vendedor');

/** Suma un desglose { billetes:{'100':n,...}, monedas:{'0.50':n,...} } -> total en $. */
export function totalDesglose(d) {
  if (!d || typeof d !== 'object') return 0;
  let t = 0;
  for (const grupo of ['billetes', 'monedas']) {
    const g = d[grupo] || {};
    for (const [denom, cant] of Object.entries(g)) {
      t += Number(denom) * (Number(cant) || 0);
    }
  }
  return redondear2(t);
}

/** Totales en vivo de una caja abierta: ventas en efectivo/transferencia, retiros, esperado. */
async function totalesCaja(cajaId, fondoInicial) {
  const { rows: v } = await consulta(
    `WITH x AS (
       SELECT ve.id, ve.cambio,
              COALESCE(SUM(pg.monto) FILTER (WHERE pg.metodo = 'efectivo'), 0) AS ef,
              COALESCE(SUM(pg.monto) FILTER (WHERE pg.metodo = 'transferencia'), 0) AS tr
         FROM ventas ve
         LEFT JOIN pagos pg ON pg.venta_id = ve.id
        WHERE ve.caja_id = $1 AND ve.estado = 'completada'
        GROUP BY ve.id, ve.cambio
     )
     SELECT COALESCE(SUM(ef - cambio), 0)::float8 AS ventas_efectivo,
            COALESCE(SUM(tr), 0)::float8          AS ventas_transferencia,
            COUNT(*)::int                          AS num_ventas
       FROM x`,
    [cajaId],
  );
  const { rows: m } = await consulta(
    `SELECT COALESCE(SUM(monto) FILTER (WHERE tipo = 'retiro'), 0)::float8  AS retiros,
            COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso'), 0)::float8 AS ingresos
       FROM movimientos_caja WHERE caja_id = $1`,
    [cajaId],
  );
  const ventasEfectivo = redondear2(v[0].ventas_efectivo);
  const ventasTransferencia = redondear2(v[0].ventas_transferencia);
  const retiros = redondear2(m[0].retiros);
  const ingresos = redondear2(m[0].ingresos);
  const efectivoEsperado = redondear2(Number(fondoInicial) + ventasEfectivo + ingresos - retiros);
  return {
    ventas_efectivo: ventasEfectivo,
    ventas_transferencia: ventasTransferencia,
    total_vendido: redondear2(ventasEfectivo + ventasTransferencia),
    retiros,
    ingresos,
    num_ventas: v[0].num_ventas,
    efectivo_esperado: efectivoEsperado,
  };
}

/** Devuelve la caja abierta de la tienda (o null), con los movimientos. */
async function cajaAbiertaDe(tiendaId) {
  const { rows } = await consulta(
    `SELECT c.*, u.nombre AS responsable
       FROM cajas c JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.tienda_id = $1 AND c.estado = 'abierta'`,
    [tiendaId],
  );
  return rows[0] || null;
}

// GET /api/cajas/actual  — caja abierta de mi tienda + totales en vivo
router.get('/actual', async (req, res) => {
  const tiendaId = tiendaObjetivo(req);
  const caja = await cajaAbiertaDe(tiendaId);
  if (!caja) return res.json({ caja: null });
  const totales = await totalesCaja(caja.id, caja.fondo_inicial);
  const { rows: movs } = await consulta(
    `SELECT m.*, u.nombre AS usuario FROM movimientos_caja m
       LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.caja_id = $1 ORDER BY m.creado_en`,
    [caja.id],
  );
  res.json({ caja, totales, movimientos: movs });
});

// POST /api/cajas/abrir  — { fondo_inicial?, desglose_apertura }
router.post('/abrir', puedeCaja, async (req, res) => {
  const tiendaId = tiendaObjetivo(req);
  if (!tiendaId) throw new ErrorHttp(400, 'No se pudo determinar la tienda');
  if (await cajaAbiertaDe(tiendaId)) {
    throw new ErrorHttp(409, 'Ya hay una caja abierta en esta tienda. Ciérrala antes de abrir otra.');
  }
  const desglose = req.body.desglose_apertura || null;
  const fondo = desglose
    ? totalDesglose(desglose)
    : redondear2(aNumero(req.body.fondo_inicial ?? 0, 'fondo_inicial', { min: 0 }));

  const caja = await conTransaccion(async (cli) => {
    const { rows: n } = await cli.query(
      `SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM cajas WHERE tienda_id = $1`, [tiendaId],
    );
    const { rows } = await cli.query(
      `INSERT INTO cajas (tienda_id, usuario_id, numero, fondo_inicial, desglose_apertura)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tiendaId, req.usuario.id, n[0].n, fondo, desglose ? JSON.stringify(desglose) : null],
    );
    return rows[0];
  });
  res.status(201).json({ caja });
});

// POST /api/cajas/:id/movimiento  — { tipo:'retiro'|'ingreso', monto, motivo }
router.post('/:id/movimiento', puedeCaja, async (req, res) => {
  const tiendaId = tiendaObjetivo(req);
  const { rows } = await consulta(`SELECT * FROM cajas WHERE id = $1`, [req.params.id]);
  const caja = rows[0];
  if (!caja) throw new ErrorHttp(404, 'Caja no encontrada');
  if (req.usuario.rol !== 'admin' && caja.tienda_id !== tiendaId) throw new ErrorHttp(403, 'Caja de otra tienda');
  if (caja.estado !== 'abierta') throw new ErrorHttp(409, 'La caja ya está cerrada');

  const tipo = String(req.body.tipo);
  if (!['retiro', 'ingreso'].includes(tipo)) throw new ErrorHttp(400, 'Tipo inválido (retiro | ingreso)');
  const monto = redondear2(aNumero(req.body.monto, 'monto', { min: 0.01 }));
  const { rows: mr } = await consulta(
    `INSERT INTO movimientos_caja (caja_id, tipo, monto, motivo, usuario_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [caja.id, tipo, monto, req.body.motivo ? String(req.body.motivo).trim() : null, req.usuario.id],
  );
  res.status(201).json(mr[0]);
});

// POST /api/cajas/:id/cerrar  — { desglose_cierre, observacion? }
router.post('/:id/cerrar', puedeCaja, async (req, res) => {
  const tiendaId = tiendaObjetivo(req);
  const { rows } = await consulta(`SELECT * FROM cajas WHERE id = $1`, [req.params.id]);
  const caja = rows[0];
  if (!caja) throw new ErrorHttp(404, 'Caja no encontrada');
  if (req.usuario.rol !== 'admin' && caja.tienda_id !== tiendaId) throw new ErrorHttp(403, 'Caja de otra tienda');
  if (caja.estado !== 'abierta') throw new ErrorHttp(409, 'La caja ya está cerrada');

  const desglose = req.body.desglose_cierre;
  if (!desglose) throw new ErrorHttp(400, 'Falta el desglose del arqueo (billetes y monedas)');
  const efectivoContado = totalDesglose(desglose);

  const t = await totalesCaja(caja.id, caja.fondo_inicial);
  const diferencia = redondear2(efectivoContado - t.efectivo_esperado);
  const resultado = diferencia === 0 ? 'cuadrada' : diferencia > 0 ? 'sobrante' : 'faltante';

  const { rows: upd } = await consulta(
    `UPDATE cajas SET
       estado = 'cerrada', cerrada_en = now(), cerrada_por = $2,
       desglose_cierre = $3, efectivo_contado = $4, efectivo_esperado = $5,
       ventas_efectivo = $6, ventas_transferencia = $7, retiros_total = $8, ingresos_total = $9,
       num_ventas = $10, diferencia = $11, resultado = $12, observacion = $13
     WHERE id = $1
     RETURNING *`,
    [
      caja.id, req.usuario.id, JSON.stringify(desglose), efectivoContado, t.efectivo_esperado,
      t.ventas_efectivo, t.ventas_transferencia, t.retiros, t.ingresos, t.num_ventas,
      diferencia, resultado, req.body.observacion ? String(req.body.observacion).trim() : null,
    ],
  );
  res.json({ caja: upd[0] });
});

// GET /api/cajas  — historial
router.get('/', async (req, res) => {
  const params = [];
  const filtros = [];
  if (req.usuario.rol === 'admin') {
    if (req.query.tienda_id) { params.push(Number(req.query.tienda_id)); filtros.push(`c.tienda_id = $${params.length}`); }
  } else {
    params.push(req.usuario.tienda_id); filtros.push(`c.tienda_id = $${params.length}`);
  }
  if (req.query.desde) { params.push(req.query.desde); filtros.push(`c.abierta_en >= $${params.length}`); }
  if (req.query.hasta) { params.push(req.query.hasta); filtros.push(`c.abierta_en <= $${params.length}`); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 60));

  const { rows } = await consulta(
    `SELECT c.id, c.numero, c.estado, c.abierta_en, c.cerrada_en,
            c.fondo_inicial, c.efectivo_esperado, c.efectivo_contado,
            c.ventas_efectivo, c.ventas_transferencia, c.retiros_total, c.diferencia, c.resultado,
            t.nombre AS tienda, u.nombre AS responsable, uc.nombre AS cerrada_por_nombre
       FROM cajas c
       JOIN tiendas t   ON t.id = c.tienda_id
       JOIN usuarios u  ON u.id = c.usuario_id
       LEFT JOIN usuarios uc ON uc.id = c.cerrada_por
       ${where}
      ORDER BY c.abierta_en DESC
      LIMIT ${limite}`,
    params,
  );
  res.json(rows);
});

// GET /api/cajas/:id  — detalle completo (para reimprimir el comprobante)
router.get('/:id', async (req, res) => {
  const { rows } = await consulta(
    `SELECT c.*, t.nombre AS tienda, u.nombre AS responsable, uc.nombre AS cerrada_por_nombre
       FROM cajas c
       JOIN tiendas t  ON t.id = c.tienda_id
       JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN usuarios uc ON uc.id = c.cerrada_por
      WHERE c.id = $1`,
    [req.params.id],
  );
  const caja = rows[0];
  if (!caja) throw new ErrorHttp(404, 'Caja no encontrada');
  if (req.usuario.rol !== 'admin' && caja.tienda_id !== req.usuario.tienda_id) {
    throw new ErrorHttp(403, 'Caja de otra tienda');
  }
  const { rows: movs } = await consulta(
    `SELECT m.*, u.nombre AS usuario FROM movimientos_caja m
       LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.caja_id = $1 ORDER BY m.creado_en`,
    [caja.id],
  );
  // si sigue abierta, devuelve totales en vivo
  const totales = caja.estado === 'abierta' ? await totalesCaja(caja.id, caja.fondo_inicial) : null;
  res.json({ ...caja, movimientos: movs, totales });
});

export default router;

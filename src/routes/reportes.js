import { Router } from 'express';
import { consulta } from '../db/pool.js';
import { autenticar, requiereRol, tiendaSeleccionada } from '../middleware/auth.js';
import { rangoPorDefecto } from '../utils/validacion.js';

const router = Router();
router.use(autenticar);
// El Dashboard y todos los reportes son exclusivos del administrador.
router.use(requiereRol('admin'));

function rango(req) {
  const def = rangoPorDefecto(Number(req.query.dias) || 30);
  return {
    desde: req.query.desde || def.desde,
    hasta: req.query.hasta || def.hasta,
  };
}

// ---------------------------------------------------------------------------
// GET /api/reportes/dashboard  — datos para el panel principal
//   admin puede pasar ?tienda_id= ; vendedor/bodega ven su tienda
// ---------------------------------------------------------------------------
router.get('/dashboard', async (req, res) => {
  const tiendaId = await tiendaSeleccionada(req);
  const umbralBajo = Number(process.env.STOCK_BAJO_UMBRAL) || 5;

  const [hoy, porMetodo, topHistorico, serieMeses, stockBajo, resumenMeses, costoMes, ultimasVentas, totales] =
    await Promise.all([
      // Ventas de hoy
      consulta(
        `SELECT COUNT(*)::int AS cantidad,
                COALESCE(SUM(v.total), 0)::float8 AS monto,
                COALESCE(ROUND(AVG(v.total), 2), 0)::float8 AS ticket_promedio,
                COALESCE((SELECT SUM(vi.cantidad) FROM venta_items vi
                          JOIN ventas v2 ON v2.id = vi.venta_id
                         WHERE v2.estado = 'completada' AND v2.tienda_id = $1
                           AND v2.creado_en::date = CURRENT_DATE), 0)::int AS unidades
           FROM ventas v
          WHERE v.estado = 'completada' AND v.tienda_id = $1
            AND v.creado_en::date = CURRENT_DATE`,
        [tiendaId],
      ),
      // Pagos de hoy por método
      consulta(
        `SELECT pg.metodo,
                COALESCE(SUM(pg.monto), 0)::float8 AS monto,
                COUNT(DISTINCT v.id)::int AS ventas
           FROM pagos pg
           JOIN ventas v ON v.id = pg.venta_id
          WHERE v.estado = 'completada' AND v.tienda_id = $1
            AND v.creado_en::date = CURRENT_DATE
          GROUP BY pg.metodo`,
        [tiendaId],
      ),
      // Top 5 productos histórico (por unidades)
      consulta(
        `SELECT vi.descripcion,
                SUM(vi.cantidad)::int AS unidades,
                COALESCE(SUM(vi.total_linea), 0)::float8 AS monto
           FROM venta_items vi
           JOIN ventas v ON v.id = vi.venta_id
          WHERE v.estado = 'completada' AND v.tienda_id = $1
          GROUP BY vi.descripcion
          ORDER BY unidades DESC, monto DESC
          LIMIT 5`,
        [tiendaId],
      ),
      // Serie: ventas y ganancia bruta, últimos 6 meses
      consulta(
        `SELECT g.mes,
                COALESCE(SUM(vi.total_linea), 0)::float8 AS ventas,
                COALESCE(SUM(vi.total_linea - vi.cantidad * pv.precio_compra), 0)::float8 AS ganancia
           FROM generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
                                date_trunc('month', CURRENT_DATE), INTERVAL '1 month') g(mes)
           LEFT JOIN ventas v ON date_trunc('month', v.creado_en) = g.mes
                 AND v.estado = 'completada' AND v.tienda_id = $1
           LEFT JOIN venta_items vi ON vi.venta_id = v.id
           LEFT JOIN producto_variantes pv ON pv.id = vi.variante_id
          GROUP BY g.mes
          ORDER BY g.mes`,
        [tiendaId],
      ),
      // Stock bajo
      consulta(
        `SELECT COUNT(*)::int AS cantidad
           FROM producto_variantes v
           JOIN productos p  ON p.id = v.producto_id
           LEFT JOIN stock s ON s.variante_id = v.id AND s.tienda_id = $1
          WHERE v.activo AND p.activo
            AND COALESCE(s.cantidad, 0) <= $2`,
        [tiendaId, umbralBajo],
      ),
      // Resumen mes actual y mes anterior (monto y # ventas)
      consulta(
        `SELECT (v.creado_en >= date_trunc('month', CURRENT_DATE)) AS es_mes_actual,
                COUNT(*)::int AS ventas,
                COALESCE(SUM(v.total), 0)::float8 AS monto
           FROM ventas v
          WHERE v.estado = 'completada' AND v.tienda_id = $1
            AND v.creado_en >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
          GROUP BY 1`,
        [tiendaId],
      ),
      // Costo y unidades del mes actual (para ganancia y margen)
      consulta(
        `SELECT COALESCE(SUM(vi.cantidad), 0)::int AS unidades,
                COALESCE(SUM(vi.cantidad * pv.precio_compra), 0)::float8 AS costo
           FROM ventas v
           JOIN venta_items vi ON vi.venta_id = v.id
           JOIN producto_variantes pv ON pv.id = vi.variante_id
          WHERE v.estado = 'completada' AND v.tienda_id = $1
            AND v.creado_en >= date_trunc('month', CURRENT_DATE)`,
        [tiendaId],
      ),
      // Últimas ventas
      consulta(
        `SELECT v.id, v.cliente_nombre, v.total::float8 AS total, v.creado_en, v.estado
           FROM ventas v
          WHERE v.tienda_id = $1
          ORDER BY v.creado_en DESC
          LIMIT 6`,
        [tiendaId],
      ),
      // Catálogo
      consulta(
        `SELECT (SELECT COUNT(*) FROM productos  WHERE activo)::int AS productos,
                (SELECT COUNT(*) FROM categorias WHERE activo)::int AS categorias`,
      ),
    ]);

  const mesActual = resumenMeses.rows.find((r) => r.es_mes_actual) || { ventas: 0, monto: 0 };
  const mesAnterior = resumenMeses.rows.find((r) => !r.es_mes_actual) || { ventas: 0, monto: 0 };
  const costo = costoMes.rows[0].costo;
  const ganancia = Number((mesActual.monto - costo).toFixed(2));
  const margen = mesActual.monto > 0 ? Number(((ganancia / mesActual.monto) * 100).toFixed(1)) : 0;
  const variacion = mesAnterior.monto > 0
    ? Number((((mesActual.monto - mesAnterior.monto) / mesAnterior.monto) * 100).toFixed(1))
    : (mesActual.monto > 0 ? 100 : 0);

  res.json({
    tienda_id: tiendaId,
    umbral_stock_bajo: umbralBajo,
    ventas_hoy: hoy.rows[0],
    ventas_por_metodo: porMetodo.rows,
    top_productos_historico: topHistorico.rows,
    serie_meses: serieMeses.rows,
    stock_bajo: stockBajo.rows[0],
    ultimas_ventas: ultimasVentas.rows,
    catalogo: totales.rows[0],
    mes: {
      ventas: mesActual.ventas,
      monto: mesActual.monto,
      unidades: costoMes.rows[0].unidades,
      costo,
      ganancia,
      margen,
      ticket_promedio: mesActual.ventas > 0 ? Number((mesActual.monto / mesActual.ventas).toFixed(2)) : 0,
      variacion_pct: variacion,
      monto_mes_anterior: mesAnterior.monto,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/reportes/ventas-por-dia?desde=&hasta=
// ---------------------------------------------------------------------------
router.get('/ventas-por-dia', async (req, res) => {
  const tiendaId = await tiendaSeleccionada(req);
  const { desde, hasta } = rango(req);
  const { rows } = await consulta(
    `SELECT d::date AS fecha,
            COUNT(v.id)::int AS ventas,
            COALESCE(SUM(v.total), 0)::float8 AS monto
       FROM generate_series($2::date, $3::date, INTERVAL '1 day') d
       LEFT JOIN ventas v
              ON v.creado_en::date = d::date
             AND v.estado = 'completada'
             AND v.tienda_id = $1
      GROUP BY d
      ORDER BY d`,
    [tiendaId, desde, hasta],
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// GET /api/reportes/top-productos?desde=&hasta=&limite=10
// ---------------------------------------------------------------------------
router.get('/top-productos', async (req, res) => {
  const tiendaId = await tiendaSeleccionada(req);
  const { desde, hasta } = rango(req);
  const limite = Math.min(50, Math.max(1, Number(req.query.limite) || 10));
  const { rows } = await consulta(
    `SELECT vi.descripcion,
            SUM(vi.cantidad)::int AS unidades,
            COALESCE(SUM(vi.total_linea), 0)::float8 AS monto
       FROM venta_items vi
       JOIN ventas v ON v.id = vi.venta_id
      WHERE v.estado = 'completada'
        AND v.tienda_id = $1
        AND v.creado_en::date BETWEEN $2::date AND $3::date
      GROUP BY vi.descripcion
      ORDER BY unidades DESC, monto DESC
      LIMIT $4`,
    [tiendaId, desde, hasta, limite],
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// GET /api/reportes/ventas-por-metodo?desde=&hasta=
// ---------------------------------------------------------------------------
router.get('/ventas-por-metodo', async (req, res) => {
  const tiendaId = await tiendaSeleccionada(req);
  const { desde, hasta } = rango(req);
  const { rows } = await consulta(
    `SELECT pg.metodo,
            COALESCE(SUM(pg.monto), 0)::float8 AS monto,
            COUNT(DISTINCT v.id)::int AS ventas
       FROM pagos pg
       JOIN ventas v ON v.id = pg.venta_id
      WHERE v.estado = 'completada'
        AND v.tienda_id = $1
        AND v.creado_en::date BETWEEN $2::date AND $3::date
      GROUP BY pg.metodo`,
    [tiendaId, desde, hasta],
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// GET /api/reportes/pagos?metodo=transferencia&desde=&hasta=&verificado=
//   Lista de pagos para conciliar contra el banco.
// ---------------------------------------------------------------------------
router.get('/pagos', async (req, res) => {
  const { desde, hasta } = rango(req);
  const params = [desde, hasta];
  const filtros = ["v.estado = 'completada'", 'v.creado_en::date BETWEEN $1::date AND $2::date'];
  // Sin ?tienda_id → todas las tiendas; con ?tienda_id → esa (validada).
  if (req.query.tienda_id) {
    params.push(await tiendaSeleccionada(req));
    filtros.push(`v.tienda_id = $${params.length}`);
  }
  if (req.query.metodo) { params.push(String(req.query.metodo)); filtros.push(`pg.metodo = $${params.length}`); }
  if (req.query.banco) { params.push(String(req.query.banco)); filtros.push(`pg.banco = $${params.length}`); }
  if (req.query.verificado === 'true' || req.query.verificado === 'false') {
    params.push(req.query.verificado === 'true');
    filtros.push(`pg.verificado = $${params.length}`);
  }

  const { rows } = await consulta(
    `SELECT pg.id, pg.metodo, pg.monto::float8 AS monto, pg.banco, pg.documento, pg.referencia,
            pg.verificado, pg.verificado_en, pg.creado_en,
            v.id AS venta_id, v.cliente_nombre, u.nombre AS vendedor
       FROM pagos pg
       JOIN ventas v   ON v.id = pg.venta_id
       JOIN usuarios u ON u.id = v.usuario_id
      WHERE ${filtros.join(' AND ')}
      ORDER BY pg.creado_en DESC`,
    params,
  );

  const totales = rows.reduce((a, p) => {
    a.total += p.monto;
    if (p.verificado) a.verificado += p.monto; else a.pendiente += p.monto;
    return a;
  }, { total: 0, verificado: 0, pendiente: 0 });

  res.json({ desde, hasta, totales, pagos: rows });
});

export default router;

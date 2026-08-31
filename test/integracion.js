/*
 * Prueba de integración de punta a punta:
 *   PostgreSQL embebido  ->  esquema  ->  API real  ->  flujo completo de negocio.
 *
 *   node test/integracion.js
 */
import bcrypt from 'bcryptjs';
import { iniciarPostgres, aplicarEsquema, ok, igual, resumen } from './helpers.js';

const PUERTO_API = 3987;

async function main() {
  console.log('Arrancando PostgreSQL embebido (la primera vez descarga binarios)...');
  const db = await iniciarPostgres();

  // Variables de entorno ANTES de importar módulos que las leen.
  process.env.DATABASE_URL = db.url;
  process.env.JWT_SECRET = 'secreto_de_pruebas_1234567890';
  process.env.STOCK_BAJO_UMBRAL = '5';
  process.env.PORT = String(PUERTO_API);

  const { pool } = await import('../src/db/pool.js');
  const { crearApp } = await import('../src/app.js');

  let servidor;
  try {
    console.log('Aplicando esquema...');
    await aplicarEsquema(pool);

    // Datos base: 2 tiendas + admin + vendedor
    await pool.query(
      `INSERT INTO tiendas (nombre, codigo_establecimiento, punto_emision)
       VALUES ('Tienda Centro','001','001'), ('Tienda Norte','002','001')`,
    );
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO usuarios (tienda_id, nombre, email, password_hash, rol) VALUES
        (1,'Admin','admin@tienda.com',$1,'admin'),
        (1,'Vera Vendedora','vera@tienda.com',$1,'vendedor')`,
      [hash],
    );

    servidor = crearApp().listen(PUERTO_API);
    const base = `http://localhost:${PUERTO_API}`;

    const api = async (metodo, ruta, { token, body } = {}) => {
      const r = await fetch(base + ruta, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      let datos = null;
      try { datos = await r.json(); } catch { /* sin cuerpo */ }
      return { status: r.status, datos };
    };

    console.log('\n— Autenticación —');
    let r = await api('POST', '/api/auth/login', { body: { email: 'admin@tienda.com', password: 'mala' } });
    ok(r.status === 401, 'login con clave incorrecta => 401', r);

    r = await api('POST', '/api/auth/login', { body: { email: 'admin@tienda.com', password: 'admin123' } });
    ok(r.status === 200 && r.datos.token, 'login admin OK', r.datos);
    const tokenAdmin = r.datos.token;

    r = await api('POST', '/api/auth/login', { body: { email: 'vera@tienda.com', password: 'admin123' } });
    const tokenVendedor = r.datos.token;
    ok(!!tokenVendedor, 'login vendedor OK');

    r = await api('GET', '/api/productos', {});
    ok(r.status === 401, 'sin token => 401');

    console.log('\n— Categorías —');
    r = await api('GET', '/api/categorias', { token: tokenAdmin });
    ok(r.status === 200 && r.datos.length >= 7, 'categorías de ejemplo cargadas', r.datos?.length);

    r = await api('POST', '/api/categorias', { token: tokenVendedor, body: { nombre: 'Chaquetas' } });
    ok(r.status === 403, 'vendedor NO puede crear categoría => 403', r);

    r = await api('POST', '/api/categorias', { token: tokenAdmin, body: { nombre: 'Chaquetas' } });
    ok(r.status === 201, 'admin crea categoría', r.datos);
    const categoriaId = r.datos.id;

    console.log('\n— Productos y variantes —');
    r = await api('POST', '/api/productos', {
      token: tokenAdmin,
      body: {
        nombre: 'Blusa manga larga',
        categoria_id: categoriaId,
        variantes: [
          { talla: 'S', color: 'Rojo', codigo_barras: 'BL-S-ROJO', precio_compra: 6.5, precio_venta: 14.9,
            stock_inicial: [{ tienda_id: 1, cantidad: 10 }] },
          { talla: 'M', color: 'Rojo', codigo_barras: 'BL-M-ROJO', precio_compra: 6.5, precio_venta: 14.9,
            stock_inicial: [{ tienda_id: 1, cantidad: 3 }] },
        ],
      },
    });
    ok(r.status === 201 && r.datos.variantes.length === 2, 'producto creado con 2 variantes', r.datos);
    const varS = r.datos.variantes[0].id;
    const varM = r.datos.variantes[1].id;

    r = await api('GET', '/api/productos/buscar?codigo=BL-S-ROJO', { token: tokenVendedor });
    ok(r.status === 200 && r.datos.stock === 10 && Number(r.datos.precio_venta) === 14.9,
      'buscar por código de barras devuelve stock y precio', r.datos);

    r = await api('GET', '/api/productos?q=blusa', { token: tokenVendedor });
    ok(r.status === 200 && r.datos.productos[0].stock_total === 13, 'listado con stock_total = 13', r.datos.productos?.[0]);

    console.log('\n— Inventario —');
    r = await api('POST', '/api/inventario/entrada', {
      token: tokenAdmin,
      body: { tienda_id: 1, referencia: 'Compra proveedor X', items: [{ variante_id: varM, cantidad: 7 }] },
    });
    ok(r.status === 201, 'ingreso de mercadería', r.datos);

    r = await api('GET', '/api/productos/buscar?codigo=BL-M-ROJO', { token: tokenAdmin });
    ok(r.datos.stock === 10, 'stock M pasó de 3 a 10', r.datos?.stock);

    console.log('\n— Venta con pago mixto (efectivo + transferencia) —');
    r = await api('POST', '/api/ventas', {
      token: tokenVendedor,
      body: {
        cliente: { nombre: 'Consumidor final' },
        items: [
          { variante_id: varS, cantidad: 2, descuento: 1.0 }, // 2*14.9 - 1 = 28.80
          { variante_id: varM, cantidad: 1 },                  // 14.90
        ],
        descuento_total: 2.0,                                  // subtotal 43.70 -> total 41.70
        pagos: [
          { metodo: 'efectivo', monto: 20.0 },
          { metodo: 'transferencia', monto: 30.0, banco: 'Pichincha', documento: 'TR-98765', referencia: 'depósito' },
        ],
      },
    });
    ok(r.status === 201, 'venta registrada', r.datos);
    igual(Number(r.datos.subtotal), 43.7, 'subtotal = 43.70');
    igual(Number(r.datos.total), 41.7, 'total = 41.70');
    igual(Number(r.datos.total_pagado), 50, 'total pagado = 50.00');
    igual(Number(r.datos.cambio), 8.3, 'cambio = 8.30');
    const ventaId = r.datos.id;

    r = await api('GET', `/api/ventas/${ventaId}`, { token: tokenAdmin });
    const pagoTr = r.datos.pagos.find((p) => p.metodo === 'transferencia');
    ok(pagoTr.banco === 'Pichincha' && pagoTr.documento === 'TR-98765', 'guarda banco y N.º de comprobante de la transferencia', pagoTr);
    ok(pagoTr.verificado === false, 'la transferencia arranca sin verificar');

    r = await api('PUT', `/api/ventas/pagos/${pagoTr.id}/verificado`, { token: tokenVendedor, body: { verificado: true } });
    ok(r.status === 200 && r.datos.verificado === true, 'marca la transferencia como verificada', r.datos);

    r = await api('GET', `/api/reportes/pagos?metodo=transferencia&desde=2000-01-01&hasta=2999-01-01`, { token: tokenAdmin });
    ok(r.datos.pagos.some((p) => p.id === pagoTr.id && p.verificado), 'aparece verificada en el reporte de transferencias', r.datos.totales);
    igual(Number(r.datos.totales.pendiente), 0, 'reporte: 0 pendiente de verificar');

    r = await api('GET', '/api/productos/buscar?codigo=BL-S-ROJO', { token: tokenAdmin });
    ok(r.datos.stock === 8, 'stock S bajó de 10 a 8 tras la venta', r.datos?.stock);

    console.log('\n— Reglas de negocio —');
    r = await api('POST', '/api/ventas', {
      token: tokenVendedor,
      body: { items: [{ variante_id: varS, cantidad: 999 }], pagos: [{ metodo: 'efectivo', monto: 99999 }] },
    });
    ok(r.status === 409, 'no permite vender sin stock => 409', r.datos);

    r = await api('POST', '/api/ventas', {
      token: tokenVendedor,
      body: { items: [{ variante_id: varM, cantidad: 1 }], pagos: [{ metodo: 'efectivo', monto: 5 }] },
    });
    ok(r.status === 400, 'no permite pago menor al total => 400', r.datos);

    r = await api('POST', '/api/ventas', {
      token: tokenVendedor,
      body: {
        items: [{ variante_id: varM, cantidad: 1 }, { variante_id: varM, cantidad: 1 }],
        pagos: [{ metodo: 'efectivo', monto: 100 }],
      },
    });
    ok(r.status === 400, 'rechaza la misma variante repetida en dos líneas => 400', r.datos);

    r = await api('POST', '/api/ventas', { token: tokenAdmin, body: { items: [{ variante_id: varM, cantidad: 1 }],
      pagos: [{ metodo: 'transferencia', monto: 50, banco: 'Banco Pichincha', documento: 'TR-1' }] } });
    ok(r.status === 400 && /vuelto/i.test(r.datos.error || ''), 'no da vuelto de transferencia => 400', r.datos);

    r = await api('POST', '/api/ventas', { token: tokenAdmin, body: { items: [{ variante_id: varM, cantidad: 1 }],
      pagos: [{ metodo: 'transferencia', monto: 14.9, banco: 'Banco Pichincha' }] } });
    ok(r.status === 400 && /comprobante/i.test(r.datos.error || ''), 'transferencia sin N.º de comprobante => 400', r.datos);

    r = await api('POST', '/api/ventas', { token: tokenAdmin, body: { items: [{ variante_id: varM, cantidad: 1 }],
      pagos: [{ metodo: 'transferencia', monto: 14.9, documento: 'TR-2' }] } });
    ok(r.status === 400 && /banco/i.test(r.datos.error || ''), 'transferencia sin banco => 400', r.datos);

    console.log('\n— Dashboard —');
    r = await api('GET', '/api/reportes/dashboard', { token: tokenVendedor });
    ok(r.status === 200, 'dashboard responde', r.status);
    igual(r.datos.ventas_hoy.cantidad, 1, 'dashboard: 1 venta hoy');
    igual(Number(r.datos.ventas_hoy.monto), 41.7, 'dashboard: monto de hoy = 41.70');
    igual(r.datos.ventas_hoy.unidades, 3, 'dashboard: 3 unidades hoy');
    ok(r.datos.top_productos_historico.length >= 1 && r.datos.top_productos_historico[0].unidades === 2,
      'dashboard: top producto histórico con 2 unidades', r.datos.top_productos_historico);
    ok(r.datos.serie_meses.length === 6, 'dashboard: serie de 6 meses', r.datos.serie_meses?.length);
    igual(Number(r.datos.mes.monto), 41.7, 'dashboard: monto del mes = 41.70');
    ok(Number(r.datos.mes.ganancia) > 0 && r.datos.mes.margen > 0, 'dashboard: ganancia y margen del mes > 0', r.datos.mes);
    const efectivo = r.datos.ventas_por_metodo.find((m) => m.metodo === 'efectivo');
    igual(Number(efectivo.monto), 20, 'dashboard: efectivo del día = 20.00');

    console.log('\n— Anulación de venta (repone stock) —');
    r = await api('POST', `/api/ventas/${ventaId}/anular`, { token: tokenVendedor, body: { motivo: 'prueba' } });
    ok(r.status === 403, 'vendedor NO puede anular => 403', r.status);

    r = await api('POST', `/api/ventas/${ventaId}/anular`, { token: tokenAdmin, body: { motivo: 'Devolución cliente' } });
    ok(r.status === 200 && r.datos.estado === 'anulada', 'admin anula la venta', r.datos);

    r = await api('GET', '/api/productos/buscar?codigo=BL-S-ROJO', { token: tokenAdmin });
    ok(r.datos.stock === 10, 'stock S vuelve a 10 tras anular', r.datos?.stock);

    r = await api('POST', `/api/ventas/${ventaId}/anular`, { token: tokenAdmin, body: { motivo: 'otra vez' } });
    ok(r.status === 409, 'no se puede anular dos veces => 409', r.status);

    console.log('\n— Caja: apertura, venta, retiro, cierre —');
    r = await api('GET', '/api/cajas/actual', { token: tokenVendedor });
    ok(r.datos.caja === null, 'no hay caja abierta al inicio');

    r = await api('POST', '/api/cajas/abrir', {
      token: tokenVendedor,
      body: { desglose_apertura: { billetes: { 20: 2, 10: 1 }, monedas: { '0.25': 4 } } },
    });
    ok(r.status === 201 && Number(r.datos.caja.fondo_inicial) === 51, 'abre caja con fondo $51.00 (2×20 + 10 + 4×0.25)', r.datos.caja);
    const cajaId = r.datos.caja.id;

    r = await api('POST', '/api/cajas/abrir', { token: tokenVendedor, body: { desglose_apertura: {} } });
    ok(r.status === 409, 'no permite abrir una segunda caja => 409');

    r = await api('POST', '/api/ventas', {
      token: tokenVendedor,
      body: { items: [{ variante_id: varM, cantidad: 1 }], pagos: [{ metodo: 'efectivo', monto: 20 }] },
    });
    ok(r.status === 201, 'venta durante la caja', r.datos);
    const totalCaja = Number(r.datos.total); // 14.90, pagado 20, cambio 5.10 -> efectivo neto = 14.90

    r = await api('POST', `/api/cajas/${cajaId}/movimiento`, {
      token: tokenVendedor, body: { tipo: 'retiro', monto: 10, motivo: 'prueba' },
    });
    ok(r.status === 201, 'registra un retiro de $10');

    r = await api('GET', '/api/cajas/actual', { token: tokenVendedor });
    const esperado = 51 + totalCaja - 10;
    ok(Math.abs(r.datos.totales.efectivo_esperado - esperado) < 0.005, `efectivo esperado = ${esperado.toFixed(2)}`, r.datos.totales);
    ok(Math.abs(r.datos.totales.ventas_efectivo - totalCaja) < 0.005, 'ventas efectivo netas = total de la venta');

    // Arqueo exacto: 50 + 5 + 3×0.25 + 0.10 + 0.05 = 55.90
    r = await api('POST', `/api/cajas/${cajaId}/cerrar`, {
      token: tokenVendedor,
      body: { desglose_cierre: { billetes: { 50: 1, 5: 1 }, monedas: { '0.25': 3, '0.10': 1, '0.05': 1 } } },
    });
    ok(r.status === 200 && r.datos.caja.resultado === 'cuadrada' && Number(r.datos.caja.diferencia) === 0,
      'cierra CAJA CUADRADA, diferencia $0.00', r.datos.caja);

    r = await api('GET', '/api/cajas', { token: tokenVendedor });
    ok(r.datos.some((c) => c.id === cajaId && c.estado === 'cerrada'), 'la caja cerrada aparece en el historial');

    r = await api('POST', `/api/cajas/${cajaId}/cerrar`, { token: tokenVendedor, body: { desglose_cierre: {} } });
    ok(r.status === 409, 'no se puede cerrar dos veces => 409');

    console.log('\n— Concurrencia: 2 ventas simultáneas del último ítem —');
    // Dejar stock exacto = 1 en varS de otra variante nueva
    r = await api('POST', '/api/productos', {
      token: tokenAdmin,
      body: { nombre: 'Gorra', variantes: [{ codigo_barras: 'GORRA-1', precio_venta: 10,
        stock_inicial: [{ tienda_id: 1, cantidad: 1 }] }] },
    });
    const varGorra = r.datos.variantes[0].id;
    const compra = () => api('POST', '/api/ventas', {
      token: tokenVendedor,
      body: { items: [{ variante_id: varGorra, cantidad: 1 }], pagos: [{ metodo: 'efectivo', monto: 10 }] },
    });
    const [a, b] = await Promise.all([compra(), compra()]);
    const exitos = [a, b].filter((x) => x.status === 201).length;
    const conflictos = [a, b].filter((x) => x.status === 409).length;
    ok(exitos === 1 && conflictos === 1, 'solo 1 de 2 ventas concurrentes prospera', { a: a.status, b: b.status });

    r = await api('GET', '/api/productos/buscar?codigo=GORRA-1', { token: tokenAdmin });
    ok(r.datos.stock === 0, 'stock final de la gorra = 0 (no quedó negativo)', r.datos?.stock);
  } finally {
    if (servidor) await new Promise((res) => servidor.close(res));
    await pool.end();
    await db.stop();
  }

  const todoOk = resumen();
  process.exit(todoOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

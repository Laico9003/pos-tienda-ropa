import { generarClaveAcceso } from './claveAcceso.js';
import { fechaEmisionEC } from './fecha.js';

const COD_PORCENTAJE_IVA = { 0: '0', 5: '5', 12: '2', 13: '10', 14: '8', 15: '4' };
const FORMA_PAGO = { efectivo: '01', transferencia: '20', tarjeta: '19' };

const n2 = (x) => (Math.round((Number(x) + Number.EPSILON) * 100) / 100).toFixed(2);
const n6 = (x) => (Math.round((Number(x) + Number.EPSILON) * 1e6) / 1e6).toFixed(6);

function tipoIdentificacion(id) {
  const s = String(id || '').trim();
  if (!s || s === '9999999999999') return { tipo: '07', id: '9999999999999', consumidorFinal: true };
  if (s.length === 13) return { tipo: '04', id: s };            // RUC
  if (s.length === 10) return { tipo: '05', id: s };            // cédula
  return { tipo: '06', id: s };                                 // pasaporte / exterior
}

/**
 * Construye el objeto `invoice` (para open-factura `generateInvoiceXml`) a partir de la venta.
 * @returns {{ invoice: object, claveAcceso: string, resumen: object }}
 */
export function construirFactura({ venta, items, pagos, negocio, comprobante }) {
  const ivaPct = Number(negocio.iva_porcentaje ?? 15);
  const rate = ivaPct / 100;
  const codPct = COD_PORCENTAJE_IVA[ivaPct] || '4';
  const incluyeIva = negocio.precios_incluyen_iva !== false;

  const fecha = new Date(venta.creado_en || Date.now());
  const fechaEmision = fechaEmisionEC(fecha); // dd/mm/yyyy en hora de Ecuador

  // ---- Ajuste del descuento global: se reparte proporcionalmente en las líneas ----
  const subtotal = Number(venta.subtotal) || items.reduce((s, it) => s + Number(it.total_linea), 0);
  const totalPagado = Number(venta.total);
  const factor = subtotal > 0 ? totalPagado / subtotal : 1;

  const lineasConIva = items.map((it) => n2(Number(it.total_linea) * factor));
  // corrige el arrastre de redondeo contra el total real
  let drift = n2(totalPagado - lineasConIva.reduce((s, v) => s + Number(v), 0));
  if (Number(drift) !== 0 && lineasConIva.length) {
    const idx = lineasConIva.reduce((mi, v, i, arr) => (Number(v) > Number(arr[mi]) ? i : mi), 0);
    lineasConIva[idx] = n2(Number(lineasConIva[idx]) + Number(drift));
  }

  // ---- Detalles ----
  const detalle = items.map((it, i) => {
    const lineaConIva = Number(lineasConIva[i]);
    const base = incluyeIva ? Number(n2(lineaConIva / (1 + rate))) : lineaConIva;
    const iva = Number(n2(base * rate));
    const brutoSinIva = incluyeIva
      ? Number(n6((Number(it.precio_unitario) * it.cantidad) / (1 + rate)))
      : Number(it.precio_unitario) * it.cantidad;
    const descuentoSinIva = Number(n2(Math.max(0, brutoSinIva - base)));
    const precioUnitarioSinIva = incluyeIva
      ? Number(n6(Number(it.precio_unitario) / (1 + rate)))
      : Number(it.precio_unitario);

    return {
      _base: base,
      _iva: iva,
      nodo: {
        codigoPrincipal: (it.codigo_barras || `ITEM${it.variante_id || i + 1}`).slice(0, 25),
        descripcion: String(it.descripcion || 'Producto').slice(0, 300),
        cantidad: n2(it.cantidad),
        precioUnitario: n6(precioUnitarioSinIva),
        descuento: n2(descuentoSinIva),
        precioTotalSinImpuesto: n2(base),
        impuestos: {
          impuesto: [{
            codigo: '2',
            codigoPorcentaje: codPct,
            tarifa: String(ivaPct),
            baseImponible: n2(base),
            valor: n2(iva),
          }],
        },
      },
    };
  });

  const totalSinImpuestos = Number(n2(detalle.reduce((s, d) => s + d._base, 0)));
  const totalIva = Number(n2(detalle.reduce((s, d) => s + d._iva, 0)));
  const totalDescuento = Number(n2(detalle.reduce((s, d) => s + Number(d.nodo.descuento), 0)));
  const importeTotal = Number(n2(totalSinImpuestos + totalIva));

  // ---- Pagos (escalados al importe total para que la suma cuadre) ----
  const sumaPagos = pagos.reduce((s, p) => s + Number(p.monto), 0) || importeTotal;
  const pagoLista = pagos.map((p) => ({
    formaPago: FORMA_PAGO[String(p.metodo)] || '01',
    total: n2((Number(p.monto) / sumaPagos) * importeTotal),
    plazo: '0',
    unidadTiempo: 'dias',
  }));
  if (pagoLista.length === 0) {
    pagoLista.push({ formaPago: '01', total: n2(importeTotal), plazo: '0', unidadTiempo: 'dias' });
  } else {
    const driftP = n2(importeTotal - pagoLista.reduce((s, p) => s + Number(p.total), 0));
    if (Number(driftP) !== 0) pagoLista[0].total = n2(Number(pagoLista[0].total) + Number(driftP));
  }

  // ---- Comprador ----
  const comprador = tipoIdentificacion(venta.cliente_identificacion);
  const razonSocialComprador = comprador.consumidorFinal
    ? 'CONSUMIDOR FINAL'
    : (venta.cliente_nombre || 'CONSUMIDOR FINAL').slice(0, 300);

  // ---- Clave de acceso ----
  const claveAcceso = comprobante.clave_acceso || generarClaveAcceso({
    fecha,
    codDoc: '01',
    ruc: negocio.ruc,
    ambiente: comprobante.ambiente,
    estab: comprobante.estab,
    ptoEmi: comprobante.pto_emi,
    secuencial: comprobante.secuencial,
  });

  const rimpe =
    negocio.regimen === 'rimpe_emprendedor' ? 'CONTRIBUYENTE RÉGIMEN RIMPE'
      : negocio.regimen === 'rimpe_popular' ? 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE'
        : undefined;

  const infoTributaria = {
    ambiente: comprobante.ambiente,
    tipoEmision: '1',
    razonSocial: (negocio.razon_social || negocio.nombre || 'MI TIENDA').slice(0, 300),
    nombreComercial: (negocio.nombre_comercial || negocio.nombre || 'MI TIENDA').slice(0, 300),
    ruc: String(negocio.ruc || '').padStart(13, '0'),
    claveAcceso,
    codDoc: '01',
    estab: comprobante.estab,
    ptoEmi: comprobante.pto_emi,
    secuencial: comprobante.secuencial,
    dirMatriz: (negocio.dir_matriz || negocio.direccion || 'S/N').slice(0, 300),
    ...(rimpe ? { contribuyenteRimpe: rimpe } : {}),
  };

  const infoFactura = {
    fechaEmision,
    dirEstablecimiento: (negocio.direccion || negocio.dir_matriz || 'S/N').slice(0, 300),
    ...(negocio.contribuyente_especial ? { contribuyenteEspecial: negocio.contribuyente_especial } : {}),
    obligadoContabilidad: negocio.obligado_contabilidad ? 'SI' : 'NO',
    tipoIdentificacionComprador: comprador.tipo,
    razonSocialComprador,
    identificacionComprador: comprador.id,
    direccionComprador: (venta.cliente_direccion || 'S/N').slice(0, 300),
    totalSinImpuestos: n2(totalSinImpuestos),
    totalDescuento: n2(totalDescuento),
    totalConImpuestos: {
      totalImpuesto: [{
        codigo: '2',
        codigoPorcentaje: codPct,
        descuentoAdicional: '0.00',
        baseImponible: n2(totalSinImpuestos),
        tarifa: String(ivaPct),
        valor: n2(totalIva),
      }],
    },
    propina: '0.00',
    importeTotal: n2(importeTotal),
    moneda: 'DOLAR',
    pagos: { pago: pagoLista },
  };

  const campoAdicional = [];
  if (venta.cliente_email) campoAdicional.push({ '@nombre': 'Email', '#': String(venta.cliente_email).slice(0, 300) });
  if (venta.cliente_telefono) campoAdicional.push({ '@nombre': 'Telefono', '#': String(venta.cliente_telefono).slice(0, 300) });
  campoAdicional.push({ '@nombre': 'Vendedor', '#': String(venta.vendedor || 'Caja').slice(0, 300) });

  // Nota: el nodo raíz NO lleva xmlns:ds ni xmlns:xsi; la firma (ec-sri-invoice-signer)
  // agrega el namespace ds dentro del elemento <ds:Signature>.
  const invoice = {
    factura: {
      '@id': 'comprobante',
      '@version': '1.1.0',
      infoTributaria,
      infoFactura,
      detalles: { detalle: detalle.map((d) => d.nodo) },
      infoAdicional: { campoAdicional },
    },
  };

  return {
    invoice,
    claveAcceso,
    resumen: { totalSinImpuestos, totalIva, totalDescuento, importeTotal },
  };
}

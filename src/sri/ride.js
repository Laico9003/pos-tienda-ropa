import PDFDocument from 'pdfkit';

const dinero = (x) => '$ ' + (Number(x) || 0).toFixed(2);

/**
 * Genera el RIDE (representación impresa) de la factura como PDF (Buffer).
 * @param {object} p
 * @param {object} p.negocio
 * @param {object} p.venta      detalle de la venta (con items, pagos, vendedor, tienda)
 * @param {object} p.comprobante fila de comprobantes_sri (clave_acceso, numero_autorizacion, ...)
 * @param {object} p.resumen    { totalSinImpuestos, totalIva, totalDescuento, importeTotal }
 */
export function generarRidePDF({ negocio, venta, comprobante, resumen }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const trozos = [];
    doc.on('data', (d) => trozos.push(d));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);

    const anchoUtil = doc.page.width - 80;
    const izqX = 40;
    const derX = 300;

    // ---------- Encabezado ----------
    if (negocio.logo_url && /^data:image\//.test(negocio.logo_url)) {
      try {
        const b64 = negocio.logo_url.split(',')[1];
        doc.image(Buffer.from(b64, 'base64'), izqX, 40, { fit: [120, 60] });
      } catch { /* logo inválido, se omite */ }
    }
    doc.fontSize(14).font('Helvetica-Bold').text(negocio.razon_social || negocio.nombre || 'MI TIENDA', izqX, 110);
    doc.fontSize(9).font('Helvetica');
    if (negocio.nombre_comercial) doc.text(negocio.nombre_comercial, izqX);
    doc.text(`Dirección Matriz: ${negocio.dir_matriz || negocio.direccion || 'S/N'}`);
    doc.text(`Dirección Sucursal: ${negocio.direccion || 'S/N'}`);
    doc.text(`Obligado a llevar contabilidad: ${negocio.obligado_contabilidad ? 'SI' : 'NO'}`);
    if (negocio.contribuyente_especial) doc.text(`Contribuyente Especial Nro: ${negocio.contribuyente_especial}`);

    // ---------- Recuadro comprobante ----------
    const boxY = 40;
    doc.rect(derX, boxY, anchoUtil - (derX - izqX), 150).stroke();
    doc.fontSize(9).font('Helvetica');
    let y = boxY + 8;
    const linea = (t, b = false) => { doc.font(b ? 'Helvetica-Bold' : 'Helvetica').text(t, derX + 8, y, { width: anchoUtil - (derX - izqX) - 16 }); y = doc.y + 2; };
    linea(`R.U.C.: ${negocio.ruc || ''}`, true);
    linea('FACTURA', true);
    linea(`No. ${comprobante.estab}-${comprobante.pto_emi}-${comprobante.secuencial}`, true);
    linea(`NÚMERO DE AUTORIZACIÓN`);
    linea(comprobante.numero_autorizacion || comprobante.clave_acceso || '—');
    linea(`FECHA Y HORA DE AUTORIZACIÓN: ${comprobante.fecha_autorizacion ? new Date(comprobante.fecha_autorizacion).toLocaleString('es-EC') : '—'}`);
    linea(`AMBIENTE: ${comprobante.ambiente === '2' ? 'PRODUCCIÓN' : 'PRUEBAS'}`);
    linea(`EMISIÓN: NORMAL`);
    linea(`CLAVE DE ACCESO:`);
    doc.font('Courier').fontSize(8).text(comprobante.clave_acceso || '', derX + 8, y, { width: anchoUtil - (derX - izqX) - 16 });

    // ---------- Datos del cliente ----------
    doc.moveTo(izqX, 210).lineTo(izqX + anchoUtil, 210).stroke();
    doc.fontSize(9).font('Helvetica').text(`Razón Social / Nombres y Apellidos: ${venta.cliente_nombre || 'CONSUMIDOR FINAL'}`, izqX, 218);
    doc.text(`Identificación: ${venta.cliente_identificacion || '9999999999999'}`);
    doc.text(`Fecha Emisión: ${new Date(venta.creado_en).toLocaleDateString('es-EC')}`);
    if (venta.cliente_direccion) doc.text(`Dirección: ${venta.cliente_direccion}`);

    // ---------- Tabla de detalles ----------
    let ty = doc.y + 12;
    const cols = [izqX, izqX + 55, izqX + 300, izqX + 360, izqX + 425, izqX + 490];
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('Cant.', cols[0], ty); doc.text('Descripción', cols[1], ty);
    doc.text('P.Unit', cols[2], ty); doc.text('Desc.', cols[3], ty);
    doc.text('Total', cols[4], ty);
    ty += 12;
    doc.moveTo(izqX, ty).lineTo(izqX + anchoUtil, ty).stroke();
    ty += 4;
    doc.font('Helvetica').fontSize(8);
    for (const it of venta.items) {
      const h = Math.max(12, doc.heightOfString(it.descripcion || '', { width: 240 }));
      doc.text(String(it.cantidad), cols[0], ty);
      doc.text(it.descripcion || '', cols[1], ty, { width: 240 });
      doc.text(Number(it.precio_unitario).toFixed(2), cols[2], ty);
      doc.text(Number(it.descuento).toFixed(2), cols[3], ty);
      doc.text(Number(it.total_linea).toFixed(2), cols[4], ty);
      ty += h + 4;
    }
    doc.moveTo(izqX, ty).lineTo(izqX + anchoUtil, ty).stroke();
    ty += 8;

    // ---------- Totales ----------
    const totX = izqX + 330;
    const fila = (lbl, val, b = false) => {
      doc.font(b ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      doc.text(lbl, totX, ty); doc.text(dinero(val), totX + 110, ty, { width: 90, align: 'right' });
      ty += 14;
    };
    fila('Subtotal sin impuestos', resumen.totalSinImpuestos);
    fila('Descuento', resumen.totalDescuento);
    fila(`IVA ${negocio.iva_porcentaje ?? 15}%`, resumen.totalIva);
    fila('VALOR TOTAL', resumen.importeTotal, true);
    ty += 6;
    doc.font('Helvetica').fontSize(8);
    doc.text('Formas de pago: ' + venta.pagos.map((p) => {
      const ex = [p.banco, p.documento && `comp. ${p.documento}`].filter(Boolean).join(' ');
      return `${p.metodo}${ex ? ` (${ex})` : ''} ${dinero(p.monto)}`;
    }).join('  ·  '), izqX, ty, { width: anchoUtil });

    ty = doc.y + 16;
    doc.fontSize(8).fillColor('#555')
      .text('Documento generado electrónicamente. Consulte su validez en el portal del SRI con la clave de acceso.', izqX, ty, { width: anchoUtil });

    doc.end();
  });
}

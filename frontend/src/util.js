export function dinero(valor) {
  const n = Number(valor || 0);
  return n.toLocaleString('es-EC', { style: 'currency', currency: 'USD' });
}

export function fecha(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-EC', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function soloFecha(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: 'short' });
}

export function redondear2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Descripción legible de una variante
export function nombreVariante(v) {
  return [v.talla, v.color].filter(Boolean).join(' / ');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Genera el HTML de un recibo estilo tirilla 80 mm.
export function reciboHTML(negocio = {}, venta = {}) {
  const m = (n) => '$' + Number(n || 0).toFixed(2);
  const items = venta.items || [];
  const pagos = venta.pagos || [];
  const fecha = venta.creado_en ? new Date(venta.creado_en).toLocaleString('es-EC') : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Recibo #${venta.id ?? ''}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { width: 72mm; margin: 0 auto; font-family: 'Segoe UI', 'Helvetica Neue', monospace; font-size: 12px; color: #000; }
  .c { text-align: center; } .b { font-weight: 700; } .r { text-align: right; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .logo { max-width: 42mm; max-height: 24mm; display: block; margin: 0 auto 4px; }
  .muted { font-size: 10px; color: #444; }
</style></head><body onload="setTimeout(function(){window.print()},150)">
  ${negocio.logo_url ? `<img class="logo" src="${negocio.logo_url}" alt="">` : ''}
  <div class="c b"><h1>${esc(negocio.nombre || 'Mi Tienda')}</h1></div>
  ${negocio.razon_social ? `<div class="c">${esc(negocio.razon_social)}</div>` : ''}
  ${negocio.ruc ? `<div class="c">RUC: ${esc(negocio.ruc)}</div>` : ''}
  ${negocio.direccion ? `<div class="c">${esc(negocio.direccion)}</div>` : ''}
  ${negocio.telefono ? `<div class="c">Tel: ${esc(negocio.telefono)}</div>` : ''}
  <hr>
  <div>Recibo #${venta.id ?? ''}</div>
  <div>${fecha}</div>
  ${venta.tienda ? `<div>Tienda: ${esc(venta.tienda)}</div>` : ''}
  ${venta.vendedor ? `<div>Atendió: ${esc(venta.vendedor)}</div>` : ''}
  ${venta.cliente_nombre ? `<div>Cliente: ${esc(venta.cliente_nombre)}</div>` : ''}
  ${venta.cliente_identificacion ? `<div>ID: ${esc(venta.cliente_identificacion)}</div>` : ''}
  <hr>
  <table>
    ${items.map((it) => `
      <tr><td colspan="2">${esc(it.descripcion || it.desc || 'Producto')}</td></tr>
      <tr><td>${it.cantidad} x ${m(it.precio_unitario ?? it.precioUnitario)}${Number(it.descuento ?? it.descLinea) > 0 ? ` (-${m(it.descuento ?? it.descLinea)})` : ''}</td>
          <td class="r">${m(it.total_linea ?? it.totalLinea)}</td></tr>`).join('')}
  </table>
  <hr>
  <table>
    <tr><td>Subtotal</td><td class="r">${m(venta.subtotal)}</td></tr>
    ${Number(venta.descuento_total) > 0 ? `<tr><td>Descuento</td><td class="r">-${m(venta.descuento_total)}</td></tr>` : ''}
    <tr class="b"><td>TOTAL</td><td class="r">${m(venta.total)}</td></tr>
    ${pagos.map((p) => {
      const extra = [p.banco, p.documento && `Comp. ${p.documento}`, p.referencia].filter(Boolean).join(' ');
      return `<tr><td>${esc(p.metodo)}${extra ? ` (${esc(extra)})` : ''}</td><td class="r">${m(p.monto)}</td></tr>`;
    }).join('')}
    <tr><td>Cambio</td><td class="r">${m(venta.cambio)}</td></tr>
  </table>
  ${venta.nota ? `<hr><div>Nota: ${esc(venta.nota)}</div>` : ''}
  <hr>
  <div class="c">${esc(negocio.mensaje_recibo || 'Gracias por su compra')}</div>
  <div class="c muted" style="margin-top:6px">Documento no tributario</div>
</body></html>`;
}

// ---- Caja: desglose de efectivo (billetes/monedas) ----
export const BILLETES = ['100', '50', '20', '10', '5', '1'];
export const MONEDAS = ['1', '0.50', '0.25', '0.10', '0.05', '0.01'];

/** Suma { billetes:{'100':n,...}, monedas:{'0.50':n,...} } -> total en $. */
export function totalDesglose(d) {
  if (!d || typeof d !== 'object') return 0;
  let t = 0;
  for (const grupo of ['billetes', 'monedas']) {
    for (const [denom, cant] of Object.entries(d[grupo] || {})) {
      t += Number(denom) * (Number(cant) || 0);
    }
  }
  return redondear2(t);
}

/** HTML del comprobante de cierre de caja (80 mm o A4). */
export function comprobanteCajaHTML(negocio = {}, caja = {}, formato = '80mm') {
  const m = (n) => '$ ' + (Number(n) || 0).toFixed(2);
  const a4 = formato === 'a4';
  const dif = Number(caja.diferencia) || 0;
  const estado = dif === 0 ? 'CAJA CUADRADA' : dif > 0 ? `SOBRANTE ${m(dif)}` : `FALTANTE ${m(Math.abs(dif))}`;
  const dg = caja.desglose_cierre || {};
  const filasDesglose = (grupo, orden) => orden
    .filter((d) => (dg[grupo]?.[d] || 0) > 0)
    .map((d) => `<tr><td>$ ${d}</td><td class="r">${dg[grupo][d]}</td><td class="r">${m(Number(d) * dg[grupo][d])}</td></tr>`)
    .join('') || '<tr><td colspan="3" class="c">—</td></tr>';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Cierre de caja #${caja.numero ?? ''}</title>
<style>
  @page { size: ${a4 ? 'A4' : '80mm auto'}; margin: ${a4 ? '18mm' : '4mm'}; }
  body { font-family: 'Segoe UI', monospace; color: #000; margin: 0 auto; width: ${a4 ? '170mm' : '72mm'}; font-size: ${a4 ? '12px' : '11px'}; }
  h1 { font-size: ${a4 ? '18px' : '14px'}; margin: 0 0 2px; text-align: center; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .cols { display: flex; gap: 12px; } .cols > div { flex: 1; }
  .res { font-size: ${a4 ? '15px' : '12px'}; font-weight: 700; text-align: center; margin: 8px 0; padding: 6px; border: 1px solid #000; }
  .firmas { display: flex; gap: 20px; margin-top: 26px; } .firmas > div { flex: 1; text-align: center; border-top: 1px solid #000; padding-top: 3px; }
</style></head><body onload="setTimeout(function(){window.print()},150)">
  <div class="c b"><h1>${esc(negocio.nombre || 'Mi Tienda')}</h1></div>
  ${negocio.ruc ? `<div class="c">RUC: ${esc(negocio.ruc)}</div>` : ''}
  ${negocio.direccion ? `<div class="c">${esc(negocio.direccion)}</div>` : ''}
  ${negocio.telefono ? `<div class="c">Tel: ${esc(negocio.telefono)}</div>` : ''}
  <hr>
  <div class="c b">CIERRE DE CAJA #${caja.numero ?? ''}</div>
  <div>Tienda: ${esc(caja.tienda || '')}</div>
  <div>Responsable: ${esc(caja.responsable || '')}</div>
  <div>Cerró: ${esc(caja.cerrada_por_nombre || caja.responsable || '')}</div>
  <div>Apertura: ${caja.abierta_en ? new Date(caja.abierta_en).toLocaleString('es-EC') : ''}</div>
  <div>Cierre: ${caja.cerrada_en ? new Date(caja.cerrada_en).toLocaleString('es-EC') : ''}</div>
  <hr>
  <table>
    <tr><td>Fondo inicial</td><td class="r">${m(caja.fondo_inicial)}</td></tr>
    <tr><td>Ventas en efectivo</td><td class="r">${m(caja.ventas_efectivo)}</td></tr>
    <tr><td>Transferencias</td><td class="r">${m(caja.ventas_transferencia)}</td></tr>
    <tr><td>Ingresos extra</td><td class="r">${m(caja.ingresos_total)}</td></tr>
    <tr><td>Retiros</td><td class="r">- ${m(caja.retiros_total)}</td></tr>
    <tr class="b"><td>Efectivo esperado</td><td class="r">${m(caja.efectivo_esperado)}</td></tr>
    <tr class="b"><td>Efectivo contado</td><td class="r">${m(caja.efectivo_contado)}</td></tr>
    <tr class="b"><td>Diferencia</td><td class="r">${m(dif)}</td></tr>
  </table>
  <hr>
  <div class="b">Desglose del efectivo contado</div>
  <div class="cols">
    <div><div class="b">Billetes</div><table>${filasDesglose('billetes', BILLETES)}</table></div>
    <div><div class="b">Monedas</div><table>${filasDesglose('monedas', MONEDAS)}</table></div>
  </div>
  ${caja.observacion ? `<hr><div>Obs.: ${esc(caja.observacion)}</div>` : ''}
  <div class="res">${estado}</div>
  <div class="firmas"><div>Firma responsable</div><div>Firma administrador</div></div>
</body></html>`;
}

export function imprimirComprobanteCaja(negocio, caja, formato = '80mm') {
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) return false;
  w.document.write(comprobanteCajaHTML(negocio, caja, formato));
  w.document.close();
  return true;
}

// Abre una ventana con el recibo y lanza el diálogo de impresión (o "Guardar como PDF").
export function imprimirRecibo(negocio, venta) {
  const w = window.open('', '_blank', 'width=380,height=640');
  if (!w) return false;
  w.document.write(reciboHTML(negocio, venta));
  w.document.close();
  return true;
}

// Reduce una imagen a un thumbnail liviano (data URI JPEG) para guardarla en el producto.
export function comprimirImagen(file, maxLado = 320, calidad = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('El archivo no es una imagen'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width >= height && width > maxLado) {
        height = Math.round((height * maxLado) / width);
        width = maxLado;
      } else if (height > maxLado) {
        width = Math.round((width * maxLado) / height);
        height = maxLado;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', calidad));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

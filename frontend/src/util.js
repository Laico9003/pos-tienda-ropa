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

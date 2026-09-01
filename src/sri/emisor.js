import dnsp from 'node:dns/promises';
import { signInvoiceXml } from 'ec-sri-invoice-signer';
import nodemailer from 'nodemailer';
import { consulta } from '../db/pool.js';
import { descifrar } from './cifrado.js';
import { construirFactura } from './construirFactura.js';
import { facturaXml } from './xml.js';
import { recepcion, autorizacion } from './soap.js';
import { generarRidePDF } from './ride.js';

async function traerContexto(ventaId) {
  const { rows: v } = await consulta(
    `SELECT ve.*, t.nombre AS tienda, u.nombre AS vendedor
       FROM ventas ve JOIN tiendas t ON t.id = ve.tienda_id JOIN usuarios u ON u.id = ve.usuario_id
      WHERE ve.id = $1`, [ventaId],
  );
  const { rows: items } = await consulta(`SELECT * FROM venta_items WHERE venta_id = $1 ORDER BY id`, [ventaId]);
  const { rows: pagos } = await consulta(`SELECT * FROM pagos WHERE venta_id = $1 ORDER BY id`, [ventaId]);
  const { rows: neg } = await consulta(`SELECT * FROM negocio WHERE id = 1`);
  return { venta: v[0], items, pagos, negocio: neg[0] };
}

async function guardar(id, campos) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(campos)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
  vals.push(id);
  await consulta(`UPDATE comprobantes_sri SET ${sets.join(', ')}, actualizado_en = now() WHERE id = $${vals.length}`, vals);
}

function reintentarLuego(id, comp, motivo) {
  const min = Math.min(60, 2 ** comp.intentos); // backoff: 2,4,8,... hasta 60 min
  return guardar(id, {
    intentos: comp.intentos + 1,
    proximo_intento: new Date(Date.now() + min * 60000),
    mensajes: JSON.stringify({ motivo: String(motivo).slice(0, 800) }),
  });
}

/** Procesa un comprobante avanzándolo un paso. Devuelve el nuevo estado. */
export async function procesarComprobante(comp) {
  const { venta, items, pagos, negocio } = await traerContexto(comp.venta_id);
  if (!negocio?.certificado_p12 || !negocio?.certificado_clave_cif) {
    await guardar(comp.id, {
      estado: 'error',
      mensajes: JSON.stringify({ motivo: 'Falta configurar el certificado .p12 en Datos del negocio' }),
    });
    return 'error';
  }

  try {
    // ---------- 1. Firmar ----------
    if (comp.estado === 'pendiente') {
      const { invoice, claveAcceso, resumen } = construirFactura({ venta, items, pagos, negocio, comprobante: comp });
      const xml = facturaXml(invoice);
      const firmado = signInvoiceXml(xml, negocio.certificado_p12, {
        pkcs12Password: descifrar(negocio.certificado_clave_cif),
      });
      await guardar(comp.id, {
        estado: 'firmado', clave_acceso: claveAcceso, xml_firmado: firmado,
        mensajes: JSON.stringify({ resumen }),
      });
      await consulta(`UPDATE ventas SET clave_acceso = $1, estado_sri = 'pendiente' WHERE id = $2`, [claveAcceso, comp.venta_id]);
      comp.estado = 'firmado';
      comp.xml_firmado = firmado;
      comp.clave_acceso = claveAcceso;
    }

    // ---------- 2. Recepción ----------
    if (comp.estado === 'firmado') {
      const r = await recepcion(comp.xml_firmado, comp.ambiente);
      if (r.estado === 'RECIBIDA') {
        await guardar(comp.id, { estado: 'recibida' });
        await consulta(`UPDATE ventas SET estado_sri = 'recibida' WHERE id = $1`, [comp.venta_id]);
        comp.estado = 'recibida';
      } else if (r.mensajes.some((m) => /registrad/i.test(`${m?.mensaje} ${m?.informacionAdicional}`))) {
        // "CLAVE ACCESO REGISTRADA" -> ya estaba recibida, seguimos a autorización
        await guardar(comp.id, { estado: 'recibida' });
        comp.estado = 'recibida';
      } else {
        await guardar(comp.id, { estado: 'devuelta', mensajes: JSON.stringify({ mensajes: r.mensajes }) });
        await consulta(`UPDATE ventas SET estado_sri = 'devuelta' WHERE id = $1`, [comp.venta_id]);
        return 'devuelta';
      }
    }

    // ---------- 3. Autorización ----------
    if (comp.estado === 'recibida' || comp.estado === 'enviado') {
      const a = await autorizacion(comp.clave_acceso, comp.ambiente);
      if (/^AUTORIZADO$/i.test(a.estado)) {
        await guardar(comp.id, {
          estado: 'autorizada',
          numero_autorizacion: a.numeroAutorizacion || comp.clave_acceso,
          fecha_autorizacion: a.fechaAutorizacion ? new Date(a.fechaAutorizacion) : new Date(),
          xml_autorizado: a.comprobante || null,
        });
        await consulta(
          `UPDATE ventas SET estado_sri = 'autorizada', numero_comprobante = $1 WHERE id = $2`,
          [a.numeroAutorizacion || comp.clave_acceso, comp.venta_id],
        );
        comp.estado = 'autorizada';
        comp.numero_autorizacion = a.numeroAutorizacion;
        comp.fecha_autorizacion = a.fechaAutorizacion;
        comp.xml_autorizado = a.comprobante;
      } else if (/NO AUTORIZADO|RECHAZAD/i.test(a.estado)) {
        await guardar(comp.id, { estado: 'no_autorizada', mensajes: JSON.stringify({ mensajes: a.mensajes }) });
        await consulta(`UPDATE ventas SET estado_sri = 'no_autorizada' WHERE id = $1`, [comp.venta_id]);
        return 'no_autorizada';
      } else {
        // EN PROCESAMIENTO / NO_ENCONTRADO -> reintentar
        await reintentarLuego(comp.id, comp, `SRI autorización: ${a.estado}`);
        return comp.estado;
      }
    }

    // ---------- 4. Enviar RIDE por correo ----------
    const usaApiCorreo = ['brevo', 'smtp2go'].includes(negocio.email_proveedor) && !!negocio.email_api_key_cif;
    const hayCorreoSaliente = usaApiCorreo || !!negocio.smtp_host;
    if (comp.estado === 'autorizada' && !comp.correo_enviado && comp.correo_destino && hayCorreoSaliente) {
      try {
        await enviarCorreo({ negocio, venta, items, pagos, comp });
        await guardar(comp.id, { correo_enviado: true });
        comp.correo_enviado = true;
      } catch (e) {
        await reintentarLuego(comp.id, comp, `Correo: ${e.message}`);
      }
    }

    return comp.estado;
  } catch (e) {
    await reintentarLuego(comp.id, comp, e.message);
    return comp.estado;
  }
}

async function enviarCorreo({ negocio, venta, items, pagos, comp }) {
  const { resumen } = construirFactura({ venta, items, pagos, negocio, comprobante: comp });
  const pdf = await generarRidePDF({ negocio, venta: { ...venta, items, pagos }, comprobante: comp, resumen });

  const asunto = `Factura electrónica ${comp.estab}-${comp.pto_emi}-${comp.secuencial} - ${negocio.nombre || ''}`;
  const texto = `Adjuntamos su factura electrónica.\n\nClave de acceso: ${comp.clave_acceso}\nTotal: $ ${Number(venta.total).toFixed(2)}\n\n${negocio.mensaje_recibo || 'Gracias por su compra'}`;
  const remitente = negocio.smtp_remitente || negocio.smtp_usuario || negocio.email;
  const remitenteNombre = negocio.smtp_remitente_nombre || negocio.nombre || undefined;

  const adjuntos = [{ nombre: `factura-${comp.secuencial}.pdf`, pdf }];
  if (comp.xml_autorizado) adjuntos.push({ nombre: `factura-${comp.secuencial}.xml`, xml: comp.xml_autorizado });

  if (negocio.email_proveedor === 'smtp2go' && negocio.email_api_key_cif) {
    await enviarPorSmtp2go({ negocio, comp, asunto, texto, remitente, remitenteNombre, adjuntos });
  } else if (negocio.email_proveedor === 'brevo' && negocio.email_api_key_cif) {
    await enviarPorBrevo({ negocio, comp, asunto, texto, remitente, remitenteNombre, adjuntos });
  } else if (negocio.smtp_host) {
    await enviarPorSmtp({ negocio, comp, asunto, texto, remitente, remitenteNombre, adjuntos });
  } else {
    throw new Error('No hay correo saliente configurado en Datos del negocio');
  }
}

/** Envío por API HTTPS de SMTP2GO (registro sin teléfono ni dominio; funciona en Railway). */
async function enviarPorSmtp2go({ negocio, comp, asunto, texto, remitente, remitenteNombre, adjuntos }) {
  if (!remitente) throw new Error('Falta el correo remitente (verificado en SMTP2GO)');
  const sender = remitenteNombre ? `${remitenteNombre} <${remitente}>` : remitente;
  const resp = await fetch('https://api.smtp2go.com/v3/email/send', {
    method: 'POST',
    headers: {
      'X-Smtp2go-Api-Key': descifrar(negocio.email_api_key_cif),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: [comp.correo_destino],
      subject: asunto,
      text_body: texto,
      attachments: adjuntos.map((a) => ({
        filename: a.nombre,
        fileblob: (a.pdf || Buffer.from(a.xml, 'utf8')).toString('base64'),
        mimetype: a.pdf ? 'application/pdf' : 'application/xml',
      })),
    }),
  });
  const j = await resp.json().catch(() => ({}));
  const data = j.data || {};
  if (!resp.ok || data.error || Number(data.succeeded || 0) < 1) {
    const detalle = data.error || data.error_code || (data.failures && JSON.stringify(data.failures)) || JSON.stringify(j).slice(0, 300);
    throw new Error(`SMTP2GO ${resp.status}: ${detalle}`);
  }
}

/** Envío por API HTTPS de Brevo (funciona en hosts que bloquean SMTP, como Railway). */
async function enviarPorBrevo({ negocio, comp, asunto, texto, remitente, remitenteNombre, adjuntos }) {
  if (!remitente) throw new Error('Falta el correo remitente (verificado en Brevo)');
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': descifrar(negocio.email_api_key_cif),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: remitente, name: remitenteNombre },
      to: [{ email: comp.correo_destino }],
      subject: asunto,
      textContent: texto,
      attachment: adjuntos.map((a) => ({
        name: a.nombre,
        content: (a.pdf || Buffer.from(a.xml, 'utf8')).toString('base64'),
      })),
    }),
  });
  if (!resp.ok) {
    throw new Error(`Brevo ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
}

/** Envío por SMTP (servidor propio / VPS). */
async function enviarPorSmtp({ negocio, comp, asunto, texto, remitente, remitenteNombre, adjuntos }) {
  let hostConexion = negocio.smtp_host;
  try {
    const { address } = await dnsp.lookup(negocio.smtp_host, { family: 4 });
    if (address) hostConexion = address;
  } catch { /* usa el nombre tal cual */ }

  const transport = nodemailer.createTransport({
    host: hostConexion,
    port: Number(negocio.smtp_port) || 587,
    secure: !!negocio.smtp_seguro,
    auth: negocio.smtp_usuario ? { user: negocio.smtp_usuario, pass: descifrar(negocio.smtp_clave_cif) } : undefined,
    family: 4,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    tls: { servername: negocio.smtp_host },
  });

  await transport.sendMail({
    from: remitenteNombre ? `"${remitenteNombre}" <${remitente}>` : remitente,
    to: comp.correo_destino,
    subject: asunto,
    text: texto,
    attachments: adjuntos.map((a) => (
      a.pdf ? { filename: a.nombre, content: a.pdf }
        : { filename: a.nombre, content: a.xml, contentType: 'application/xml' }
    )),
  });
}

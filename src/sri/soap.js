import { XMLParser } from 'fast-xml-parser';

const BASE = {
  1: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws',
  2: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws',
};

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

async function llamarSoap(url, soapAction, cuerpo, timeoutMs = 30000) {
  const envelope =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soapenv:Header/><soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml;charset=UTF-8', SOAPAction: soapAction },
      body: envelope,
      signal: ctrl.signal,
    });
    const texto = await resp.text();
    if (!resp.ok && !texto.includes('Envelope')) {
      throw new Error(`SRI HTTP ${resp.status}: ${texto.slice(0, 200)}`);
    }
    const json = parser.parse(texto);
    const body = json?.Envelope?.Body || {};
    Object.defineProperty(body, '__raw', { value: texto, enumerable: false });
    return body;
  } finally {
    clearTimeout(t);
  }
}

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);

/** Busca recursivamente la primera propiedad con ese nombre dentro del objeto. */
function buscar(obj, clave) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (clave in obj) return obj[clave];
  for (const v of Object.values(obj)) {
    const r = buscar(v, clave);
    if (r !== undefined) return r;
  }
  return undefined;
}

/**
 * Recepción del comprobante firmado.
 * @returns {{ estado: string, mensajes: Array }}
 */
export async function recepcion(xmlFirmado, ambiente) {
  const url = `${BASE[ambiente] || BASE[1]}/RecepcionComprobantesOffline`;
  const b64 = Buffer.from(xmlFirmado, 'utf8').toString('base64');
  const cuerpo =
    `<ec:validarComprobante xmlns:ec="http://ec.gob.sri.ws.recepcion">` +
    `<xml>${b64}</xml></ec:validarComprobante>`;
  const body = await llamarSoap(url, '', cuerpo);
  const r = buscar(body, 'RespuestaRecepcionComprobante') || {};
  const estado = buscar(r, 'estado') || 'DESCONOCIDO';
  let mensajes = arr(buscar(r, 'comprobante')).flatMap((c) => arr(buscar(c, 'mensaje')));
  if (estado !== 'RECIBIDA' && mensajes.length === 0 && body.__raw) {
    mensajes = [{ mensaje: 'Respuesta SRI', informacionAdicional: String(body.__raw).slice(0, 1500) }];
  }
  return { estado, mensajes };
}

/**
 * Consulta de autorización por clave de acceso.
 * @returns {{ estado, numeroAutorizacion, fechaAutorizacion, comprobante, mensajes }}
 */
export async function autorizacion(claveAcceso, ambiente) {
  const url = `${BASE[ambiente] || BASE[1]}/AutorizacionComprobantesOffline`;
  const cuerpo =
    `<ec:autorizacionComprobante xmlns:ec="http://ec.gob.sri.ws.autorizacion">` +
    `<claveAccesoComprobante>${claveAcceso}</claveAccesoComprobante></ec:autorizacionComprobante>`;
  const body = await llamarSoap(url, '', cuerpo);
  const r = buscar(body, 'RespuestaAutorizacionComprobante') || {};
  const a = arr(buscar(r, 'autorizacion'))[0] || {};
  const numComp = buscar(r, 'numeroComprobantes');
  const estado = buscar(a, 'estado') || (Number(numComp) === 0 ? 'NO_ENCONTRADO' : 'EN PROCESAMIENTO');
  let mensajes = arr(buscar(a, 'mensaje'));
  if (/NO AUTORIZADO|RECHAZAD/i.test(estado) && mensajes.length === 0 && body.__raw) {
    mensajes = [{ mensaje: 'Respuesta SRI', informacionAdicional: String(body.__raw).slice(0, 1500) }];
  }
  const comprobante = buscar(a, 'comprobante');
  return {
    estado,
    numeroAutorizacion: buscar(a, 'numeroAutorizacion') || null,
    fechaAutorizacion: buscar(a, 'fechaAutorizacion') || null,
    comprobante: typeof comprobante === 'string' ? comprobante : null,
    mensajes,
  };
}

import { consulta } from '../db/pool.js';
import { procesarComprobante } from './emisor.js';

const INTERVALO_MS = Number(process.env.SRI_WORKER_INTERVALO_MS) || 15000;
const MAX_INTENTOS = Number(process.env.SRI_WORKER_MAX_INTENTOS) || 12;
const ESTADOS_ACTIVOS = ['pendiente', 'firmado', 'enviado', 'recibida', 'autorizada'];

let corriendo = false;

async function tanda() {
  if (corriendo) return;
  corriendo = true;
  try {
    const { rows } = await consulta(
      `SELECT * FROM comprobantes_sri
        WHERE estado = ANY($1)
          AND proximo_intento <= now()
          AND intentos < $2
          AND NOT (estado = 'autorizada' AND correo_enviado = true)
        ORDER BY creado_en
        LIMIT 5`,
      [ESTADOS_ACTIVOS, MAX_INTENTOS],
    );
    for (const comp of rows) {
      try {
        await procesarComprobante(comp);
      } catch (e) {
        console.error(`[SRI] comprobante ${comp.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[SRI worker]', e.message);
  } finally {
    corriendo = false;
  }
}

export function iniciarWorkerSri() {
  console.log(`[SRI] worker activo (cada ${INTERVALO_MS / 1000}s)`);
  setInterval(tanda, INTERVALO_MS).unref();
  setTimeout(tanda, 3000).unref();
}

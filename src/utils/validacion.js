import { ErrorHttp } from '../middleware/errores.js';

/** Exige que un valor venga presente (no vacío). */
export function requerido(valor, nombre) {
  if (valor === undefined || valor === null || valor === '') {
    throw new ErrorHttp(400, `El campo "${nombre}" es obligatorio`);
  }
  return valor;
}

/** Convierte a número y valida rango opcional. */
export function aNumero(valor, nombre, { min, max } = {}) {
  const n = Number(valor);
  if (valor === '' || valor === null || valor === undefined || Number.isNaN(n)) {
    throw new ErrorHttp(400, `El campo "${nombre}" debe ser numérico`);
  }
  if (min !== undefined && n < min) throw new ErrorHttp(400, `El campo "${nombre}" debe ser mayor o igual a ${min}`);
  if (max !== undefined && n > max) throw new ErrorHttp(400, `El campo "${nombre}" debe ser menor o igual a ${max}`);
  return n;
}

/** Igual que aNumero pero exige entero. */
export function aEntero(valor, nombre, opciones) {
  const n = aNumero(valor, nombre, opciones);
  if (!Number.isInteger(n)) throw new ErrorHttp(400, `El campo "${nombre}" debe ser un número entero`);
  return n;
}

/** Redondea a 2 decimales evitando errores de coma flotante. */
export function redondear2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Fecha (YYYY-MM-DD) de hoy y de hace `dias` días, para filtros por defecto. */
export function rangoPorDefecto(dias = 30) {
  const hoy = new Date();
  const desde = new Date(Date.now() - (dias - 1) * 86400000);
  return {
    desde: desde.toISOString().slice(0, 10),
    hasta: hoy.toISOString().slice(0, 10),
  };
}

/** Zona horaria de la tienda (Ecuador), usada para que los filtros por fecha
 *  tomen días completos en hora local y no en UTC (servidor). */
export const ZONA_ECUADOR = 'America/Guayaquil';

/**
 * Agrega a `params` ?desde/?hasta ('YYYY-MM-DD') como un rango de días
 * completos en hora de Ecuador sobre una columna timestamptz, y devuelve
 * los fragmentos SQL a sumar al WHERE (array, puede quedar vacío).
 */
export function condicionesFechaEcuador(params, columna, { desde, hasta }) {
  const condiciones = [];
  if (desde) {
    params.push(desde);
    condiciones.push(`${columna} >= ($${params.length}::date AT TIME ZONE '${ZONA_ECUADOR}')`);
  }
  if (hasta) {
    params.push(hasta);
    condiciones.push(`${columna} < (($${params.length}::date + INTERVAL '1 day') AT TIME ZONE '${ZONA_ECUADOR}')`);
  }
  return condiciones;
}

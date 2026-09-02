// Utilidades de seguridad sin dependencias externas:
//   1. Freno de fuerza bruta para /api/auth/login (en memoria, por IP + correo).
//   2. Caché corta del estado (activo / rol) del usuario para que desactivar una
//      cuenta o cambiarle el rol surta efecto sin esperar a que caduque el JWT.

import { consulta } from '../db/pool.js';

// ---------- 1. Freno de intentos de login ----------
const MAX_INTENTOS = 8;        // intentos fallidos antes de bloquear
const VENTANA_MIN = 15;        // se cuentan los fallos de los últimos N minutos
const BLOQUEO_MIN = 15;        // cuánto dura el bloqueo

const intentos = new Map();    // clave -> { n, primero, hasta }

export function claveLogin(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'ip';
  const email = String(req.body?.email || '').toLowerCase().trim();
  return `${ip}|${email}`;
}

/** Segundos que faltan para poder reintentar, o 0 si no está bloqueado. */
export function loginBloqueado(clave) {
  const e = intentos.get(clave);
  if (e?.hasta && e.hasta > Date.now()) return Math.ceil((e.hasta - Date.now()) / 1000);
  return 0;
}

export function loginFallido(clave) {
  const ahora = Date.now();
  let e = intentos.get(clave);
  if (!e || ahora - e.primero > VENTANA_MIN * 60_000) e = { n: 0, primero: ahora, hasta: 0 };
  e.n += 1;
  if (e.n >= MAX_INTENTOS) e.hasta = ahora + BLOQUEO_MIN * 60_000;
  intentos.set(clave, e);
}

export function loginOk(clave) {
  intentos.delete(clave);
}

// Limpieza periódica para que el Map no crezca sin límite.
setInterval(() => {
  const ahora = Date.now();
  for (const [k, e] of intentos) {
    if ((!e.hasta || e.hasta < ahora) && ahora - e.primero > VENTANA_MIN * 60_000) intentos.delete(k);
  }
}, 10 * 60_000).unref?.();

// ---------- 2. Estado del usuario (activo / rol) con caché ----------
const TTL_MS = 30_000;
const cacheEstado = new Map(); // id -> { activo, rol, exp }

/**
 * Devuelve { activo, rol } del usuario, con caché de 30 s.
 * Devuelve null si el usuario ya no existe.
 */
export async function estadoUsuario(id) {
  const hit = cacheEstado.get(id);
  if (hit && hit.exp > Date.now()) return hit.activo === null ? null : hit;

  const { rows } = await consulta('SELECT activo, rol FROM usuarios WHERE id = $1', [id]);
  const est = rows[0]
    ? { activo: rows[0].activo, rol: rows[0].rol, exp: Date.now() + TTL_MS }
    : { activo: null, rol: null, exp: Date.now() + TTL_MS };
  cacheEstado.set(id, est);
  return est.activo === null ? null : est;
}

/** Invalida la caché de un usuario (tras cambiarle rol o estado). */
export function invalidarEstadoUsuario(id) {
  cacheEstado.delete(Number(id));
}

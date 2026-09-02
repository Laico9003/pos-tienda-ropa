import jwt from 'jsonwebtoken';
import { ErrorHttp } from './errores.js';
import { consulta } from '../db/pool.js';
import { estadoUsuario } from './seguridad.js';

/**
 * Verifica el token JWT y deja los datos del usuario en req.usuario.
 * Además comprueba (con caché de 30 s) que la cuenta siga activa y aplica el
 * rol actual de la base, para que desactivar un usuario o cambiarle el rol
 * tenga efecto sin esperar a que caduque el token.
 */
export async function autenticar(req, _res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
  if (!token) throw new ErrorHttp(401, 'Falta el token de autenticación');

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET); // { id, rol, tienda_id, nombre }
  } catch {
    throw new ErrorHttp(401, 'Token inválido o expirado');
  }

  try {
    const est = await estadoUsuario(payload.id);
    if (!est || est.activo === false) throw new ErrorHttp(401, 'La cuenta está desactivada');
    payload.rol = est.rol; // respeta cambios de rol en caliente
  } catch (e) {
    if (e instanceof ErrorHttp) throw e;
    // Fallo transitorio de la BD: no cerramos la sesión de todos; el JWT sigue siendo válido.
  }

  req.usuario = payload;
  next();
}

/** Restringe la ruta a los roles indicados. */
export function requiereRol(...roles) {
  return (req, _res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      throw new ErrorHttp(403, 'No tienes permisos para realizar esta acción');
    }
    next();
  };
}

/**
 * Devuelve la tienda sobre la que opera la petición.
 * - admin: puede elegir con ?tienda_id= o body.tienda_id; si no, su tienda.
 * - vendedor / bodega: siempre quedan fijados a su propia tienda (se ignora
 *   cualquier tienda_id que manden por query o body).
 */
export function tiendaObjetivo(req) {
  if (req.usuario.rol === 'admin') {
    const id = req.query.tienda_id ?? req.body?.tienda_id;
    return id ? Number(id) : req.usuario.tienda_id;
  }
  return req.usuario.tienda_id;
}

/**
 * Igual que `tiendaObjetivo` pero además valida que la tienda exista y esté
 * activa. Úsala en los endpoints de consulta que aceptan `?tienda_id` del
 * navegador (separación por tienda del panel de administración).
 * @returns {Promise<number>}
 */
export async function tiendaSeleccionada(req) {
  const id = Number(tiendaObjetivo(req));
  if (!Number.isInteger(id) || id <= 0) {
    throw new ErrorHttp(400, 'No se pudo determinar la tienda');
  }
  const { rows } = await consulta('SELECT 1 FROM tiendas WHERE id = $1 AND activo = true', [id]);
  if (!rows[0]) throw new ErrorHttp(400, 'La tienda seleccionada no existe');
  return id;
}

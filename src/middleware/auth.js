import jwt from 'jsonwebtoken';
import { ErrorHttp } from './errores.js';

/** Verifica el token JWT y deja los datos del usuario en req.usuario. */
export function autenticar(req, _res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
  if (!token) throw new ErrorHttp(401, 'Falta el token de autenticación');

  try {
    // { id, rol, tienda_id, nombre }
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    throw new ErrorHttp(401, 'Token inválido o expirado');
  }
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
 * - vendedor / bodega: siempre quedan fijados a su propia tienda.
 */
export function tiendaObjetivo(req) {
  if (req.usuario.rol === 'admin') {
    const id = req.query.tienda_id ?? req.body?.tienda_id;
    return id ? Number(id) : req.usuario.tienda_id;
  }
  return req.usuario.tienda_id;
}

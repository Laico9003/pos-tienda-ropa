import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { consulta } from '../db/pool.js';
import { autenticar } from '../middleware/auth.js';
import { ErrorHttp } from '../middleware/errores.js';
import { requerido } from '../utils/validacion.js';
import { loginBloqueado, loginFallido, loginOk, invalidarEstadoUsuario } from '../middleware/seguridad.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const espera = loginBloqueado(req);
  if (espera) {
    res.setHeader('Retry-After', String(espera));
    throw new ErrorHttp(429, `Demasiados intentos fallidos. Espera ${Math.ceil(espera / 60)} min e inténtalo de nuevo.`);
  }

  const email = String(requerido(req.body.email, 'email')).toLowerCase().trim();
  const password = String(requerido(req.body.password, 'password'));

  const { rows } = await consulta(
    `SELECT u.*, t.nombre AS tienda_nombre
       FROM usuarios u
       LEFT JOIN tiendas t ON t.id = u.tienda_id
      WHERE u.email = $1`,
    [email],
  );
  const usuario = rows[0];
  if (!usuario || !usuario.activo) { loginFallido(req); throw new ErrorHttp(401, 'Credenciales inválidas'); }

  const ok = await bcrypt.compare(password, usuario.password_hash);
  if (!ok) { loginFallido(req); throw new ErrorHttp(401, 'Credenciales inválidas'); }

  loginOk(req);

  const token = jwt.sign(
    { id: usuario.id, rol: usuario.rol, tienda_id: usuario.tienda_id, nombre: usuario.nombre },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRA || '12h' },
  );

  res.json({
    token,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      tienda_id: usuario.tienda_id,
      tienda_nombre: usuario.tienda_nombre,
    },
  });
});

// GET /api/auth/perfil
router.get('/perfil', autenticar, async (req, res) => {
  const { rows } = await consulta(
    `SELECT u.id, u.nombre, u.email, u.rol, u.tienda_id, t.nombre AS tienda_nombre
       FROM usuarios u
       LEFT JOIN tiendas t ON t.id = u.tienda_id
      WHERE u.id = $1`,
    [req.usuario.id],
  );
  if (!rows[0]) throw new ErrorHttp(404, 'Usuario no encontrado');
  res.json(rows[0]);
});

// POST /api/auth/cambiar-clave  — cualquier usuario cambia SU propia contraseña
router.post('/cambiar-clave', autenticar, async (req, res) => {
  const actual = String(requerido(req.body.actual, 'actual'));
  const nueva = String(requerido(req.body.nueva, 'nueva'));
  if (nueva.length < 6) throw new ErrorHttp(400, 'La nueva contraseña debe tener al menos 6 caracteres');
  if (nueva === actual) throw new ErrorHttp(400, 'La nueva contraseña debe ser distinta de la actual');

  const { rows } = await consulta('SELECT password_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
  if (!rows[0]) throw new ErrorHttp(404, 'Usuario no encontrado');

  const ok = await bcrypt.compare(actual, rows[0].password_hash);
  if (!ok) throw new ErrorHttp(400, 'La contraseña actual no es correcta');

  const hash = await bcrypt.hash(nueva, 10);
  await consulta('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, req.usuario.id]);
  invalidarEstadoUsuario(req.usuario.id);
  res.json({ ok: true });
});

export default router;

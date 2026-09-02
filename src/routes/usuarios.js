import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { consulta } from '../db/pool.js';
import { autenticar, requiereRol } from '../middleware/auth.js';
import { ErrorHttp } from '../middleware/errores.js';
import { requerido } from '../utils/validacion.js';
import { invalidarEstadoUsuario } from '../middleware/seguridad.js';

const router = Router();
router.use(autenticar, requiereRol('admin'));

const ROLES = ['admin', 'vendedor', 'bodega'];

// GET /api/usuarios
router.get('/', async (_req, res) => {
  const { rows } = await consulta(
    `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.tienda_id,
            t.nombre AS tienda, u.creado_en
       FROM usuarios u
       LEFT JOIN tiendas t ON t.id = u.tienda_id
      ORDER BY u.nombre`,
  );
  res.json(rows);
});

// POST /api/usuarios
router.post('/', async (req, res) => {
  const nombre = String(requerido(req.body.nombre, 'nombre')).trim();
  const email = String(requerido(req.body.email, 'email')).toLowerCase().trim();
  const password = String(requerido(req.body.password, 'password'));
  const rol = req.body.rol || 'vendedor';

  if (!ROLES.includes(rol)) throw new ErrorHttp(400, `Rol inválido. Use uno de: ${ROLES.join(', ')}`);
  if (password.length < 6) throw new ErrorHttp(400, 'La contraseña debe tener al menos 6 caracteres');

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await consulta(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, tienda_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, nombre, email, rol, activo, tienda_id`,
    [nombre, email, hash, rol, req.body.tienda_id || null],
  );
  res.status(201).json(rows[0]);
});

// PUT /api/usuarios/:id
router.put('/:id', async (req, res) => {
  const { nombre, rol, tienda_id, activo, password } = req.body;
  if (rol && !ROLES.includes(rol)) throw new ErrorHttp(400, `Rol inválido. Use uno de: ${ROLES.join(', ')}`);

  const id = Number(req.params.id);
  const propioUsuario = id === req.usuario.id;

  // No permitir que un admin se desactive o se quite el rol de admin a sí mismo.
  if (propioUsuario && activo === false) throw new ErrorHttp(400, 'No puedes desactivar tu propia cuenta');
  if (propioUsuario && rol && rol !== 'admin') throw new ErrorHttp(400, 'No puedes quitarte a ti mismo el rol de administrador');

  // No dejar el sistema sin ningún admin activo.
  if (activo === false || (rol && rol !== 'admin')) {
    const { rows: r } = await consulta(
      `SELECT rol, activo FROM usuarios WHERE id = $1`, [id],
    );
    const eraAdminActivo = r[0]?.rol === 'admin' && r[0]?.activo;
    if (eraAdminActivo) {
      const { rows: c } = await consulta(
        `SELECT COUNT(*)::int AS n FROM usuarios WHERE rol = 'admin' AND activo = true AND id <> $1`, [id],
      );
      if (c[0].n === 0) throw new ErrorHttp(409, 'Debe quedar al menos un administrador activo');
    }
  }

  let hash = null;
  if (password) {
    if (String(password).length < 6) throw new ErrorHttp(400, 'La contraseña debe tener al menos 6 caracteres');
    hash = await bcrypt.hash(String(password), 10);
  }

  const { rows } = await consulta(
    `UPDATE usuarios SET
        nombre        = COALESCE($1, nombre),
        rol           = COALESCE($2, rol),
        tienda_id     = COALESCE($3, tienda_id),
        activo        = COALESCE($4, activo),
        password_hash = COALESCE($5, password_hash)
      WHERE id = $6
      RETURNING id, nombre, email, rol, activo, tienda_id`,
    [
      nombre ? String(nombre).trim() : null,
      rol ?? null,
      tienda_id ?? null,
      typeof activo === 'boolean' ? activo : null,
      hash,
      req.params.id,
    ],
  );
  if (!rows[0]) throw new ErrorHttp(404, 'Usuario no encontrado');
  invalidarEstadoUsuario(id);
  res.json(rows[0]);
});

export default router;

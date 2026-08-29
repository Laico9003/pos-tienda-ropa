import { Router } from 'express';
import { consulta } from '../db/pool.js';
import { autenticar, requiereRol } from '../middleware/auth.js';
import { ErrorHttp } from '../middleware/errores.js';
import { requerido } from '../utils/validacion.js';

const router = Router();
router.use(autenticar);

// GET /api/tiendas  — disponible para cualquier usuario autenticado (selectores)
router.get('/', async (req, res) => {
  const { rows } = await consulta(
    `SELECT id, nombre, codigo_establecimiento, punto_emision, direccion, telefono, activo
       FROM tiendas
      ${req.query.incluir_inactivas === 'true' ? '' : 'WHERE activo = true'}
      ORDER BY codigo_establecimiento`,
  );
  res.json(rows);
});

// POST /api/tiendas  — solo admin
router.post('/', requiereRol('admin'), async (req, res) => {
  const nombre = String(requerido(req.body.nombre, 'nombre')).trim();
  const codigo = String(requerido(req.body.codigo_establecimiento, 'codigo_establecimiento')).trim();
  const puntoEmision = String(req.body.punto_emision || '001').trim();
  const { rows } = await consulta(
    `INSERT INTO tiendas (nombre, codigo_establecimiento, punto_emision, direccion, telefono)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [nombre, codigo, puntoEmision, req.body.direccion ?? null, req.body.telefono ?? null],
  );
  res.status(201).json(rows[0]);
});

// PUT /api/tiendas/:id  — solo admin
router.put('/:id', requiereRol('admin'), async (req, res) => {
  const { nombre, punto_emision, direccion, telefono, activo } = req.body;
  const { rows } = await consulta(
    `UPDATE tiendas SET
        nombre        = COALESCE($1, nombre),
        punto_emision = COALESCE($2, punto_emision),
        direccion     = COALESCE($3, direccion),
        telefono      = COALESCE($4, telefono),
        activo        = COALESCE($5, activo)
      WHERE id = $6
      RETURNING *`,
    [
      nombre ? String(nombre).trim() : null,
      punto_emision ? String(punto_emision).trim() : null,
      direccion ?? null,
      telefono ?? null,
      typeof activo === 'boolean' ? activo : null,
      req.params.id,
    ],
  );
  if (!rows[0]) throw new ErrorHttp(404, 'Tienda no encontrada');
  res.json(rows[0]);
});

export default router;

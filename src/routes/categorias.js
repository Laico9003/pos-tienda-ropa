import { Router } from 'express';
import { consulta } from '../db/pool.js';
import { autenticar, requiereRol } from '../middleware/auth.js';
import { ErrorHttp } from '../middleware/errores.js';
import { requerido } from '../utils/validacion.js';

const router = Router();
router.use(autenticar);

// GET /api/categorias?incluir_inactivas=true
router.get('/', async (req, res) => {
  const incluirInactivas = req.query.incluir_inactivas === 'true';
  const { rows } = await consulta(
    `SELECT c.id, c.nombre, c.activo,
            COUNT(p.id) FILTER (WHERE p.activo) ::int AS productos
       FROM categorias c
       LEFT JOIN productos p ON p.categoria_id = c.id
      ${incluirInactivas ? '' : 'WHERE c.activo = true'}
      GROUP BY c.id
      ORDER BY c.nombre`,
  );
  res.json(rows);
});

// POST /api/categorias
router.post('/', requiereRol('admin', 'bodega'), async (req, res) => {
  const nombre = String(requerido(req.body.nombre, 'nombre')).trim();
  const { rows } = await consulta(
    `INSERT INTO categorias (nombre) VALUES ($1) RETURNING id, nombre, activo`,
    [nombre],
  );
  res.status(201).json(rows[0]);
});

// PUT /api/categorias/:id
router.put('/:id', requiereRol('admin', 'bodega'), async (req, res) => {
  const { nombre, activo } = req.body;
  const { rows } = await consulta(
    `UPDATE categorias SET
        nombre = COALESCE($1, nombre),
        activo = COALESCE($2, activo)
      WHERE id = $3
      RETURNING id, nombre, activo`,
    [nombre ? String(nombre).trim() : null, typeof activo === 'boolean' ? activo : null, req.params.id],
  );
  if (!rows[0]) throw new ErrorHttp(404, 'Categoría no encontrada');
  res.json(rows[0]);
});

// DELETE /api/categorias/:id
// Si la categoría tiene productos, se desactiva en lugar de borrarse.
router.delete('/:id', requiereRol('admin', 'bodega'), async (req, res) => {
  const { id } = req.params;
  const enUso = await consulta(`SELECT 1 FROM productos WHERE categoria_id = $1 LIMIT 1`, [id]);

  if (enUso.rowCount > 0) {
    const { rows } = await consulta(
      `UPDATE categorias SET activo = false WHERE id = $1 RETURNING id, nombre, activo`,
      [id],
    );
    if (!rows[0]) throw new ErrorHttp(404, 'Categoría no encontrada');
    return res.json({
      desactivada: true,
      categoria: rows[0],
      mensaje: 'La categoría tiene productos asociados, se desactivó en lugar de eliminarla',
    });
  }

  const { rowCount } = await consulta(`DELETE FROM categorias WHERE id = $1`, [id]);
  if (rowCount === 0) throw new ErrorHttp(404, 'Categoría no encontrada');
  res.json({ eliminada: true });
});

export default router;

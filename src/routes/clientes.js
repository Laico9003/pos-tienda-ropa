import { Router } from 'express';
import { consulta } from '../db/pool.js';
import { autenticar } from '../middleware/auth.js';

const router = Router();
router.use(autenticar);

const limpiar = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const soloDigitos = (v) => String(v || '').replace(/\D/g, '').slice(0, 13);

/** Crea o actualiza un cliente por su identificación. Devuelve la fila (o null si la id no sirve). */
export async function upsertCliente({ identificacion, nombre, email, telefono, direccion }) {
  const id = soloDigitos(identificacion);
  if (id.length < 3 || !nombre) return null;
  const { rows } = await consulta(
    `INSERT INTO clientes (identificacion, nombre, email, telefono, direccion)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (identificacion) DO UPDATE SET
       nombre         = EXCLUDED.nombre,
       email          = COALESCE(EXCLUDED.email, clientes.email),
       telefono       = COALESCE(EXCLUDED.telefono, clientes.telefono),
       direccion      = COALESCE(EXCLUDED.direccion, clientes.direccion),
       actualizado_en = now()
     RETURNING *`,
    [id, String(nombre).trim(), limpiar(email), limpiar(telefono), limpiar(direccion)],
  );
  return rows[0];
}

// GET /api/clientes?q=texto  — autocompletar por nombre o identificación
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const { rows } = await consulta(
    `SELECT identificacion, nombre, email, telefono, direccion
       FROM clientes
      WHERE identificacion ILIKE $1 OR nombre ILIKE $1
      ORDER BY nombre
      LIMIT 10`,
    [`%${q}%`],
  );
  res.json(rows);
});

// GET /api/clientes/:identificacion  — buscar uno exacto
router.get('/:identificacion', async (req, res) => {
  const id = soloDigitos(req.params.identificacion);
  const { rows } = await consulta(
    `SELECT identificacion, nombre, email, telefono, direccion FROM clientes WHERE identificacion = $1`,
    [id],
  );
  res.json({ cliente: rows[0] || null });
});

// PUT /api/clientes  — guardar/actualizar (upsert por identificación)
router.put('/', async (req, res) => {
  const guardado = await upsertCliente(req.body || {});
  if (!guardado) {
    return res.status(400).json({ error: 'Se necesita una identificación y un nombre para guardar el cliente' });
  }
  res.json(guardado);
});

export default router;

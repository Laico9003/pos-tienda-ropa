import dns from 'node:dns';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { crearApp } from './app.js';
import { iniciarWorkerSri } from './sri/worker.js';
import { pool } from './db/pool.js';
import { aplicarEsquema } from './db/migrar.js';

// Prioriza IPv4 en las resoluciones DNS (algunos hosts como Railway no rutean IPv6 saliente).
try { dns.setDefaultResultOrder('ipv4first'); } catch { /* Node viejo */ }

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en el archivo .env');
  process.exit(1);
}

// En producción (Railway/VPS) conviene AUTO_MIGRAR=true: aplica el esquema y,
// si no hay usuarios, crea las tiendas base y el admin desde ADMIN_EMAIL / ADMIN_PASSWORD.
async function preparar() {
  if (process.env.AUTO_MIGRAR === 'true') {
    console.log('Aplicando esquema de base de datos…');
    await aplicarEsquema();

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
    if (rows[0].n === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      await pool.query(
        `INSERT INTO tiendas (nombre, codigo_establecimiento, punto_emision)
         VALUES ('Tienda 1','001','001'), ('Tienda 2','002','001')
         ON CONFLICT (codigo_establecimiento) DO NOTHING`,
      );
      const hash = await bcrypt.hash(String(process.env.ADMIN_PASSWORD), 10);
      await pool.query(
        `INSERT INTO usuarios (tienda_id, nombre, email, password_hash, rol)
         VALUES (1, $1, $2, $3, 'admin')`,
        [process.env.ADMIN_NOMBRE || 'Admin', String(process.env.ADMIN_EMAIL).toLowerCase().trim(), hash],
      );
      console.log(`Usuario administrador creado: ${process.env.ADMIN_EMAIL}`);
    }
  }
}

const PORT = process.env.PORT || 3000;

preparar()
  .then(() => {
    const app = crearApp();
    app.listen(PORT, () => {
      console.log(`Servidor POS corriendo en http://localhost:${PORT}`);
      if (process.env.SRI_WORKER !== 'off') iniciarWorkerSri();
    });
  })
  .catch((err) => {
    console.error('Error al iniciar:', err.message);
    process.exit(1);
  });

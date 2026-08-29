import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';

/*
 * Crea (si no existen) las 2 tiendas base y un usuario administrador.
 *
 * Uso interactivo:
 *   npm run crear-admin
 *
 * Uso no interactivo (útil en el servidor):
 *   ADMIN_NOMBRE="Admin" ADMIN_EMAIL="admin@tienda.com" ADMIN_PASSWORD="secreta123" npm run crear-admin
 */

async function pedirDatos() {
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    return {
      nombre: process.env.ADMIN_NOMBRE || 'Admin',
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    };
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const nombre = (await rl.question('Nombre del administrador: ')) || 'Admin';
  const email = await rl.question('Email: ');
  const password = await rl.question('Contraseña (mín. 6 caracteres): ');
  rl.close();
  return { nombre, email, password };
}

async function main() {
  const { nombre, email, password } = await pedirDatos();
  const correo = String(email || '').toLowerCase().trim();

  if (!correo || String(password || '').length < 6) {
    console.error('Se requiere un email y una contraseña de al menos 6 caracteres.');
    process.exit(1);
  }

  // Tiendas base (no se duplican gracias a codigo_establecimiento UNIQUE)
  await pool.query(
    `INSERT INTO tiendas (nombre, codigo_establecimiento, punto_emision)
     VALUES ('Tienda 1', '001', '001'), ('Tienda 2', '002', '001')
     ON CONFLICT (codigo_establecimiento) DO NOTHING`,
  );
  const { rows: tiendas } = await pool.query(
    `SELECT id FROM tiendas ORDER BY codigo_establecimiento LIMIT 1`,
  );

  const hash = await bcrypt.hash(String(password), 10);
  const { rows } = await pool.query(
    `INSERT INTO usuarios (tienda_id, nombre, email, password_hash, rol)
     VALUES ($1, $2, $3, $4, 'admin')
     ON CONFLICT (email)
     DO UPDATE SET password_hash = EXCLUDED.password_hash, rol = 'admin', activo = true
     RETURNING id, nombre, email, rol, tienda_id`,
    [tiendas[0].id, nombre, correo, hash],
  );

  console.log('Listo. Usuario administrador:', rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

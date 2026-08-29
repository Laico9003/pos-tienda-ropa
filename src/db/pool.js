import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en el archivo .env');
  process.exit(1);
}

// PostgreSQL administrado (Railway, Render, Neon, Supabase...) suele exigir SSL.
const necesitaSSL =
  /sslmode=require/.test(process.env.DATABASE_URL) ||
  process.env.DATABASE_SSL === 'true';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: necesitaSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

/** Ejecuta una consulta suelta usando el pool. */
export function consulta(texto, parametros) {
  return pool.query(texto, parametros);
}

/**
 * Ejecuta `fn(cliente)` dentro de una transacción.
 * Hace COMMIT si todo va bien y ROLLBACK ante cualquier error.
 */
export async function conTransaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

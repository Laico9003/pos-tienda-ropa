import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

// Solo se usa DATABASE_URL si de verdad parece una URL de PostgreSQL.
// Si viene con basura (p. ej. una referencia mal pegada), se ignora y se
// usan las variables sueltas PGHOST / PGUSER / PGPASSWORD / PGDATABASE / PGPORT
// que Railway/Render inyectan al conectar la base.
const url = process.env.DATABASE_URL;
const urlValida = typeof url === 'string' && /^postgres(ql)?:\/\/.+@.+/i.test(url.trim());

if (!urlValida && !process.env.PGHOST) {
  console.error(
    'No hay conexión a la base de datos válida.\n' +
    `  DATABASE_URL = ${url ? JSON.stringify(url.slice(0, 40) + '…') : '(vacío)'}\n` +
    '  Debe ser algo como  postgresql://usuario:clave@host:5432/basedatos\n' +
    '  (o definir PGHOST, PGUSER, PGPASSWORD, PGDATABASE).',
  );
  process.exit(1);
}

const necesitaSSL =
  (urlValida && /sslmode=require/.test(url)) ||
  process.env.DATABASE_SSL === 'true' ||
  process.env.PGSSLMODE === 'require';

export const pool = new Pool({
  ...(urlValida ? { connectionString: url.trim() } : {}), // si no, pg toma PGHOST/PGUSER/...
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

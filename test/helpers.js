import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Arranca un PostgreSQL embebido (descarga los binarios la primera vez),
 * crea la base y aplica el esquema. Devuelve { pg, url, stop }.
 */
// Puerto 55433 para no chocar con `npm run db:local` (que usa 55432).
export async function iniciarPostgres({ port = 55433, databaseDir, persistent = false } = {}) {
  const dataDir = databaseDir || path.join(dir, '..', '.pgdata-test');
  if (!persistent && fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase('pos_tienda_ropa');
  } catch (e) {
    if (!/already exists/i.test(String(e.message))) throw e;
  }

  const url = `postgresql://postgres:postgres@localhost:${port}/pos_tienda_ropa`;
  return {
    pg,
    url,
    stop: async () => {
      try { await pg.stop(); } catch { /* ignore */ }
    },
  };
}

/** Aplica src/db/schema.sql usando un pool ya conectado. */
export async function aplicarEsquema(pool) {
  const sql = fs.readFileSync(path.join(dir, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

// -------- mini framework de aserciones --------
let pasadas = 0;
let fallidas = 0;

export function ok(condicion, titulo, extra) {
  if (condicion) {
    pasadas++;
    console.log(`  \x1b[32m✓\x1b[0m ${titulo}`);
  } else {
    fallidas++;
    console.log(`  \x1b[31m✗ ${titulo}\x1b[0m`);
    if (extra !== undefined) console.log('     →', JSON.stringify(extra));
  }
}

export function igual(actual, esperado, titulo) {
  ok(JSON.stringify(actual) === JSON.stringify(esperado), titulo, { actual, esperado });
}

export function resumen() {
  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  return fallidas === 0;
}

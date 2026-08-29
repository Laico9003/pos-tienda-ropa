/*
 * Levanta un PostgreSQL LOCAL embebido para desarrollo, sin instalar nada.
 * Los datos se guardan en ./.pgdata-local y se conservan entre reinicios.
 *
 *   npm run db:local
 *
 * Deja corriendo la base en el puerto 55432. Poné en tu .env:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pos_tienda_ropa
 *
 * Cortá con Ctrl+C.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PGLOCAL_PORT) || 55432;

const pg = new EmbeddedPostgres({
  databaseDir: path.join(dir, '..', '..', '.pgdata-local'),
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
  // Fuerza UTF-8 (si no, en Windows la base queda en WIN1252 y falla con emojis / caracteres raros)
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

async function main() {
  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase('pos_tienda_ropa');
    console.log('Base "pos_tienda_ropa" creada.');
  } catch (e) {
    if (/already exists/i.test(String(e.message))) console.log('Base "pos_tienda_ropa" ya existía.');
    else throw e;
  }

  console.log('\nPostgreSQL local corriendo.');
  console.log(`DATABASE_URL=postgresql://postgres:postgres@localhost:${PORT}/pos_tienda_ropa\n`);
  console.log('Siguiente: en otra terminal ->  npm run migrar  &&  npm run crear-admin  &&  npm run dev');
  console.log('(Ctrl+C para detener la base)');
}

async function detener() {
  console.log('\nDeteniendo PostgreSQL local...');
  try { await pg.stop(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', detener);
process.on('SIGTERM', detener);

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

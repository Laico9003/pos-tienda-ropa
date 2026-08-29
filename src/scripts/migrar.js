import { pool } from '../db/pool.js';
import { aplicarEsquema } from '../db/migrar.js';

async function main() {
  console.log('Aplicando esquema de base de datos...');
  await aplicarEsquema();
  console.log('Esquema aplicado correctamente.');
  await pool.end();
}

main().catch((err) => {
  console.error('Error al aplicar el esquema:', err.message);
  process.exit(1);
});

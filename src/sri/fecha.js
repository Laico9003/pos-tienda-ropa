// Fechas del SRI SIEMPRE en hora de Ecuador (America/Guayaquil = UTC-5, sin horario de verano),
// sin importar la zona horaria del servidor donde corra el sistema.

function partesEC(d = new Date()) {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d); // "YYYY-MM-DD"
  const [y, m, dd] = iso.split('-');
  return { y, m, dd };
}

/** "dd/mm/yyyy" en hora de Ecuador (para infoFactura.fechaEmision). */
export function fechaEmisionEC(d) {
  const { y, m, dd } = partesEC(d instanceof Date ? d : new Date(d || Date.now()));
  return `${dd}/${m}/${y}`;
}

/** "ddmmyyyy" en hora de Ecuador (para la clave de acceso). */
export function ddmmyyyyEC(d) {
  const { y, m, dd } = partesEC(d instanceof Date ? d : new Date(d || Date.now()));
  return `${dd}${m}${y}`;
}

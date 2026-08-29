// Clave de acceso del SRI: 49 dígitos.
//   ddmmyyyy(8) + codDoc(2) + ruc(13) + ambiente(1) + serie=estab+ptoEmi(6)
//   + secuencial(9) + codigoNumerico(8) + tipoEmision(1) + digitoVerificador(1)

function ddmmyyyy(fecha) {
  const d = String(fecha.getDate()).padStart(2, '0');
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${d}${m}${fecha.getFullYear()}`;
}

/** Dígito verificador por módulo 11, pesos 7..2 cíclicos. */
export function digitoVerificador(clave48) {
  let suma = 0;
  let peso = 2;
  for (let i = clave48.length - 1; i >= 0; i--) {
    suma += Number(clave48[i]) * peso;
    peso = peso === 7 ? 2 : peso + 1;
  }
  const resto = suma % 11;
  const dig = 11 - resto;
  if (dig === 11) return 0;
  if (dig === 10) return 1;
  return dig;
}

/**
 * @param {object} o
 * @param {Date}   o.fecha
 * @param {string} o.codDoc         '01'
 * @param {string} o.ruc            13 dígitos
 * @param {string} o.ambiente       '1' | '2'
 * @param {string} o.estab          '001'
 * @param {string} o.ptoEmi         '001'
 * @param {string} o.secuencial     9 dígitos (con ceros a la izquierda)
 * @param {string} [o.codigoNumerico] 8 dígitos; si falta se genera aleatorio
 * @param {string} [o.tipoEmision]  '1'
 */
export function generarClaveAcceso(o) {
  const codigoNumerico = (o.codigoNumerico || String(Math.floor(10000000 + Math.random() * 89999999)))
    .padStart(8, '0')
    .slice(0, 8);
  const tipoEmision = o.tipoEmision || '1';
  const base =
    ddmmyyyy(o.fecha) +
    o.codDoc +
    String(o.ruc).padStart(13, '0') +
    o.ambiente +
    String(o.estab).padStart(3, '0') +
    String(o.ptoEmi).padStart(3, '0') +
    String(o.secuencial).padStart(9, '0') +
    codigoNumerico +
    tipoEmision;
  return base + String(digitoVerificador(base));
}

import crypto from 'node:crypto';

// Clave de cifrado para secretos guardados en la base (contraseña del .p12 y del SMTP).
// Se deriva de SRI_CLAVE si existe, si no de JWT_SECRET.
const material = process.env.SRI_CLAVE || process.env.JWT_SECRET || 'clave-por-defecto-cambiar';
const CLAVE = crypto.createHash('sha256').update(material).digest(); // 32 bytes

/** Cifra un texto -> "ivBase64:tagBase64:datosBase64". Devuelve null si el texto es vacío. */
export function cifrar(texto) {
  if (texto === undefined || texto === null || texto === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', CLAVE, iv);
  const datos = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${datos.toString('base64')}`;
}

/** Descifra lo que produjo cifrar(). Devuelve '' si no hay valor o si falla. */
export function descifrar(valor) {
  if (!valor) return '';
  try {
    const [ivB64, tagB64, datosB64] = String(valor).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', CLAVE, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(datosB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

// Cliente HTTP mínimo para la API del POS.
const BASE = import.meta.env.VITE_API_URL || '';

let token = localStorage.getItem('pos_token') || null;
let alSalir = null; // callback que se dispara ante un 401

export function setToken(nuevo) {
  token = nuevo;
  if (nuevo) localStorage.setItem('pos_token', nuevo);
  else localStorage.removeItem('pos_token');
}

export function getToken() {
  return token;
}

export function onNoAutorizado(fn) {
  alSalir = fn;
}

async function pedir(metodo, ruta, cuerpo) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });

  let datos = null;
  const texto = await res.text();
  if (texto) {
    try { datos = JSON.parse(texto); } catch { datos = texto; }
  }

  if (res.status === 401 && alSalir) alSalir();

  if (!res.ok) {
    const mensaje = (datos && datos.error) || `Error ${res.status}`;
    const err = new Error(mensaje);
    err.status = res.status;
    err.datos = datos;
    throw err;
  }
  return datos;
}

// Descarga un archivo protegido (con el token) y lo abre en una pestaña nueva.
export async function abrirArchivo(ruta) {
  const res = await fetch(BASE + ruta, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const api = {
  get: (ruta) => pedir('GET', ruta),
  post: (ruta, cuerpo) => pedir('POST', ruta, cuerpo),
  put: (ruta, cuerpo) => pedir('PUT', ruta, cuerpo),
  del: (ruta) => pedir('DELETE', ruta),
};

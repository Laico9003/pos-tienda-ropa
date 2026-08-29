import { useRef } from 'react';
import { useToast } from './Toast.jsx';
import { comprimirImagen } from '../util.js';

/**
 * Selector de foto: comprime la imagen en el navegador y devuelve un data URI
 * (o null si se quita). No sube archivos al servidor.
 */
export default function SelectorImagen({ valor, onCambio, disabled, etiqueta = 'Subir foto', maxLado = 320 }) {
  const toast = useToast();
  const inputRef = useRef(null);

  async function elegir(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      onCambio(await comprimirImagen(file, maxLado));
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="sel-imagen">
      <div className="sel-imagen-prev">
        {valor ? <img src={valor} alt="" /> : <span>🖼️</span>}
      </div>
      <div className="sel-imagen-acc">
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={elegir} />
        <button type="button" className="btn-secundario chico" disabled={disabled}
          onClick={() => inputRef.current?.click()}>
          {valor ? 'Cambiar' : etiqueta}
        </button>
        {valor && (
          <button type="button" className="btn-texto peligro" disabled={disabled}
            onClick={() => onCambio(null)}>Quitar</button>
        )}
      </div>
    </div>
  );
}

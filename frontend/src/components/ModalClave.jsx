import { useState } from 'react';
import { api } from '../api.js';
import { useToast } from './Toast.jsx';

/** Modal para que el usuario cambie su propia contraseña. */
export default function ModalClave({ onCerrar }) {
  const toast = useToast();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (nueva.length < 6) { toast.error('La nueva contraseña debe tener al menos 6 caracteres'); return; }
    if (nueva !== repetir) { toast.error('La nueva contraseña y su repetición no coinciden'); return; }
    setGuardando(true);
    try {
      await api.post('/api/auth/cambiar-clave', { actual, nueva });
      toast.ok('Contraseña actualizada');
      onCerrar();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Cambiar contraseña</h3>
        <label>Contraseña actual
          <input type="password" value={actual} onChange={(e) => setActual(e.target.value)}
            autoComplete="current-password" autoFocus />
        </label>
        <label>Nueva contraseña
          <input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)}
            autoComplete="new-password" />
        </label>
        <label>Repetir la nueva
          <input type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)}
            autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && guardar()} />
        </label>
        <div className="modal-acciones">
          <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primario" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Cambiar'}
          </button>
        </div>
      </div>
    </div>
  );
}

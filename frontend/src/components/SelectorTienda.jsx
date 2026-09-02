import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

/**
 * Selector de tienda para el panel de administración (Productos, Inventario,
 * Ventas, Comprobantes). Solo se muestra a los administradores; el backend
 * también valida el rol y la tienda, así que esto es solo la capa visual.
 *
 * Props:
 *   value     string|number   id de la tienda seleccionada ('' = todas)
 *   onChange  (id) => void
 *   conTodas  boolean         incluye el botón "Todas" (por defecto true)
 */
export default function SelectorTienda({ value, onChange, conTodas = true }) {
  const { esAdmin } = useAuth();
  const [tiendas, setTiendas] = useState([]);

  useEffect(() => {
    if (!esAdmin) return;
    api.get('/api/tiendas').then(setTiendas).catch(() => {});
  }, [esAdmin]);

  if (!esAdmin || tiendas.length === 0) return null;

  const val = String(value ?? '');

  return (
    <div className="tabs selector-tienda" role="group" aria-label="Tienda">
      {conTodas && (
        <button type="button" className={val === '' ? 'activo' : ''} onClick={() => onChange('')}>
          Todas
        </button>
      )}
      {tiendas.map((t) => (
        <button
          key={t.id}
          type="button"
          className={val === String(t.id) ? 'activo' : ''}
          onClick={() => onChange(String(t.id))}
        >
          {t.nombre}
        </button>
      ))}
    </div>
  );
}

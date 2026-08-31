import { useEffect, useRef } from 'react';
import { api } from '../api.js';

const VACIO = { identificacion: '', nombre: '', email: '', telefono: '', direccion: '' };

/**
 * Formulario de datos del cliente con validación de cédula/RUC (solo dígitos, máx. 13)
 * y autocompletado: al escribir 10 o 13 dígitos busca el cliente guardado y rellena.
 *
 * @param {object}   value     { identificacion, nombre, email, telefono, direccion }
 * @param {function} onChange  recibe el objeto completo actualizado
 * @param {function} [onEncontrado]  se llama con los datos si se encontró un cliente guardado
 */
export default function FormularioCliente({ value, onChange, onEncontrado }) {
  const v = { ...VACIO, ...(value || {}) };
  const buscado = useRef('');

  const set = (campos) => onChange({ ...v, ...campos });

  function cambiarId(texto) {
    const id = String(texto).replace(/\D/g, '').slice(0, 13); // solo dígitos, máx. 13
    set({ identificacion: id });
  }

  useEffect(() => {
    const id = v.identificacion;
    if ((id.length !== 10 && id.length !== 13) || buscado.current === id) return;
    buscado.current = id;
    api.get(`/api/clientes/${id}`).then((r) => {
      if (r?.cliente) {
        const c = r.cliente;
        onChange({
          identificacion: id,
          nombre: c.nombre || '',
          email: c.email || '',
          telefono: c.telefono || '',
          direccion: c.direccion || '',
        });
        onEncontrado?.(c);
      }
    }).catch(() => {});
  }, [v.identificacion]); // eslint-disable-line

  const hint = v.identificacion.length === 0 ? ''
    : v.identificacion.length === 10 ? 'Cédula (10 dígitos)'
      : v.identificacion.length === 13 ? 'RUC (13 dígitos)'
        : `${v.identificacion.length} dígitos — la cédula tiene 10 y el RUC 13`;

  return (
    <div className="form-cliente">
      <label>Cédula / RUC
        <input value={v.identificacion} onChange={(e) => cambiarId(e.target.value)}
          inputMode="numeric" maxLength={13} placeholder="Solo números" autoFocus />
        {hint && <span className={'nota-min' + (![0, 10, 13].includes(v.identificacion.length) ? ' peligro-txt' : '')}>{hint}</span>}
      </label>
      <label>Nombre / Razón social
        <input value={v.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder="Consumidor final" />
      </label>
      <label>Correo
        <input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} placeholder="cliente@correo.com" />
      </label>
      <label>Teléfono
        <input value={v.telefono} onChange={(e) => set({ telefono: e.target.value })} placeholder="099 999 9999" />
      </label>
      <label>Dirección
        <input value={v.direccion} onChange={(e) => set({ direccion: e.target.value })} placeholder="Calle, número, ciudad" />
      </label>
    </div>
  );
}

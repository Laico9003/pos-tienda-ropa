import { useState } from 'react';
import { BANCOS_EC } from '../constants.js';

/** Lista desplegable de bancos de Ecuador, con opción "Otro…" para escribir uno. */
export default function SelectorBanco({ value, onChange }) {
  const [otro, setOtro] = useState(!!value && !BANCOS_EC.includes(value));

  return (
    <>
      <select
        value={otro ? '__otro__' : (value || '')}
        onChange={(e) => {
          if (e.target.value === '__otro__') { setOtro(true); onChange(''); }
          else { setOtro(false); onChange(e.target.value); }
        }}
      >
        <option value="">— Selecciona el banco —</option>
        {BANCOS_EC.map((b) => <option key={b} value={b}>{b}</option>)}
        <option value="__otro__">Otro…</option>
      </select>
      {otro && (
        <input
          value={value}
          placeholder="Nombre del banco"
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          style={{ marginTop: 6 }}
        />
      )}
    </>
  );
}

import { BILLETES, MONEDAS, totalDesglose, dinero } from '../util.js';

/**
 * Grilla de billetes y monedas. value = { billetes:{}, monedas:{} }.
 * El total se calcula solo (el usuario nunca lo escribe).
 */
export default function DesgloseEfectivo({ value, onChange }) {
  const v = { billetes: {}, monedas: {}, ...(value || {}) };

  const set = (grupo, denom, cant) => {
    const n = Math.max(0, Math.floor(Number(cant) || 0));
    onChange({ ...v, [grupo]: { ...v[grupo], [denom]: n } });
  };

  const filas = (grupo, denoms) => denoms.map((d) => {
    const cant = v[grupo]?.[d] || 0;
    return (
      <tr key={grupo + d}>
        <td className="de-den">$ {d}</td>
        <td>
          <input type="number" min="0" step="1" value={cant || ''} placeholder="0"
            onChange={(e) => set(grupo, d, e.target.value)} />
        </td>
        <td className="r">{dinero(Number(d) * cant)}</td>
      </tr>
    );
  });

  return (
    <div className="desglose">
      <div className="de-col">
        <h5>Billetes</h5>
        <table className="tabla-sub">
          <thead><tr><th>Denom.</th><th>Cant.</th><th className="r">Total</th></tr></thead>
          <tbody>{filas('billetes', BILLETES)}</tbody>
        </table>
      </div>
      <div className="de-col">
        <h5>Monedas</h5>
        <table className="tabla-sub">
          <thead><tr><th>Denom.</th><th>Cant.</th><th className="r">Total</th></tr></thead>
          <tbody>{filas('monedas', MONEDAS)}</tbody>
        </table>
      </div>
      <div className="de-total">Total contado: <strong>{dinero(totalDesglose(v))}</strong></div>
    </div>
  );
}

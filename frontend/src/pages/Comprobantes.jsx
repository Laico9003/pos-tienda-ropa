import { useEffect, useState } from 'react';
import { api, abrirArchivo } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { dinero, fecha } from '../util.js';

const ESTADO_CLASE = {
  autorizada: 'completada',
  devuelta: 'anulada', no_autorizada: 'anulada', error: 'anulada',
};
const ESTADO_TXT = {
  pendiente: 'Pendiente', firmado: 'Firmado', enviado: 'Enviado', recibida: 'Recibida por el SRI',
  autorizada: 'Autorizada', devuelta: 'Devuelta', no_autorizada: 'No autorizada', error: 'Error',
};

export default function Comprobantes() {
  const { esAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [estado, setEstado] = useState('');
  const [detalle, setDetalle] = useState(null);

  async function cargar() {
    try {
      const r = await api.get(`/api/comprobantes?limite=200${estado ? `&estado=${estado}` : ''}`);
      setRows(r.comprobantes || []);
    } catch (e) { toast.error(e.message); }
  }
  useEffect(() => { cargar(); }, [estado]);

  async function reintentar(id) {
    try {
      await api.post(`/api/comprobantes/${id}/reintentar`);
      toast.ok('Reintento encolado');
      setTimeout(cargar, 1500);
    } catch (e) { toast.error(e.message); }
  }

  async function reenviarCorreo(c) {
    const correo = window.prompt('Enviar la factura por correo a:', c.correo_destino || '');
    if (correo === null) return;
    try {
      await api.post(`/api/comprobantes/${c.id}/reenviar-correo`, { correo: correo.trim() });
      toast.ok('Envío de correo encolado');
      setTimeout(cargar, 1500);
    } catch (e) { toast.error(e.message); }
  }

  function mensajesDe(m) {
    if (!m) return [];
    const arr = m.mensajes || m;
    return Array.isArray(arr) ? arr : [];
  }

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <h1>Comprobantes electrónicos</h1>
        <button className="btn-secundario" onClick={cargar}>Actualizar</button>
      </div>

      <div className="filtros">
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.keys(ESTADO_TXT).map((k) => <option key={k} value={k}>{ESTADO_TXT[k]}</option>)}
        </select>
      </div>

      <table className="tabla">
        <thead>
          <tr><th>Fecha</th><th>Nº</th><th>Cliente</th><th>Total</th><th>Estado</th><th>Correo</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{fecha(c.venta_fecha || c.creado_en)}</td>
              <td className="mono">{c.estab}-{c.pto_emi}-{c.secuencial}</td>
              <td>{c.cliente_nombre || 'Consumidor final'}</td>
              <td>{dinero(c.total)}</td>
              <td>
                <span className={'estado ' + (ESTADO_CLASE[c.estado] || 'proceso')}>{ESTADO_TXT[c.estado] || c.estado}</span>
                {c.intentos > 0 && ['devuelta', 'no_autorizada', 'error'].includes(c.estado) === false && (
                  <span className="nota-min"> · intento {c.intentos}</span>
                )}
              </td>
              <td>{c.correo_destino ? (c.correo_enviado ? '✅ enviado' : '⏳ ' + c.correo_destino) : '—'}</td>
              <td className="acc-fila">
                {mensajesDe(c.mensajes).length > 0 && (
                  <button className="btn-texto" onClick={() => setDetalle(c)}>Ver mensajes</button>
                )}
                {['autorizada', 'recibida', 'devuelta', 'no_autorizada'].includes(c.estado) && (
                  <>
                    <button className="btn-texto" onClick={() => abrirArchivo(`/api/comprobantes/${c.id}/xml`).catch((e) => toast.error(e.message))}>XML</button>
                    <button className="btn-texto" onClick={() => abrirArchivo(`/api/comprobantes/${c.id}/ride`).catch((e) => toast.error(e.message))}>RIDE</button>
                  </>
                )}
                {esAdmin && ['devuelta', 'no_autorizada', 'error', 'firmado', 'recibida'].includes(c.estado) && (
                  <button className="btn-texto" onClick={() => reintentar(c.id)}>Reintentar</button>
                )}
                {esAdmin && c.estado === 'autorizada' && !c.correo_enviado && (
                  <button className="btn-texto" onClick={() => reenviarCorreo(c)}>Enviar correo</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan="7" className="vacio-min">Sin comprobantes</td></tr>}
        </tbody>
      </table>

      {detalle && (
        <div className="modal-fondo" onClick={() => setDetalle(null)}>
          <div className="modal ancho-lg" onClick={(e) => e.stopPropagation()}>
            <h3>Comprobante {detalle.estab}-{detalle.pto_emi}-{detalle.secuencial}</h3>
            <p className="modal-sub">Estado: {ESTADO_TXT[detalle.estado] || detalle.estado} · Clave de acceso:
              <span className="mono" style={{ fontSize: 11 }}> {detalle.clave_acceso || '—'}</span></p>
            <ul className="msg-lista">
              {mensajesDe(detalle.mensajes).map((m, i) => (
                <li key={i}>
                  <strong>{m.identificador ? `[${m.identificador}] ` : ''}{m.mensaje || 'Mensaje'}</strong>
                  {m.informacionAdicional && <div className="msg-extra">{m.informacionAdicional}</div>}
                  {m.tipo && <span className="nota-min"> ({m.tipo})</span>}
                </li>
              ))}
            </ul>
            <div className="modal-acciones">
              <button className="btn-secundario" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

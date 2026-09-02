import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import DesgloseEfectivo from '../components/DesgloseEfectivo.jsx';
import { dinero, fecha, totalDesglose, imprimirComprobanteCaja } from '../util.js';

const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '—');

function resultado(dif) {
  if (Math.abs(dif) < 0.005) return { txt: '🟢 CAJA CUADRADA', cls: 'ok' };
  if (dif > 0) return { txt: `🟢 SOBRANTE ${dinero(dif)}`, cls: 'ok' };
  return { txt: `🔴 FALTANTE ${dinero(Math.abs(dif))}`, cls: 'bad' };
}

export default function Caja() {
  const { esAdmin } = useAuth();
  const [tab, setTab] = useState('actual');
  // El historial de caja es solo para administradores (el backend también lo exige).
  const verHistorial = esAdmin && tab === 'historial';
  return (
    <div className="pagina">
      <div className="pagina-cab"><h1>Caja</h1></div>
      <div className="tabs">
        <button className={tab === 'actual' ? 'activo' : ''} onClick={() => setTab('actual')}>Caja actual</button>
        {esAdmin && (
          <button className={tab === 'historial' ? 'activo' : ''} onClick={() => setTab('historial')}>Historial</button>
        )}
      </div>
      {verHistorial ? <HistorialCajas /> : <CajaActual />}
    </div>
  );
}

function CajaActual() {
  const { negocio } = useAuth();
  const toast = useToast();
  const [estado, setEstado] = useState(null); // { caja, totales, movimientos } | { caja: null }
  const [desgAper, setDesgAper] = useState({ billetes: {}, monedas: {} });
  const [abriendo, setAbriendo] = useState(false);
  const [modalMov, setModalMov] = useState(null); // { tipo }
  const [cerrando, setCerrando] = useState(false);
  const [desgCierre, setDesgCierre] = useState(null); // null = sección oculta
  const [obs, setObs] = useState('');
  const [reciboCerrada, setReciboCerrada] = useState(null);

  async function cargar() {
    try { setEstado(await api.get('/api/cajas/actual')); }
    catch (e) { toast.error(e.message); }
  }
  useEffect(() => { cargar(); }, []);

  async function abrir() {
    setAbriendo(true);
    try {
      await api.post('/api/cajas/abrir', { desglose_apertura: desgAper });
      setDesgAper({ billetes: {}, monedas: {} });
      toast.ok('Caja abierta');
      cargar();
    } catch (e) { toast.error(e.message); } finally { setAbriendo(false); }
  }

  async function registrarMov(monto, motivo) {
    try {
      await api.post(`/api/cajas/${estado.caja.id}/movimiento`, { tipo: modalMov.tipo, monto: Number(monto), motivo });
      setModalMov(null);
      toast.ok('Movimiento registrado');
      cargar();
    } catch (e) { toast.error(e.message); }
  }

  async function confirmarCierre() {
    setCerrando(true);
    try {
      const r = await api.post(`/api/cajas/${estado.caja.id}/cerrar`, {
        desglose_cierre: desgCierre, observacion: obs || undefined,
      });
      setReciboCerrada({ ...r.caja, tienda: estado.caja.tienda || '', responsable: estado.caja.responsable });
      setDesgCierre(null); setObs('');
      toast.ok('Caja cerrada');
      cargar();
    } catch (e) { toast.error(e.message); } finally { setCerrando(false); }
  }

  if (!estado) return <div className="vacio">Cargando…</div>;

  // ---------- Sin caja abierta: formulario de apertura ----------
  if (!estado.caja) {
    return (
      <div className="panel" style={{ maxWidth: 640 }}>
        <h2>Abrir caja</h2>
        <p className="nota-min">Cuenta el efectivo con el que inicias la jornada. El total se calcula solo.</p>
        <DesgloseEfectivo value={desgAper} onChange={setDesgAper} />
        <div className="modal-acciones">
          <button className="btn-primario" onClick={abrir} disabled={abriendo}>
            {abriendo ? 'Abriendo…' : `Abrir caja con ${dinero(totalDesglose(desgAper))}`}
          </button>
        </div>
        {reciboCerrada && <ReciboCierre caja={reciboCerrada} negocio={negocio} onCerrar={() => setReciboCerrada(null)} />}
      </div>
    );
  }

  // ---------- Caja abierta ----------
  const { caja, totales, movimientos } = estado;
  const contado = desgCierre ? totalDesglose(desgCierre) : 0;
  const dif = desgCierre ? contado - totales.efectivo_esperado : 0;
  const res = resultado(dif);

  return (
    <>
      <div className="caja-cab">
        <div>
          <span className="estado completada">CAJA ABIERTA</span>
          <strong> Caja #{caja.numero}</strong> · {caja.responsable} · abierta {hora(caja.abierta_en)}
        </div>
      </div>

      <div className="caja-kpis">
        <div><span>Fondo inicial</span><strong>{dinero(caja.fondo_inicial)}</strong></div>
        <div><span>Ventas efectivo</span><strong>{dinero(totales.ventas_efectivo)}</strong></div>
        <div><span>Transferencias</span><strong>{dinero(totales.ventas_transferencia)}</strong></div>
        <div><span>Retiros</span><strong>- {dinero(totales.retiros)}</strong></div>
        {totales.ingresos > 0 && <div><span>Ingresos extra</span><strong>{dinero(totales.ingresos)}</strong></div>}
        <div className="destacado"><span>Efectivo esperado</span><strong>{dinero(totales.efectivo_esperado)}</strong></div>
      </div>

      <div className="panel" style={{ maxWidth: 720 }}>
        <div className="panel-cab">
          <h2>Movimientos de caja ({totales.num_ventas} ventas)</h2>
          <div className="cab-acciones">
            <button className="btn-secundario" onClick={() => setModalMov({ tipo: 'retiro' })}>− Retiro</button>
            <button className="btn-secundario" onClick={() => setModalMov({ tipo: 'ingreso' })}>+ Ingreso</button>
          </div>
        </div>
        {movimientos.length === 0 ? (
          <p className="vacio-min">Sin retiros ni ingresos manuales</p>
        ) : (
          <table className="tabla-sub">
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id}>
                  <td>{m.tipo === 'retiro' ? '➖ Retiro' : '➕ Ingreso'}</td>
                  <td>{m.motivo || '—'}</td>
                  <td className="nota-min">{fecha(m.creado_en)} · {m.usuario}</td>
                  <td className="r"><strong>{m.tipo === 'retiro' ? '- ' : ''}{dinero(m.monto)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---------- Cierre ---------- */}
      {!desgCierre ? (
        <div className="modal-acciones" style={{ maxWidth: 720 }}>
          <button className="btn-primario" onClick={() => setDesgCierre({ billetes: {}, monedas: {} })}>
            Cerrar caja (arqueo)
          </button>
        </div>
      ) : (
        <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
          <h2>Arqueo — cuenta el efectivo físico</h2>
          <DesgloseEfectivo value={desgCierre} onChange={setDesgCierre} />

          <div className="arqueo-resumen">
            <div className="fila"><span>Efectivo esperado</span><span>{dinero(totales.efectivo_esperado)}</span></div>
            <div className="fila"><span>Efectivo contado</span><span>{dinero(contado)}</span></div>
            <div className="fila total"><span>Diferencia</span><span>{dinero(dif)}</span></div>
            <div className={'arqueo-badge ' + res.cls}>{res.txt}</div>
          </div>

          <label className="ancho">Observación (opcional)
            <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: faltó vuelto de una venta" />
          </label>

          <div className="modal-acciones">
            <button className="btn-secundario" onClick={() => setDesgCierre(null)} disabled={cerrando}>Cancelar</button>
            <button className="btn-primario" onClick={confirmarCierre} disabled={cerrando}>
              {cerrando ? 'Cerrando…' : 'Confirmar cierre'}
            </button>
          </div>
        </div>
      )}

      {modalMov && <ModalMovimiento tipo={modalMov.tipo} onCerrar={() => setModalMov(null)} onGuardar={registrarMov} />}
      {reciboCerrada && <ReciboCierre caja={reciboCerrada} negocio={negocio} onCerrar={() => setReciboCerrada(null)} />}
    </>
  );
}

function ModalMovimiento({ tipo, onCerrar, onGuardar }) {
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{tipo === 'retiro' ? 'Retiro de efectivo' : 'Ingreso de efectivo'}</h3>
        <p className="modal-sub">{tipo === 'retiro'
          ? 'Dinero que sale de la caja (pago a proveedor, gasto, depósito…).'
          : 'Dinero que entra a la caja aparte de las ventas (cambio, fondo extra…).'}</p>
        <label>Monto<input type="number" min="0.01" step="0.01" value={monto} autoFocus onChange={(e) => setMonto(e.target.value)} /></label>
        <label>Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
        <div className="modal-acciones">
          <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primario" onClick={() => Number(monto) > 0 && onGuardar(monto, motivo)}>Registrar</button>
        </div>
      </div>
    </div>
  );
}

function ReciboCierre({ caja, negocio, onCerrar }) {
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal recibo" onClick={(e) => e.stopPropagation()}>
        <div className={'check ' + (caja.resultado === 'faltante' ? 'malo' : '')}>
          {caja.resultado === 'faltante' ? '!' : '✓'}
        </div>
        <h3>Caja #{caja.numero} cerrada</h3>
        <div className="fila"><span>Efectivo esperado</span><span>{dinero(caja.efectivo_esperado)}</span></div>
        <div className="fila"><span>Efectivo contado</span><span>{dinero(caja.efectivo_contado)}</span></div>
        <div className={'fila ' + (Number(caja.diferencia) < 0 ? 'falta' : 'cambio')}>
          <span>Diferencia</span><span>{dinero(caja.diferencia)}</span>
        </div>
        <p className="nota-min">{resultado(Number(caja.diferencia)).txt}</p>
        <div className="modal-acciones" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn-secundario" onClick={() => imprimirComprobanteCaja(negocio, caja, '80mm')}>Imprimir 80 mm</button>
          <button className="btn-secundario" onClick={() => imprimirComprobanteCaja(negocio, caja, 'a4')}>Imprimir A4</button>
          <button className="btn-primario" onClick={onCerrar}>Listo</button>
        </div>
      </div>
    </div>
  );
}

function HistorialCajas() {
  const { esAdmin, negocio } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [detalle, setDetalle] = useState(null);

  useEffect(() => {
    api.get('/api/cajas').then(setRows).catch((e) => toast.error(e.message));
  }, []);

  async function ver(id) {
    try { setDetalle(await api.get(`/api/cajas/${id}`)); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <>
      <table className="tabla">
        <thead>
          <tr><th>#</th><th>Fecha</th>{esAdmin && <th>Tienda</th>}<th>Responsable</th>
            <th>Apertura</th><th>Cierre</th><th>Esperado</th><th>Contado</th><th>Transfer.</th><th>Dif.</th><th>Estado</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="clic" onClick={() => ver(c.id)}>
              <td>{c.numero}</td>
              <td>{fecha(c.abierta_en)}</td>
              {esAdmin && <td>{c.tienda}</td>}
              <td>{c.responsable}</td>
              <td>{hora(c.abierta_en)}</td>
              <td>{c.cerrada_en ? hora(c.cerrada_en) : '—'}</td>
              <td>{c.efectivo_esperado != null ? dinero(c.efectivo_esperado) : '—'}</td>
              <td>{c.efectivo_contado != null ? dinero(c.efectivo_contado) : '—'}</td>
              <td>{c.ventas_transferencia != null ? dinero(c.ventas_transferencia) : '—'}</td>
              <td>{c.diferencia != null ? dinero(c.diferencia) : '—'}</td>
              <td>
                {c.estado === 'abierta'
                  ? <span className="estado completada">abierta</span>
                  : <span className={'estado ' + (c.resultado === 'faltante' ? 'anulada' : 'completada')}>{c.resultado}</span>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={esAdmin ? 11 : 10} className="vacio-min">Sin cajas registradas</td></tr>}
        </tbody>
      </table>

      {detalle && (
        <div className="modal-fondo" onClick={() => setDetalle(null)}>
          <div className="modal ancho-lg" onClick={(e) => e.stopPropagation()}>
            <h3>Caja #{detalle.numero} · {detalle.tienda}</h3>
            <p className="modal-sub">
              {detalle.responsable} · {fecha(detalle.abierta_en)} → {detalle.cerrada_en ? fecha(detalle.cerrada_en) : 'ABIERTA'}
            </p>
            <div className="recibo-totales">
              <div className="fila"><span>Fondo inicial</span><span>{dinero(detalle.fondo_inicial)}</span></div>
              <div className="fila"><span>Ventas efectivo</span><span>{dinero(detalle.ventas_efectivo)}</span></div>
              <div className="fila"><span>Transferencias</span><span>{dinero(detalle.ventas_transferencia)}</span></div>
              <div className="fila"><span>Retiros</span><span>- {dinero(detalle.retiros_total)}</span></div>
              <div className="fila total"><span>Efectivo esperado</span><span>{dinero(detalle.efectivo_esperado)}</span></div>
              <div className="fila"><span>Efectivo contado</span><span>{dinero(detalle.efectivo_contado)}</span></div>
              <div className={'fila ' + (Number(detalle.diferencia) < 0 ? 'falta' : 'cambio')}>
                <span>Diferencia</span><span>{dinero(detalle.diferencia)}</span>
              </div>
            </div>
            {detalle.observacion && <p className="nota-min">Obs.: {detalle.observacion}</p>}
            <div className="modal-acciones">
              {detalle.estado === 'cerrada' && (
                <>
                  <button className="btn-secundario" onClick={() => imprimirComprobanteCaja(negocio, detalle, '80mm')}>Imprimir 80 mm</button>
                  <button className="btn-secundario" onClick={() => imprimirComprobanteCaja(negocio, detalle, 'a4')}>Imprimir A4</button>
                </>
              )}
              <button className="btn-secundario" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

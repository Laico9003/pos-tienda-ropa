import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import FormularioCliente from '../components/FormularioCliente.jsx';
import SelectorTienda from '../components/SelectorTienda.jsx';
import { BANCOS_EC } from '../constants.js';
import { dinero, fecha } from '../util.js';

const hoyISO = () => new Date().toISOString().slice(0, 10);
const haceISO = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

export default function Ventas() {
  const [tab, setTab] = useState('ventas');
  return (
    <div className="pagina">
      <div className="pagina-cab"><h1>Ventas</h1></div>
      <div className="tabs">
        <button className={tab === 'ventas' ? 'activo' : ''} onClick={() => setTab('ventas')}>Historial</button>
        <button className={tab === 'transfer' ? 'activo' : ''} onClick={() => setTab('transfer')}>Transferencias</button>
      </div>
      {tab === 'ventas' ? <ListaVentas /> : <Transferencias />}
    </div>
  );
}

function ListaVentas() {
  const { esAdmin } = useAuth();
  const toast = useToast();
  const [ventas, setVentas] = useState([]);
  const [desde, setDesde] = useState(haceISO(7));
  const [hasta, setHasta] = useState(hoyISO());
  const [tiendaId, setTiendaId] = useState('');   // '' = todas
  const [detalle, setDetalle] = useState(null);
  const [modalFactura, setModalFactura] = useState(null); // datos del cliente para facturar
  const [facturando, setFacturando] = useState(false);

  async function cargar() {
    try {
      const r = await api.get(`/api/ventas?desde=${desde}&hasta=${hasta}T23:59:59&limite=200${tiendaId ? `&tienda_id=${tiendaId}` : ''}`);
      setVentas(r.ventas || []);
    } catch (e) { toast.error(e.message); }
  }
  useEffect(() => { cargar(); }, [desde, hasta, tiendaId]);

  async function verDetalle(id) {
    try { setDetalle(await api.get(`/api/ventas/${id}`)); }
    catch (e) { toast.error(e.message); }
  }
  async function anular() {
    const motivo = prompt('Motivo de la anulación:');
    if (motivo === null) return;
    try {
      await api.post(`/api/ventas/${detalle.id}/anular`, { motivo });
      toast.ok('Venta anulada, stock repuesto');
      setDetalle(null); cargar();
    } catch (e) { toast.error(e.message); }
  }
  function facturar() {
    setModalFactura({
      identificacion: detalle.cliente_identificacion || '',
      nombre: detalle.cliente_nombre || '',
      email: detalle.cliente_email || '',
      telefono: detalle.cliente_telefono || '',
      direccion: detalle.cliente_direccion || '',
    });
  }
  async function confirmarFactura() {
    setFacturando(true);
    try {
      await api.post(`/api/ventas/${detalle.id}/facturar`, { cliente: modalFactura });
      toast.ok('Factura enviada al SRI (se procesa en segundo plano)');
      setModalFactura(null);
      verDetalle(detalle.id);
    } catch (e) { toast.error(e.message); }
    finally { setFacturando(false); }
  }
  async function toggleVerificado(pago) {
    try {
      await api.put(`/api/ventas/pagos/${pago.id}/verificado`, { verificado: !pago.verificado });
      verDetalle(detalle.id);
    } catch (e) { toast.error(e.message); }
  }

  const totalPeriodo = ventas.filter((v) => v.estado === 'completada').reduce((s, v) => s + Number(v.total), 0);

  return (
    <>
      {esAdmin && (
        <div className="filtros">
          <SelectorTienda value={tiendaId} onChange={setTiendaId} />
        </div>
      )}
      <div className="filtros">
        <label>Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <span className="total-periodo">{ventas.length} ventas · {dinero(totalPeriodo)}</span>
      </div>

      <table className="tabla">
        <thead><tr><th>#</th><th>Fecha</th><th>Vendedor</th><th>Cliente</th><th>Pagos</th><th>Total</th><th>Estado</th></tr></thead>
        <tbody>
          {ventas.map((v) => (
            <tr key={v.id} className={'clic' + (v.estado === 'anulada' ? ' anulada' : '')} onClick={() => verDetalle(v.id)}>
              <td>{v.id}</td>
              <td>{fecha(v.creado_en)}</td>
              <td>{v.vendedor}</td>
              <td>{v.cliente_nombre || '—'}</td>
              <td>{(v.pagos || []).map((p) => p.metodo[0].toUpperCase()).join('+') || '—'}</td>
              <td>{dinero(v.total)}</td>
              <td><span className={'estado ' + v.estado}>{v.estado}</span></td>
            </tr>
          ))}
          {ventas.length === 0 && <tr><td colSpan="7" className="vacio-min">Sin ventas en el período</td></tr>}
        </tbody>
      </table>

      {detalle && (
        <div className="modal-fondo" onClick={() => setDetalle(null)}>
          <div className="modal ancho-lg" onClick={(e) => e.stopPropagation()}>
            <h3>Venta #{detalle.id} <span className={'estado ' + detalle.estado}>{detalle.estado}</span></h3>
            <p className="modal-sub">{fecha(detalle.creado_en)} · {detalle.vendedor} · {detalle.tienda}</p>

            <table className="tabla-sub">
              <thead><tr><th>Producto</th><th>Cant.</th><th>P. unit.</th><th>Desc.</th><th>Total</th></tr></thead>
              <tbody>
                {detalle.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.descripcion}</td><td>{it.cantidad}</td>
                    <td>{dinero(it.precio_unitario)}</td><td>{dinero(it.descuento)}</td>
                    <td>{dinero(it.total_linea)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="recibo-totales">
              <div className="fila"><span>Subtotal</span><span>{dinero(detalle.subtotal)}</span></div>
              <div className="fila"><span>Descuento</span><span>{dinero(detalle.descuento_total)}</span></div>
              <div className="fila total"><span>Total</span><span>{dinero(detalle.total)}</span></div>
            </div>

            <h4>Pagos</h4>
            <table className="tabla-sub">
              <tbody>
                {detalle.pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.metodo === 'efectivo' ? '💵 Efectivo' : '🏦 Transferencia'}</td>
                    <td>
                      {p.metodo === 'transferencia' && (
                        <span className="nota-min">
                          {[p.banco, p.documento && `Comp. ${p.documento}`, p.referencia].filter(Boolean).join(' · ') || 'sin datos'}
                        </span>
                      )}
                    </td>
                    <td className="r"><strong>{dinero(p.monto)}</strong></td>
                    <td>
                      {p.metodo === 'transferencia' && (
                        <button className={'toggle chico' + (p.verificado ? ' on' : '')} onClick={() => toggleVerificado(p)}>
                          {p.verificado ? '✓ verificado' : 'marcar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr><td>Cambio</td><td></td><td className="r">{dinero(detalle.cambio)}</td><td></td></tr>
              </tbody>
            </table>

            {detalle.motivo_anulacion && <p className="nota-min">Anulada: {detalle.motivo_anulacion}</p>}
            {detalle.nota && <p className="nota-min">Nota: {detalle.nota}</p>}

            {detalle.comprobante ? (
              <p className="nota-min">
                Factura electrónica {detalle.comprobante.estab}-{detalle.comprobante.pto_emi}-{detalle.comprobante.secuencial}
                {' — '}<strong>{detalle.comprobante.estado}</strong>.
                {' '}<Link to="/comprobantes" className="btn-texto" style={{ padding: 0 }}>Ver en Comprobantes →</Link>
              </p>
            ) : (
              detalle.estado === 'completada' && (
                <p className="nota-min">
                  Sin factura electrónica.
                  {' '}<button className="btn-texto" style={{ padding: 0 }} onClick={facturar}>Emitir factura</button>
                </p>
              )
            )}

            <div className="modal-acciones">
              {esAdmin && detalle.estado === 'completada' && (
                <button className="btn-texto peligro" onClick={anular}>Anular venta</button>
              )}
              <button className="btn-secundario" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {modalFactura && (
        <div className="modal-fondo" onClick={() => !facturando && setModalFactura(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Datos del cliente para la factura</h3>
            <p className="modal-sub">Escribe la cédula/RUC y se cargan los datos si el cliente ya está guardado.</p>
            <FormularioCliente value={modalFactura} onChange={setModalFactura}
              onEncontrado={(c) => toast.ok(`Cliente encontrado: ${c.nombre}`)} />
            <div className="modal-acciones">
              <button className="btn-secundario" onClick={() => setModalFactura(null)} disabled={facturando}>Cancelar</button>
              <button className="btn-primario" onClick={confirmarFactura} disabled={facturando}>
                {facturando ? 'Enviando…' : 'Emitir factura'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Transferencias() {
  const { esAdmin } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [desde, setDesde] = useState(haceISO(30));
  const [hasta, setHasta] = useState(hoyISO());
  const [filtro, setFiltro] = useState('');
  const [banco, setBanco] = useState('');
  const [tiendaId, setTiendaId] = useState('');

  async function cargar() {
    try {
      const q = new URLSearchParams({ metodo: 'transferencia', desde, hasta: `${hasta}T23:59:59` });
      if (filtro) q.set('verificado', filtro);
      if (banco) q.set('banco', banco);
      if (tiendaId) q.set('tienda_id', tiendaId);
      setData(await api.get(`/api/reportes/pagos?${q}`));
    } catch (e) { toast.error(e.message); }
  }
  useEffect(() => { cargar(); }, [desde, hasta, filtro, banco, tiendaId]);

  async function toggle(p) {
    try {
      await api.put(`/api/ventas/pagos/${p.id}/verificado`, { verificado: !p.verificado });
      cargar();
    } catch (e) { toast.error(e.message); }
  }

  if (!data) return <div className="vacio">Cargando…</div>;

  return (
    <>
      {esAdmin && (
        <div className="filtros">
          <SelectorTienda value={tiendaId} onChange={setTiendaId} />
        </div>
      )}
      <div className="filtros">
        <label>Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <select value={banco} onChange={(e) => setBanco(e.target.value)}>
          <option value="">Todos los bancos</option>
          {BANCOS_EC.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="">Todas</option>
          <option value="false">Sin verificar</option>
          <option value="true">Verificadas</option>
        </select>
      </div>

      <div className="tira-conc">
        <div><span>Total transferido</span><strong>{dinero(data.totales.total)}</strong></div>
        <div className="ok"><span>Verificado</span><strong>{dinero(data.totales.verificado)}</strong></div>
        <div className="pend"><span>Pendiente de verificar</span><strong>{dinero(data.totales.pendiente)}</strong></div>
      </div>

      <table className="tabla">
        <thead>
          <tr><th></th><th>Fecha</th><th>Venta</th><th>Cliente</th><th>Banco</th><th>N.º comprobante</th><th>Obs.</th><th>Monto</th></tr>
        </thead>
        <tbody>
          {data.pagos.map((p) => (
            <tr key={p.id} className={p.verificado ? 'conc-ok' : ''}>
              <td>
                <button className={'toggle chico' + (p.verificado ? ' on' : '')} onClick={() => toggle(p)}>
                  {p.verificado ? '✓' : '○'}
                </button>
              </td>
              <td>{fecha(p.creado_en)}</td>
              <td className="mono">#{p.venta_id}</td>
              <td>{p.cliente_nombre || 'Consumidor final'}</td>
              <td>{p.banco || '—'}</td>
              <td className="mono">{p.documento || '—'}</td>
              <td>{p.referencia || '—'}</td>
              <td className="r"><strong>{dinero(p.monto)}</strong></td>
            </tr>
          ))}
          {data.pagos.length === 0 && <tr><td colSpan="8" className="vacio-min">Sin transferencias en el período</td></tr>}
        </tbody>
      </table>
    </>
  );
}

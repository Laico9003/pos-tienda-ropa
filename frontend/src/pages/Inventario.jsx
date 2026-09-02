import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import ImportarFacturaXml from '../components/ImportarFacturaXml.jsx';
import SelectorTienda from '../components/SelectorTienda.jsx';
import { fecha, nombreVariante } from '../util.js';

// Parámetro tienda_id para las consultas (solo el admin cambia de tienda).
const qTienda = (id) => (id ? `&tienda_id=${id}` : '');
const qTienda1 = (id) => (id ? `?tienda_id=${id}` : '');

export default function Inventario() {
  const { usuario, esAdmin } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('stock');
  const [tiendaId, setTiendaId] = useState(String(usuario.tienda_id ?? ''));

  return (
    <div className="pagina">
      <div className="pagina-cab"><h1>Inventario</h1></div>
      {esAdmin && (
        <div className="filtros">
          <SelectorTienda value={tiendaId} onChange={setTiendaId} conTodas={false} />
        </div>
      )}
      <div className="tabs">
        <button className={tab === 'stock' ? 'activo' : ''} onClick={() => setTab('stock')}>Stock</button>
        <button className={tab === 'entrada' ? 'activo' : ''} onClick={() => setTab('entrada')}>Ingreso de mercadería</button>
        <button className={tab === 'kardex' ? 'activo' : ''} onClick={() => setTab('kardex')}>Movimientos</button>
      </div>
      {tab === 'stock' && <Stock tiendaId={tiendaId} />}
      {tab === 'entrada' && <Entrada tiendaId={tiendaId} onListo={() => toast.ok('Stock actualizado')} />}
      {tab === 'kardex' && <Kardex tiendaId={tiendaId} />}
    </div>
  );
}

function Stock({ tiendaId }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [soloBajo, setSoloBajo] = useState(false);
  const [ajuste, setAjuste] = useState(null);

  async function cargar() {
    try {
      const r = soloBajo
        ? (await api.get(`/api/inventario/stock-bajo${qTienda1(tiendaId)}`)).items
        : await api.get(`/api/inventario/stock${qTienda1(tiendaId)}`);
      setRows(r);
    } catch (e) { toast.error(e.message); }
  }
  useEffect(() => { cargar(); }, [soloBajo, tiendaId]);

  async function guardarAjuste() {
    try {
      await api.post('/api/inventario/ajuste', {
        tienda_id: tiendaId ? Number(tiendaId) : undefined,
        variante_id: ajuste.variante_id,
        cantidad_nueva: Number(ajuste.cantidad_nueva),
        motivo: ajuste.motivo || 'Ajuste manual',
      });
      toast.ok('Ajuste registrado'); setAjuste(null); cargar();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <>
      <label className="check-inline">
        <input type="checkbox" checked={soloBajo} onChange={(e) => setSoloBajo(e.target.checked)} /> Solo stock bajo
      </label>
      <table className="tabla">
        <thead><tr><th>Producto</th><th>Variante</th><th>Código</th><th>Stock</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.variante_id}>
              <td>{r.producto}</td>
              <td>{nombreVariante(r) || '—'}</td>
              <td>{r.codigo_barras || '—'}</td>
              <td><span className={'pill' + (r.stock <= 5 ? ' bajo' : '')}>{r.stock}</span></td>
              <td><button className="btn-texto" onClick={() => setAjuste({ ...r, cantidad_nueva: r.stock, motivo: '' })}>Ajustar</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan="5" className="vacio-min">Sin registros</td></tr>}
        </tbody>
      </table>

      {ajuste && (
        <div className="modal-fondo" onClick={() => setAjuste(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Ajustar stock</h3>
            <p className="modal-sub">{ajuste.producto} {nombreVariante(ajuste)}</p>
            <label>Cantidad real en tienda
              <input type="number" value={ajuste.cantidad_nueva}
                onChange={(e) => setAjuste({ ...ajuste, cantidad_nueva: e.target.value })} autoFocus />
            </label>
            <label>Motivo
              <input value={ajuste.motivo} placeholder="Conteo físico, merma…"
                onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} />
            </label>
            <div className="modal-acciones">
              <button className="btn-secundario" onClick={() => setAjuste(null)}>Cancelar</button>
              <button className="btn-primario" onClick={guardarAjuste}>Guardar ajuste</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Entrada({ tiendaId, onListo }) {
  const toast = useToast();
  const [busqueda, setBusqueda] = useState('');
  const [items, setItems] = useState([]); // {variante_id, etiqueta, cantidad}
  const [referencia, setReferencia] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function buscar(e) {
    e.preventDefault();
    if (!busqueda.trim()) return;
    try {
      const v = await api.get(`/api/productos/buscar?codigo=${encodeURIComponent(busqueda.trim())}${qTienda(tiendaId)}`);
      setItems((xs) => {
        if (xs.some((x) => x.variante_id === v.variante_id)) return xs;
        return [...xs, { variante_id: v.variante_id, etiqueta: `${v.producto} ${nombreVariante(v)}`, cantidad: 1 }];
      });
      setBusqueda('');
    } catch (err) {
      toast.error(err.status === 404 ? 'Código no encontrado' : err.message);
    }
  }

  async function guardar() {
    if (items.length === 0) return;
    setGuardando(true);
    try {
      await api.post('/api/inventario/entrada', {
        tienda_id: tiendaId ? Number(tiendaId) : undefined,
        referencia: referencia || undefined,
        items: items.map((x) => ({ variante_id: x.variante_id, cantidad: Number(x.cantidad) })),
      });
      setItems([]); setReferencia('');
      onListo();
    } catch (e) { toast.error(e.message); }
    finally { setGuardando(false); }
  }

  return (
    <div className="entrada">
      <div className="entrada-cab">
        <form className="pos-buscador" onSubmit={buscar}>
          <span className="lupa">🔎</span>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Escanear o escribir código de barras…" autoFocus />
        </form>
        <ImportarFacturaXml onListo={onListo} tiendaId={tiendaId} />
      </div>

      <table className="tabla">
        <thead><tr><th>Producto</th><th>Cantidad que ingresa</th><th></th></tr></thead>
        <tbody>
          {items.map((x, i) => (
            <tr key={x.variante_id}>
              <td>{x.etiqueta}</td>
              <td>
                <input type="number" min="1" value={x.cantidad}
                  onChange={(e) => setItems((xs) => xs.map((y, j) => j === i ? { ...y, cantidad: e.target.value } : y))} />
              </td>
              <td><button className="btn-texto" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan="3" className="vacio-min">Agrega productos escaneando su código</td></tr>}
        </tbody>
      </table>

      <div className="entrada-pie">
        <input placeholder="Referencia (proveedor, factura…)" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        <button className="btn-primario" onClick={guardar} disabled={items.length === 0 || guardando}>
          {guardando ? 'Guardando…' : 'Registrar ingreso'}
        </button>
      </div>
    </div>
  );
}

function Kardex({ tiendaId }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [tipo, setTipo] = useState('');

  useEffect(() => {
    api.get(`/api/inventario/movimientos?limite=200${tipo ? `&tipo=${tipo}` : ''}${qTienda(tiendaId)}`)
      .then(setRows).catch((e) => toast.error(e.message));
  }, [tipo, tiendaId]);

  const etiquetaTipo = {
    entrada: '📥 Entrada', venta: '🛒 Venta', ajuste: '⚙️ Ajuste',
    anulacion_venta: '↩️ Anulación', salida: '📤 Salida',
  };

  return (
    <>
      <div className="filtros">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos los movimientos</option>
          <option value="entrada">Entradas</option>
          <option value="venta">Ventas</option>
          <option value="ajuste">Ajustes</option>
          <option value="anulacion_venta">Anulaciones</option>
        </select>
      </div>
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Cant.</th><th>Antes→Después</th><th>Referencia</th><th>Usuario</th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>{fecha(m.creado_en)}</td>
              <td>{etiquetaTipo[m.tipo] || m.tipo}</td>
              <td>{m.producto} {nombreVariante(m)}</td>
              <td>{m.cantidad}</td>
              <td className="mono">{m.cantidad_anterior} → {m.cantidad_nueva}</td>
              <td>{m.referencia || '—'}</td>
              <td>{m.usuario || '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan="7" className="vacio-min">Sin movimientos</td></tr>}
        </tbody>
      </table>
    </>
  );
}

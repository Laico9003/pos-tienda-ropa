import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import SelectorImagen from '../components/SelectorImagen.jsx';
import { dinero, nombreVariante } from '../util.js';

const varianteVacia = () => ({ talla: '', color: '', codigo_barras: '', precio_compra: '', precio_venta: '', stock_inicial: '' });

export default function Productos() {
  const { puedeInventario, usuario } = useAuth();
  const toast = useToast();
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [abierto, setAbierto] = useState(null); // id de producto expandido
  const [modalNuevo, setModalNuevo] = useState(false);
  const [modalCategorias, setModalCategorias] = useState(false);

  async function cargar() {
    try {
      const [pr, ca] = await Promise.all([
        api.get(`/api/productos?limite=200${q ? `&q=${encodeURIComponent(q)}` : ''}${cat ? `&categoria_id=${cat}` : ''}`),
        api.get('/api/categorias?incluir_inactivas=true'),
      ]);
      setProductos(pr.productos || []);
      setCategorias(ca || []);
    } catch (e) { toast.error(e.message); }
  }
  useEffect(() => { cargar(); }, [q, cat]);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <h1>Productos</h1>
        <div className="cab-acciones">
          <button className="btn-secundario" onClick={() => setModalCategorias(true)}>Categorías</button>
          {puedeInventario && <button className="btn-primario" onClick={() => setModalNuevo(true)}>+ Nuevo producto</button>}
        </div>
      </div>

      <div className="filtros">
        <input placeholder="Buscar por nombre o código…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>

      <table className="tabla">
        <thead>
          <tr><th></th><th>Producto</th><th>Categoría</th><th>Variantes</th><th>Stock</th><th>Precio</th><th>Estado</th></tr>
        </thead>
        <tbody>
          {productos.map((p) => {
            const precios = (p.variantes || []).map((v) => Number(v.precio_venta));
            return (
              <FilaProducto key={p.id} p={p} precios={precios}
                expandido={abierto === p.id}
                onToggle={() => setAbierto(abierto === p.id ? null : p.id)}
                puedeEditar={puedeInventario}
                tiendaId={usuario.tienda_id}
                onCambio={cargar} />
            );
          })}
          {productos.length === 0 && <tr><td colSpan="7" className="vacio-min">Sin productos</td></tr>}
        </tbody>
      </table>

      {modalNuevo && (
        <ModalNuevoProducto categorias={categorias.filter((c) => c.activo)} tiendaId={usuario.tienda_id}
          onCerrar={() => setModalNuevo(false)} onCreado={() => { setModalNuevo(false); cargar(); }} />
      )}
      {modalCategorias && (
        <ModalCategorias categorias={categorias} onCerrar={() => { setModalCategorias(false); cargar(); }} />
      )}
    </div>
  );
}

function FilaProducto({ p, precios, expandido, onToggle, puedeEditar, tiendaId, onCambio }) {
  const toast = useToast();
  const rango = precios.length
    ? (Math.min(...precios) === Math.max(...precios) ? dinero(precios[0]) : `${dinero(Math.min(...precios))}–${dinero(Math.max(...precios))}`)
    : '—';

  async function alternarActivo() {
    try { await api.put(`/api/productos/${p.id}`, { activo: !p.activo }); onCambio(); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <>
      <tr className={expandido ? 'fila-abierta' : ''}>
        <td><button className="btn-mini" onClick={onToggle}>{expandido ? '▾' : '▸'}</button></td>
        <td>
          <div className="prod-fila-nombre">
            <span className="prod-mini">
              {p.imagen_url ? <img src={p.imagen_url} alt="" /> : <span>👕</span>}
            </span>
            <strong>{p.nombre}</strong>
          </div>
        </td>
        <td>{p.categoria || '—'}</td>
        <td>{(p.variantes || []).length}</td>
        <td><span className={'pill' + (p.stock_total <= 5 ? ' bajo' : '')}>{p.stock_total ?? 0}</span></td>
        <td>{rango}</td>
        <td>
          <button className={'toggle' + (p.activo ? ' on' : '')} onClick={alternarActivo} disabled={!puedeEditar}>
            {p.activo ? 'Activo' : 'Inactivo'}
          </button>
        </td>
      </tr>
      {expandido && (
        <tr className="fila-detalle">
          <td colSpan="7">
            <div className="variantes-box img-box">
              <h4>Foto del producto</h4>
              <ImagenProductoEdit producto={p} puedeEditar={puedeEditar} onCambio={onCambio} />
            </div>
            <TablaVariantes producto={p} puedeEditar={puedeEditar} tiendaId={tiendaId} onCambio={onCambio} />
          </td>
        </tr>
      )}
    </>
  );
}

function ImagenProductoEdit({ producto, puedeEditar, onCambio }) {
  const toast = useToast();
  const [guardando, setGuardando] = useState(false);
  async function set(dataUri) {
    setGuardando(true);
    try {
      await api.put(`/api/productos/${producto.id}`, { imagen_url: dataUri });
      toast.ok(dataUri ? 'Foto actualizada' : 'Foto quitada');
      onCambio();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }
  return <SelectorImagen valor={producto.imagen_url} onCambio={set} disabled={!puedeEditar || guardando} />;
}

function TablaVariantes({ producto, puedeEditar, onCambio }) {
  const toast = useToast();
  const [nueva, setNueva] = useState(null);

  async function guardarVariante(v, cambios) {
    try { await api.put(`/api/productos/variantes/${v.id}`, cambios); toast.ok('Variante actualizada'); onCambio(); }
    catch (e) { toast.error(e.message); }
  }
  async function agregar() {
    try {
      await api.post(`/api/productos/${producto.id}/variantes`, {
        talla: nueva.talla || null, color: nueva.color || null,
        codigo_barras: nueva.codigo_barras || null,
        precio_compra: Number(nueva.precio_compra) || 0,
        precio_venta: Number(nueva.precio_venta) || 0,
      });
      toast.ok('Variante agregada'); setNueva(null); onCambio();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="variantes-box">
      <table className="tabla-sub">
        <thead><tr><th>Talla</th><th>Color</th><th>Código barras</th><th>P. compra</th><th>P. venta</th><th>Stock</th><th></th></tr></thead>
        <tbody>
          {(producto.variantes || []).map((v) => (
            <tr key={v.id}>
              <td>{v.talla || '—'}</td>
              <td>{v.color || '—'}</td>
              <td><EditableTexto valor={v.codigo_barras || ''} onGuardar={(x) => guardarVariante(v, { codigo_barras: x || null })} editable={puedeEditar} /></td>
              <td><EditableNum valor={v.precio_compra} onGuardar={(x) => guardarVariante(v, { precio_compra: x })} editable={puedeEditar} /></td>
              <td><EditableNum valor={v.precio_venta} onGuardar={(x) => guardarVariante(v, { precio_venta: x })} editable={puedeEditar} /></td>
              <td><span className="pill">{v.stock ?? 0}</span></td>
              <td>
                <button className={'toggle chico' + (v.activo !== false ? ' on' : '')}
                  onClick={() => guardarVariante(v, { activo: !(v.activo !== false) })} disabled={!puedeEditar}>
                  {v.activo !== false ? 'Activa' : 'Inactiva'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {puedeEditar && (nueva ? (
        <div className="nueva-variante">
          {['talla', 'color', 'codigo_barras', 'precio_compra', 'precio_venta'].map((k) => (
            <input key={k} placeholder={k.replace('_', ' ')} value={nueva[k]}
              onChange={(e) => setNueva({ ...nueva, [k]: e.target.value })} />
          ))}
          <button className="btn-primario chico" onClick={agregar}>Guardar</button>
          <button className="btn-texto" onClick={() => setNueva(null)}>Cancelar</button>
        </div>
      ) : (
        <button className="btn-texto" onClick={() => setNueva(varianteVacia())}>+ Agregar variante</button>
      ))}
      <p className="nota-min">El stock se ajusta desde <strong>Inventario</strong>.</p>
    </div>
  );
}

function EditableTexto({ valor, onGuardar, editable }) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  if (!editable) return <span>{valor || '—'}</span>;
  return <input className="inp-inline" value={v} onChange={(e) => setV(e.target.value)}
    onBlur={() => v !== valor && onGuardar(v)} />;
}
function EditableNum({ valor, onGuardar, editable }) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  if (!editable) return <span>{dinero(valor)}</span>;
  return <input className="inp-inline" type="number" step="0.01" value={v}
    onChange={(e) => setV(e.target.value)}
    onBlur={() => Number(v) !== Number(valor) && onGuardar(Number(v))} />;
}

function ModalNuevoProducto({ categorias, tiendaId, onCerrar, onCreado }) {
  const toast = useToast();
  const [nombre, setNombre] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [imagen, setImagen] = useState(null);
  const [variantes, setVariantes] = useState([varianteVacia()]);
  const [guardando, setGuardando] = useState(false);

  function set(i, k, val) { setVariantes((vs) => vs.map((v, j) => j === i ? { ...v, [k]: val } : v)); }

  async function crear() {
    if (!nombre.trim()) { toast.error('Falta el nombre'); return; }
    setGuardando(true);
    try {
      await api.post('/api/productos', {
        nombre: nombre.trim(),
        categoria_id: categoriaId || null,
        descripcion: descripcion || null,
        imagen_url: imagen || null,
        variantes: variantes.map((v) => ({
          talla: v.talla || null, color: v.color || null,
          codigo_barras: v.codigo_barras || null,
          precio_compra: Number(v.precio_compra) || 0,
          precio_venta: Number(v.precio_venta) || 0,
          stock_inicial: Number(v.stock_inicial) > 0 ? [{ tienda_id: tiendaId, cantidad: Number(v.stock_inicial) }] : [],
        })),
      });
      toast.ok('Producto creado');
      onCreado();
    } catch (e) { toast.error(e.message); }
    finally { setGuardando(false); }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho-lg" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo producto</h3>
        <div className="form-imagen">
          <SelectorImagen valor={imagen} onCambio={setImagen} />
        </div>
        <div className="form-grid">
          <label>Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></label>
          <label>Categoría
            <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="ancho">Descripción<input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></label>
        </div>

        <h4>Variantes (talla / color)</h4>
        <table className="tabla-sub">
          <thead><tr><th>Talla</th><th>Color</th><th>Código barras</th><th>P. compra</th><th>P. venta</th><th>Stock inicial</th><th></th></tr></thead>
          <tbody>
            {variantes.map((v, i) => (
              <tr key={i}>
                <td><input value={v.talla} onChange={(e) => set(i, 'talla', e.target.value)} /></td>
                <td><input value={v.color} onChange={(e) => set(i, 'color', e.target.value)} /></td>
                <td><input value={v.codigo_barras} onChange={(e) => set(i, 'codigo_barras', e.target.value)} /></td>
                <td><input type="number" step="0.01" value={v.precio_compra} onChange={(e) => set(i, 'precio_compra', e.target.value)} /></td>
                <td><input type="number" step="0.01" value={v.precio_venta} onChange={(e) => set(i, 'precio_venta', e.target.value)} /></td>
                <td><input type="number" value={v.stock_inicial} onChange={(e) => set(i, 'stock_inicial', e.target.value)} /></td>
                <td>{variantes.length > 1 && <button className="btn-texto" onClick={() => setVariantes((vs) => vs.filter((_, j) => j !== i))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn-texto" onClick={() => setVariantes((vs) => [...vs, varianteVacia()])}>+ Otra variante</button>

        <div className="modal-acciones">
          <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primario" onClick={crear} disabled={guardando}>{guardando ? 'Guardando…' : 'Crear producto'}</button>
        </div>
      </div>
    </div>
  );
}

function ModalCategorias({ categorias, onCerrar }) {
  const toast = useToast();
  const [lista, setLista] = useState(categorias);
  const [nueva, setNueva] = useState('');

  async function recargar() {
    setLista(await api.get('/api/categorias?incluir_inactivas=true'));
  }
  async function crear() {
    if (!nueva.trim()) return;
    try { await api.post('/api/categorias', { nombre: nueva.trim() }); setNueva(''); recargar(); }
    catch (e) { toast.error(e.message); }
  }
  async function renombrar(c, nombre) {
    if (nombre === c.nombre || !nombre.trim()) return;
    try { await api.put(`/api/categorias/${c.id}`, { nombre: nombre.trim() }); recargar(); }
    catch (e) { toast.error(e.message); }
  }
  async function alternar(c) {
    try { await api.put(`/api/categorias/${c.id}`, { activo: !c.activo }); recargar(); }
    catch (e) { toast.error(e.message); }
  }
  async function eliminar(c) {
    try {
      const r = await api.del(`/api/categorias/${c.id}`);
      toast.ok(r.desactivada ? 'Categoría desactivada (tiene productos)' : 'Categoría eliminada');
      recargar();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Categorías</h3>
        <div className="cat-nueva">
          <input placeholder="Nueva categoría…" value={nueva}
            onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && crear()} />
          <button className="btn-primario chico" onClick={crear}>Agregar</button>
        </div>
        <ul className="cat-lista">
          {lista.map((c) => (
            <li key={c.id} className={c.activo ? '' : 'inactiva'}>
              <EditableTexto valor={c.nombre} onGuardar={(x) => renombrar(c, x)} editable />
              <span className="cat-uso">{c.productos} prod.</span>
              <button className={'toggle chico' + (c.activo ? ' on' : '')} onClick={() => alternar(c)}>
                {c.activo ? 'Activa' : 'Inactiva'}
              </button>
              <button className="btn-texto peligro" onClick={() => eliminar(c)}>Eliminar</button>
            </li>
          ))}
        </ul>
        <button className="btn-secundario" onClick={onCerrar}>Cerrar</button>
      </div>
    </div>
  );
}

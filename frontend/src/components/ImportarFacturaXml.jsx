import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from './Toast.jsx';
import { dinero, redondear2 } from '../util.js';

const num = (s) => Number(String(s ?? '').replace(',', '.')) || 0;

/** Extrae proveedor + ítems del XML de una factura electrónica del SRI. */
function parsearFacturaXml(texto) {
  const parser = new DOMParser();
  let doc = parser.parseFromString(texto, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('El archivo no es un XML válido');

  // Formato "comprobante autorizado": el <factura> viene dentro de <comprobante> (CDATA)
  const compEl = doc.querySelector('comprobante');
  if (compEl && compEl.textContent && compEl.textContent.includes('<factura')) {
    doc = parser.parseFromString(compEl.textContent, 'application/xml');
  }

  const fac = doc.querySelector('factura');
  if (!fac) throw new Error('No se encontró una factura en el XML (¿es una nota de crédito u otro documento?)');

  const t = (sel, ctx = fac) => ctx.querySelector(sel)?.textContent?.trim() || '';
  const factura = {
    proveedor: t('infoTributaria razonSocial') || t('infoTributaria nombreComercial'),
    ruc: t('infoTributaria ruc'),
    numero: [t('infoTributaria estab'), t('infoTributaria ptoEmi'), t('infoTributaria secuencial')].filter(Boolean).join('-'),
    fecha: t('infoFactura fechaEmision'),
  };

  const items = [...fac.querySelectorAll('detalles > detalle')].map((d) => {
    const cantidad = num(t('cantidad', d));
    const base = num(t('precioTotalSinImpuesto', d));
    const punit = num(t('precioUnitario', d));
    const costo = cantidad > 0 && base > 0 ? base / cantidad : punit; // neto por unidad
    return {
      codigo: t('codigoPrincipal', d) || t('codigoAuxiliar', d),
      descripcion: t('descripcion', d),
      cantidad,
      costo_unitario: Math.round(costo * 1e4) / 1e4,
    };
  });
  if (!items.length) throw new Error('La factura no tiene ítems de detalle');
  return { factura, items };
}

export default function ImportarFacturaXml({ onListo }) {
  const { negocio } = useAuth();
  const toast = useToast();
  const inputRef = useRef(null);
  const iva = Number(negocio?.iva_porcentaje ?? 15);

  const [abierto, setAbierto] = useState(false);
  const [factura, setFactura] = useState(null);
  const [filas, setFilas] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [referencia, setReferencia] = useState('');
  const [sumarIva, setSumarIva] = useState(negocio?.precios_incluyen_iva !== false);
  const [guardando, setGuardando] = useState(false);

  function precioDesdeMargen(costo, margen, conIva) {
    const p = costo * (1 + (Number(margen) || 0) / 100);
    return redondear2(conIva ? p * (1 + iva / 100) : p);
  }
  function margenDesdePrecio(costo, precio, conIva) {
    if (!costo) return 0;
    const neto = conIva ? Number(precio) / (1 + iva / 100) : Number(precio);
    return Math.round((neto / costo - 1) * 100);
  }

  async function elegirArchivo(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const texto = await file.text();
      const { factura: fac, items } = parsearFacturaXml(texto);
      const prev = await api.post('/api/inventario/importar/previsualizar', { items });
      const [cats] = await Promise.all([api.get('/api/categorias')]);
      setCategorias(cats || []);
      setFactura(fac);
      setReferencia(`Factura ${fac.proveedor || ''} ${fac.numero || ''}`.trim());
      setFilas(prev.items.map((it) => {
        const margen = 40;
        return {
          ...it,
          accion: it.match ? 'existente' : 'nuevo',
          variante_id: it.match?.variante_id || null,
          cantidad: it.cantidad || 1,
          costo: it.costo_unitario,
          margen,
          precio_venta: precioDesdeMargen(it.costo_unitario, margen, negocio?.precios_incluyen_iva !== false),
          nuevo: { nombre: it.descripcion, talla: '', color: '', categoria_id: '', codigo_barras: it.codigo || '' },
        };
      }));
      setAbierto(true);
    } catch (err) {
      toast.error(err.message);
    }
  }

  function editar(i, campos) {
    setFilas((fs) => fs.map((f, j) => {
      if (j !== i) return f;
      const n = { ...f, ...campos };
      if ('costo' in campos || 'margen' in campos) n.precio_venta = precioDesdeMargen(n.costo, n.margen, sumarIva);
      if ('precio_venta' in campos) n.margen = margenDesdePrecio(n.costo, n.precio_venta, sumarIva);
      return n;
    }));
  }
  function editarNuevo(i, campos) {
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, nuevo: { ...f.nuevo, ...campos } } : f)));
  }
  function cambiarSumarIva(v) {
    setSumarIva(v);
    setFilas((fs) => fs.map((f) => ({ ...f, precio_venta: precioDesdeMargen(f.costo, f.margen, v) })));
  }

  async function confirmar() {
    setGuardando(true);
    try {
      const r = await api.post('/api/inventario/importar', {
        referencia: referencia || undefined,
        factura,
        items: filas.map((f) => ({
          accion: f.accion,
          variante_id: f.accion === 'existente' ? f.variante_id : undefined,
          cantidad: Number(f.cantidad),
          costo_unitario: Number(f.costo),
          precio_venta: Number(f.precio_venta),
          nuevo: f.accion === 'nuevo' ? {
            nombre: f.nuevo.nombre || f.descripcion,
            categoria_id: f.nuevo.categoria_id || null,
            talla: f.nuevo.talla || null,
            color: f.nuevo.color || null,
            codigo_barras: f.nuevo.codigo_barras || f.codigo || null,
          } : undefined,
        })),
      });
      toast.ok(`Ingreso registrado: ${r.creados} nuevos, ${r.actualizados} actualizados`);
      setAbierto(false); setFilas([]); setFactura(null);
      onListo?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".xml,text/xml,application/xml" hidden onChange={elegirArchivo} />
      <button className="btn-secundario" onClick={() => inputRef.current?.click()}>📄 Importar factura (XML)</button>

      {abierto && (
        <div className="modal-fondo" onClick={() => !guardando && setAbierto(false)}>
          <div className="modal ancho-xl" onClick={(e) => e.stopPropagation()}>
            <h3>Importar factura de compra</h3>
            <p className="modal-sub">
              {factura?.proveedor || 'Proveedor'} · Factura {factura?.numero || '—'} · {factura?.fecha || ''}
            </p>

            <div className="import-opts">
              <label className="ancho">Referencia del movimiento
                <input value={referencia} onChange={(e) => setReferencia(e.target.value)} />
              </label>
              <label className="check-inline">
                <input type="checkbox" checked={sumarIva} onChange={(e) => cambiarSumarIva(e.target.checked)} />
                El precio de venta incluye IVA ({iva}%)
              </label>
            </div>

            <div className="tabla-scroll">
              <table className="tabla-sub tabla-import">
                <thead>
                  <tr>
                    <th>Producto</th><th>Estado</th><th>Cant.</th><th>Costo u.</th>
                    <th>Margen %</th><th>P. Venta</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <FilaImport key={i} f={f} i={i} categorias={categorias}
                      onEditar={editar} onEditarNuevo={editarNuevo}
                      onQuitar={() => setFilas((fs) => fs.filter((_, j) => j !== i))} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-acciones">
              <button className="btn-secundario" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</button>
              <button className="btn-primario" onClick={confirmar} disabled={guardando || filas.length === 0}>
                {guardando ? 'Registrando…' : `Registrar ingreso (${filas.length} ítems)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FilaImport({ f, i, categorias, onEditar, onEditarNuevo, onQuitar }) {
  const inp = (v, on, extra = {}) => (
    <input value={v} onChange={(e) => on(e.target.value)} {...extra} />
  );
  return (
    <>
      <tr>
        <td>
          <strong>{f.descripcion}</strong>
          {f.match && <div className="nota-min">{f.match.producto} {[f.match.talla, f.match.color].filter(Boolean).join('/')} · stock {f.match.stock}</div>}
          {f.codigo && <div className="nota-min">cód. {f.codigo}</div>}
        </td>
        <td>
          <select value={f.accion} onChange={(e) => onEditar(i, { accion: e.target.value })}>
            <option value="existente" disabled={!f.match}>Existente</option>
            <option value="nuevo">Crear nuevo</option>
          </select>
        </td>
        <td>{inp(f.cantidad, (v) => onEditar(i, { cantidad: v }), { type: 'number', min: 1, style: { width: 60 } })}</td>
        <td>{inp(f.costo, (v) => onEditar(i, { costo: Number(v) }), { type: 'number', step: '0.01', style: { width: 80 } })}</td>
        <td>{inp(f.margen, (v) => onEditar(i, { margen: v }), { type: 'number', style: { width: 64 } })}</td>
        <td>{inp(f.precio_venta, (v) => onEditar(i, { precio_venta: v }), { type: 'number', step: '0.01', style: { width: 84 } })}
          {f.accion === 'existente' && f.match && (
            <div className="nota-min">antes {dinero(f.match.precio_venta)}</div>
          )}
        </td>
        <td><button className="btn-texto" onClick={onQuitar}>✕</button></td>
      </tr>
      {f.accion === 'nuevo' && (
        <tr className="fila-nuevo">
          <td colSpan="7">
            <div className="nuevo-campos">
              <input placeholder="Nombre del producto" value={f.nuevo.nombre} onChange={(e) => onEditarNuevo(i, { nombre: e.target.value })} style={{ minWidth: 220 }} />
              <select value={f.nuevo.categoria_id} onChange={(e) => onEditarNuevo(i, { categoria_id: e.target.value })}>
                <option value="">Sin categoría</option>
                {categorias.filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <input placeholder="Talla" value={f.nuevo.talla} onChange={(e) => onEditarNuevo(i, { talla: e.target.value })} style={{ width: 80 }} />
              <input placeholder="Color" value={f.nuevo.color} onChange={(e) => onEditarNuevo(i, { color: e.target.value })} style={{ width: 100 }} />
              <input placeholder="Código de barras" value={f.nuevo.codigo_barras} onChange={(e) => onEditarNuevo(i, { codigo_barras: e.target.value })} style={{ width: 150 }} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

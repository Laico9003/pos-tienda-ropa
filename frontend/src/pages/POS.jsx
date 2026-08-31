import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import SelectorBanco from '../components/SelectorBanco.jsx';
import FormularioCliente from '../components/FormularioCliente.jsx';
import { dinero, redondear2, nombreVariante, imprimirRecibo } from '../util.js';

const LIMITE = 24;
const CLAVE_GUARDADAS = 'pos_ventas_guardadas';
const CLAVE_SALTAR = 'pos_saltar_recibo';

export default function POS() {
  const toast = useToast();
  const { negocio } = useAuth();
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [catActiva, setCatActiva] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [cargando, setCargando] = useState(true);

  const [carrito, setCarrito] = useState([]);
  const [descuentoTotal, setDescuentoTotal] = useState(0);
  const [cliente, setCliente] = useState(null); // { nombre, identificacion }
  const [seleccion, setSeleccion] = useState(null);

  const [modalPago, setModalPago] = useState(false);
  const [modalCliente, setModalCliente] = useState(false);
  const [modalGuardadas, setModalGuardadas] = useState(false);
  const [variantePicker, setVariantePicker] = useState(null);
  const [ultimaVenta, setUltimaVenta] = useState(null);

  const [efectivo, setEfectivo] = useState('');
  const [transferencia, setTransferencia] = useState('');
  const [refTransfer, setRefTransfer] = useState('');
  const [bancoTransfer, setBancoTransfer] = useState('');
  const [docTransfer, setDocTransfer] = useState('');
  const [cobrando, setCobrando] = useState(false);

  const [guardadas, setGuardadas] = useState([]);

  const buscadorRef = useRef(null);

  // -------------------- carga de datos --------------------
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const qs = new URLSearchParams({ limite: String(LIMITE), pagina: String(pagina) });
      if (catActiva) qs.set('categoria_id', String(catActiva));
      if (qDebounced) qs.set('q', qDebounced);
      const [pr, ca] = await Promise.all([
        api.get(`/api/productos?${qs}`),
        categorias.length ? Promise.resolve(null) : api.get('/api/categorias'),
      ]);
      setProductos(pr.productos || []);
      setTotalPaginas(pr.total_paginas || 1);
      if (ca) setCategorias(ca);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setCargando(false);
    }
  }, [pagina, catActiva, qDebounced]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(busqueda.trim()), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => { setPagina(1); }, [qDebounced, catActiva]);
  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => { buscadorRef.current?.focus(); }, []);

  useEffect(() => {
    try { setGuardadas(JSON.parse(localStorage.getItem(CLAVE_GUARDADAS) || '[]')); } catch { /* */ }
  }, []);

  function persistirGuardadas(lista) {
    setGuardadas(lista);
    try { localStorage.setItem(CLAVE_GUARDADAS, JSON.stringify(lista)); } catch { /* */ }
  }

  // -------------------- carrito --------------------
  const agregarVariante = useCallback((prod, v) => {
    if ((v.stock ?? 0) <= 0) { toast.error('Sin stock disponible'); return; }
    setCarrito((c) => {
      const i = c.findIndex((x) => x.varianteId === v.id);
      if (i >= 0) {
        const copia = [...c];
        const nueva = Math.min(copia[i].cantidad + 1, v.stock);
        if (nueva === copia[i].cantidad) toast.info('Alcanzaste el stock disponible');
        copia[i] = { ...copia[i], cantidad: nueva };
        return copia;
      }
      return [...c, {
        varianteId: v.id,
        nombre: prod.nombre,
        desc: nombreVariante(v),
        imagen_url: prod.imagen_url || null,
        precio: Number(v.precio_venta),
        cantidad: 1,
        descuento: 0,
        stock: v.stock ?? 0,
      }];
    });
    setSeleccion(v.id);
    setVariantePicker(null);
  }, [toast]);

  function alHacerClicProducto(p) {
    const activas = (p.variantes || []).filter((v) => v.activo !== false);
    if (activas.length === 1) agregarVariante(p, activas[0]);
    else setVariantePicker(p);
  }

  function cambiarCantidad(varianteId, delta) {
    setCarrito((c) => c.flatMap((x) => {
      if (x.varianteId !== varianteId) return [x];
      const n = x.cantidad + delta;
      if (n <= 0) return [];
      if (n > x.stock) { toast.info('Stock máximo alcanzado'); return [x]; }
      return [{ ...x, cantidad: n }];
    }));
  }

  function cambiarDescLinea(varianteId, valor) {
    setCarrito((c) => c.map((x) => x.varianteId === varianteId
      ? { ...x, descuento: Math.max(0, Number(valor) || 0) } : x));
  }

  function quitar(varianteId) {
    setCarrito((c) => c.filter((x) => x.varianteId !== varianteId));
    if (seleccion === varianteId) setSeleccion(null);
  }

  const nuevaVenta = useCallback(() => {
    setCarrito([]); setDescuentoTotal(0); setCliente(null); setSeleccion(null);
    setEfectivo(''); setTransferencia(''); setRefTransfer(''); setBancoTransfer(''); setDocTransfer('');
  }, []);

  // -------------------- buscador / lector de código --------------------
  async function alEnviarBusqueda(e) {
    e.preventDefault();
    const codigo = busqueda.trim();
    if (!codigo) return;
    try {
      const v = await api.get(`/api/productos/buscar?codigo=${encodeURIComponent(codigo)}`);
      agregarVariante(
        { nombre: v.producto, imagen_url: v.imagen_url },
        { id: v.variante_id, talla: v.talla, color: v.color, precio_venta: v.precio_venta, stock: v.stock, activo: v.variante_activa },
      );
      setBusqueda('');
    } catch (err) {
      if (err.status === 404) toast.info('No hay producto con ese código; se usa como filtro');
      else toast.error(err.message);
    }
    buscadorRef.current?.focus();
  }

  // -------------------- totales --------------------
  const subtotal = useMemo(
    () => redondear2(carrito.reduce((s, x) => s + x.precio * x.cantidad - x.descuento, 0)),
    [carrito],
  );
  const total = redondear2(Math.max(0, subtotal - (Number(descuentoTotal) || 0)));
  const recibido = redondear2((Number(efectivo) || 0) + (Number(transferencia) || 0));
  const cambio = redondear2(Math.max(0, recibido - total));
  const faltante = redondear2(Math.max(0, total - recibido));

  // -------------------- pago --------------------
  const abrirPago = useCallback((metodo) => {
    if (carrito.length === 0) { toast.info('El carrito está vacío'); return; }
    setEfectivo(metodo === 'efectivo' ? String(total) : '');
    setTransferencia(metodo === 'transferencia' ? String(total) : '');
    setRefTransfer(''); setBancoTransfer(''); setDocTransfer('');
    setModalPago(true);
  }, [carrito.length, total, toast]);

  async function cobrar() {
    if (carrito.length === 0) return;
    if (recibido + 0.005 < total) { toast.error('El pago no cubre el total'); return; }
    setCobrando(true);
    try {
      const pagos = [];
      if (Number(efectivo) > 0) pagos.push({ metodo: 'efectivo', monto: Number(efectivo) });
      if (Number(transferencia) > 0) pagos.push({
        metodo: 'transferencia', monto: Number(transferencia),
        banco: bancoTransfer || undefined, documento: docTransfer || undefined, referencia: refTransfer || undefined,
      });
      if (pagos.length === 0) pagos.push({ metodo: 'efectivo', monto: total });

      const venta = await api.post('/api/ventas', {
        cliente: cliente || undefined,
        items: carrito.map((x) => ({
          variante_id: x.varianteId,
          cantidad: x.cantidad,
          precio_unitario: x.precio,
          descuento: x.descuento || 0,
        })),
        descuento_total: Number(descuentoTotal) || 0,
        pagos,
      });
      // Detalle con tienda / vendedor / ítems con descripción, para el recibo
      const detalle = await api.get(`/api/ventas/${venta.id}`).catch(() => venta);
      toast.ok(`Venta #${venta.id} registrada`);
      setModalPago(false);
      nuevaVenta();
      cargar();
      if (localStorage.getItem(CLAVE_SALTAR) === '1') {
        if (Number(detalle.cambio) > 0) toast.info(`Cambio: ${dinero(detalle.cambio)}`);
      } else {
        setUltimaVenta(detalle);
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setCobrando(false);
      buscadorRef.current?.focus();
    }
  }

  // -------------------- ventas guardadas --------------------
  const guardarVenta = useCallback(() => {
    if (carrito.length === 0) { toast.info('No hay nada para guardar'); return; }
    const item = {
      id: Date.now(),
      ts: new Date().toISOString(),
      carrito, descuentoTotal, cliente,
      total: redondear2(carrito.reduce((s, x) => s + x.precio * x.cantidad - x.descuento, 0) - (Number(descuentoTotal) || 0)),
    };
    persistirGuardadas([item, ...guardadas]);
    nuevaVenta();
    toast.ok('Venta guardada');
  }, [carrito, descuentoTotal, cliente, guardadas, nuevaVenta, toast]);

  function reanudar(g) {
    if (carrito.length > 0 && !window.confirm('Se reemplazará la venta actual. ¿Continuar?')) return;
    setCarrito(g.carrito); setDescuentoTotal(g.descuentoTotal || 0); setCliente(g.cliente || null);
    persistirGuardadas(guardadas.filter((x) => x.id !== g.id));
    setModalGuardadas(false);
  }
  function descartarGuardada(id) {
    persistirGuardadas(guardadas.filter((x) => x.id !== id));
  }

  // -------------------- atajos de teclado --------------------
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F9') { e.preventDefault(); guardarVenta(); }
      else if (e.key === 'F10') { e.preventDefault(); abrirPago(); }
      else if (e.key === 'Escape') { setModalPago(false); setVariantePicker(null); setModalCliente(false); setModalGuardadas(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guardarVenta, abrirPago]);

  const itemSel = carrito.find((x) => x.varianteId === seleccion) || null;

  // ====================================================================
  return (
    <div className="pos">
      {/* ---------- Barra de acciones ---------- */}
      <div className="pos-toolbar">
        <button className="tb" onClick={nuevaVenta} title="Vaciar la venta actual">
          <span className="tb-ico">🧺</span>Nueva venta
        </button>
        <button className="tb" onClick={() => setModalCliente(true)}>
          <span className="tb-ico">👤</span>{cliente?.nombre ? cliente.nombre.split(' ')[0] : 'Cliente'}
        </button>
        <button className="tb" onClick={() => buscadorRef.current?.focus()}>
          <span className="tb-ico">🔎</span>Buscar
        </button>
        <button className="tb" onClick={guardarVenta} title="F9">
          <span className="tb-ico">💾</span>Guardar <kbd>F9</kbd>
        </button>
        <button className="tb" onClick={() => setModalGuardadas(true)}>
          <span className="tb-ico">🗂️</span>Guardadas{guardadas.length ? ` (${guardadas.length})` : ''}
        </button>

        <span className="tb-sep" />

        <button className="tb tb-quick" onClick={() => abrirPago('efectivo')}>
          <span className="tb-ico">💵</span>Efectivo
        </button>
        <button className="tb tb-quick" onClick={() => abrirPago('transferencia')}>
          <span className="tb-ico">🏦</span>Transferencia
        </button>
        <button className="tb tb-pago" onClick={() => abrirPago()} disabled={carrito.length === 0}>
          <kbd>F10</kbd> Pagar {dinero(total)}
        </button>
      </div>

      <div className="pos-cuerpo">
        {/* ---------- Ticket (izquierda) ---------- */}
        <aside className="pos-ticket">
          <div className="ticket-cab">
            <span>Venta actual</span>
            {cliente && (
              <span className="ticket-cliente" onClick={() => setModalCliente(true)}>
                {cliente.nombre || cliente.identificacion || 'Cliente'} ✕
              </span>
            )}
          </div>

          <div className="ticket-tools">
            <button disabled={!itemSel} onClick={() => itemSel && quitar(itemSel.varianteId)}>✕ Eliminar</button>
            <div className="cant">
              <button disabled={!itemSel} onClick={() => itemSel && cambiarCantidad(itemSel.varianteId, -1)}>−</button>
              <span>{itemSel ? itemSel.cantidad : '—'}</span>
              <button disabled={!itemSel} onClick={() => itemSel && cambiarCantidad(itemSel.varianteId, +1)}>+</button>
            </div>
          </div>

          {carrito.length === 0 ? (
            <div className="ticket-vacio">
              <span>🛒</span>
              <p>No hay artículos.<br />Toca un producto o escanea su código.</p>
            </div>
          ) : (
            <div className="ticket-items">
              {carrito.map((x) => (
                <div key={x.varianteId}
                  className={'ticket-item' + (seleccion === x.varianteId ? ' sel' : '')}
                  onClick={() => setSeleccion(x.varianteId)}>
                  <div className="ti-mini">
                    {x.imagen_url ? <img src={x.imagen_url} alt="" /> : <span>👕</span>}
                  </div>
                  <div className="ti-info">
                    <strong>{x.nombre}</strong>
                    {x.desc && <span className="ti-desc">{x.desc}</span>}
                    <span className="ti-precio">{x.cantidad} × {dinero(x.precio)}</span>
                  </div>
                  <div className="ti-monto">
                    {dinero(x.precio * x.cantidad - x.descuento)}
                    <input className="ti-desc-input" type="number" min="0" step="0.01"
                      value={x.descuento || ''} placeholder="desc."
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => cambiarDescLinea(x.varianteId, e.target.value)} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="ticket-totales">
            <div className="fila"><span>Subtotal</span><span>{dinero(subtotal)}</span></div>
            <div className="fila">
              <span>Descuento</span>
              <input type="number" min="0" step="0.01" value={descuentoTotal || ''}
                placeholder="0.00" onChange={(e) => setDescuentoTotal(e.target.value)} />
            </div>
            <div className="fila total"><span>TOTAL</span><span>{dinero(total)}</span></div>
            <button className="btn-primario grande" disabled={carrito.length === 0}
              onClick={() => abrirPago()}>Cobrar {dinero(total)}</button>
          </div>
        </aside>

        {/* ---------- Catálogo (derecha) ---------- */}
        <section className="pos-catalogo">
          <form className="pos-buscador" onSubmit={alEnviarBusqueda}>
            <span className="lupa">🔎</span>
            <input ref={buscadorRef} value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto por nombre o escanear código de barras…" />
          </form>

          <div className="pos-categorias">
            <button className={'chip' + (catActiva === null ? ' activo' : '')} onClick={() => setCatActiva(null)}>Todas</button>
            {categorias.map((c) => (
              <button key={c.id} className={'chip' + (catActiva === c.id ? ' activo' : '')}
                onClick={() => setCatActiva(c.id)}>{c.nombre}</button>
            ))}
          </div>

          <div className="pos-grid-wrap">
            {cargando ? (
              <div className="vacio">Cargando…</div>
            ) : productos.length === 0 ? (
              <div className="vacio">No hay productos para mostrar</div>
            ) : (
              <div className="pos-grid">
                {productos.map((p) => {
                  const stock = p.stock_total ?? 0;
                  const precios = (p.variantes || []).map((v) => Number(v.precio_venta));
                  const precioMin = precios.length ? Math.min(...precios) : 0;
                  return (
                    <button key={p.id} className={'prod-card' + (stock <= 0 ? ' agotado' : '')}
                      onClick={() => alHacerClicProducto(p)} disabled={stock <= 0}>
                      <div className="prod-img">
                        {p.imagen_url
                          ? <img src={p.imagen_url} alt="" loading="lazy" />
                          : <span className="prod-img-ph">👕</span>}
                        <span className={'prod-stock' + (stock <= 5 ? ' bajo' : '')}>{stock}</span>
                      </div>
                      <div className="prod-body">
                        <div className="prod-nombre">{p.nombre}</div>
                        <div className="prod-pie">
                          <span className="prod-precio">{dinero(precioMin)}</span>
                          {(p.variantes || []).length > 1 && <span className="prod-var">{p.variantes.length} var.</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pos-paginacion">
            <span>Página {pagina} / {totalPaginas}</span>
            <div className="pag-btns">
              <button disabled={pagina <= 1} onClick={() => setPagina(1)}>«</button>
              <button disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>‹</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((n) => n + 1)}>›</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina(totalPaginas)}>»</button>
            </div>
          </div>
        </section>
      </div>

      {/* ---------- Selector de variante ---------- */}
      {variantePicker && (
        <div className="modal-fondo" onClick={() => setVariantePicker(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{variantePicker.nombre}</h3>
            <p className="modal-sub">Elige talla / color</p>
            <div className="variante-lista">
              {variantePicker.variantes.map((v) => (
                <button key={v.id} className="variante-op" disabled={(v.stock ?? 0) <= 0}
                  onClick={() => agregarVariante(variantePicker, v)}>
                  <span>{nombreVariante(v) || 'Única'}</span>
                  <span className="v-precio">{dinero(v.precio_venta)}</span>
                  <span className={'v-stock' + ((v.stock ?? 0) <= 0 ? ' cero' : '')}>{v.stock ?? 0} u.</span>
                </button>
              ))}
            </div>
            <button className="btn-secundario" onClick={() => setVariantePicker(null)}>Cerrar</button>
          </div>
        </div>
      )}

      {/* ---------- Cliente ---------- */}
      {modalCliente && (
        <ModalCliente cliente={cliente}
          onCerrar={() => setModalCliente(false)}
          onGuardar={(c) => { setCliente(c); setModalCliente(false); }}
          onQuitar={() => { setCliente(null); setModalCliente(false); }} />
      )}

      {/* ---------- Ventas guardadas ---------- */}
      {modalGuardadas && (
        <div className="modal-fondo" onClick={() => setModalGuardadas(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Ventas guardadas</h3>
            {guardadas.length === 0 ? (
              <p className="modal-sub">No hay ventas guardadas.</p>
            ) : (
              <ul className="guardadas-lista">
                {guardadas.map((g) => (
                  <li key={g.id}>
                    <div>
                      <strong>{dinero(g.total)}</strong>
                      <span className="g-meta">{g.carrito.length} art. · {new Date(g.ts).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}{g.cliente?.nombre ? ` · ${g.cliente.nombre}` : ''}</span>
                    </div>
                    <div className="g-acc">
                      <button className="btn-primario chico" onClick={() => reanudar(g)}>Reanudar</button>
                      <button className="btn-texto peligro" onClick={() => descartarGuardada(g.id)}>Descartar</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn-secundario" onClick={() => setModalGuardadas(false)}>Cerrar</button>
          </div>
        </div>
      )}

      {/* ---------- Pago ---------- */}
      {modalPago && (
        <div className="modal-fondo" onClick={() => !cobrando && setModalPago(false)}>
          <div className="modal modal-pago" onClick={(e) => e.stopPropagation()}>
            <h3>Cobrar</h3>
            <div className="pago-total">{dinero(total)}</div>

            <label>Efectivo
              <input type="number" min="0" step="0.01" value={efectivo} autoFocus
                onChange={(e) => setEfectivo(e.target.value)} />
            </label>
            <div className="pago-chips">
              <button onClick={() => setEfectivo(String(total))}>Exacto</button>
              {[5, 10, 20, 50].map((n) => (
                <button key={n} onClick={() => setEfectivo(String(redondear2((Number(efectivo) || 0) + n)))}>+{n}</button>
              ))}
            </div>

            <label>Transferencia
              <input type="number" min="0" step="0.01" value={transferencia}
                onChange={(e) => setTransferencia(e.target.value)} />
            </label>
            {Number(transferencia) > 0 && (
              <div className="pago-transfer">
                <label>Banco
                  <SelectorBanco value={bancoTransfer} onChange={setBancoTransfer} />
                </label>
                <label>N.º de comprobante
                  <input value={docTransfer} placeholder="N.º de la transferencia"
                    onChange={(e) => setDocTransfer(e.target.value)} />
                </label>
                <label className="ancho">Observación
                  <input value={refTransfer} placeholder="Opcional"
                    onChange={(e) => setRefTransfer(e.target.value)} />
                </label>
              </div>
            )}

            <div className="pago-linea"><span>Recibido</span><span>{dinero(recibido)}</span></div>
            {faltante > 0
              ? <div className="pago-linea falta"><span>Falta</span><span>{dinero(faltante)}</span></div>
              : <div className="pago-linea cambio"><span>Cambio</span><span>{dinero(cambio)}</span></div>}

            <div className="modal-acciones">
              <button className="btn-secundario" onClick={() => setModalPago(false)} disabled={cobrando}>Cancelar</button>
              <button className="btn-primario" onClick={cobrar} disabled={faltante > 0 || cobrando}>
                {cobrando ? 'Procesando…' : 'Confirmar cobro'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Acciones tras el cobro ---------- */}
      {ultimaVenta && (
        <ModalAcciones venta={ultimaVenta} negocio={negocio}
          onCerrar={() => setUltimaVenta(null)} toast={toast} />
      )}
    </div>
  );
}

function ModalAcciones({ venta, negocio, onCerrar, toast }) {
  const [notaAbierta, setNotaAbierta] = useState(false);
  const [nota, setNota] = useState(venta.nota || '');
  const [guardandoNota, setGuardandoNota] = useState(false);
  const [saltar, setSaltar] = useState(localStorage.getItem(CLAVE_SALTAR) === '1');
  const [facturando, setFacturando] = useState(false);
  const [factura, setFactura] = useState(null); // { estado } tras encolar
  const [modalFacturar, setModalFacturar] = useState(false);
  const [datosFactura, setDatosFactura] = useState({
    identificacion: venta.cliente_identificacion || '',
    nombre: venta.cliente_nombre || '',
    email: venta.cliente_email || '',
    telefono: venta.cliente_telefono || '',
    direccion: venta.cliente_direccion || '',
  });

  function imprimir() {
    if (!imprimirRecibo(negocio, venta)) toast.error('Permite las ventanas emergentes para imprimir');
  }

  const sriListo = !!negocio?.tiene_certificado && !!negocio?.ruc;

  function facturarSri() {
    if (!sriListo) {
      toast.error('Primero configura el RUC y el certificado en "Datos del negocio"');
      return;
    }
    setModalFacturar(true);
  }

  async function confirmarFactura() {
    setFacturando(true);
    try {
      const r = await api.post(`/api/ventas/${venta.id}/facturar`, { cliente: datosFactura });
      const c = r.comprobante || r;
      setFactura({ estado: c.estado || 'pendiente', num: `${c.estab}-${c.pto_emi}-${c.secuencial}` });
      toast.ok(r.ya_existe ? 'Ya tenía factura en proceso' : 'Factura enviada al SRI (se procesa en segundo plano)');
      setModalFacturar(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setFacturando(false);
    }
  }

  function enviarEmail() {
    const to = window.prompt('Correo del cliente:', venta.cliente_email || '');
    if (!to) return;
    const lineas = (venta.items || []).map((it) => `- ${it.descripcion} (${it.cantidad} x $${Number(it.precio_unitario).toFixed(2)})`).join('%0D%0A');
    const cuerpo = `${negocio?.nombre || 'Recibo'} - Venta #${venta.id}%0D%0A%0D%0A${lineas}%0D%0A%0D%0ATotal: $${Number(venta.total).toFixed(2)}%0D%0ACambio: $${Number(venta.cambio).toFixed(2)}%0D%0A%0D%0A${negocio?.mensaje_recibo || 'Gracias por su compra'}`;
    window.open(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`Recibo venta #${venta.id}`)}&body=${cuerpo}`);
  }

  async function guardarNota() {
    setGuardandoNota(true);
    try {
      await api.put(`/api/ventas/${venta.id}/nota`, { nota });
      venta.nota = nota;
      toast.ok('Nota guardada');
      setNotaAbierta(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardandoNota(false);
    }
  }

  function cambiarSaltar(v) {
    setSaltar(v);
    localStorage.setItem(CLAVE_SALTAR, v ? '1' : '0');
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal modal-acc" onClick={(e) => e.stopPropagation()}>
        <div className="acc-cab">
          <span>Venta #{venta.id} registrada</span>
          <button className="acc-x" onClick={onCerrar}>✕</button>
        </div>

        <div className="acc-cambio">
          <span className="acc-cambio-ico">💵</span>
          Cambio: <strong>{dinero(venta.cambio)}</strong>
        </div>

        <h3 className="acc-titulo">¿Cómo le entregamos el recibo al cliente?</h3>

        <div className="acc-grid">
          <button className="acc-op" onClick={imprimir}>
            <span className="acc-ico">🧾</span>Imprimir recibo
          </button>
          <button className="acc-op" onClick={imprimir}>
            <span className="acc-ico">📄</span>Guardar como PDF
          </button>
          <button className="acc-op" onClick={enviarEmail}>
            <span className="acc-ico">✉️</span>Enviar por email
          </button>
          <button className="acc-op" onClick={() => setNotaAbierta((v) => !v)}>
            <span className="acc-ico">✏️</span>{venta.nota ? 'Editar nota' : 'Agregar nota'}
          </button>
          <button className={'acc-op' + (sriListo ? '' : ' acc-disabled')} onClick={facturarSri} disabled={facturando || !!factura}>
            <span className="acc-ico">🧮</span>
            {facturando ? 'Enviando…' : factura ? 'Factura en proceso' : 'Factura electrónica'}
            {!sriListo && <span className="acc-badge">Configurar</span>}
          </button>
        </div>

        {factura && (
          <div className="acc-factura">
            Factura <strong>{factura.num}</strong> — estado: {factura.estado}. Se autoriza en segundo plano;
            revisa <strong>Comprobantes</strong>.
          </div>
        )}

        {notaAbierta && (
          <div className="acc-nota">
            <textarea rows="2" value={nota} onChange={(e) => setNota(e.target.value)}
              placeholder="Ej.: cambio permitido dentro de 8 días" autoFocus />
            <button className="btn-primario chico" onClick={guardarNota} disabled={guardandoNota}>
              {guardandoNota ? 'Guardando…' : 'Guardar nota'}
            </button>
          </div>
        )}

        <div className="acc-pie">
          <label className="check-inline">
            <input type="checkbox" checked={saltar} onChange={(e) => cambiarSaltar(e.target.checked)} />
            No mostrar esto nuevamente
          </label>
          <button className="btn-primario" onClick={onCerrar}>Hecho</button>
        </div>
      </div>

      {modalFacturar && (
        <div className="modal-fondo" onClick={() => !facturando && setModalFacturar(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Datos del cliente para la factura</h3>
            <p className="modal-sub">Escribe la cédula/RUC y se cargan los datos si el cliente ya está guardado.</p>
            <FormularioCliente value={datosFactura} onChange={setDatosFactura}
              onEncontrado={(c) => toast.ok(`Cliente encontrado: ${c.nombre}`)} />
            <div className="modal-acciones">
              <button className="btn-secundario" onClick={() => setModalFacturar(false)} disabled={facturando}>Cancelar</button>
              <button className="btn-primario" onClick={confirmarFactura} disabled={facturando}>
                {facturando ? 'Enviando…' : 'Emitir factura'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModalCliente({ cliente, onCerrar, onGuardar, onQuitar }) {
  const toast = useToast();
  const [datos, setDatos] = useState({
    identificacion: cliente?.identificacion || '',
    nombre: cliente?.nombre || '',
    email: cliente?.email || '',
    telefono: cliente?.telefono || '',
    direccion: cliente?.direccion || '',
  });
  const [guardandoLibreta, setGuardandoLibreta] = useState(false);

  async function guardarEnLibreta() {
    if (!datos.identificacion || !datos.nombre) {
      toast.error('Para guardar el cliente necesitas cédula/RUC y nombre');
      return;
    }
    setGuardandoLibreta(true);
    try {
      await api.put('/api/clientes', datos);
      toast.ok('Cliente guardado');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardandoLibreta(false);
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Cliente de la venta</h3>
        <p className="modal-sub">Opcional. Se usa para la factura electrónica. Al escribir la cédula/RUC se cargan los datos guardados.</p>

        <FormularioCliente value={datos} onChange={setDatos}
          onEncontrado={(c) => toast.ok(`Cliente encontrado: ${c.nombre}`)} />

        <div className="modal-acciones" style={{ justifyContent: 'space-between' }}>
          <button className="btn-secundario chico" onClick={guardarEnLibreta} disabled={guardandoLibreta}>
            {guardandoLibreta ? 'Guardando…' : '💾 Guardar cliente'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {cliente && <button className="btn-texto peligro" onClick={onQuitar}>Quitar</button>}
            <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
            <button className="btn-primario" onClick={() => onGuardar({
              ...datos,
              nombre: datos.nombre.trim() || 'Consumidor final',
            })}>Usar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

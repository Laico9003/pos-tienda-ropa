import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { dinero } from '../util.js';

const COLORES_DONUT = ['#4f46e5', '#0ea5e9', '#f59e0b', '#10b981', '#a855f7'];

const mesCorto = (iso) =>
  new Date(iso).toLocaleDateString('es-EC', { month: 'short', year: '2-digit' }).replace('.', '');

export default function Dashboard() {
  const { esAdmin } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [tiendas, setTiendas] = useState([]);
  const [tiendaId, setTiendaId] = useState('');

  useEffect(() => {
    if (esAdmin) api.get('/api/tiendas').then(setTiendas).catch(() => {});
  }, [esAdmin]);

  useEffect(() => {
    setD(null);
    const q = tiendaId ? `?tienda_id=${tiendaId}` : '';
    api.get(`/api/reportes/dashboard${q}`).then(setD).catch((e) => toast.error(e.message));
  }, [tiendaId]);

  if (!d) return <div className="vacio">Cargando dashboard…</div>;

  const varPos = d.mes.variacion_pct >= 0;
  const maxSerie = Math.max(1, ...d.serie_meses.flatMap((m) => [m.ventas, Math.max(0, m.ganancia)]));
  const totalTop = d.top_productos_historico.reduce((s, x) => s + x.unidades, 0) || 1;

  const R = 54;
  const CIRC = 2 * Math.PI * R;
  let acumulado = 0;
  const segmentos = d.top_productos_historico.map((x, i) => {
    const frac = x.unidades / totalTop;
    const seg = { ...x, color: COLORES_DONUT[i % COLORES_DONUT.length], off: acumulado, len: frac };
    acumulado += frac;
    return seg;
  });

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <h1>Dashboard</h1>
        {esAdmin && (
          <select value={tiendaId} onChange={(e) => setTiendaId(e.target.value)}>
            <option value="">Mi tienda</option>
            {tiendas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        )}
      </div>

      {/* ---------- KPIs ---------- */}
      <div className="kpis">
        <div className="kpi kpi-acc verde">
          <div className="kpi-top"><span className="kpi-ico">💵</span><span className="kpi-lbl">Ventas del mes</span></div>
          <span className="kpi-val">{dinero(d.mes.monto)}</span>
          <span className={'kpi-delta ' + (varPos ? 'up' : 'down')}>
            {varPos ? '▲' : '▼'} {Math.abs(d.mes.variacion_pct)}% vs. mes anterior
          </span>
        </div>
        <div className="kpi kpi-acc azul">
          <div className="kpi-top"><span className="kpi-ico">🧾</span><span className="kpi-lbl">Ventas hoy</span></div>
          <span className="kpi-val">{d.ventas_hoy.cantidad}</span>
          <span className="kpi-sub">{dinero(d.ventas_hoy.monto)} · {d.ventas_hoy.unidades} u.</span>
        </div>
        <div className="kpi kpi-acc morado">
          <div className="kpi-top"><span className="kpi-ico">📈</span><span className="kpi-lbl">Ganancia del mes</span></div>
          <span className="kpi-val">{dinero(d.mes.ganancia)}</span>
          <span className="kpi-sub">margen {d.mes.margen}% · costo {dinero(d.mes.costo)}</span>
        </div>
        <div className={'kpi kpi-acc ' + (d.stock_bajo.cantidad > 0 ? 'amarillo' : 'gris')}>
          <div className="kpi-top"><span className="kpi-ico">⚠️</span><span className="kpi-lbl">Stock bajo</span></div>
          <span className="kpi-val">{d.stock_bajo.cantidad}</span>
          <span className="kpi-sub">productos con ≤ {d.umbral_stock_bajo} u.</span>
        </div>
      </div>

      {/* ---------- Tira del mes ---------- */}
      <div className="flujo-tira">
        <div className="flujo-card">
          <span className="flujo-lbl">Ventas del mes</span>
          <span className="flujo-val">{d.mes.ventas}</span>
        </div>
        <div className="flujo-card">
          <span className="flujo-lbl">Unidades vendidas (mes)</span>
          <span className="flujo-val">{d.mes.unidades}</span>
        </div>
        <div className="flujo-card">
          <span className="flujo-lbl">Ticket promedio (mes)</span>
          <span className="flujo-val">{dinero(d.mes.ticket_promedio)}</span>
        </div>
        <div className="flujo-card">
          <span className="flujo-lbl">Catálogo activo</span>
          <span className="flujo-val">{d.catalogo.productos} <small>prod.</small> · {d.catalogo.categorias} <small>cat.</small></span>
        </div>
      </div>

      {/* ---------- Gráficos ---------- */}
      <div className="panel-grid">
        <div className="panel">
          <h2>Ventas y ganancia — últimos 6 meses</h2>
          <div className="leyenda">
            <span><i className="pt" style={{ background: 'var(--ok)' }} /> Ventas</span>
            <span><i className="pt" style={{ background: 'var(--primario)' }} /> Ganancia bruta</span>
          </div>
          <div className="barras-grp">
            {d.serie_meses.map((m) => (
              <div key={m.mes} className="bg-col">
                <div className="bg-bars">
                  <div className="bg-bar v" style={{ height: `${(m.ventas / maxSerie) * 100}%` }} title={`Ventas: ${dinero(m.ventas)}`} />
                  <div className="bg-bar g" style={{ height: `${(Math.max(0, m.ganancia) / maxSerie) * 100}%` }} title={`Ganancia: ${dinero(m.ganancia)}`} />
                </div>
                <div className="bg-lbl">{mesCorto(m.mes)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Top 5 productos — histórico</h2>
          {segmentos.length === 0 ? (
            <p className="vacio-min">Sin ventas todavía</p>
          ) : (
            <div className="donut-wrap">
              <svg viewBox="0 0 140 140" className="donut">
                {segmentos.map((s) => (
                  <circle key={s.descripcion} r={R} cx="70" cy="70" fill="none"
                    stroke={s.color} strokeWidth="24"
                    strokeDasharray={`${s.len * CIRC} ${CIRC}`}
                    strokeDashoffset={`${-s.off * CIRC}`}
                    transform="rotate(-90 70 70)" />
                ))}
                <text x="70" y="67" textAnchor="middle" className="donut-num">{totalTop}</text>
                <text x="70" y="84" textAnchor="middle" className="donut-cap">unidades</text>
              </svg>
              <ul className="donut-leg">
                {segmentos.map((s) => (
                  <li key={s.descripcion}>
                    <i style={{ background: s.color }} />
                    <span className="dl-nom">{s.descripcion}</span>
                    <span className="dl-num">{s.unidades}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Pagos de hoy</h2>
          {d.ventas_por_metodo.length === 0 ? (
            <p className="vacio-min">Aún no hay ventas hoy</p>
          ) : (
            <ul className="lista-metodos">
              {d.ventas_por_metodo.map((m) => (
                <li key={m.metodo}>
                  <span className="met-nombre">{m.metodo === 'efectivo' ? '💵 Efectivo' : '🏦 Transferencia'}</span>
                  <span className="met-monto">{dinero(m.monto)}</span>
                  <span className="met-cant">{m.ventas} vta.</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <div className="panel-cab">
            <h2>Últimas ventas</h2>
            <Link to="/ventas" className="btn-texto">Ver todas →</Link>
          </div>
          <table className="tabla-min">
            <tbody>
              {d.ultimas_ventas.map((v) => (
                <tr key={v.id} className="clic" onClick={() => nav('/ventas')}>
                  <td className="um-id">#{v.id}</td>
                  <td>{v.cliente_nombre || 'Consumidor final'}</td>
                  <td className={'um-total' + (v.estado === 'anulada' ? ' anulada' : '')}>{dinero(v.total)}</td>
                </tr>
              ))}
              {d.ultimas_ventas.length === 0 && <tr><td colSpan="3" className="vacio-min">Sin ventas</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

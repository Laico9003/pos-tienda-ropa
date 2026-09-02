import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import ModalClave from './ModalClave.jsx';

const ICON = {
  venta: '🛒', dashboard: '📊', productos: '👕', inventario: '📦', ventas: '🧾',
  caja: '💰', comprobantes: '🧮', usuarios: '👥', negocio: '🏪',
};

export default function Layout({ children }) {
  const { usuario, negocio, salir, esAdmin, puedeInventario } = useAuth();
  const [modalClave, setModalClave] = useState(false);

  const enlaces = [
    { to: '/venta', txt: 'Punto de venta', k: 'venta' },
    esAdmin && { to: '/dashboard', txt: 'Dashboard', k: 'dashboard' },
    { to: '/productos', txt: 'Productos', k: 'productos' },
    puedeInventario && { to: '/inventario', txt: 'Inventario', k: 'inventario' },
    esAdmin && { to: '/ventas', txt: 'Ventas', k: 'ventas' },
    { to: '/caja', txt: 'Caja', k: 'caja' },
    { to: '/comprobantes', txt: 'Comprobantes', k: 'comprobantes' },
    esAdmin && { to: '/usuarios', txt: 'Usuarios', k: 'usuarios' },
    esAdmin && { to: '/negocio', txt: 'Datos del negocio', k: 'negocio' },
  ].filter(Boolean);

  const nombreNegocio = negocio?.nombre || 'Sistema POS';

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="marca">
          {negocio?.logo_url
            ? <img className="marca-logo-img" src={negocio.logo_url} alt="" />
            : <span className="marca-logo">{nombreNegocio.charAt(0).toUpperCase()}</span>}
          <span className="marca-txt">{nombreNegocio}</span>
        </div>
        <nav>
          {enlaces.map((e) => (
            <NavLink key={e.to} to={e.to} className={({ isActive }) => 'nav-link' + (isActive ? ' activo' : '')}>
              <span className="nav-ico">{ICON[e.k]}</span> {e.txt}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-pie">
          <div className="usuario-info">
            <strong>{usuario.nombre}</strong>
            <span className="badge">{usuario.rol}</span>
            <span className="tienda">{usuario.tienda_nombre || `Tienda ${usuario.tienda_id}`}</span>
          </div>
          <button className="btn-texto" onClick={() => setModalClave(true)}>Cambiar contraseña</button>
          <button className="btn-texto" onClick={salir}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="contenido">{children}</main>
      {modalClave && <ModalClave onCerrar={() => setModalClave(false)} />}
    </div>
  );
}

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import POS from './pages/POS.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Productos from './pages/Productos.jsx';
import Inventario from './pages/Inventario.jsx';
import Ventas from './pages/Ventas.jsx';
import Caja from './pages/Caja.jsx';
import Usuarios from './pages/Usuarios.jsx';
import Negocio from './pages/Negocio.jsx';
import Comprobantes from './pages/Comprobantes.jsx';

export default function App() {
  const { usuario, cargando } = useAuth();

  if (cargando) {
    return <div className="pantalla-carga">Cargando…</div>;
  }

  if (!usuario) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/venta" replace />} />
        <Route path="/venta" element={<POS />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/productos" element={<Productos />} />
        <Route path="/inventario" element={<Inventario />} />
        <Route path="/ventas" element={<Ventas />} />
        <Route path="/caja" element={<Caja />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/negocio" element={<Negocio />} />
        <Route path="/comprobantes" element={<Comprobantes />} />
        <Route path="*" element={<Navigate to="/venta" replace />} />
      </Routes>
    </Layout>
  );
}

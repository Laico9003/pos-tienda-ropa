import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

/**
 * Guarda de ruta por rol. Si el usuario no tiene un rol permitido, lo manda al
 * Punto de venta. Es el respaldo real de la protección: aunque el menú oculte el
 * enlace, el backend también responde 403; esto evita además que se renderice la
 * página al entrar por URL.
 *
 * Uso:  <RutaRol roles={['admin']}><Dashboard /></RutaRol>
 */
export default function RutaRol({ roles = ['admin'], children }) {
  const { usuario } = useAuth();
  if (!usuario) return <Navigate to="/venta" replace />;
  return roles.includes(usuario.rol) ? children : <Navigate to="/venta" replace />;
}

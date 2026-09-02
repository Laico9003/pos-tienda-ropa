import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, getToken, onNoAutorizado } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [negocio, setNegocio] = useState(null);
  const [cargando, setCargando] = useState(true);

  const salir = useCallback(() => {
    setToken(null);
    setUsuario(null);
  }, []);

  useEffect(() => {
    onNoAutorizado(salir);
  }, [salir]);

  const cargarNegocio = useCallback(() => {
    api.get('/api/negocio').then(setNegocio).catch(() => {});
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setCargando(false);
      return;
    }
    api.get('/api/auth/perfil')
      .then((u) => { setUsuario({ ...u, tienda_nombre: u.tienda_nombre }); cargarNegocio(); })
      .catch(() => setToken(null))
      .finally(() => setCargando(false));
  }, [cargarNegocio]);

  async function entrar(email, password) {
    const r = await api.post('/api/auth/login', { email, password });
    setToken(r.token);
    setUsuario(r.usuario);
    cargarNegocio();
    return r.usuario;
  }

  const esAdmin = usuario?.rol === 'admin';
  const esVendedor = usuario?.rol === 'vendedor';
  const esBodega = usuario?.rol === 'bodega';
  const puedeVender = usuario?.rol === 'admin' || usuario?.rol === 'vendedor';
  const puedeInventario = usuario?.rol === 'admin' || usuario?.rol === 'bodega';

  return (
    <AuthContext.Provider value={{
      usuario, negocio, setNegocio, cargando, entrar, salir,
      esAdmin, esVendedor, esBodega, puedeVender, puedeInventario,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';

export default function Usuarios() {
  const toast = useToast();
  const [usuarios, setUsuarios] = useState([]);
  const [tiendas, setTiendas] = useState([]);
  const [modal, setModal] = useState(null); // {nuevo:true} | usuario

  async function cargar() {
    try {
      const [u, t] = await Promise.all([api.get('/api/usuarios'), api.get('/api/tiendas?incluir_inactivas=true')]);
      setUsuarios(u); setTiendas(t);
    } catch (e) { toast.error(e.message); }
  }
  useEffect(() => { cargar(); }, []);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <h1>Usuarios y tiendas</h1>
        <button className="btn-primario" onClick={() => setModal({ nuevo: true, rol: 'vendedor', tienda_id: tiendas[0]?.id })}>+ Nuevo usuario</button>
      </div>

      <h2 className="sub">Usuarios</h2>
      <table className="tabla">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Tienda</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id}>
              <td>{u.nombre}</td><td>{u.email}</td><td><span className="badge">{u.rol}</span></td>
              <td>{u.tienda || '—'}</td>
              <td><span className={'estado ' + (u.activo ? 'completada' : 'anulada')}>{u.activo ? 'activo' : 'inactivo'}</span></td>
              <td><button className="btn-texto" onClick={() => setModal(u)}>Editar</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="sub">Tiendas</h2>
      <Tiendas tiendas={tiendas} onCambio={cargar} />

      {modal && (
        <ModalUsuario datos={modal} tiendas={tiendas}
          onCerrar={() => setModal(null)}
          onGuardado={() => { setModal(null); cargar(); }} />
      )}
    </div>
  );
}

function ModalUsuario({ datos, tiendas, onCerrar, onGuardado }) {
  const toast = useToast();
  const esNuevo = !!datos.nuevo;
  const [f, setF] = useState({
    nombre: datos.nombre || '', email: datos.email || '', password: '',
    rol: datos.rol || 'vendedor', tienda_id: datos.tienda_id || tiendas[0]?.id, activo: datos.activo ?? true,
  });

  async function guardar() {
    try {
      if (esNuevo) {
        await api.post('/api/usuarios', f);
      } else {
        const cambios = { nombre: f.nombre, rol: f.rol, tienda_id: f.tienda_id, activo: f.activo };
        if (f.password) cambios.password = f.password;
        await api.put(`/api/usuarios/${datos.id}`, cambios);
      }
      toast.ok('Usuario guardado');
      onGuardado();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{esNuevo ? 'Nuevo usuario' : `Editar ${datos.nombre}`}</h3>
        <label>Nombre<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
        <label>Email<input type="email" value={f.email} disabled={!esNuevo}
          onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>{esNuevo ? 'Contraseña' : 'Nueva contraseña (opcional)'}
          <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <label>Rol
          <select value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>
            <option value="vendedor">Vendedor</option>
            <option value="bodega">Bodega</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label>Tienda
          <select value={f.tienda_id} onChange={(e) => setF({ ...f, tienda_id: Number(e.target.value) })}>
            {tiendas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </label>
        {!esNuevo && (
          <label className="check-inline">
            <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Activo
          </label>
        )}
        <div className="modal-acciones">
          <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primario" onClick={guardar}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function Tiendas({ tiendas, onCambio }) {
  const toast = useToast();
  const [nueva, setNueva] = useState({ nombre: '', codigo_establecimiento: '', punto_emision: '001' });

  async function crear() {
    if (!nueva.nombre.trim() || !nueva.codigo_establecimiento.trim()) { toast.error('Nombre y código requeridos'); return; }
    try { await api.post('/api/tiendas', nueva); setNueva({ nombre: '', codigo_establecimiento: '', punto_emision: '001' }); onCambio(); }
    catch (e) { toast.error(e.message); }
  }
  async function alternar(t) {
    try { await api.put(`/api/tiendas/${t.id}`, { activo: !t.activo }); onCambio(); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <table className="tabla">
      <thead><tr><th>Nombre</th><th>Cód. establecimiento</th><th>Punto emisión</th><th>Estado</th></tr></thead>
      <tbody>
        {tiendas.map((t) => (
          <tr key={t.id}>
            <td>{t.nombre}</td><td className="mono">{t.codigo_establecimiento}</td><td className="mono">{t.punto_emision}</td>
            <td><button className={'toggle chico' + (t.activo ? ' on' : '')} onClick={() => alternar(t)}>{t.activo ? 'Activa' : 'Inactiva'}</button></td>
          </tr>
        ))}
        <tr>
          <td><input placeholder="Nombre" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} /></td>
          <td><input placeholder="003" value={nueva.codigo_establecimiento} onChange={(e) => setNueva({ ...nueva, codigo_establecimiento: e.target.value })} /></td>
          <td><input value={nueva.punto_emision} onChange={(e) => setNueva({ ...nueva, punto_emision: e.target.value })} /></td>
          <td><button className="btn-primario chico" onClick={crear}>Agregar</button></td>
        </tr>
      </tbody>
    </table>
  );
}

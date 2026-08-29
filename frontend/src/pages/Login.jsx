import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { entrar } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      await entrar(email.trim(), password);
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={enviar}>
        <div className="login-logo">S</div>
        <h1>Sistema POS</h1>
        <p className="login-sub">Tienda de ropa</p>

        <label>Correo</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoFocus required placeholder="admin@tienda.com" />

        <label>Contraseña</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          required placeholder="••••••••" />

        {error && <div className="login-error">{error}</div>}

        <button className="btn-primario" disabled={cargando}>
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import SelectorImagen from '../components/SelectorImagen.jsx';

const VACIO = {
  nombre: '', razon_social: '', ruc: '', direccion: '', telefono: '', email: '',
  logo_url: null, mensaje_recibo: '',
  obligado_contabilidad: false, ambiente_sri: 'pruebas',
  dir_matriz: '', nombre_comercial: '', contribuyente_especial: '', regimen: 'general',
  iva_porcentaje: 15, precios_incluyen_iva: true, emitir_factura_auto: false, exigir_caja: false,
  email_proveedor: 'smtp',
  smtp_host: '', smtp_port: 587, smtp_seguro: false, smtp_usuario: '',
  smtp_remitente: '', smtp_remitente_nombre: '',
  gmail_client_id: '',
  tiene_certificado: false, certificado_nombre: null, tiene_smtp_clave: false,
  tiene_email_api_key: false, tiene_gmail_secret: false, tiene_gmail_refresh: false,
};

const leerArchivoBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(new Error('No se pudo leer el archivo'));
  r.readAsDataURL(file);
});

export default function Negocio() {
  const { esAdmin, setNegocio } = useAuth();
  const toast = useToast();
  const [f, setF] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [saltarRecibo, setSaltarRecibo] = useState(localStorage.getItem('pos_saltar_recibo') === '1');

  // Certificado
  const p12Ref = useRef(null);
  const [p12, setP12] = useState(null);          // { nombre, base64 }
  const [p12Clave, setP12Clave] = useState('');
  const [smtpClave, setSmtpClave] = useState('');
  const [emailApiKey, setEmailApiKey] = useState('');
  const [gmailSecret, setGmailSecret] = useState('');
  const [gmailRefresh, setGmailRefresh] = useState('');

  function cargar() {
    api.get('/api/negocio').then((n) => setF({ ...VACIO, ...n })).catch((e) => toast.error(e.message));
  }
  useEffect(() => { cargar(); }, []);

  function set(k, v) { setF((x) => ({ ...x, [k]: v })); }

  async function guardar() {
    setGuardando(true);
    try {
      const cuerpo = {
        nombre: f.nombre?.trim() || 'Mi Tienda',
        razon_social: f.razon_social?.trim() || null,
        ruc: f.ruc?.trim() || null,
        direccion: f.direccion?.trim() || null,
        telefono: f.telefono?.trim() || null,
        email: f.email?.trim() || null,
        logo_url: f.logo_url || null,
        mensaje_recibo: f.mensaje_recibo?.trim() || null,
        obligado_contabilidad: !!f.obligado_contabilidad,
        ambiente_sri: f.ambiente_sri,
        dir_matriz: f.dir_matriz?.trim() || null,
        nombre_comercial: f.nombre_comercial?.trim() || null,
        contribuyente_especial: f.contribuyente_especial?.trim() || null,
        regimen: f.regimen,
        iva_porcentaje: Number(f.iva_porcentaje),
        precios_incluyen_iva: !!f.precios_incluyen_iva,
        emitir_factura_auto: !!f.emitir_factura_auto,
        exigir_caja: !!f.exigir_caja,
        email_proveedor: ['brevo', 'smtp2go', 'gmail'].includes(f.email_proveedor) ? f.email_proveedor : 'smtp',
        smtp_host: f.smtp_host?.trim() || null,
        smtp_port: Number(f.smtp_port) || 587,
        smtp_seguro: !!f.smtp_seguro,
        smtp_usuario: f.smtp_usuario?.trim() || null,
        smtp_remitente: f.smtp_remitente?.trim() || null,
        smtp_remitente_nombre: f.smtp_remitente_nombre?.trim() || null,
        gmail_client_id: f.gmail_client_id?.trim() || null,
      };
      if (smtpClave) cuerpo.smtp_clave = smtpClave;
      if (emailApiKey) cuerpo.email_api_key = emailApiKey;
      if (gmailSecret) cuerpo.gmail_client_secret = gmailSecret;
      if (gmailRefresh) cuerpo.gmail_refresh_token = gmailRefresh;
      if (p12) {
        cuerpo.certificado_p12 = p12.base64;
        cuerpo.certificado_clave = p12Clave;
        cuerpo.certificado_nombre = p12.nombre;
      }

      const actualizado = await api.put('/api/negocio', cuerpo);
      setNegocio(actualizado);
      setF({ ...VACIO, ...actualizado });
      setP12(null); setP12Clave(''); setSmtpClave(''); setEmailApiKey(''); setGmailSecret(''); setGmailRefresh('');
      if (p12Ref.current) p12Ref.current.value = '';
      toast.ok('Datos del negocio guardados');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function elegirP12(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.(p12|pfx)$/i.test(file.name)) { toast.error('El archivo debe ser .p12 o .pfx'); return; }
    try {
      setP12({ nombre: file.name, base64: await leerArchivoBase64(file) });
    } catch (err) { toast.error(err.message); }
  }

  async function quitarCertificado() {
    if (!window.confirm('¿Quitar el certificado guardado?')) return;
    try {
      const n = await api.put('/api/negocio', { certificado_p12: '' });
      setF({ ...VACIO, ...n });
      toast.ok('Certificado quitado');
    } catch (e) { toast.error(e.message); }
  }

  function cambiarSaltar(v) {
    setSaltarRecibo(v);
    localStorage.setItem('pos_saltar_recibo', v ? '1' : '0');
  }

  if (!esAdmin) return <div className="pagina"><p className="vacio">Solo el administrador puede configurar el negocio.</p></div>;

  return (
    <div className="pagina">
      <div className="pagina-cab"><h1>Datos del negocio</h1></div>

      {/* ---------- Datos generales ---------- */}
      <div className="panel" style={{ maxWidth: 720 }}>
        <div className="negocio-logo">
          <SelectorImagen valor={f.logo_url} onCambio={(v) => set('logo_url', v)} etiqueta="Subir logo" maxLado={360} />
          <p className="nota-min">Aparece en el recibo y en la factura. Imagen cuadrada o apaisada.</p>
        </div>

        <div className="form-grid">
          <label>Nombre del negocio
            <input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Boutique Carmen" />
          </label>
          <label>Nombre comercial (SRI)
            <input value={f.nombre_comercial} onChange={(e) => set('nombre_comercial', e.target.value)} placeholder="Boutique Carmen" />
          </label>
          <label>Razón social (SRI)
            <input value={f.razon_social} onChange={(e) => set('razon_social', e.target.value)} placeholder="BELECELA GUAPI JOSE DANIEL" />
          </label>
          <label>RUC
            <input value={f.ruc} inputMode="numeric" maxLength={13} placeholder="2100814264001 (13 dígitos)"
              onChange={(e) => set('ruc', e.target.value.replace(/\D/g, '').slice(0, 13))} />
            {f.ruc && f.ruc.length !== 13 && (
              <span className="nota-min peligro-txt">El RUC tiene 13 dígitos ({f.ruc.length} ahora). El RUC de persona natural = cédula + "001".</span>
            )}
          </label>
          <label>Teléfono
            <input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} placeholder="099 999 9999" />
          </label>
          <label>Correo del negocio
            <input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="ventas@minegocio.com" />
          </label>
          <label className="ancho">Dirección del establecimiento
            <input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} placeholder="Av. Principal y calle 2, local 5" />
          </label>
          <label className="ancho">Dirección matriz (SRI)
            <input value={f.dir_matriz} onChange={(e) => set('dir_matriz', e.target.value)} placeholder="La misma, si no tienes varias sucursales" />
          </label>
          <label className="ancho">Mensaje al pie del recibo
            <input value={f.mensaje_recibo} onChange={(e) => set('mensaje_recibo', e.target.value)} placeholder="¡Gracias por su compra!" />
          </label>
        </div>
      </div>

      {/* ---------- Impuestos y facturación ---------- */}
      <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
        <h2>Impuestos y facturación electrónica</h2>
        <div className="form-grid">
          <label>Ambiente SRI
            <select value={f.ambiente_sri} onChange={(e) => set('ambiente_sri', e.target.value)}>
              <option value="pruebas">Pruebas</option>
              <option value="produccion">Producción</option>
            </select>
          </label>
          <label>Régimen
            <select value={f.regimen} onChange={(e) => set('regimen', e.target.value)}>
              <option value="general">General</option>
              <option value="rimpe_emprendedor">RIMPE - Emprendedor</option>
              <option value="rimpe_popular">RIMPE - Negocio popular</option>
            </select>
          </label>
          <label>IVA de los productos
            <select value={f.iva_porcentaje} onChange={(e) => set('iva_porcentaje', e.target.value)}>
              <option value={15}>15%</option>
              <option value={5}>5%</option>
              <option value={0}>0%</option>
            </select>
          </label>
          <label>Contribuyente especial (Nro. resolución)
            <input value={f.contribuyente_especial} onChange={(e) => set('contribuyente_especial', e.target.value)} placeholder="Dejar vacío si no aplica" />
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={f.precios_incluyen_iva}
              onChange={(e) => set('precios_incluyen_iva', e.target.checked)} />
            Los precios ya incluyen IVA (PVP)
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={f.obligado_contabilidad}
              onChange={(e) => set('obligado_contabilidad', e.target.checked)} />
            Obligado a llevar contabilidad
          </label>
          <label className="check-inline ancho">
            <input type="checkbox" checked={f.emitir_factura_auto}
              onChange={(e) => set('emitir_factura_auto', e.target.checked)} />
            Emitir factura electrónica automáticamente en cada venta
          </label>
          <label className="check-inline ancho">
            <input type="checkbox" checked={f.exigir_caja}
              onChange={(e) => set('exigir_caja', e.target.checked)} />
            Exigir una caja abierta para poder registrar ventas
          </label>
        </div>
        <p className="nota-min">Si no la activas, la factura se emite con el botón "Factura electrónica" al terminar cada venta.</p>
      </div>

      {/* ---------- Firma electrónica ---------- */}
      <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
        <h2>Firma electrónica (.p12)</h2>
        {f.tiene_certificado && !p12 ? (
          <div className="cert-estado">
            <span className="estado completada">Certificado cargado</span>
            {f.certificado_nombre && <span className="nota-min"> · {f.certificado_nombre}</span>}
            <button className="btn-texto peligro" onClick={quitarCertificado}>Quitar</button>
          </div>
        ) : null}
        <div className="form-grid">
          <label>Archivo del certificado
            <input ref={p12Ref} type="file" accept=".p12,.pfx" onChange={elegirP12} />
          </label>
          <label>Contraseña de la firma
            <input type="password" value={p12Clave} onChange={(e) => setP12Clave(e.target.value)}
              placeholder={f.tiene_certificado ? '••••••••' : ''} autoComplete="new-password" />
          </label>
        </div>
        {p12 && <p className="nota-min">Se validará al guardar: <strong>{p12.nombre}</strong></p>}
      </div>

      {/* ---------- Correo saliente ---------- */}
      <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
        <h2>Correo para enviar las facturas</h2>

        <label>Cómo se envían los correos
          <select value={f.email_proveedor || 'smtp'} onChange={(e) => set('email_proveedor', e.target.value)}>
            <option value="gmail">API de Gmail — recomendado (tu cuenta actual, sin dominio ni SMS)</option>
            <option value="smtp2go">SMTP2GO (API HTTPS)</option>
            <option value="brevo">Brevo (API HTTPS)</option>
            <option value="smtp">Servidor SMTP propio / VPS</option>
          </select>
        </label>
        <p className="nota-min">
          Railway y la mayoría de servicios en la nube bloquean el envío por SMTP (puertos 25/465/587),
          por eso se usa una API HTTPS. La <strong>API de Gmail</strong> funciona con tu propia cuenta de Google
          (sin dominio propio ni verificación por SMS); requiere una configuración inicial de una sola vez.
        </p>

        {f.email_proveedor === 'gmail' ? (
          <>
            <div className="form-grid">
              <label>Client ID de OAuth
                <input value={f.gmail_client_id} onChange={(e) => set('gmail_client_id', e.target.value)}
                  placeholder="1234567890-abc...apps.googleusercontent.com" autoComplete="off" />
              </label>
              <label>Client secret {f.tiene_gmail_secret && <span className="estado completada">guardado</span>}
                <input type="password" value={gmailSecret} onChange={(e) => setGmailSecret(e.target.value)}
                  placeholder={f.tiene_gmail_secret ? '••••••••' : 'GOCSPX-...'} autoComplete="new-password" />
              </label>
              <label>Refresh token {f.tiene_gmail_refresh && <span className="estado completada">guardado</span>}
                <input type="password" value={gmailRefresh} onChange={(e) => setGmailRefresh(e.target.value)}
                  placeholder={f.tiene_gmail_refresh ? '••••••••' : '1//0g...'} autoComplete="new-password" />
              </label>
              <label>Remitente (tu dirección de Gmail)
                <input value={f.smtp_remitente} onChange={(e) => set('smtp_remitente', e.target.value)} placeholder="tucorreo@gmail.com" />
              </label>
              <label>Nombre del remitente
                <input value={f.smtp_remitente_nombre} onChange={(e) => set('smtp_remitente_nombre', e.target.value)} placeholder="Boutique Carmen" />
              </label>
            </div>
            <ol className="nota-min" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
              <li>En <strong>console.cloud.google.com</strong> crea un proyecto nuevo.</li>
              <li><strong>APIs y servicios → Biblioteca</strong>: busca <strong>Gmail API</strong> y pulsa <strong>Habilitar</strong>.</li>
              <li><strong>APIs y servicios → Pantalla de consentimiento de OAuth</strong>: tipo <em>Externo</em>, completa nombre y correos, añade el permiso <code>.../auth/gmail.send</code>, agrégate como usuario de prueba y luego pulsa <strong>Publicar la aplicación</strong> (así el token no caduca a los 7 días).</li>
              <li><strong>APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth</strong>, tipo <em>Aplicación web</em>. En <em>URIs de redireccionamiento autorizados</em> agrega <code>https://developers.google.com/oauthplayground</code>. Copia el <strong>Client ID</strong> y el <strong>Client secret</strong> aquí arriba.</li>
              <li>Abre <strong>developers.google.com/oauthplayground</strong> → engranaje (arriba der.) → marca <em>Use your own OAuth credentials</em> y pega el Client ID y el secret.</li>
              <li>En el recuadro izquierdo escribe <code>https://www.googleapis.com/auth/gmail.send</code> → <strong>Authorize APIs</strong> → inicia sesión con tu Gmail y acepta (si sale aviso de "app no verificada", continúa).</li>
              <li>Pulsa <strong>Exchange authorization code for tokens</strong> y copia el <strong>Refresh token</strong> aquí arriba.</li>
              <li>Guarda. Las facturas autorizadas se enviarán solas; las pendientes se reintentan cada pocos segundos.</li>
            </ol>
          </>
        ) : (f.email_proveedor === 'smtp2go' || f.email_proveedor === 'brevo') ? (
          <>
            <div className="form-grid">
              <label>
                Clave API de {f.email_proveedor === 'smtp2go' ? 'SMTP2GO' : 'Brevo'}
                {f.tiene_email_api_key && <span className="estado completada">guardada</span>}
                <input type="password" value={emailApiKey} onChange={(e) => setEmailApiKey(e.target.value)}
                  placeholder={f.tiene_email_api_key ? '••••••••' : (f.email_proveedor === 'smtp2go' ? 'api-XXXXXXXX...' : 'xkeysib-...')}
                  autoComplete="new-password" />
              </label>
              <label>Remitente (correo verificado en {f.email_proveedor === 'smtp2go' ? 'SMTP2GO' : 'Brevo'})
                <input value={f.smtp_remitente} onChange={(e) => set('smtp_remitente', e.target.value)} placeholder="tucorreo@gmail.com" />
              </label>
              <label>Nombre del remitente
                <input value={f.smtp_remitente_nombre} onChange={(e) => set('smtp_remitente_nombre', e.target.value)} placeholder="Boutique Carmen" />
              </label>
            </div>
            {f.email_proveedor === 'smtp2go' ? (
              <ol className="nota-min" style={{ paddingLeft: 18, lineHeight: 1.5 }}>
                <li>Crea una cuenta gratis en <strong>smtp2go.com</strong> (solo pide correo, sin teléfono).</li>
                <li>Menú <strong>Sending → Verified Senders → Single Sender Emails</strong>: agrega tu correo (el mismo del campo "Remitente") y confírmalo con el enlace que te llega.</li>
                <li>Menú <strong>Settings → API Keys → Add API Key</strong>: crea una clave con permiso de envío y pégala arriba (empieza con <code>api-</code>).</li>
                <li>Guarda. Las facturas autorizadas se enviarán solas; las pendientes se reintentan cada pocos segundos.</li>
              </ol>
            ) : (
              <ol className="nota-min" style={{ paddingLeft: 18, lineHeight: 1.5 }}>
                <li>Crea una cuenta gratis en <strong>brevo.com</strong>.</li>
                <li>En <strong>Senders, Domains &amp; Dedicated IPs → Senders</strong> agrega tu correo (el mismo del campo "Remitente") y confírmalo con el enlace que te llega.</li>
                <li>En <strong>menú de tu cuenta → SMTP &amp; API → API Keys</strong> genera una clave nueva y pégala arriba (empieza con <code>xkeysib-</code>).</li>
                <li>Guarda. Las facturas autorizadas se enviarán solas; las pendientes se reintentan cada pocos segundos.</li>
              </ol>
            )}
          </>
        ) : (
          <>
            <div className="form-grid">
              <label>Servidor (host)
                <input value={f.smtp_host} onChange={(e) => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com" />
              </label>
              <label>Puerto
                <input type="number" value={f.smtp_port} onChange={(e) => set('smtp_port', e.target.value)} placeholder="587" />
              </label>
              <label>Usuario
                <input value={f.smtp_usuario} onChange={(e) => set('smtp_usuario', e.target.value)} placeholder="tucorreo@gmail.com" autoComplete="off" />
              </label>
              <label>Contraseña {f.tiene_smtp_clave && <span className="estado completada">guardada</span>}
                <input type="password" value={smtpClave} onChange={(e) => setSmtpClave(e.target.value)}
                  placeholder={f.tiene_smtp_clave ? '••••••••' : 'contraseña de aplicación'} autoComplete="new-password" />
              </label>
              <label>Remitente (correo que aparece)
                <input value={f.smtp_remitente} onChange={(e) => set('smtp_remitente', e.target.value)} placeholder="tucorreo@gmail.com" />
              </label>
              <label>Nombre del remitente
                <input value={f.smtp_remitente_nombre} onChange={(e) => set('smtp_remitente_nombre', e.target.value)} placeholder="Boutique Carmen" />
              </label>
              <label className="check-inline ancho">
                <input type="checkbox" checked={f.smtp_seguro} onChange={(e) => set('smtp_seguro', e.target.checked)} />
                Conexión SSL (puerto 465). Si usas 587 déjalo desmarcado.
              </label>
            </div>
            <p className="nota-min">Gmail: activa la verificación en 2 pasos y crea una "contraseña de aplicación". No funciona en Railway (puertos SMTP bloqueados).</p>
          </>
        )}
      </div>

      <div className="modal-acciones" style={{ maxWidth: 720 }}>
        <button className="btn-primario" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar todo'}
        </button>
      </div>

      {/* ---------- Recibo ---------- */}
      <div className="panel" style={{ maxWidth: 720, marginTop: 16 }}>
        <h2>Recibo al cobrar</h2>
        <label className="check-inline">
          <input type="checkbox" checked={saltarRecibo} onChange={(e) => cambiarSaltar(e.target.checked)} />
          No mostrar las opciones de recibo al terminar una venta (cobro rápido)
        </label>
      </div>
    </div>
  );
}

import { Router } from 'express';
import forge from 'node-forge';
import { consulta } from '../db/pool.js';
import { autenticar, requiereRol } from '../middleware/auth.js';
import { ErrorHttp } from '../middleware/errores.js';
import { cifrar } from '../sri/cifrado.js';

const router = Router();
router.use(autenticar);

// Campos de texto/numéricos/booleanos que el admin edita directamente.
const CAMPOS = [
  'nombre', 'razon_social', 'ruc', 'direccion', 'telefono', 'email',
  'logo_url', 'mensaje_recibo',
  'dir_matriz', 'nombre_comercial', 'contribuyente_especial', 'regimen',
  'iva_porcentaje', 'precios_incluyen_iva', 'emitir_factura_auto',
  'obligado_contabilidad', 'ambiente_sri', 'exigir_caja',
  'smtp_host', 'smtp_port', 'smtp_seguro', 'smtp_usuario', 'smtp_remitente', 'smtp_remitente_nombre',
  'email_proveedor', 'gmail_client_id',
];
const ANULABLES = new Set([
  'razon_social', 'ruc', 'direccion', 'telefono', 'email', 'logo_url', 'mensaje_recibo',
  'dir_matriz', 'nombre_comercial', 'contribuyente_especial',
  'smtp_host', 'smtp_usuario', 'smtp_remitente', 'smtp_remitente_nombre', 'gmail_client_id',
]);

// No se devuelven al frontend (secretos): certificado_p12, certificado_clave_cif,
// smtp_clave_cif, email_api_key_cif, gmail_client_secret_cif, gmail_refresh_token_cif
function limpiarNegocio(n) {
  if (!n) return {};
  const {
    certificado_p12, certificado_clave_cif, smtp_clave_cif, email_api_key_cif,
    gmail_client_secret_cif, gmail_refresh_token_cif, ...resto
  } = n;
  return {
    ...resto,
    tiene_certificado: !!certificado_p12,
    tiene_smtp_clave: !!smtp_clave_cif,
    tiene_email_api_key: !!email_api_key_cif,
    tiene_gmail_secret: !!gmail_client_secret_cif,
    tiene_gmail_refresh: !!gmail_refresh_token_cif,
  };
}

// GET /api/negocio
router.get('/', async (_req, res) => {
  const { rows } = await consulta(`SELECT * FROM negocio WHERE id = 1`);
  res.json(limpiarNegocio(rows[0]));
});

// PUT /api/negocio  — solo admin
router.put('/', requiereRol('admin'), async (req, res) => {
  const sets = [];
  const valores = [];

  for (const campo of CAMPOS) {
    if (req.body[campo] === undefined) continue;
    let v = req.body[campo];
    if (campo === 'ruc' && v) {
      v = String(v).replace(/\D/g, '');
      if (v.length !== 13) {
        throw new ErrorHttp(400, `El RUC debe tener 13 dígitos (recibí ${v.length}). El RUC de persona natural es la cédula + "001".`);
      }
    }
    if (campo === 'email_proveedor') {
      v = String(v || 'smtp').trim().toLowerCase();
      if (!['smtp', 'brevo', 'smtp2go', 'gmail'].includes(v)) v = 'smtp';
    }
    if (ANULABLES.has(campo)) v = v || null;
    valores.push(v);
    sets.push(`${campo} = $${valores.length}`);
  }

  // Certificado .p12 (base64) + su contraseña -> se valida y se cifra
  if (req.body.certificado_p12 !== undefined) {
    const b64 = String(req.body.certificado_p12 || '').replace(/^data:.*;base64,/, '');
    const clave = req.body.certificado_clave ?? '';
    if (b64) {
      try {
        const der = forge.util.decode64(b64);
        const asn1 = forge.asn1.fromDer(der);
        forge.pkcs12.pkcs12FromAsn1(asn1, String(clave)); // lanza si la clave no sirve
      } catch {
        throw new ErrorHttp(400, 'No se pudo abrir el certificado con esa contraseña. Verifica el archivo .p12 y la clave.');
      }
      valores.push(b64); sets.push(`certificado_p12 = $${valores.length}`);
      valores.push(cifrar(String(clave))); sets.push(`certificado_clave_cif = $${valores.length}`);
      if (req.body.certificado_nombre) {
        valores.push(String(req.body.certificado_nombre)); sets.push(`certificado_nombre = $${valores.length}`);
      }
    } else {
      // cadena vacía = quitar certificado
      sets.push('certificado_p12 = NULL', 'certificado_clave_cif = NULL', 'certificado_nombre = NULL');
    }
  }

  // Contraseña SMTP (solo si viene; cadena vacía = quitar)
  if (req.body.smtp_clave !== undefined) {
    if (req.body.smtp_clave) {
      valores.push(cifrar(String(req.body.smtp_clave)));
      sets.push(`smtp_clave_cif = $${valores.length}`);
    } else {
      sets.push('smtp_clave_cif = NULL');
    }
  }

  // Clave API de Brevo / SMTP2GO (solo si viene; cadena vacía = quitar)
  if (req.body.email_api_key !== undefined) {
    if (req.body.email_api_key) {
      valores.push(cifrar(String(req.body.email_api_key).trim()));
      sets.push(`email_api_key_cif = $${valores.length}`);
    } else {
      sets.push('email_api_key_cif = NULL');
    }
  }

  // Credenciales OAuth de Gmail (client secret y refresh token; cadena vacía = quitar)
  if (req.body.gmail_client_secret !== undefined) {
    if (req.body.gmail_client_secret) {
      valores.push(cifrar(String(req.body.gmail_client_secret).trim()));
      sets.push(`gmail_client_secret_cif = $${valores.length}`);
    } else {
      sets.push('gmail_client_secret_cif = NULL');
    }
  }
  if (req.body.gmail_refresh_token !== undefined) {
    if (req.body.gmail_refresh_token) {
      valores.push(cifrar(String(req.body.gmail_refresh_token).trim()));
      sets.push(`gmail_refresh_token_cif = $${valores.length}`);
    } else {
      sets.push('gmail_refresh_token_cif = NULL');
    }
  }

  if (sets.length === 0) {
    const { rows } = await consulta(`SELECT * FROM negocio WHERE id = 1`);
    return res.json(limpiarNegocio(rows[0]));
  }

  const { rows } = await consulta(
    `UPDATE negocio SET ${sets.join(', ')}, actualizado_en = now() WHERE id = 1 RETURNING *`,
    valores,
  );
  res.json(limpiarNegocio(rows[0]));
});

export default router;

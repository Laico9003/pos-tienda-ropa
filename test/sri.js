/*
 * Prueba de la Fase SRI SIN conexión al SRI:
 *   - dígito verificador y clave de acceso (49 dígitos)
 *   - construcción del XML de la factura (open-factura)
 *   - firma XAdES-BES con un .p12 autogenerado
 *   - generación del RIDE (PDF)
 *   - cifrado/descifrado de secretos
 *
 *   node test/sri.js
 */
import forge from 'node-forge';
import { signInvoiceXml } from 'ec-sri-invoice-signer';
import { facturaXml } from '../src/sri/xml.js';
import { generarClaveAcceso, digitoVerificador } from '../src/sri/claveAcceso.js';
import { construirFactura } from '../src/sri/construirFactura.js';
import { generarRidePDF } from '../src/sri/ride.js';
import { cifrar, descifrar } from '../src/sri/cifrado.js';
import { ok, igual, resumen } from './helpers.js';

// -- .p12 autofirmado para poder probar la firma --
function generarP12(password) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 864e5);
  const attrs = [{ name: 'commonName', value: 'PRUEBA SRI' }, { name: 'organizationName', value: 'Demo' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  const der = forge.asn1.toDer(asn1).getBytes();
  return Buffer.from(forge.util.encode64(der), 'base64');
}

async function main() {
  console.log('— Dígito verificador / clave de acceso —');
  igual(digitoVerificador('123456789012345678901234567890123456789012345678'), 7, 'dígito verificador conocido');

  const clave = generarClaveAcceso({
    fecha: new Date('2026-08-28T10:00:00'),
    codDoc: '01', ruc: '1790012345001', ambiente: '1',
    estab: '001', ptoEmi: '001', secuencial: '000000123',
    codigoNumerico: '12345678',
  });
  ok(clave.length === 49, 'clave de acceso tiene 49 dígitos', clave.length);
  ok(/^\d{49}$/.test(clave), 'clave de acceso es numérica');
  ok(clave.startsWith('28082026' + '01' + '1790012345001' + '1' + '001' + '001' + '000000123' + '12345678' + '1'),
    'clave de acceso arma bien los campos', clave);

  console.log('\n— Construcción y firma del XML —');
  const negocio = {
    nombre: 'Boutique Carmen', razon_social: 'CARMEN LOPEZ', nombre_comercial: 'Boutique Carmen',
    ruc: '1790012345001', direccion: 'Av. Principal 123', dir_matriz: 'Av. Principal 123',
    obligado_contabilidad: false, iva_porcentaje: 15, precios_incluyen_iva: true, regimen: 'general',
  };
  const venta = {
    id: 42, creado_en: '2026-08-28T10:00:00', total: 41.7, subtotal: 43.7, descuento_total: 2,
    cliente_nombre: 'Ana Pérez', cliente_identificacion: '1712345678', cliente_email: 'ana@example.com',
    cliente_direccion: 'Calle 5', vendedor: 'Vera',
  };
  const items = [
    { variante_id: 1, descripcion: 'Blusa manga larga - M / Rojo', codigo_barras: '78600100001', cantidad: 2, precio_unitario: 14.9, descuento: 1, total_linea: 28.8 },
    { variante_id: 5, descripcion: 'Vestido casual - S / Azul', codigo_barras: '78600100008', cantidad: 1, precio_unitario: 14.9, descuento: 0, total_linea: 14.9 },
  ];
  const pagos = [{ metodo: 'efectivo', monto: 20 }, { metodo: 'transferencia', monto: 21.7 }];
  const comprobante = { ambiente: '1', estab: '001', pto_emi: '001', secuencial: '000000042' };

  const { invoice, claveAcceso, resumen: r } = construirFactura({ venta, items, pagos, negocio, comprobante });
  ok(claveAcceso.length === 49, 'construirFactura genera clave de 49', claveAcceso.length);
  ok(invoice.factura['@version'] === '1.1.0', 'versión de factura = 1.1.0');
  ok(Math.abs(r.importeTotal - 41.7) < 0.02, 'importe total ≈ total de la venta', r);
  ok(Math.abs((r.totalSinImpuestos + r.totalIva) - r.importeTotal) < 0.001, 'base + IVA = importe total', r);

  const xml = facturaXml(invoice);
  ok(xml.includes('<factura') && xml.includes('claveAcceso') && xml.includes('<pago>'), 'XML contiene factura, claveAcceso y pagos');
  ok(xml.includes('<totalSinImpuestos>') && xml.includes('<importeTotal>'), 'XML contiene totales');
  ok(!xml.includes('xmlns:ds'), 'el nodo raíz no lleva xmlns:ds (lo agrega la firma)');

  const p12 = generarP12('test123');
  const firmado = signInvoiceXml(xml, p12, { pkcs12Password: 'test123' });
  ok(firmado.includes('<ds:Signature') && firmado.includes('SignedProperties'), 'XML firmado (XAdES-BES) contiene la firma');
  ok(firmado.includes('X509Certificate') && firmado.includes('<ds:SignatureValue'), 'la firma incluye certificado X509 y SignatureValue');
  ok(firmado.includes('http://www.w3.org/2000/09/xmldsig#') && !firmado.includes('xmldisg'), 'namespace ds correcto (sin typo)');

  console.log('\n— RIDE (PDF) —');
  const pdf = await generarRidePDF({
    negocio, venta: { ...venta, items, pagos },
    comprobante: { ...comprobante, clave_acceso: claveAcceso, numero_autorizacion: claveAcceso, fecha_autorizacion: new Date() },
    resumen: r,
  });
  ok(Buffer.isBuffer(pdf) && pdf.length > 800, 'RIDE es un PDF con contenido', pdf.length);
  ok(pdf.slice(0, 4).toString() === '%PDF', 'RIDE empieza con %PDF');

  console.log('\n— Cifrado de secretos —');
  const cif = cifrar('MiClaveSuperSecreta#2026');
  ok(cif && cif.split(':').length === 3, 'cifrar produce iv:tag:datos');
  igual(descifrar(cif), 'MiClaveSuperSecreta#2026', 'descifrar recupera el original');
  igual(descifrar('basura'), '', 'descifrar de basura devuelve vacío');

  process.exit(resumen() ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

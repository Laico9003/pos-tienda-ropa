import { create } from 'xmlbuilder2';

/** Serializa el objeto `invoice` ({ factura: {...} }) al XML del comprobante. */
export function facturaXml(invoice) {
  return create({ version: '1.0', encoding: 'UTF-8' }, invoice).end({ prettyPrint: false });
}

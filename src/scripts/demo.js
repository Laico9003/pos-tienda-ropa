/*
 * Carga datos de DEMO (productos, stock y algunas ventas) para probar la interfaz.
 * Requiere que ya existan las tablas y el admin.
 *
 *   npm run demo
 */
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';

async function main() {
  // Reinicia los datos para poder correr la demo varias veces sin duplicar.
  await pool.query(`TRUNCATE
    movimientos_inventario, pagos, venta_items, ventas,
    stock, producto_variantes, productos
    RESTART IDENTITY CASCADE`);
  console.log('Datos anteriores limpiados.');

  // Asegura tiendas y usuarios
  await pool.query(
    `INSERT INTO tiendas (nombre, codigo_establecimiento, punto_emision)
     VALUES ('Tienda Centro','001','001'), ('Tienda Norte','002','001')
     ON CONFLICT (codigo_establecimiento) DO NOTHING`,
  );
  const hash = await bcrypt.hash('admin123', 10);
  await pool.query(
    `INSERT INTO usuarios (tienda_id, nombre, email, password_hash, rol) VALUES
      (1,'Admin','admin@tienda.com',$1,'admin'),
      (1,'Vera Vendedora','vera@tienda.com',$1,'vendedor'),
      (1,'Beto Bodega','beto@tienda.com',$1,'bodega')
     ON CONFLICT (email) DO NOTHING`,
    [hash],
  );

  const cat = {};
  for (const nombre of ['Blusas', 'Vestidos', 'Pantalones', 'Zapatos', 'Accesorios']) {
    const { rows } = await pool.query(
      `INSERT INTO categorias (nombre) VALUES ($1)
       ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`,
      [nombre],
    );
    cat[nombre] = rows[0].id;
  }

  const productos = [
    { nombre: 'Blusa manga larga', categoria: 'Blusas', pc: 6.5, pv: 15.9,
      variantes: [['S', 'Blanco'], ['M', 'Blanco'], ['M', 'Negro'], ['L', 'Negro']] },
    { nombre: 'Blusa gasa floral', categoria: 'Blusas', pc: 7, pv: 18.5,
      variantes: [['S', 'Rosa'], ['M', 'Rosa'], ['L', 'Rosa']] },
    { nombre: 'Vestido casual', categoria: 'Vestidos', pc: 12, pv: 32,
      variantes: [['S', 'Azul'], ['M', 'Azul'], ['M', 'Verde'], ['L', 'Verde']] },
    { nombre: 'Vestido de noche', categoria: 'Vestidos', pc: 22, pv: 55,
      variantes: [['S', 'Negro'], ['M', 'Negro']] },
    { nombre: 'Jean skinny', categoria: 'Pantalones', pc: 14, pv: 29.9,
      variantes: [['28', 'Celeste'], ['30', 'Celeste'], ['32', 'Celeste'], ['30', 'Negro']] },
    { nombre: 'Pantalón palazzo', categoria: 'Pantalones', pc: 11, pv: 26,
      variantes: [['S', 'Beige'], ['M', 'Beige'], ['L', 'Beige']] },
    { nombre: 'Sandalia plataforma', categoria: 'Zapatos', pc: 13, pv: 28,
      variantes: [['36', 'Café'], ['37', 'Café'], ['38', 'Café'], ['39', 'Negro']] },
    { nombre: 'Cinturón cuero', categoria: 'Accesorios', pc: 4, pv: 12,
      variantes: [['Único', 'Café'], ['Único', 'Negro']] },
    { nombre: 'Bufanda tejida', categoria: 'Accesorios', pc: 5, pv: 14,
      variantes: [['Único', 'Gris'], ['Único', 'Mostaza']] },
  ];

  let cb = 100000;
  const variantesTodas = [];
  for (const p of productos) {
    const { rows } = await pool.query(
      `INSERT INTO productos (nombre, categoria_id, descripcion) VALUES ($1,$2,$3) RETURNING id`,
      [p.nombre, cat[p.categoria], null],
    );
    const prodId = rows[0].id;
    for (const [talla, color] of p.variantes) {
      cb += 1;
      const { rows: vr } = await pool.query(
        `INSERT INTO producto_variantes (producto_id, talla, color, codigo_barras, precio_compra, precio_venta)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [prodId, talla, color, `78600${cb}`, p.pc, p.pv],
      );
      const varId = vr[0].id;
      const cantidad = 3 + Math.floor(Math.random() * 15);
      await pool.query(
        `INSERT INTO stock (variante_id, tienda_id, cantidad) VALUES ($1,1,$2)`,
        [varId, cantidad],
      );
      await pool.query(
        `INSERT INTO movimientos_inventario (variante_id, tienda_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, referencia, usuario_id)
         VALUES ($1,1,'entrada',$2,0,$2,'Stock inicial demo',1)`,
        [varId, cantidad],
      );
      variantesTodas.push({ id: varId, pv: Number(p.pv), desc: `${p.nombre} - ${talla} / ${color}` });
    }
  }

  const nombresCliente = [null, 'Ana Pérez', 'Carmen Quispe', 'Pedro Condori', 'Lucía Rojas', 'María Suárez'];

  // Ventas repartidas en los últimos ~5 meses (para que los gráficos tengan historia).
  // Sólo las de la última semana descuentan stock (el stock refleja "hoy").
  for (let d = 150; d >= 0; d--) {
    // más ventas en días recientes; en meses viejos, sólo algunos días con ventas
    const cuantas = d <= 7
      ? 2 + Math.floor(Math.random() * 3)
      : d <= 45
        ? 1 + Math.floor(Math.random() * 2)
        : (Math.random() < 0.55 ? 1 + Math.floor(Math.random() * 2) : 0);
    for (let k = 0; k < cuantas; k++) {
      const nLineas = 1 + Math.floor(Math.random() * 2);
      const lineas = [];
      let subtotal = 0;
      for (let li = 0; li < nLineas; li++) {
        const item = variantesTodas[Math.floor(Math.random() * variantesTodas.length)];
        const cantidad = 1 + Math.floor(Math.random() * 2);
        const totalLinea = Number((item.pv * cantidad).toFixed(2));
        lineas.push({ item, cantidad, totalLinea });
        subtotal += totalLinea;
      }
      subtotal = Number(subtotal.toFixed(2));

      const descuenta = d <= 7;
      if (descuenta) {
        // valida stock para las ventas recientes
        let ok = true;
        for (const l of lineas) {
          const { rows: st } = await pool.query(
            `SELECT cantidad FROM stock WHERE variante_id=$1 AND tienda_id=1`, [l.item.id],
          );
          if (!st[0] || st[0].cantidad < l.cantidad) { ok = false; break; }
        }
        if (!ok) continue;
      }

      const cliente = nombresCliente[Math.floor(Math.random() * nombresCliente.length)];
      const { rows: vr } = await pool.query(
        `INSERT INTO ventas (tienda_id, usuario_id, cliente_nombre, subtotal, descuento_total, total, total_pagado, cambio, creado_en)
         VALUES (1,2,$1,$2,0,$2,$2,0, now() - ($3 || ' days')::interval - (random()*8 || ' hours')::interval) RETURNING id`,
        [cliente || 'Consumidor final', subtotal, d],
      );
      const ventaId = vr[0].id;
      for (const l of lineas) {
        await pool.query(
          `INSERT INTO venta_items (venta_id, variante_id, descripcion, cantidad, precio_unitario, descuento, total_linea)
           VALUES ($1,$2,$3,$4,$5,0,$6)`,
          [ventaId, l.item.id, l.item.desc, l.cantidad, l.item.pv, l.totalLinea],
        );
        if (descuenta) {
          const { rows: st } = await pool.query(
            `SELECT cantidad FROM stock WHERE variante_id=$1 AND tienda_id=1`, [l.item.id],
          );
          await pool.query(`UPDATE stock SET cantidad = cantidad - $1 WHERE variante_id=$2 AND tienda_id=1`, [l.cantidad, l.item.id]);
          await pool.query(
            `INSERT INTO movimientos_inventario (variante_id, tienda_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, referencia, venta_id, usuario_id)
             VALUES ($1,1,'venta',$2,$3,$4,$5,$6,2)`,
            [l.item.id, l.cantidad, st[0].cantidad, st[0].cantidad - l.cantidad, `Venta #${ventaId}`, ventaId],
          );
        }
      }
      const metodo = Math.random() > 0.45 ? 'efectivo' : 'transferencia';
      await pool.query(`INSERT INTO pagos (venta_id, metodo, monto) VALUES ($1,$2,$3)`, [ventaId, metodo, subtotal]);
    }
  }

  console.log('Datos de demo cargados.');
  console.log('  admin@tienda.com / admin123   (administrador)');
  console.log('  vera@tienda.com  / admin123   (vendedor)');
  console.log('  beto@tienda.com  / admin123   (bodega)');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

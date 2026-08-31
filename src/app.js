import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import usuariosRoutes from './routes/usuarios.js';
import tiendasRoutes from './routes/tiendas.js';
import negocioRoutes from './routes/negocio.js';
import categoriasRoutes from './routes/categorias.js';
import productosRoutes from './routes/productos.js';
import inventarioRoutes from './routes/inventario.js';
import ventasRoutes from './routes/ventas.js';
import reportesRoutes from './routes/reportes.js';
import comprobantesRoutes from './routes/comprobantes.js';
import cajasRoutes from './routes/cajas.js';
import clientesRoutes from './routes/clientes.js';
import { noEncontrado, manejadorErrores } from './middleware/errores.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(dir, '..', 'frontend', 'dist');

export function crearApp() {
  const app = express();
  app.use(cors());
  // límite alto: las fotos de producto viajan como data URI dentro del JSON
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/salud', (_req, res) => {
    res.json({ estado: 'ok', hora: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/usuarios', usuariosRoutes);
  app.use('/api/tiendas', tiendasRoutes);
  app.use('/api/negocio', negocioRoutes);
  app.use('/api/categorias', categoriasRoutes);
  app.use('/api/productos', productosRoutes);
  app.use('/api/inventario', inventarioRoutes);
  app.use('/api/ventas', ventasRoutes);
  app.use('/api/reportes', reportesRoutes);
  app.use('/api/comprobantes', comprobantesRoutes);
  app.use('/api/cajas', cajasRoutes);
  app.use('/api/clientes', clientesRoutes);

  // ---- Frontend compilado (en producción se sirve desde el mismo servidor) ----
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distDir, 'index.html'), (err) => (err ? next() : undefined));
    });
  }

  app.use(noEncontrado);
  app.use(manejadorErrores);

  return app;
}

# POS Tienda de Ropa — Frontend

Interfaz del punto de venta. **React + Vite** (JavaScript).

## Puesta en marcha (desarrollo)

Con el backend corriendo en `http://localhost:3000`:

```bash
cd frontend
npm install
npm run dev
```

Abre `http://localhost:5173`. En desarrollo, `/api` se redirige al backend
mediante el proxy de Vite (ver `vite.config.js`). Si tu backend está en otro
puerto: `VITE_API_PROXY=http://localhost:4000 npm run dev`.

### Usuarios de prueba (tras `npm run demo` en el backend)

| Rol | Correo | Clave |
|---|---|---|
| Administrador | admin@tienda.com | admin123 |
| Vendedor | vera@tienda.com | admin123 |
| Bodega | beto@tienda.com | admin123 |

## Compilar para producción

```bash
npm run build      # genera frontend/dist/
```

`dist/` es un sitio estático. Se puede publicar en Netlify / Vercel /
Cloudflare Pages, o servirlo desde el mismo servidor del backend.
Define la URL del backend con la variable `VITE_API_URL` antes de compilar:

```bash
VITE_API_URL=https://api.mitienda.com npm run build
```

## Pantallas

| Ruta | Descripción |
|---|---|
| `/venta` | Punto de venta: catálogo, categorías, buscador con lector de código de barras, carrito, descuentos, pago mixto efectivo/transferencia y cambio |
| `/dashboard` | KPIs del día y del mes, ventas de 7 días, pagos por método, productos más vendidos, stock bajo |
| `/productos` | Productos con variantes (talla/color), precios, activar/desactivar, y gestión de categorías |
| `/inventario` | Stock, ingreso de mercadería por código de barras, ajustes y kardex de movimientos (rol admin/bodega) |
| `/ventas` | Historial con filtro por fechas, detalle de cada venta y anulación (rol admin) |
| `/usuarios` | Alta y edición de usuarios y tiendas (rol admin) |

El token JWT se guarda en `localStorage`; ante un `401` la sesión se cierra sola.

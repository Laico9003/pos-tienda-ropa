# POS Tienda de Ropa — Backend

Sistema de punto de venta e inventario para tienda de ropa, con soporte para
**2 tiendas centralizadas bajo el mismo RUC** (una sola base de datos).

Stack: **Node.js + Express 5 + PostgreSQL** (JavaScript, sin framework pesado).

---

## Fase 1 — incluida en este backend

- Productos con **variantes** (talla / color), código de barras, precio de compra y de venta.
- **Categorías** administrables (crear / editar / eliminar) desde la API.
- **Inventario por tienda**: ingresos suben stock, ventas lo descuentan, con **kardex** de movimientos.
- **Ventas** con:
  - Descuento por línea y descuento a nivel de venta.
  - **Pagos mixtos** efectivo + transferencia (se guarda el valor por método).
  - Validación de stock (no se puede vender sin existencias).
  - Transacción atómica y bloqueo de stock para evitar sobreventa.
  - Anulación de venta (repone stock).
- **Roles**: `admin`, `vendedor`, `bodega`.
- **Dashboard / reportes**: ventas del día, ticket promedio, ventas por método de pago,
  productos más vendidos, ventas de los últimos 7 días, stock bajo, resumen del mes.
- Búsqueda de producto por **código de barras** (para lector físico).

### Preparado para la Fase 2 (facturación electrónica SRI)

La tabla `ventas` ya tiene `numero_comprobante`, `clave_acceso` y `estado_sri`.
La Fase 2 será un módulo aparte (cola de trabajos + firma XAdES-BES con el `.p12` +
envío a los web services del SRI + RIDE por correo), sin rediseñar lo actual.

---

## Instalación local

```bash
npm install
cp .env.example .env      # edita JWT_SECRET (y DATABASE_URL si usas tu propio PostgreSQL)
```

### Opción A — sin instalar PostgreSQL (recomendada para desarrollo)

Trae un PostgreSQL embebido (se descarga solo la primera vez, queda en `.pgdata-local/`).

```bash
npm run db:local         # deja la base corriendo en el puerto 55432 (Ctrl+C para parar)
```
En el `.env`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pos_tienda_ropa
```
En **otra terminal**:
```bash
npm run migrar
npm run crear-admin
npm run dev
```

### Opción B — con tu propio PostgreSQL

```sql
CREATE DATABASE pos_tienda_ropa;
```
Completa `DATABASE_URL` en `.env` y luego `npm run migrar && npm run crear-admin && npm run dev`.

El servidor queda en `http://localhost:3000`. Prueba: `GET /api/salud`.

### Datos de demostración

```bash
npm run demo             # carga productos, stock y ventas de ejemplo + 3 usuarios de prueba
```

### Pruebas

```bash
npm test                 # prueba de integración de punta a punta (levanta su propia base)
```
Cubre login/roles, productos con variantes, código de barras, inventario, venta con
pago mixto, descuentos, dashboard, anulación y control de sobreventa en concurrencia.

### Interfaz (frontend)

La interfaz del punto de venta está en [`frontend/`](frontend/) (React + Vite).
Con el backend corriendo:

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173
```

---

## Roles y permisos

| Acción | admin | vendedor | bodega |
|---|:--:|:--:|:--:|
| Iniciar sesión | ✅ | ✅ | ✅ |
| Ver productos / buscar por código | ✅ | ✅ | ✅ |
| Registrar ventas | ✅ | ✅ | ❌ |
| Anular ventas | ✅ | ❌ | ❌ |
| Crear/editar productos, variantes y categorías | ✅ | ❌ | ✅ |
| Ingresos y ajustes de inventario | ✅ | ✅* | ✅ |
| Gestionar usuarios y tiendas | ✅ | ❌ | ❌ |
| Ver dashboard | ✅ (cualquier tienda) | ✅ (su tienda) | ✅ (su tienda) |

Los usuarios `vendedor` y `bodega` quedan **fijados a su tienda**; el `admin` puede
consultar cualquier tienda pasando `?tienda_id=` (o `tienda_id` en el body).
\* Los ingresos/ajustes de inventario los hace `admin` o `bodega`.

---

## Endpoints

Todas las rutas (menos `login` y `salud`) requieren cabecera
`Authorization: Bearer <token>`.

### Auth
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` → `{ token, usuario }` |
| GET | `/api/auth/perfil` | Datos del usuario del token |

### Usuarios y tiendas (admin)
| Método | Ruta | Descripción |
|---|---|---|
| GET/POST | `/api/usuarios` | Listar / crear usuarios |
| PUT | `/api/usuarios/:id` | Editar (nombre, rol, tienda, activo, password) |
| GET | `/api/tiendas` | Listar tiendas (cualquier usuario) |
| POST/PUT | `/api/tiendas` `/api/tiendas/:id` | Crear / editar tienda (admin) |

### Categorías
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/categorias` | Listar (`?incluir_inactivas=true`) |
| POST | `/api/categorias` | `{ nombre }` |
| PUT | `/api/categorias/:id` | `{ nombre?, activo? }` |
| DELETE | `/api/categorias/:id` | Elimina; si tiene productos, la desactiva |

### Productos
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/productos` | `?q=&categoria_id=&activo=&pagina=&limite=` con stock de la tienda |
| GET | `/api/productos/buscar?codigo=XXX` | Buscar variante por código de barras / SKU |
| GET | `/api/productos/:id` | Detalle + stock por tienda |
| POST | `/api/productos` | Crea producto + variantes (ver ejemplo abajo) |
| PUT | `/api/productos/:id` | Editar datos del producto |
| POST | `/api/productos/:id/variantes` | Añadir una variante |
| PUT | `/api/productos/variantes/:varianteId` | Editar precios / datos de la variante |

### Inventario
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/inventario/entrada` | `{ tienda_id?, referencia?, items:[{variante_id,cantidad,costo_unitario?}] }` |
| POST | `/api/inventario/ajuste` | `{ variante_id, cantidad_nueva, motivo }` |
| GET | `/api/inventario/stock` | Stock actual de la tienda |
| GET | `/api/inventario/stock-bajo?umbral=5` | Variantes con poco stock |
| GET | `/api/inventario/movimientos` | Kardex `?variante_id=&tipo=&desde=&hasta=` |

### Ventas
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/ventas` | Registrar venta (ver ejemplo abajo) |
| GET | `/api/ventas` | Historial `?desde=&hasta=&usuario_id=&estado=&pagina=` |
| GET | `/api/ventas/:id` | Detalle con ítems y pagos |
| POST | `/api/ventas/:id/anular` | `{ motivo }` — repone stock (admin) |

### Reportes
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/reportes/dashboard` | Todo el panel en una llamada (`?tienda_id=&dias=`) |
| GET | `/api/reportes/ventas-por-dia` | `?desde=&hasta=` |
| GET | `/api/reportes/top-productos` | `?desde=&hasta=&limite=` |
| GET | `/api/reportes/ventas-por-metodo` | `?desde=&hasta=` |

---

## Ejemplos

### Crear un producto con variantes
```json
POST /api/productos
{
  "nombre": "Blusa manga larga",
  "categoria_id": 1,
  "descripcion": "Algodón",
  "variantes": [
    { "talla": "S", "color": "Rojo",  "codigo_barras": "7860001", "precio_compra": 6.5, "precio_venta": 14.9,
      "stock_inicial": [{ "tienda_id": 1, "cantidad": 10 }] },
    { "talla": "M", "color": "Rojo",  "codigo_barras": "7860002", "precio_compra": 6.5, "precio_venta": 14.9 }
  ]
}
```

### Registrar una venta con pago mixto
```json
POST /api/ventas
{
  "cliente": { "nombre": "Consumidor final", "identificacion": "9999999999999" },
  "items": [
    { "variante_id": 1, "cantidad": 2, "descuento": 1.00 },
    { "variante_id": 5, "cantidad": 1 }
  ],
  "descuento_total": 2.00,
  "pagos": [
    { "metodo": "efectivo", "monto": 20.00 },
    { "metodo": "transferencia", "monto": 30.00, "referencia": "Banco Pichincha 0012345" }
  ]
}
```
La API valida stock, calcula `subtotal`, `total`, `cambio` y descuenta inventario
en una sola transacción.

---

## Despliegue

Un backend Node + PostgreSQL **no funciona en hosting compartido tipo cPanel**.
Opciones:

- **PaaS (más fácil):** Railway o Render. Subes el repo, agregas un PostgreSQL,
  defines las variables de entorno (`DATABASE_URL`, `JWT_SECRET`, `DATABASE_SSL=true`),
  y corres `npm run migrar` una vez. ~$5–15/mes.
- **VPS Linux (más económico):** Hetzner / DigitalOcean / Contabo (~$5–7/mes) con
  Node + PostgreSQL + Nginx como proxy inverso y PM2 para mantener el proceso vivo.
- **Frontend (Fase 2):** sitio estático en Netlify / Vercel / Cloudflare Pages (gratis),
  o servido por el mismo servidor.

El hosting/dominio/servidor no está incluido en el valor de desarrollo.

---

## Estado

- **Fase 1 — Backend POS + Inventario:** completada y probada (`npm test`).
- **Fase 2 — Frontend React + Vite:** completada, en [`frontend/`](frontend/).
- **Fase 3 — Facturación electrónica SRI:** pendiente (módulo aparte + cola +
  firma XAdES-BES con el `.p12` + web services del SRI + RIDE por correo).

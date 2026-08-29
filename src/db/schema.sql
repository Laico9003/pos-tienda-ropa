-- ============================================================
--  Esquema POS Tienda de Ropa — Fase 1
--  Ejecutar con:   npm run migrar
--  (o)             psql -d pos_tienda_ropa -f src/db/schema.sql
--  Es idempotente: se puede volver a correr sin romper nada.
-- ============================================================

-- ---------- Tiendas ----------
CREATE TABLE IF NOT EXISTS tiendas (
  id                      SERIAL PRIMARY KEY,
  nombre                  TEXT NOT NULL,
  codigo_establecimiento  VARCHAR(3) NOT NULL UNIQUE,          -- SRI: 001, 002...
  punto_emision           VARCHAR(3) NOT NULL DEFAULT '001',   -- SRI: punto de emisión
  direccion               TEXT,
  telefono                TEXT,
  activo                  BOOLEAN NOT NULL DEFAULT true,
  creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Usuarios ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id             SERIAL PRIMARY KEY,
  tienda_id      INTEGER REFERENCES tiendas(id),
  nombre         TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  rol            TEXT NOT NULL DEFAULT 'vendedor'
                   CHECK (rol IN ('admin', 'vendedor', 'bodega')),
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Categorías (administrables por la clienta) ----------
CREATE TABLE IF NOT EXISTS categorias (
  id         SERIAL PRIMARY KEY,
  nombre     TEXT NOT NULL UNIQUE,
  activo     BOOLEAN NOT NULL DEFAULT true,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Productos (la prenda "madre") ----------
CREATE TABLE IF NOT EXISTS productos (
  id            SERIAL PRIMARY KEY,
  nombre        TEXT NOT NULL,
  categoria_id  INTEGER REFERENCES categorias(id),
  descripcion   TEXT,
  imagen_url    TEXT,                -- foto referencial (data URI o URL)
  activo        BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Para bases creadas antes de agregar la columna:
ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url TEXT;
CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_productos_nombre    ON productos(lower(nombre));

-- ---------- Variantes: misma prenda en distintas tallas / colores ----------
-- Cada variante es la unidad real de venta: tiene su código de barras,
-- sus precios y su stock.
CREATE TABLE IF NOT EXISTS producto_variantes (
  id             SERIAL PRIMARY KEY,
  producto_id    INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  talla          TEXT,
  color          TEXT,
  codigo_barras  TEXT UNIQUE,
  sku            TEXT UNIQUE,
  precio_compra  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (precio_compra >= 0),
  precio_venta   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (precio_venta  >= 0),
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (producto_id, talla, color)
);
CREATE INDEX IF NOT EXISTS idx_variantes_producto ON producto_variantes(producto_id);
CREATE INDEX IF NOT EXISTS idx_variantes_codigo   ON producto_variantes(codigo_barras);

-- ---------- Stock por tienda ----------
CREATE TABLE IF NOT EXISTS stock (
  id           SERIAL PRIMARY KEY,
  variante_id  INTEGER NOT NULL REFERENCES producto_variantes(id) ON DELETE CASCADE,
  tienda_id    INTEGER NOT NULL REFERENCES tiendas(id),
  cantidad     INTEGER NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  UNIQUE (variante_id, tienda_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_tienda ON stock(tienda_id);

-- ---------- Ventas ----------
CREATE TABLE IF NOT EXISTS ventas (
  id                     SERIAL PRIMARY KEY,
  tienda_id              INTEGER NOT NULL REFERENCES tiendas(id),
  usuario_id             INTEGER NOT NULL REFERENCES usuarios(id),
  cliente_nombre         TEXT,
  cliente_identificacion TEXT,           -- cédula / RUC (se usará en Fase SRI)
  cliente_email          TEXT,
  cliente_direccion      TEXT,
  subtotal               NUMERIC(12,2) NOT NULL,
  descuento_total        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (descuento_total >= 0),
  total                  NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  total_pagado           NUMERIC(12,2) NOT NULL DEFAULT 0,
  cambio                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  nota                   TEXT,
  estado                 TEXT NOT NULL DEFAULT 'completada'
                           CHECK (estado IN ('completada', 'anulada')),
  -- Campos preparados para la Fase 2 (facturación electrónica SRI):
  numero_comprobante     TEXT,
  clave_acceso           TEXT,
  estado_sri             TEXT NOT NULL DEFAULT 'no_aplica'
                           CHECK (estado_sri IN ('no_aplica','pendiente','recibida',
                                                 'autorizada','devuelta','no_autorizada')),
  creado_en              TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulada_en             TIMESTAMPTZ,
  anulada_por            INTEGER REFERENCES usuarios(id),
  motivo_anulacion       TEXT
);
CREATE INDEX IF NOT EXISTS idx_ventas_tienda_fecha ON ventas(tienda_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha        ON ventas(creado_en);

-- ---------- Ítems de cada venta (con "foto" del producto al momento) ----------
CREATE TABLE IF NOT EXISTS venta_items (
  id              SERIAL PRIMARY KEY,
  venta_id        INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  variante_id     INTEGER NOT NULL REFERENCES producto_variantes(id),
  descripcion     TEXT NOT NULL,                       -- "Blusa manga larga - M / Rojo"
  codigo_barras   TEXT,
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL CHECK (precio_unitario >= 0),
  descuento       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  total_linea     NUMERIC(12,2) NOT NULL CHECK (total_linea >= 0)
);
CREATE INDEX IF NOT EXISTS idx_venta_items_venta    ON venta_items(venta_id);
CREATE INDEX IF NOT EXISTS idx_venta_items_variante ON venta_items(variante_id);

-- ---------- Pagos (efectivo / transferencia, separados) ----------
CREATE TABLE IF NOT EXISTS pagos (
  id           SERIAL PRIMARY KEY,
  venta_id     INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  metodo       TEXT NOT NULL CHECK (metodo IN ('efectivo', 'transferencia')),
  monto        NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  banco        TEXT,                                    -- banco de la transferencia
  documento    TEXT,                                    -- N° de comprobante / transferencia
  referencia   TEXT,                                    -- observación libre
  verificado   BOOLEAN NOT NULL DEFAULT false,          -- conciliado contra el banco
  verificado_en TIMESTAMPTZ,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pagos_venta ON pagos(venta_id);
-- Para bases previas:
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS banco         TEXT;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS documento     TEXT;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS verificado    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS verificado_en TIMESTAMPTZ;

-- ---------- Kardex / movimientos de inventario ----------
CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id                 SERIAL PRIMARY KEY,
  variante_id        INTEGER NOT NULL REFERENCES producto_variantes(id),
  tienda_id          INTEGER NOT NULL REFERENCES tiendas(id),
  tipo               TEXT NOT NULL
                       CHECK (tipo IN ('entrada','salida','ajuste','venta','anulacion_venta')),
  cantidad           INTEGER NOT NULL,                 -- magnitud del movimiento
  cantidad_anterior  INTEGER,
  cantidad_nueva     INTEGER,
  referencia         TEXT,
  venta_id           INTEGER REFERENCES ventas(id),
  usuario_id         INTEGER REFERENCES usuarios(id),
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movim_variante_tienda ON movimientos_inventario(variante_id, tienda_id);
CREATE INDEX IF NOT EXISTS idx_movim_fecha           ON movimientos_inventario(creado_en);

-- ---------- Datos del negocio (una sola fila) ----------
CREATE TABLE IF NOT EXISTS negocio (
  id                     SMALLINT PRIMARY KEY DEFAULT 1,
  nombre                 TEXT NOT NULL DEFAULT 'Mi Tienda',
  razon_social           TEXT,
  ruc                    TEXT,
  direccion              TEXT,
  telefono               TEXT,
  email                  TEXT,
  logo_url               TEXT,
  mensaje_recibo         TEXT DEFAULT 'Gracias por su compra',
  -- Preparados para la Fase SRI (todavía no se usan):
  obligado_contabilidad  BOOLEAN NOT NULL DEFAULT false,
  ambiente_sri           TEXT NOT NULL DEFAULT 'pruebas' CHECK (ambiente_sri IN ('pruebas', 'produccion')),
  actualizado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT negocio_fila_unica CHECK (id = 1)
);
INSERT INTO negocio (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Campos de la Fase SRI en el negocio (idempotente para bases previas)
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS dir_matriz             TEXT;
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS nombre_comercial       TEXT;
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS contribuyente_especial TEXT;      -- nro. resolución o vacío
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS regimen                TEXT NOT NULL DEFAULT 'general'
  CHECK (regimen IN ('general', 'rimpe_emprendedor', 'rimpe_popular'));
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS iva_porcentaje         SMALLINT NOT NULL DEFAULT 15;   -- 15 | 5 | 0
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS precios_incluyen_iva   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS emitir_factura_auto    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS certificado_p12        TEXT;      -- .p12 en base64
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS certificado_clave_cif  TEXT;      -- contraseña del .p12 (AES-GCM)
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS certificado_nombre     TEXT;      -- nombre de archivo, para referencia
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS smtp_host              TEXT;
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS smtp_port              SMALLINT DEFAULT 587;
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS smtp_seguro            BOOLEAN NOT NULL DEFAULT false; -- true = SSL 465
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS smtp_usuario           TEXT;
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS smtp_clave_cif         TEXT;      -- contraseña SMTP (AES-GCM)
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS smtp_remitente         TEXT;
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS smtp_remitente_nombre  TEXT;

-- Nota interna opcional por venta (para bases previas)
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS nota TEXT;

-- ---------- Secuenciales de comprobantes por tienda ----------
CREATE TABLE IF NOT EXISTS secuencias (
  tienda_id   INTEGER NOT NULL REFERENCES tiendas(id),
  tipo        VARCHAR(2) NOT NULL DEFAULT '01',   -- 01 = factura
  secuencial  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tienda_id, tipo)
);

-- ---------- Comprobantes electrónicos (cola + registro SRI) ----------
CREATE TABLE IF NOT EXISTS comprobantes_sri (
  id                   SERIAL PRIMARY KEY,
  venta_id             INTEGER NOT NULL REFERENCES ventas(id),
  tipo                 VARCHAR(2) NOT NULL DEFAULT '01',
  ambiente             VARCHAR(1) NOT NULL,                  -- 1 pruebas, 2 producción
  estab                VARCHAR(3) NOT NULL,
  pto_emi              VARCHAR(3) NOT NULL,
  secuencial           VARCHAR(9) NOT NULL,
  clave_acceso         VARCHAR(49) UNIQUE,
  estado               TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente','firmado','enviado','recibida',
                                           'autorizada','devuelta','no_autorizada','error')),
  numero_autorizacion  TEXT,
  fecha_autorizacion   TIMESTAMPTZ,
  xml_firmado          TEXT,
  xml_autorizado       TEXT,
  mensajes             JSONB,
  intentos             INTEGER NOT NULL DEFAULT 0,
  proximo_intento      TIMESTAMPTZ NOT NULL DEFAULT now(),
  correo_destino       TEXT,
  correo_enviado       BOOLEAN NOT NULL DEFAULT false,
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta  ON comprobantes_sri(venta_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_estado ON comprobantes_sri(estado, proximo_intento);

-- ---------- Datos base ----------
-- Categorías de ejemplo (no se duplican si ya existen)
INSERT INTO categorias (nombre) VALUES
  ('Blusas'), ('Vestidos'), ('Shorts'), ('Pantalones'),
  ('Accesorios'), ('Zapatos'), ('Otros')
ON CONFLICT (nombre) DO NOTHING;

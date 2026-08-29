# Subir el sistema a internet (Railway)

El backend y el frontend van en **un solo servicio**: el servidor Node sirve la
API y también la interfaz ya compilada.

## 1. Subir el código a GitHub

```bash
git init
git add .
git commit -m "POS tienda de ropa"
```

Crea un repositorio vacío en https://github.com/new (privado), y luego:

```bash
git remote add origin https://github.com/TU_USUARIO/pos-tienda-ropa.git
git branch -M main
git push -u origin main
```

## 2. Crear el proyecto en Railway

1. Entra a https://railway.app → **Login with GitHub**.
2. **New Project → Deploy from GitHub repo** → elige el repo.
3. En el proyecto: **New → Database → Add PostgreSQL**.
4. Abre el servicio del backend → pestaña **Variables** y agrega:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | **Add Reference → Postgres → `DATABASE_URL`** (la interna) |
   | `DATABASE_SSL` | `false` |
   | `JWT_SECRET` | una clave larga aleatoria |
   | `SRI_CLAVE` | otra clave larga aleatoria — **NO cambiarla nunca** |
   | `SRI_WORKER` | `on` |
   | `STOCK_BAJO_UMBRAL` | `5` |
   | `AUTO_MIGRAR` | `true` |
   | `ADMIN_EMAIL` | tu correo (será el primer usuario admin) |
   | `ADMIN_PASSWORD` | una contraseña segura |
   | `ADMIN_NOMBRE` | tu nombre |

5. Railway compila solo (`npm run build`) y arranca (`npm start`).
   En el primer arranque `AUTO_MIGRAR=true` crea las tablas, las 2 tiendas y el
   usuario admin.

## 3. Dominio

- Railway te da uno gratis: `Settings → Networking → Generate Domain`.
- Para tu dominio propio: compra un `.com` (Cloudflare Registrar o Namecheap,
  ~$12/año), y en `Settings → Networking → Custom Domain` pega el dominio;
  Railway te dice el registro CNAME a crear. El HTTPS se activa solo.

## 4. Primeros pasos en la app publicada

1. Entra con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. **Datos del negocio**: RUC, razón social, dirección, **subir el `.p12`** + su
   clave, y los datos de **correo (SMTP)**.
3. Carga productos (o se migran desde local).
4. Para facturar de verdad: acepta el acuerdo en el portal *SRI en línea* y
   cambia **Ambiente** a *Producción*.

## Notas

- Los datos que tienes en local (productos, `.p12`, SMTP) **no** se suben con el
  código; se vuelven a cargar en la app publicada.
- Cada tienda solo necesita un dispositivo con navegador apuntando a la URL.
- Recomendado: router con SIM 4G de respaldo en cada local (es un POS en la nube).

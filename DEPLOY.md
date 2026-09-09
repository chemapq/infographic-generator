# Despliegue

La app es un servidor Node de larga duración (cola de jobs en memoria, HTML/capturas
persistidos en disco en `output/`, Chromium vía Playwright, progreso en vivo por SSE).
Necesita un **proceso persistente con disco propio**, no funciones serverless: por eso
este despliegue se hace con Docker en un host que mantenga el contenedor corriendo
(Render, Railway, Fly.io o un VPS), no en Vercel/Netlify/Lambda.

## Antes de desplegar en cualquier host

**Variables de entorno obligatorias:**

| Variable | Por qué |
| --- | --- |
| `ANTHROPIC_API_KEY` | Sin ella, el SDK no puede llamar a la API. |
| `AUTH_PASSWORD`, `API_KEYS` y/o `EMBED_SECRET` | Con `NODE_ENV=production` (el Dockerfile lo fija) **el servidor no arranca sin al menos una de las tres** — ver [README § Login](README.md#login-para-desplegar) y [README § API v1](README.md#api-v1-integraciones--moodle-y-similares). `AUTH_PASSWORD` protege la interfaz web; `API_KEYS` autentica clientes servidor-a-servidor; `EMBED_SECRET` autentica al plugin de Moodle, que incrusta la app en un iframe. Un despliegue que solo sirve a Moodle necesita `EMBED_SECRET` y **no** puede llevar `UI_ENABLED=false`: el iframe sirve la interfaz. |
| `AUTH_SECRET` | Cadena aleatoria fija. Sin ella, cada redeploy/reinicio cierra todas las sesiones abiertas — las de la web y las que abre un ticket de Moodle. Genérala una vez, p. ej. `openssl rand -hex 32`, y no la cambies. |

**Volumen persistente en `/app/output`: no es opcional.** Ahí vive el estado de cada job
(imagen original, HTML y capturas de cada pasada, `usage.json`), y desde la 1.0.0 del
plugin de Moodle **es el único sitio donde existe una infografía**: antes Moodle guardaba
su propia copia del HTML en la File API, y ya no. Sin un volumen montado ahí, un redeploy
no pierde "el historial del navegador de alguien": pierde el trabajo de todos los
profesores del centro, sin vuelta atrás.

Opcionales: `PORT` (la mayoría de estos hosts lo inyectan solos), `MAX_PASSES`,
`TARGET_SCORE`, `ANTHROPIC_MODEL`, `AUTH_SESSION_HOURS`, `EMBED_ALLOWED_ORIGINS`,
`EMBED_SESSION_HOURS` — ver `.env.example`.

**Antes del primer despliegue real, construye y prueba la imagen en local** (aquí no
hay Docker disponible para verificarlo por ti):

```bash
docker build -t infographic-generator .
docker run --rm -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-... \
  -e AUTH_PASSWORD=prueba-local \
  -e AUTH_SECRET=$(openssl rand -hex 32) \
  -v "$(pwd)/output-docker:/app/output" \
  infographic-generator
```

Comprueba `curl localhost:3000/api/health`, entra con la contraseña y sube una imagen
de prueba de principio a fin (que renderice con Chromium dentro del contenedor).

---

## Render

Hay un `render.yaml` (Blueprint) en la raíz: **New → Blueprint → conecta el repo**, y Render
crea el servicio solo (runtime Docker, healthcheck en `/api/health`, `AUTH_SECRET`
autogenerado). Solo te pedirá `ANTHROPIC_API_KEY` y `AUTH_PASSWORD` al crearlo.

Configurado para el **plan free**, para probarlo sin coste. **El plan free no sirve para
usar esto con Moodle de verdad**, por el primer punto:

- **Sin disco** — el free tier no admite Persistent Disks. `output/` vive en el disco
  efímero del contenedor: los jobs sobreviven mientras el servicio esté arriba, pero
  desaparecen en cada redeploy, reinicio o cuando se duerma por inactividad. Con el
  plugin de Moodle sirviendo el iframe, eso es todo el historial de todos los
  profesores: Moodle no guarda copia de nada.
- **Se duerme a los 15 min sin tráfico** (arranque en frío de 30-60 s al siguiente request).
- **512 MB de RAM / 0,1 vCPU** — de sobra para probarlo, pero justo para Chromium +
  sharp en pasadas pesadas o varias seguidas; si ves renders que se cuelgan o el
  servicio reiniciándose solo, es memoria.

Para que los jobs persistan de verdad —requisito, no mejora, si esto va a servir a un
Moodle— sube el plan a Starter y añade un **Disk** con mount path `/app/output` (edítalo
a mano en el dashboard o en `render.yaml`: bloque
`disk: { name: output, mountPath: /app/output, sizeGB: 1 }` dentro del servicio).

Sin Blueprint, también vale a mano: New → Web Service → conecta el repo (detecta el
`Dockerfile` solo) → variables de entorno → Health check path `/api/health`.

## Railway

1. New Project → Deploy from GitHub repo. Railway detecta el `Dockerfile` solo.
2. Añade un **Volume**, mount path `/app/output`.
3. Variables → las de la tabla anterior. Railway inyecta `PORT` solo.

## Fly.io

```bash
fly launch --no-deploy        # detecta el Dockerfile; dile que NO añada Postgres/Redis
fly volumes create ig_output --size 3   # ajusta el tamaño a tu volumen de trabajos
```

En el `fly.toml` que genera, añade el montaje del volumen:

```toml
[mounts]
  source = "ig_output"
  destination = "/app/output"
```

Luego:

```bash
fly secrets set ANTHROPIC_API_KEY=sk-... AUTH_PASSWORD=... AUTH_SECRET=$(openssl rand -hex 32)
fly deploy
```

## VPS / Docker genérico

```bash
docker build -t infographic-generator .
docker run -d --restart unless-stopped -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-... \
  -e AUTH_PASSWORD=... \
  -e AUTH_SECRET=... \
  -v /ruta/persistente/output:/app/output \
  infographic-generator
```

Pon un proxy inverso (Caddy, nginx, Traefik) delante con TLS: el login manda la
contraseña en claro si se sirve por HTTP sin cifrar.

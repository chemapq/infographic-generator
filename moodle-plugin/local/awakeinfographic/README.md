# local_awakeinfographic

Plugin de Moodle que re-aloja la app de [Awakelab Infographic Generator](../../../README.md):
la misma pantalla de subida, el mismo resultado con el comparador, y el mismo editor visual
completo (señalar y pedirle un cambio a Claude, o editar textos a mano) — dentro de Moodle,
con la clave de la API del motor guardada solo en el servidor. Ver
[`../../PLAN_MOODLE.md`](../../PLAN_MOODLE.md) para el porqué de cada decisión.

## Instalar

1. Genera los assets (`templates/app.mustache`, `styles/app.css`, `js/*.js`) desde el repo del
   motor — ya están commiteados en este árbol, pero si tocas `public/*` en el motor hace falta
   regenerarlos:
   ```bash
   npm run build:moodle                                        # sobre este mismo árbol
   npm run build:moodle -- --out /ruta/a/otro/moodle/local/awakeinfographic
   ```
2. Copia (o symlink) `local/awakeinfographic/` dentro de `<moodle>/local/`.
3. Entra como admin: Moodle detecta el plugin nuevo y pide actualizar la base de datos.
4. **Administración del sitio → Extensiones → Extensiones locales → Awakelab Infographic**:
   - `apibaseurl`: la URL del motor (p. ej. `http://host.docker.internal:3000` en moodle-docker).
   - `apikey`: una de las claves de `API_KEYS` del motor.
   - Guarda y pulsa **Probar conexión**.

## Probar de cero

Ver [`../../PLAN_MOODLE.md` §8](../../PLAN_MOODLE.md#8-cómo-probarlo-de-cero) para el paso a
paso completo con moodle-docker (motor sin Moodle, levantar Moodle, generar, y sobre todo
**editar — la prueba de verdad, que no necesita cron para nada**).

## Arquitectura, en una frase

`app.js`/`editor.js` no se tocan: siguen construyendo las mismas URLs que en la app standalone
(`/api/jobs`, `/api/jobs/:id/result?pass=n`…). `ajax/index.php` y `files.php` las despachan por
`PATH_INFO` — el mismo mecanismo que usa `pluginfile.php` — hacia el fichero de `ajax/` o la
File API que sabe resolver cada una. `IG_CONFIG` (con el `sesskey` y las URLs de este Moodle) se
inyecta en línea desde `index.php`.

## Tests

```bash
vendor/bin/phpunit --testsuite local_awakeinfographic_testsuite
```

No se han ejecutado en este entorno de desarrollo (sin PHPUnit/Moodle disponibles fuera de un
moodle-docker real) — revísalos ahí antes de fusionar. Cubren `api_client`, `sync_job` y
`html_guard`; los endpoints de `ajax/` y `job_shape` todavía no tienen cobertura (pendiente).

## Limitaciones conocidas de esta v1

- Sin casilla de "confirmo que tengo derechos sobre esta imagen" en la subida (sí la tenía el
  formulario viejo): al reusar el `index.html` de la app tal cual, añadirla exigiría tocar
  `app.js`, que se ha evitado a propósito. Pendiente si se quiere recuperar esa mitigación legal.
- El thumbnail de una versión `ai`/`manual` (sin captura propia) cae al original en vez de a un
  render suyo: no hay Chromium en el camino de edición, que es justo lo que se quería evitar.
- Sin banco de contenido (`contenttype_`), sin cuotas por alumno, sin actividad con nota: fuera de
  alcance de esta v1 (ver PLAN_MOODLE.md §10).

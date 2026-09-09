# local_awakeinfographic

Plugin de Moodle que sirve la app de [Awakelab Infographic Generator](../../../README.md) en un
iframe, con el usuario de Moodle ya autenticado dentro. Lo que se ve es la app real, servida por
el motor: la misma pantalla de subida, el mismo comparador y el mismo editor visual.

El plugin **no guarda nada**: ni tablas, ni ficheros, ni copias del HTML. Su único trabajo es
firmar un pase de acceso que le dice al motor quién está mirando.

> **Antes de la 1.0.0** el plugin reimplementaba la interfaz dentro de Moodle (una copia
> generada de `public/` calificada bajo `.ig-app`, endpoints `ajax/*` de proxy, dos tablas, tres
> fileareas y dos tareas de cron). Se retiró: pelear con el CSS de Boost daba un resultado peor
> que la app original, y mantener una segunda copia de los datos no aportaba nada. El upgrade a
> 1.0.0 **borra** esa copia local — ver [`db/upgrade.php`](db/upgrade.php).
>
> [`../../PLAN_MOODLE.md`](../../PLAN_MOODLE.md) documenta esa arquitectura anterior y sigue
> siendo útil para entender por qué se tomó cada decisión, pero ya no describe el plugin.

## Cómo entra el usuario

```
index.php                                    motor (GET /embed)
  ticket = v1.<payload>.<HMAC(embedsecret)>    verifica firma y caducidad
  <iframe src="{apibaseurl}/embed?t=…">  ───►  emite un token de sesión propio
                                             302 → /?t=<token>
  el iframe carga la app  ◄──────────────────────┘
```

El **ticket** lo firma Moodle con el secreto compartido y vive 120 segundos: es un pase de un
solo salto. La **sesión** la emite el motor con su propio secreto, que nunca sale de allí — así
un Moodle comprometido no puede fabricar sesiones largas.

En el payload van cuatro cosas: `owner` (`moodle:<hash del sitio>:<userid>`, y con él el
aislamiento de la galería: cada profesor ve solo lo suyo), `name` (para los logs del motor),
`edit` (la capability `:edit` y el ajuste del sitio, juntos) y `exp` en segundos Unix.

Todo esto vive en [`classes/embed.php`](classes/embed.php), y el otro lado del contrato en
`src/services/embed.ts` del repo del motor. **Si cambias uno, cambia el otro** —
[`tests/embed_test.php`](tests/embed_test.php) fija el formato exacto por ese motivo.

## Instalar

1. Copia (o symlink) `local/awakeinfographic/` dentro de `<moodle>/local/`. No hay paso de build:
   el plugin no lleva JS ni CSS de la app.
2. Entra como admin: Moodle detecta la versión nueva y pide actualizar la base de datos.
   **Ese upgrade borra las tablas y los ficheros del plugin** si vienes de la 0.1.0.
3. **Administración del sitio → Extensiones → Extensiones locales → Awakelab Infographic**:
   - **URL base del motor**: p. ej. `http://host.docker.internal:3000` en moodle-docker, o la
     URL pública del despliegue. Sin barra final. **HTTPS si este Moodle es HTTPS**: el navegador
     bloquea un iframe `http://` dentro de una página `https://`, y sin decir por qué.
   - **Secreto compartido**: el mismo valor que `EMBED_SECRET` en el motor.
   - Guarda y pulsa **Probar conexión**.
4. En el motor, declara qué Moodle puede incrustarlo:
   `EMBED_ALLOWED_ORIGINS=https://moodle.ejemplo.com`.

## Permisos

| Capability | Para qué |
|---|---|
| `local/awakeinfographic:generate` | ver el generador y crear infografías |
| `local/awakeinfographic:edit` | pedirle cambios a la IA y retocar textos |

Las dos van en el ticket, y el motor las respeta: sin `:edit` (o con el ajuste del sitio
apagado) el botón de editar no se pinta y las llamadas de escritura responden 403.

## Tests

```bash
vendor/bin/phpunit --testsuite local_awakeinfographic_testsuite
```

No se han ejecutado en este entorno de desarrollo (sin PHPUnit/Moodle fuera de un moodle-docker
real) — revísalos ahí antes de fusionar. Cubren la firma del ticket, que es el único límite de
seguridad que le queda al plugin.

## Cosas que conviene saber

- **El motor es el único sitio donde vive una infografía.** Moodle ya no guarda copia, así que la
  persistencia del motor (su carpeta `output/`) deja de ser una comodidad y pasa a ser el
  almacén. En Render sin disco montado, un redeploy borra el historial de todos. Ver
  [`../../DEPLOY.md`](../../DEPLOY.md).
- **El historial anterior a la 1.0.0 no aparece.** Lo que se generó a través del plugin viejo
  sigue en el motor, pero con el `ownerId` de la clave de API (`moodle`) en vez del del usuario,
  así que no sale en la galería de nadie. Se rescata a mano editando `ownerId` en
  `output/<jobId>/job.json`.
- **El token de sesión viaja en la querystring**, no en una cabecera: la app lo necesita en
  `<img src>`, en el iframe del resultado y en los enlaces de descarga. Aparece en los logs de
  acceso del motor; lo acota su caducidad (`EMBED_SESSION_HOURS`, 12 h por defecto). Es el mismo
  compromiso que hace Moodle con `sesskey`.
- **Sin cookies**, y a propósito: un navegador con las cookies de terceros bloqueadas (Safari por
  defecto) no dejaría pasar una cookie de sesión a un iframe de otro dominio.

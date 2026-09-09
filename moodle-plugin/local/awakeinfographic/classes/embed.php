<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

/**
 * El lado Moodle del acceso al iframe.
 *
 * El plugin no guarda nada ni llama a la API: su único trabajo es firmar un
 * pase de acceso («ticket») que le dice al motor quién es el usuario que está
 * mirando. El motor lo valida, lo cambia por un token de sesión propio y sirve
 * la app. Ver `src/services/embed.ts` en el repo del motor.
 *
 * Formato del ticket, idéntico al que verifica el motor:
 *
 *     v1.<base64url(JSON)>.<base64url(HMAC-SHA256 del segmento anterior)>
 *
 * y en el JSON:
 *
 *     owner  string  "moodle:<8 hex de sha1(siteidentifier)>:<userid>"
 *     name   string  nombre para mostrar del usuario (solo para los logs del motor)
 *     edit   bool    si puede pedir cambios (capability :edit + ajuste allowaiedit)
 *     exp    int     caducidad, en SEGUNDOS Unix
 *
 * 120 segundos de vida: es un pase de un solo salto, de esta página a
 * `GET /embed`. La sesión larga la emite el motor con su propio secreto, así
 * que un Moodle comprometido no puede fabricar sesiones de doce horas.
 */
class embed {

    /** Segundos de validez del ticket. Solo tiene que sobrevivir a la carga del iframe. */
    const TICKET_TTL = 120;

    /** La URL base del motor, sin barra final, o `''` si no está configurada. */
    protected static function baseurl(): string {
        return rtrim((string) get_config('local_awakeinfographic', 'apibaseurl'), '/');
    }

    /** El secreto compartido con el motor (`EMBED_SECRET`), o `''`. */
    protected static function secret(): string {
        return trim((string) get_config('local_awakeinfographic', 'embedsecret'));
    }

    /** `true` si hay URL y secreto: se puede construir el iframe. */
    public static function is_configured(): bool {
        return self::baseurl() !== '' && self::secret() !== '';
    }

    /**
     * Identidad del usuario ante el motor, y con ella el aislamiento de la
     * galería: cada profesor solo ve lo suyo.
     *
     * Va con el `siteidentifier` hasheado (y no en claro) porque el valor
     * acaba escrito en los ficheros y los logs del motor, y en un Moodle es
     * un secreto de instalación. Con el hash sigue siendo estable y sigue
     * distinguiendo dos Moodles que compartan motor, que es para lo que está.
     */
    public static function owner_id(): string {
        global $CFG, $USER;
        return 'moodle:' . substr(sha1($CFG->siteidentifier), 0, 8) . ':' . (int) $USER->id;
    }

    /**
     * Si este usuario puede modificar una infografía. Son dos condiciones y
     * hacen falta las dos: el permiso de la persona y que el administrador no
     * haya apagado la edición para todo el sitio.
     */
    public static function can_edit(): bool {
        return has_capability('local/awakeinfographic:edit', \context_system::instance())
            && (bool) get_config('local_awakeinfographic', 'allowaiedit');
    }

    /** base64url sin `=` de relleno, como espera `Buffer.from(…, 'base64url')`. */
    protected static function base64url(string $raw): string {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    /** El ticket firmado para el usuario en sesión. */
    public static function ticket(): string {
        global $USER;

        $payload = json_encode([
            'owner' => self::owner_id(),
            'name' => fullname($USER),
            'edit' => self::can_edit(),
            'exp' => time() + self::TICKET_TTL,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $body = self::base64url($payload);
        // El HMAC se calcula sobre el segmento YA codificado, no sobre el JSON
        // crudo: así los dos lados firman exactamente los mismos bytes sin
        // depender de cómo serialice el JSON cada lenguaje.
        $signature = self::base64url(hash_hmac('sha256', $body, self::secret(), true));

        return 'v1.' . $body . '.' . $signature;
    }

    /** La URL del iframe, o `null` si falta configuración. */
    public static function url(): ?\moodle_url {
        if (!self::is_configured()) {
            return null;
        }
        return new \moodle_url(self::baseurl() . '/embed', ['t' => self::ticket()]);
    }
}

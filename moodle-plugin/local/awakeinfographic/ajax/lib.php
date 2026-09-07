<?php
namespace local_awakeinfographic\ajax;

defined('MOODLE_INTERNAL') || die();

use local_awakeinfographic\job;

/**
 * Lo común a toda ruta ajax: extraer el sufijo de ruta que app.js/editor.js
 * ya construyen (`/api/jobs/…`), leer el cuerpo JSON, y traducir cualquier
 * excepción a la forma `{code, error}` que ya produce el motor — así el
 * manejo de errores de app.js no cambia. Ver PLAN_MOODLE.md §6.4.
 */

/**
 * El sufijo de ruta tras `ajax/index.php`, igual que hace `pluginfile.php`
 * con las suyas. `PATH_INFO` es lo normal; si el servidor no lo entrega (algún
 * hosting con `cgi.fix_pathinfo`/`AcceptPathInfo` apagado) se deriva de
 * `REQUEST_URI` quitando `SCRIPT_NAME` y la querystring.
 */
function resolve_pathinfo(): string {
    if (!empty($_SERVER['PATH_INFO'])) {
        return $_SERVER['PATH_INFO'];
    }
    $uri = $_SERVER['REQUEST_URI'] ?? '';
    $uri = strtok($uri, '?');
    $script = $_SERVER['SCRIPT_NAME'] ?? '';
    if ($script !== '' && str_starts_with($uri, $script)) {
        return substr($uri, strlen($script));
    }
    return '';
}

/** Responde `{code, error, ...extra}` con el status HTTP dado y termina la petición. */
function respond_error(int $status, string $code, string $error, array $extra = []): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array_merge(['code' => $code, 'error' => $error], $extra));
    exit;
}

/** Responde un cuerpo JSON y termina la petición. */
function respond_json(mixed $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
    exit;
}

/** 204: sin cuerpo, como ya espera `app.js` del borrado. */
function respond_no_content(): void {
    http_response_code(204);
    exit;
}

/** El cuerpo JSON de la petición (POST/PATCH sin multipart), como array asociativo. */
function json_body(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode((string) $raw, true);
    return is_array($data) ? $data : [];
}

/** Job por id, comprobando que exista y que el usuario pueda verlo. Termina con 404 si no. */
function required_job(int $id): \stdClass {
    global $DB, $USER;
    $job = $DB->get_record('local_awakeinfographic_job', ['id' => $id]);
    if (!$job || !job::can_view($job, (int) $USER->id)) {
        respond_error(404, 'job_not_found', get_string('error:noaccess', 'local_awakeinfographic'));
    }
    return $job;
}

/** Recorta y limpia un campo de texto del cuerpo; `''` si viene vacío o no es texto. */
function text_field(array $body, string $key, int $maxlength): string {
    $value = $body[$key] ?? '';
    if (!is_string($value)) {
        return '';
    }
    $value = trim($value);
    return \core_text::substr($value, 0, $maxlength);
}

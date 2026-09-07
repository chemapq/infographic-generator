<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

// La clase \curl y make_request_directory() viven aquí; no siempre está
// cargada por defecto según el punto de entrada que autocargue esta clase.
require_once($CFG->libdir . '/filelib.php');

/**
 * Cliente HTTP contra la API v1 del motor (bearer, multipart, JSON). Ver
 * PLAN_MOODLE.md §3 (contrato) y §4.5 (por qué `ignoresecurity` y los
 * timeouts). Las llamadas HTTP pasan por `call()` / `raw_call()`, la única
 * costura que `fake_api_client` (tests/) sustituye para probar `sync_job`
 * sin un motor real corriendo detrás.
 */
class api_client {

    /** @var string Sin barra final. */
    protected string $baseurl;
    protected string $apikey;

    public function __construct() {
        $this->baseurl = rtrim((string) get_config('local_awakeinfographic', 'apibaseurl'), '/');
        $this->apikey = (string) get_config('local_awakeinfographic', 'apikey');
        if ($this->baseurl === '' || $this->apikey === '') {
            throw new \moodle_exception('error:notconfigured', 'local_awakeinfographic');
        }
    }

    protected function new_curl(array $options = []): \curl {
        // La URL de la API la configura un administrador, no un usuario:
        // saltarse el comprobador de seguridad de cURL es correcto aquí, y
        // NECESARIO — sin esto, apuntar a host.docker.internal o a una IP
        // privada puede acabar bloqueado por $CFG->curlsecurityblockedhosts
        // con un error que no dice por qué (PLAN_MOODLE.md §4.5).
        return new \curl(array_merge(['ignoresecurity' => true], $options));
    }

    protected function headers(?string $idempotencykey = null): array {
        $headers = ['Authorization: Bearer ' . $this->apikey];
        if ($idempotencykey !== null) {
            $headers[] = 'Idempotency-Key: ' . $idempotencykey;
        }
        return $headers;
    }

    /** Decodifica una respuesta JSON; lanza `api_exception` si el HTTP no es 2xx. Nunca vuelca la clave. */
    protected function decode(int $status, string $raw): array {
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            $data = [];
        }
        if ($status >= 200 && $status < 300) {
            return $data;
        }
        throw new api_exception(
            $data['code'] ?? 'unknown',
            $data['error'] ?? ('Error HTTP ' . $status . ' de la API del motor.'),
            $status,
            isset($data['retryAfterSeconds']) ? (int) $data['retryAfterSeconds'] : null
        );
    }

    /**
     * Llamada JSON (GET/POST/DELETE) contra `$path`. Único punto que
     * `fake_api_client` sustituye para las respuestas que decodifican a JSON.
     */
    protected function call(string $method, string $path, array $curloptions, array $headers, array|string $postparams = []): array {
        $curl = $this->new_curl($curloptions);
        $curl->setHeader($headers);
        $url = $this->baseurl . $path;
        $raw = match ($method) {
            'post' => $curl->post($url, $postparams),
            'delete' => $curl->delete($url),
            default => $curl->get($url),
        };
        return $this->decode((int) ($curl->get_info()['http_code'] ?? 0), $raw);
    }

    /**
     * Descarga binaria/texto (no JSON) contra `$path`. Único punto que
     * `fake_api_client` sustituye para el HTML y la previsualización.
     */
    protected function raw_call(string $path, array $curloptions): string {
        $curl = $this->new_curl($curloptions);
        $curl->setHeader($this->headers());
        $raw = $curl->get($this->baseurl . $path);
        $status = (int) ($curl->get_info()['http_code'] ?? 0);
        if ($status < 200 || $status >= 300) {
            $this->decode($status, $raw); // siempre lanza: nunca hay 2xx aquí dentro.
        }
        return $raw;
    }

    /** GET /api/v1/health — sin clave. Para el botón «probar conexión». */
    public function health(): array {
        return $this->call('get', '/api/v1/health', ['connecttimeout' => 10, 'timeout' => 15], []);
    }

    /**
     * POST /api/v1/jobs — sube la imagen y crea el job. `$sourcefile` es el
     * `stored_file` del filearea `source`; se copia a un fichero temporal
     * porque cURL necesita una ruta real para el multipart.
     */
    public function create_job(
        \stored_file $sourcefile,
        string $idempotencykey,
        string $externalref,
        string $notes,
        int $maxpasses
    ): array {
        $dir = make_request_directory();
        $tmp = $dir . '/' . $sourcefile->get_filename();
        $sourcefile->copy_content_to($tmp);

        $params = [
            'image' => new \CURLFile($tmp, $sourcefile->get_mimetype() ?: 'application/octet-stream', $sourcefile->get_filename()),
            'maxPasses' => $maxpasses,
            'externalRef' => $externalref,
        ];
        if ($notes !== '') {
            $params['notes'] = $notes;
        }

        return $this->call(
            'post',
            '/api/v1/jobs',
            ['connecttimeout' => 30, 'timeout' => 120],
            $this->headers($idempotencykey),
            $params
        );
    }

    /** GET /api/v1/jobs/:id — estado ligero. */
    public function get_status(string $remotejobid): array {
        return $this->call('get', '/api/v1/jobs/' . $remotejobid, ['connecttimeout' => 15, 'timeout' => 30], $this->headers());
    }

    /** GET /api/v1/jobs/:id?include=passes — con el detalle de cada pasada, para descargarlas todas como versiones. */
    public function get_status_with_passes(string $remotejobid): array {
        return $this->call(
            'get',
            '/api/v1/jobs/' . $remotejobid . '?include=passes',
            ['connecttimeout' => 15, 'timeout' => 30],
            $this->headers()
        );
    }

    /** GET /api/v1/jobs/:id/html — el HTML final, tal cual. */
    public function download_html(string $remotejobid): string {
        return $this->raw_call('/api/v1/jobs/' . $remotejobid . '/html', ['connecttimeout' => 30, 'timeout' => 300]);
    }

    /** GET /api/v1/jobs/:id/html?pass=n — el HTML de una pasada concreta. */
    public function download_html_pass(string $remotejobid, int $pass): string {
        return $this->raw_call(
            '/api/v1/jobs/' . $remotejobid . '/html?pass=' . $pass,
            ['connecttimeout' => 30, 'timeout' => 300]
        );
    }

    /** GET /api/v1/jobs/:id/preview.png — la captura de la pasada que se muestra como resultado. */
    public function download_preview(string $remotejobid): string {
        return $this->raw_call('/api/v1/jobs/' . $remotejobid . '/preview.png', ['connecttimeout' => 30, 'timeout' => 300]);
    }

    /** GET /api/v1/jobs/:id/preview.png?pass=n — la captura de una pasada concreta. */
    public function download_preview_pass(string $remotejobid, int $pass): string {
        return $this->raw_call(
            '/api/v1/jobs/' . $remotejobid . '/preview.png?pass=' . $pass,
            ['connecttimeout' => 30, 'timeout' => 300]
        );
    }

    /** DELETE /api/v1/jobs/:id. Que falle no es motivo para no borrar en local (job::delete). */
    public function delete_job(string $remotejobid): void {
        $this->call('delete', '/api/v1/jobs/' . $remotejobid, ['connecttimeout' => 15, 'timeout' => 30], $this->headers());
    }

    /**
     * POST /api/v1/edit — edición sin estado. `$target` es el elemento
     * señalado (`label`/`selector`/`html`/`text`), o `null` para un cambio
     * sobre toda la pieza. 180 s de timeout: es la llamada sin estado más
     * larga del contrato (§6.11, §6.8).
     */
    public function edit_html(string $html, string $prompt, ?array $target, ?string $originaljobid): array {
        $payload = ['html' => $html, 'prompt' => $prompt];
        if ($target !== null) {
            $payload['target'] = $target;
        }
        if ($originaljobid !== null) {
            $payload['originalJobId'] = $originaljobid;
        }

        return $this->call(
            'post',
            '/api/v1/edit',
            ['connecttimeout' => 30, 'timeout' => 180],
            array_merge($this->headers(), ['Content-Type: application/json']),
            json_encode($payload)
        );
    }
}

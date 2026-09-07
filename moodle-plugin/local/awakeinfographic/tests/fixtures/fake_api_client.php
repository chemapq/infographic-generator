<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

require_once(__DIR__ . '/../../classes/api_client.php');

/**
 * `api_client` con las llamadas HTTP sustituidas por respuestas programadas
 * en cola: la costura que permite probar `sync_job` sin un motor real
 * corriendo detrás (PLAN_MOODLE.md §5, hito 5). No lee `apibaseurl`/`apikey`.
 */
class fake_api_client extends api_client {
    /** @var array<int, array{0:int,1:array}> cola de [status, body] para llamadas JSON, en orden. */
    public array $jsonresponses = [];
    /** @var array<int, array{0:int,1:string}> cola de [status, body] para descargas crudas (html/preview). */
    public array $rawresponses = [];
    /** @var array<int, array{method:string,path:string}> registro de llamadas realizadas, para aserciones. */
    public array $calls = [];

    public function __construct() {
        // Deliberadamente no se llama a parent::__construct(): los tests no
        // necesitan apibaseurl/apikey reales.
    }

    protected function call(string $method, string $path, array $curloptions, array $headers, array|string $postparams = []): array {
        $this->calls[] = ['method' => $method, 'path' => $path];
        if (empty($this->jsonresponses)) {
            throw new \coding_exception('fake_api_client: no hay más respuestas JSON programadas para ' . $path);
        }
        [$status, $body] = array_shift($this->jsonresponses);
        if ($status >= 200 && $status < 300) {
            return $body;
        }
        throw new api_exception(
            $body['code'] ?? 'unknown',
            $body['error'] ?? '',
            $status,
            $body['retryAfterSeconds'] ?? null
        );
    }

    protected function raw_call(string $path, array $curloptions): string {
        $this->calls[] = ['method' => 'get-raw', 'path' => $path];
        if (empty($this->rawresponses)) {
            throw new \coding_exception('fake_api_client: no hay más respuestas crudas programadas para ' . $path);
        }
        [$status, $body] = array_shift($this->rawresponses);
        if ($status >= 200 && $status < 300) {
            return $body;
        }
        throw new api_exception('no_result', 'sin resultado', $status);
    }
}

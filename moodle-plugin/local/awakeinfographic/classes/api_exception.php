<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

/**
 * Excepción tipada para un error de la API v1: conserva el `code` estable
 * (PLAN_MOODLE.md §3.2) para que quien la capture decida por ahí, no
 * parseando el texto de `error`. `getMessage()` ya trae el mensaje en
 * lenguaje llano que produce errors.ts en el motor, listo para guardar tal
 * cual en `job->errormessage`.
 */
class api_exception extends \Exception {
    public string $apicode;
    public int $httpstatus;
    public ?int $retryafterseconds;

    public function __construct(string $apicode, string $message, int $httpstatus, ?int $retryafterseconds = null) {
        parent::__construct($message);
        $this->apicode = $apicode;
        $this->httpstatus = $httpstatus;
        $this->retryafterseconds = $retryafterseconds;
    }
}

<?php
namespace local_awakeinfographic\task;

defined('MOODLE_INTERNAL') || die();

use local_awakeinfographic\api_client;
use local_awakeinfographic\api_exception;
use local_awakeinfographic\job;

// get_file_storage() para guardar el resultado; no siempre está cargada por
// defecto en el contexto en que corre una tarea ad hoc (cron CLI).
require_once($CFG->libdir . '/filelib.php');

/**
 * Una única tarea que resuelve los dos estados del job: enviarlo si no tiene
 * `remotejobid`, o sondearlo si ya lo tiene. Ver PLAN_MOODLE.md §4.3.
 *
 * Detalle que importa: «sigue en curso» se resuelve reencolando una tarea
 * nueva y *retornando con normalidad*, nunca lanzando una excepción. Si esta
 * tarea lanza, Moodle activa su maquinaria de reintentos con backoff y la
 * marca como fallida en los informes: un panel de administración lleno de
 * rojo por un job que iba perfectamente.
 */
class sync_job extends \core\task\adhoc_task {

    public function get_name() {
        return get_string('task:syncjob', 'local_awakeinfographic');
    }

    public function execute() {
        global $DB;

        $data = (array) $this->get_custom_data();
        $jobid = (int) ($data['jobid'] ?? 0);
        if (!$jobid) {
            return;
        }

        $job = $DB->get_record('local_awakeinfographic_job', ['id' => $jobid]);
        if (!$job) {
            // La fila ya no existe (el profesor borró el activo mientras la tarea esperaba): nada que hacer.
            return;
        }
        if (job::is_finished($job)) {
            return;
        }

        $client = $this->make_client();

        if (!$job->remotejobid) {
            $this->submit($client, $job, $data);
        } else {
            $this->poll($client, $job);
        }
    }

    /** Punto de extensión: los tests sustituyen esto por un `fake_api_client`. */
    protected function make_client(): api_client {
        return new api_client();
    }

    protected function submit(api_client $client, \stdClass $job, array $data): void {
        global $DB;

        $sourcefile = job::get_source_file($job);
        if (!$sourcefile) {
            $this->fail($job, 'missing_source', get_string('error:missingsource', 'local_awakeinfographic'));
            return;
        }

        $notes = (string) ($data['notes'] ?? '');
        $maxpasses = (int) ($data['maxpasses'] ?? 3);

        try {
            $result = $client->create_job(
                $sourcefile,
                $job->idempotencykey,
                'moodle:' . md5($GLOBALS['CFG']->wwwroot) . ':' . $job->id,
                $notes,
                $maxpasses
            );
        } catch (api_exception $e) {
            if ($e->apicode === 'queue_full') {
                // Todavía sin remotejobid: hay que conservar notes/maxpasses
                // para el próximo intento de envío, o se perderían.
                $this->requeue($job, max($e->retryafterseconds ?? 30, 30), ['notes' => $notes, 'maxpasses' => $maxpasses]);
                return;
            }
            $this->fail($job, $e->apicode, $e->getMessage());
            return;
        }

        $job->remotejobid = $result['jobId'];
        $job->status = job::STATUS_SUBMITTED;
        $job->remotestatus = $result['status'] ?? null;
        $job->timemodified = time();
        $DB->update_record('local_awakeinfographic_job', $job);

        $this->requeue($job, 30);
    }

    protected function poll(api_client $client, \stdClass $job): void {
        global $DB;

        try {
            $status = $client->get_status($job->remotejobid);
        } catch (api_exception $e) {
            if ($e->apicode === 'queue_full') {
                $this->requeue($job, max($e->retryafterseconds ?? 30, 30));
                return;
            }
            if ($e->apicode === 'job_not_found') {
                $this->fail($job, $e->apicode, get_string('error:remotenotfound', 'local_awakeinfographic'));
                return;
            }
            // Fallo de red o del motor: se reintenta con el mismo backoff que "sigue en curso".
            $this->requeue($job, $this->backoff($job->attempts));
            return;
        }

        $job->remotestatus = $status['status'] ?? null;
        $job->score = $status['bestScore'] ?? $status['currentScore'] ?? null;
        $job->passcount = $status['passCount'] ?? null;

        if (($status['status'] ?? '') === 'failed') {
            $this->fail($job, 'remote_failed', $status['error'] ?? get_string('error:remotefailed', 'local_awakeinfographic'));
            return;
        }

        if (($status['status'] ?? '') === 'done') {
            $this->download_result($client, $job);
            return;
        }

        // Sigue en curso: se guarda el progreso y se reencola. Nunca se lanza.
        $job->status = job::STATUS_RUNNING;
        $job->timemodified = time();
        $DB->update_record('local_awakeinfographic_job', $job);
        $this->requeue($job, $this->backoff($job->attempts));
    }

    protected function download_result(api_client $client, \stdClass $job): void {
        global $DB;

        try {
            $html = $client->download_html($job->remotejobid);
            $preview = $client->download_preview($job->remotejobid);
        } catch (api_exception $e) {
            // El job terminó bien en el motor pero la descarga falló (red, timeout…): se reintenta.
            $this->requeue($job, $this->backoff($job->attempts));
            return;
        }

        if (!$this->passes_safety_check($html)) {
            $this->fail($job, 'unsafe_html', get_string('error:unsafehtml', 'local_awakeinfographic'));
            return;
        }

        $usercontext = \context_user::instance($job->userid);
        $fs = get_file_storage();

        $fs->delete_area_files($usercontext->id, 'local_awakeinfographic', 'result', $job->id);
        $fs->create_file_from_string([
            'contextid' => $usercontext->id,
            'component' => 'local_awakeinfographic',
            'filearea' => 'result',
            'itemid' => $job->id,
            'filepath' => '/',
            'filename' => 'infographic.html',
        ], $html);

        $fs->delete_area_files($usercontext->id, 'local_awakeinfographic', 'preview', $job->id);
        $fs->create_file_from_string([
            'contextid' => $usercontext->id,
            'component' => 'local_awakeinfographic',
            'filearea' => 'preview',
            'itemid' => $job->id,
            'filepath' => '/',
            'filename' => 'preview.png',
        ], $preview);

        $job->status = job::STATUS_DONE;
        $job->errorcode = null;
        $job->errormessage = null;
        $job->timemodified = time();
        $DB->update_record('local_awakeinfographic_job', $job);
    }

    /**
     * Defensa en profundidad, además del saneado que ya hace el motor
     * (`sanitizeHtml()`, orchestrator.ts): si aparece `<script`, un atributo
     * `on*=` o una URL externa fuera de Google Fonts, se rechaza el
     * resultado. Ver PLAN_MOODLE.md §4.4, punto 2.
     */
    protected function passes_safety_check(string $html): bool {
        if (preg_match('/<script\b/i', $html)) {
            return false;
        }
        if (preg_match('/\son\w+\s*=/i', $html)) {
            return false;
        }
        if (preg_match_all('/https?:\/\/([^\s"\'<>)]+)/i', $html, $matches)) {
            foreach ($matches[1] as $match) {
                $host = strtolower(explode('/', $match)[0]);
                if (!in_array($host, ['fonts.googleapis.com', 'fonts.gstatic.com'], true)) {
                    return false;
                }
            }
        }
        return true;
    }

    /** 30 s, 60 s, 120 s, tope 120 s (PLAN_MOODLE.md §4.3). */
    protected function backoff(int $attempts): int {
        return min(30 * (2 ** min($attempts, 2)), 120);
    }

    protected function requeue(\stdClass $job, int $delayseconds, array $extradata = []): void {
        global $DB;

        $job->attempts++;
        $job->timemodified = time();
        $DB->update_record('local_awakeinfographic_job', $job);

        if ($job->attempts >= job::MAXATTEMPTS) {
            $this->fail($job, 'timeout', get_string('error:timeout', 'local_awakeinfographic'));
            return;
        }

        $task = new self();
        $task->set_custom_data(array_merge(['jobid' => $job->id], $extradata));
        $task->set_next_run_time(time() + $delayseconds);
        \core\task\manager::queue_adhoc_task($task, false);
    }

    protected function fail(\stdClass $job, string $errorcode, string $errormessage): void {
        global $DB;

        $job->status = job::STATUS_FAILED;
        $job->errorcode = $errorcode;
        $job->errormessage = $errormessage;
        $job->timemodified = time();
        $DB->update_record('local_awakeinfographic_job', $job);
    }
}

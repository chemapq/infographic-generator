<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

/**
 * Entidad + CRUD sobre `local_awakeinfographic_job` y el pegamento con la
 * File API. Ver PLAN_MOODLE.md §4.1 (tabla) y §4.3 (flujo).
 */
class job {
    const STATUS_PENDING = 'pending';
    const STATUS_SUBMITTED = 'submitted';
    const STATUS_RUNNING = 'running';
    const STATUS_DONE = 'done';
    const STATUS_FAILED = 'failed';

    /** Sondeos máximos antes de `failed` con `errorcode = 'timeout'` (§4.3, §6). */
    const MAXATTEMPTS = 40;

    /**
     * Inserta la fila, copia la imagen del área de borrador del formulario al
     * filearea `source`, y encola la primera tarea de sincronización.
     */
    public static function create_from_form(\stdClass $data, int $userid): int {
        global $DB;

        $record = new \stdClass();
        $record->userid = $userid;
        $record->courseid = !empty($data->courseid) ? (int) $data->courseid : null;
        $record->remotejobid = null;
        // Generada aquí, antes del primer envío: es lo que hace seguro un
        // reintento del profesor o de la propia tarea (PLAN_MOODLE.md §6).
        $record->idempotencykey = random_string(32);
        $record->title = $data->title;
        $record->status = self::STATUS_PENDING;
        $record->remotestatus = null;
        $record->score = null;
        $record->passcount = null;
        $record->attempts = 0;
        $record->errorcode = null;
        $record->errormessage = null;
        $record->timecreated = time();
        $record->timemodified = $record->timecreated;
        $record->id = $DB->insert_record('local_awakeinfographic_job', $record);

        $context = \context_user::instance($userid);
        file_save_draft_area_files(
            $data->image,
            $context->id,
            'local_awakeinfographic',
            'source',
            $record->id,
            ['subdirs' => 0, 'maxfiles' => 1]
        );

        $maxpasses = (int) ($data->maxpasses ?: (get_config('local_awakeinfographic', 'maxpassesdefault') ?: 3));
        $task = new \local_awakeinfographic\task\sync_job();
        $task->set_custom_data([
            'jobid' => $record->id,
            'notes' => (string) ($data->notes ?? ''),
            'maxpasses' => $maxpasses,
        ]);
        \core\task\manager::queue_adhoc_task($task);

        return $record->id;
    }

    public static function get(int $id): \stdClass {
        global $DB;
        return $DB->get_record('local_awakeinfographic_job', ['id' => $id], '*', MUST_EXIST);
    }

    public static function can_view(\stdClass $job, int $userid): bool {
        if ((int) $job->userid === $userid) {
            return true;
        }
        return has_capability('local/awakeinfographic:viewall', \context_system::instance());
    }

    public static function is_finished(\stdClass $job): bool {
        return in_array($job->status, [self::STATUS_DONE, self::STATUS_FAILED], true);
    }

    /**
     * Borra los ficheros, la fila, e intenta el borrado remoto. Que el
     * borrado remoto falle no impide el local: se registra y se sigue
     * (PLAN_MOODLE.md §4.3).
     */
    public static function delete(\stdClass $job): void {
        global $DB;

        $context = \context_user::instance($job->userid);
        $fs = get_file_storage();
        foreach (['source', 'result', 'preview'] as $filearea) {
            $fs->delete_area_files($context->id, 'local_awakeinfographic', $filearea, $job->id);
        }

        if ($job->remotejobid) {
            try {
                (new api_client())->delete_job($job->remotejobid);
            } catch (\Throwable $e) {
                debugging(
                    'local_awakeinfographic: no se pudo borrar el job remoto ' . $job->remotejobid . ': ' . $e->getMessage(),
                    DEBUG_NORMAL
                );
            }
        }

        $DB->delete_records('local_awakeinfographic_job', ['id' => $job->id]);
    }

    public static function get_source_file(\stdClass $job): ?\stored_file {
        $context = \context_user::instance($job->userid);
        $fs = get_file_storage();
        $files = $fs->get_area_files($context->id, 'local_awakeinfographic', 'source', $job->id, 'itemid', false);
        return $files ? reset($files) : null;
    }
}

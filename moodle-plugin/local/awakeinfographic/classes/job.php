<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

// get_file_storage()... no siempre está cargada por defecto según el punto
// de entrada que autocargue esta clase.
require_once($CFG->libdir . '/filelib.php');

/**
 * Entidad + CRUD sobre `local_awakeinfographic_job` y el pegamento con la
 * File API. El historial de versiones vive en `version` (clase hermana), no
 * aquí. Ver PLAN_MOODLE.md §6.2.
 */
class job {
    const STATUS_PENDING = 'pending';
    const STATUS_SUBMITTED = 'submitted';
    const STATUS_RUNNING = 'running';
    const STATUS_DONE = 'done';
    const STATUS_FAILED = 'failed';

    /** Sondeos máximos antes de `failed` con `errorcode = 'timeout'` (§6.12). */
    const MAXATTEMPTS = 40;

    /**
     * Inserta la fila, guarda la imagen subida en el filearea `source`
     * (itemid = id del job), y encola la primera tarea de sincronización.
     * `$tmpfilepath` es la ruta al fichero temporal que dejó la subida de
     * `ajax/create.php` (no un draft area: es una llamada `fetch()`, no un
     * `moodleform`).
     */
    public static function create(
        int $userid,
        ?int $courseid,
        string $title,
        string $tmpfilepath,
        string $filename,
        string $mimetype,
        string $notes,
        int $maxpasses
    ): \stdClass {
        global $DB;

        $record = new \stdClass();
        $record->userid = $userid;
        $record->courseid = $courseid;
        $record->remotejobid = null;
        // Generada aquí, antes del primer envío: es lo que hace seguro un
        // reintento del profesor o de la propia tarea (§6.12).
        $record->idempotencykey = random_string(32);
        $record->title = $title;
        $record->width = null;
        $record->height = null;
        $record->status = self::STATUS_PENDING;
        $record->remotestatus = null;
        $record->currentversion = null;
        $record->bestversion = null;
        $record->attempts = 0;
        $record->errorcode = null;
        $record->errormessage = null;
        $record->timecreated = time();
        $record->timemodified = $record->timecreated;
        $record->id = $DB->insert_record('local_awakeinfographic_job', $record);

        $context = \context_user::instance($userid);
        get_file_storage()->create_file_from_pathname([
            'contextid' => $context->id,
            'component' => 'local_awakeinfographic',
            'filearea' => 'source',
            'itemid' => $record->id,
            'filepath' => '/',
            'filename' => $filename !== '' ? $filename : 'original',
            'mimetype' => $mimetype,
        ], $tmpfilepath);

        $task = new \local_awakeinfographic\task\sync_job();
        $task->set_custom_data([
            'jobid' => $record->id,
            'notes' => $notes,
            'maxpasses' => $maxpasses,
        ]);
        \core\task\manager::queue_adhoc_task($task);

        return $record;
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

    /** La edición con IA cuesta tokens: capability propia, separada de poder ver/editar a mano (§6.3). */
    public static function can_edit_with_ai(\stdClass $job, int $userid): bool {
        if (!self::can_view($job, $userid)) {
            return false;
        }
        if (!(bool) get_config('local_awakeinfographic', 'allowaiedit')) {
            return false;
        }
        return has_capability('local/awakeinfographic:edit', \context_system::instance());
    }

    public static function is_finished(\stdClass $job): bool {
        return in_array($job->status, [self::STATUS_DONE, self::STATUS_FAILED], true);
    }

    public static function rename(\stdClass $job, string $title): void {
        global $DB;
        $DB->set_field('local_awakeinfographic_job', 'title', $title, ['id' => $job->id]);
        $DB->set_field('local_awakeinfographic_job', 'timemodified', time(), ['id' => $job->id]);
    }

    public static function set_dimensions(int $jobid, int $width, int $height): void {
        global $DB;
        $DB->set_field('local_awakeinfographic_job', 'width', $width, ['id' => $jobid]);
        $DB->set_field('local_awakeinfographic_job', 'height', $height, ['id' => $jobid]);
    }

    public static function set_current_version(int $jobid, int $versionno): void {
        global $DB;
        $DB->set_field('local_awakeinfographic_job', 'currentversion', $versionno, ['id' => $jobid]);
        $DB->set_field('local_awakeinfographic_job', 'timemodified', time(), ['id' => $jobid]);
    }

    /** Recalcula `bestversion`: la de mejor score entre las versiones `generate`/`refine`. */
    public static function update_best_version(int $jobid): void {
        global $DB;
        $sql = "SELECT versionno
                  FROM {local_awakeinfographic_version}
                 WHERE jobid = :jobid AND origin IN ('generate', 'refine') AND score IS NOT NULL
              ORDER BY score DESC, versionno ASC";
        $rows = $DB->get_records_sql($sql, ['jobid' => $jobid], 0, 1);
        $bestversion = $rows ? (int) reset($rows)->versionno : null;
        $DB->set_field('local_awakeinfographic_job', 'bestversion', $bestversion, ['id' => $jobid]);
    }

    /**
     * Borra las versiones (fila + ficheros), la fuente, la fila del job, e
     * intenta el borrado remoto. Que el borrado remoto falle no impide el
     * local (§6.4).
     */
    public static function delete(\stdClass $job): void {
        global $DB;

        $context = \context_user::instance($job->userid);
        $fs = get_file_storage();

        $versions = $DB->get_records('local_awakeinfographic_version', ['jobid' => $job->id]);
        foreach ($versions as $v) {
            $fs->delete_area_files($context->id, 'local_awakeinfographic', 'version', $v->id);
            $fs->delete_area_files($context->id, 'local_awakeinfographic', 'preview', $v->id);
        }
        $fs->delete_area_files($context->id, 'local_awakeinfographic', 'source', $job->id);

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

        $DB->delete_records('local_awakeinfographic_version', ['jobid' => $job->id]);
        $DB->delete_records('local_awakeinfographic_job', ['id' => $job->id]);
    }

    public static function get_source_file(\stdClass $job): ?\stored_file {
        $context = \context_user::instance($job->userid);
        $fs = get_file_storage();
        $files = $fs->get_area_files($context->id, 'local_awakeinfographic', 'source', $job->id, 'itemid', false);
        return $files ? reset($files) : null;
    }
}

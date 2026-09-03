<?php
namespace local_awakeinfographic\task;

defined('MOODLE_INTERNAL') || die();

use local_awakeinfographic\job;

/**
 * Purga los jobs fallidos antiguos: sin esto, un motor caído deja tareas ad
 * hoc reintentando hasta MAXATTEMPTS pero las filas `failed` se acumulan sin
 * límite (PLAN_MOODLE.md §6). Los activos ya descargados (`status = done`)
 * no se tocan.
 */
class cleanup extends \core\task\scheduled_task {

    /** Días tras los que se purga un job en `failed`. */
    const FAILED_RETENTION_DAYS = 30;

    public function get_name() {
        return get_string('task:cleanup', 'local_awakeinfographic');
    }

    public function execute() {
        global $DB;

        $cutoff = time() - self::FAILED_RETENTION_DAYS * DAYSECS;
        $jobs = $DB->get_records_select(
            'local_awakeinfographic_job',
            'status = :status AND timemodified < :cutoff',
            ['status' => job::STATUS_FAILED, 'cutoff' => $cutoff]
        );

        foreach ($jobs as $row) {
            mtrace('local_awakeinfographic: purgando job fallido ' . $row->id . ' (' . $row->title . ')');
            job::delete($row);
        }
    }
}

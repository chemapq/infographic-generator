<?php
namespace local_awakeinfographic\ajax;

defined('MOODLE_INTERNAL') || die();

use local_awakeinfographic\job;

/** `DELETE /api/jobs/:id` -> borra versiones, ficheros y fila; intenta el borrado remoto. Ver PLAN_MOODLE.md §6.4. */
function handle_delete(int $id): void {
    $job = required_job($id);
    job::delete($job);
    respond_json(null, 204);
}

<?php
namespace local_awakeinfographic\ajax;

defined('MOODLE_INTERNAL') || die();

use local_awakeinfographic\job_shape;

/** `GET /api/jobs/:id` -> forma de JobRecord, desde las tablas de Moodle. Ver PLAN_MOODLE.md §6.4, §6.9. */
function handle_status(int $id): void {
    $job = required_job($id);
    respond_json(job_shape::build($job));
}

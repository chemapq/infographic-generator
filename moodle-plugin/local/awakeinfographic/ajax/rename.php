<?php
namespace local_awakeinfographic\ajax;

defined('MOODLE_INTERNAL') || die();

use local_awakeinfographic\job;

/** `PATCH /api/jobs/:id` -> renombra. Ver PLAN_MOODLE.md §6.4. */
function handle_rename(int $id): void {
    $job = required_job($id);
    $body = json_body();
    $title = text_field($body, 'title', 255);
    if ($title === '') {
        respond_error(400, 'missing_title', get_string('error:missingtitle', 'local_awakeinfographic'));
    }
    job::rename($job, $title);
    respond_json(['ok' => true, 'title' => $title]);
}

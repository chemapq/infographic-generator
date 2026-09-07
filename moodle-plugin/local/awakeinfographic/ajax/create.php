<?php
namespace local_awakeinfographic\ajax;

defined('MOODLE_INTERNAL') || die();

use local_awakeinfographic\job;

/** `POST /api/jobs` (multipart) -> fila + tarea ad hoc. Ver PLAN_MOODLE.md §6.4. */
function handle_create(): void {
    global $USER;

    require_capability('local/awakeinfographic:generate', \context_system::instance());

    if (empty($_FILES['image']) || ($_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        respond_error(400, 'missing_image', get_string('error:missingimage', 'local_awakeinfographic'));
    }
    $upload = $_FILES['image'];
    $maxbytes = 25 * 1024 * 1024;
    if ((int) $upload['size'] > $maxbytes) {
        respond_error(413, 'image_too_large', get_string('error:imagetoolarge', 'local_awakeinfographic'));
    }

    $originalname = clean_param($upload['name'], PARAM_FILE);
    $title = pathinfo($originalname, PATHINFO_FILENAME);
    if ($title === '') {
        $title = get_string('pluginname', 'local_awakeinfographic');
    }

    $requestedmaxpasses = (int) ($_POST['maxPasses'] ?? 0);
    $default = (int) (get_config('local_awakeinfographic', 'maxpassesdefault') ?: 3);
    $maxpasses = $requestedmaxpasses > 0 ? min(max($requestedmaxpasses, 1), 8) : $default;
    $notes = text_field($_POST, 'notes', 2000);
    $courseid = (int) ($_POST['courseid'] ?? 0) ?: null;

    $job = job::create(
        (int) $USER->id,
        $courseid,
        $title,
        $upload['tmp_name'],
        $originalname,
        mimeinfo('type', $originalname) ?: 'application/octet-stream',
        $notes,
        $maxpasses
    );

    respond_json(['jobId' => (string) $job->id, 'status' => $job->status], 202);
}

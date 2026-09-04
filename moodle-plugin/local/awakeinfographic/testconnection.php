<?php
require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/filelib.php');

require_login();
$context = context_system::instance();
require_capability('moodle/site:config', $context);

$PAGE->set_context($context);
$PAGE->set_url(new moodle_url('/local/awakeinfographic/testconnection.php'));
$PAGE->set_title(get_string('setting:testconnection', 'local_awakeinfographic'));
$PAGE->set_heading(get_string('setting:testconnection', 'local_awakeinfographic'));
$PAGE->set_pagelayout('admin');

$settingsurl = new moodle_url('/admin/settings.php', ['section' => 'local_awakeinfographic']);

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('setting:testconnection', 'local_awakeinfographic'));

try {
    $health = (new \local_awakeinfographic\api_client())->health();
    echo $OUTPUT->notification(
        get_string('testconnection:ok', 'local_awakeinfographic', $health['model'] ?? '?'),
        \core\output\notification::NOTIFY_SUCCESS
    );
    echo html_writer::tag('pre', s(json_encode($health, JSON_PRETTY_PRINT)));
} catch (\Throwable $e) {
    // Nunca se vuelca la clave: solo el mensaje de fallo de conexión/HTTP.
    echo $OUTPUT->notification(
        get_string('testconnection:fail', 'local_awakeinfographic', $e->getMessage()),
        \core\output\notification::NOTIFY_ERROR
    );
}

echo html_writer::link($settingsurl, get_string('back'));
echo $OUTPUT->footer();

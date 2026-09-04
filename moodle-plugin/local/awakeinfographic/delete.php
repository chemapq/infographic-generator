<?php
require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/filelib.php');

$id = required_param('id', PARAM_INT);
$confirm = optional_param('confirm', 0, PARAM_BOOL);

require_login();
$context = context_system::instance();
$job = \local_awakeinfographic\job::get($id);

if (!\local_awakeinfographic\job::can_view($job, (int) $USER->id)) {
    throw new \moodle_exception('error:noaccess', 'local_awakeinfographic');
}

$PAGE->set_context($context);
$PAGE->set_url(new moodle_url('/local/awakeinfographic/delete.php', ['id' => $id]));
$PAGE->set_pagelayout('admin');

$indexurl = new moodle_url('/local/awakeinfographic/index.php');

if ($confirm && confirm_sesskey()) {
    \local_awakeinfographic\job::delete($job);
    redirect($indexurl, get_string('deleted', 'local_awakeinfographic'), null, \core\output\notification::NOTIFY_SUCCESS);
}

echo $OUTPUT->header();
echo $OUTPUT->confirm(
    get_string('delete:confirm', 'local_awakeinfographic', format_string($job->title)),
    new moodle_url('/local/awakeinfographic/delete.php', ['id' => $id, 'confirm' => 1, 'sesskey' => sesskey()]),
    $indexurl
);
echo $OUTPUT->footer();

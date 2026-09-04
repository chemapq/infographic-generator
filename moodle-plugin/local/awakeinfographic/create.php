<?php
require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/adminlib.php');
require_once($CFG->libdir . '/filelib.php');
require_once($CFG->dirroot . '/local/awakeinfographic/classes/form/create_form.php');

$courseid = optional_param('courseid', 0, PARAM_INT);

// Registrada como admin_externalpage en settings.php: esto hace require_login(),
// comprueba la capability del nodo y deja el árbol de administración resaltado.
admin_externalpage_setup('local_awakeinfographic_create');
$PAGE->set_url(new moodle_url('/local/awakeinfographic/create.php', ['courseid' => $courseid]));

$form = new \local_awakeinfographic\form\create_form(null, ['courseid' => $courseid]);

if ($form->is_cancelled()) {
    redirect(new moodle_url('/local/awakeinfographic/index.php'));
} else if ($data = $form->get_data()) {
    $jobid = \local_awakeinfographic\job::create_from_form($data, (int) $USER->id);
    redirect(
        new moodle_url('/local/awakeinfographic/view.php', ['id' => $jobid]),
        get_string('submitted', 'local_awakeinfographic'),
        null,
        \core\output\notification::NOTIFY_SUCCESS
    );
}

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('newinfographic', 'local_awakeinfographic'));
echo $OUTPUT->notification(get_string('form:intro', 'local_awakeinfographic'), \core\output\notification::NOTIFY_INFO);
$form->display();
echo $OUTPUT->footer();

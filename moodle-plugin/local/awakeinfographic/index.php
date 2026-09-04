<?php
require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/adminlib.php');

// Registrada como admin_externalpage en settings.php: esto hace require_login(),
// comprueba la capability del nodo y deja el árbol de administración resaltado.
admin_externalpage_setup('local_awakeinfographic_list');
$context = context_system::instance();

$viewall = has_capability('local/awakeinfographic:viewall', $context);
$conditions = $viewall ? [] : ['userid' => $USER->id];
$jobs = $DB->get_records('local_awakeinfographic_job', $conditions, 'timemodified DESC');

$hasrunning = false;
$haspendingtoolong = false;
$stalecutoff = time() - 5 * MINSECS;
foreach ($jobs as $row) {
    if (!\local_awakeinfographic\job::is_finished($row)) {
        $hasrunning = true;
    }
    if ($row->status === \local_awakeinfographic\job::STATUS_PENDING && $row->timecreated < $stalecutoff) {
        $haspendingtoolong = true;
    }
}
if ($hasrunning) {
    // Con algún job en curso, recarga simple: cinco líneas, no miente, y no
    // hace falta un web service ni un módulo AMD para la v1 (PLAN_MOODLE.md §4.3, paso 4).
    $PAGE->set_periodicrefreshdelay(15);
}

// El fallo número uno de quien empieza con tareas ad hoc: el cron de Moodle
// no corre y nada se mueve nunca. Un job en pending más de 5 minutos con el
// cron parado es la pista (PLAN_MOODLE.md §6). Solo se calcula aquí; se
// pinta más abajo, después de $OUTPUT->header().
$showcronwarning = false;
if ($haspendingtoolong) {
    $lastcron = \core\task\manager::get_last_cron_start();
    $showcronwarning = !$lastcron || $lastcron < $stalecutoff;
}

$rows = [];
foreach ($jobs as $row) {
    $rows[] = [
        'id' => $row->id,
        'title' => format_string($row->title),
        'status' => get_string('status:' . $row->status, 'local_awakeinfographic'),
        'statusraw' => $row->status,
        'score' => $row->score !== null ? number_format((float) $row->score, 2) . '%' : '—',
        'timecreated' => userdate($row->timecreated, get_string('strftimedatetimeshort', 'langconfig')),
        'viewurl' => (new moodle_url('/local/awakeinfographic/view.php', ['id' => $row->id]))->out(false),
        'owner' => $viewall ? fullname(\core_user::get_user($row->userid)) : null,
    ];
}

echo $OUTPUT->header();
if ($showcronwarning) {
    echo $OUTPUT->notification(
        get_string('warning:croninactive', 'local_awakeinfographic'),
        \core\output\notification::NOTIFY_WARNING
    );
}
echo $OUTPUT->heading(get_string('pluginname', 'local_awakeinfographic'));
echo html_writer::link(
    new moodle_url('/local/awakeinfographic/create.php'),
    get_string('newinfographic', 'local_awakeinfographic'),
    ['class' => 'btn btn-primary mb-3']
);

echo $OUTPUT->render_from_template('local_awakeinfographic/list', [
    'jobs' => array_values($rows),
    'hasjobs' => count($rows) > 0,
    'viewall' => $viewall,
]);

echo $OUTPUT->footer();

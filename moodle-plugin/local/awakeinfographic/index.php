<?php
require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/adminlib.php');
require_once($CFG->libdir . '/filelib.php');

// Registrada como admin_externalpage en settings.php: esto hace require_login(),
// comprueba la capability del nodo y deja el árbol de administración
// resaltado si se llega desde ahí. `embedded` se aplica después, para que la
// página se vea como la app y no como un Moodle (PLAN_MOODLE.md §6.5).
admin_externalpage_setup('local_awakeinfographic_list');
$PAGE->set_pagelayout('embedded');
$PAGE->set_url(new moodle_url('/local/awakeinfographic/index.php'));
$PAGE->set_title(get_string('pluginname', 'local_awakeinfographic'));
$PAGE->set_heading(get_string('pluginname', 'local_awakeinfographic'));

// El fallo número uno de quien empieza con tareas ad hoc: el cron de Moodle
// no corre y nada se mueve nunca. Un job en pending más de 5 minutos con el
// cron parado es la pista. Comprobación defensiva: no todas las versiones de
// Moodle tienen `get_last_cron_start()` (ya ha pasado con otras APIs en este
// plugin) — es solo un aviso de cortesía, nunca debe tumbar la página.
$stalecutoff = time() - 5 * MINSECS;
$haspendingtoolong = $DB->record_exists_select(
    'local_awakeinfographic_job',
    'userid = :userid AND status = :status AND timecreated < :cutoff',
    ['userid' => $USER->id, 'status' => \local_awakeinfographic\job::STATUS_PENDING, 'cutoff' => $stalecutoff]
);
$showcronwarning = false;
if ($haspendingtoolong && method_exists('\core\task\manager', 'get_last_cron_start')) {
    $lastcron = \core\task\manager::get_last_cron_start();
    $showcronwarning = !$lastcron || $lastcron < $stalecutoff;
}

$PAGE->requires->css(new moodle_url('https://fonts.googleapis.com/css2', [
    'family' => 'Poppins:wght@300;400;500;600;700',
    'display' => 'swap',
]));
$PAGE->requires->css(new moodle_url('/local/awakeinfographic/styles/app.css'));

// `IG_CONFIG` se inyecta en línea (no como js/config.js estático): lleva el
// sesskey y las URLs de este Moodle concreto, que solo se conocen en tiempo
// de petición (§6.5). `sse`/`auth` apagados: PHP-FPM no sostiene SSE y la
// sesión es la del propio Moodle.
$igconfig = [
    'apiBase' => (new moodle_url('/local/awakeinfographic/ajax/index.php'))->out(false),
    'filesBase' => (new moodle_url('/local/awakeinfographic/files.php'))->out(false),
    'extraParams' => ['sesskey' => sesskey()],
    'features' => ['sse' => false, 'auth' => false, 'score' => true],
];

echo $OUTPUT->header();
if ($showcronwarning) {
    echo $OUTPUT->notification(
        get_string('warning:croninactive', 'local_awakeinfographic'),
        \core\output\notification::NOTIFY_WARNING
    );
}

echo $OUTPUT->render_from_template('local_awakeinfographic/app', [
    'igconfigjson' => json_encode($igconfig),
    'apijsurl' => (new moodle_url('/local/awakeinfographic/js/api.js'))->out(false),
    'editorjsurl' => (new moodle_url('/local/awakeinfographic/js/editor.js'))->out(false),
    'appjsurl' => (new moodle_url('/local/awakeinfographic/js/app.js'))->out(false),
]);

echo $OUTPUT->footer();

<?php
require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/adminlib.php');

// Registrada como admin_externalpage en settings.php: esto hace require_login()
// y comprueba la capability del nodo. `embedded` se aplica después, para que la
// ventana la ocupe la app y no la cabecera de Moodle.
admin_externalpage_setup('local_awakeinfographic_list');
$PAGE->set_pagelayout('embedded');
$PAGE->set_url(new moodle_url('/local/awakeinfographic/index.php'));
$PAGE->set_title(get_string('pluginname', 'local_awakeinfographic'));
$PAGE->set_heading(get_string('pluginname', 'local_awakeinfographic'));
$PAGE->add_body_class('local-awakeinfographic-embed');
$PAGE->requires->css(new moodle_url('/local/awakeinfographic/styles/frame.css'));

// Se calcula antes del header: si no hay configuración no hay iframe que
// pintar, y el aviso tiene que salir dentro de la página, no como excepción.
$embedurl = \local_awakeinfographic\embed::url();

echo $OUTPUT->header();

if ($embedurl === null) {
    echo $OUTPUT->notification(
        get_string('error:notconfigured', 'local_awakeinfographic'),
        \core\output\notification::NOTIFY_ERROR
    );
} else {
    echo $OUTPUT->render_from_template('local_awakeinfographic/frame', [
        'src' => $embedurl->out(false),
        'title' => get_string('frame:title', 'local_awakeinfographic'),
    ]);
}

echo $OUTPUT->footer();

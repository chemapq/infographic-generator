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
$baseurl = rtrim((string) get_config('local_awakeinfographic', 'apibaseurl'), '/');

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('setting:testconnection', 'local_awakeinfographic'));

if ($baseurl === '') {
    echo $OUTPUT->notification(
        get_string('error:notconfigured', 'local_awakeinfographic'),
        \core\output\notification::NOTIFY_ERROR
    );
} else {
    // `/api/v1/health` no pide clave, así que basta un GET pelado: el plugin ya
    // no habla con la API para nada más. `ignoresecurity` porque la URL la pone
    // un administrador y sin esto apuntar a host.docker.internal o a una IP
    // privada lo puede bloquear $CFG->curlsecurityblockedhosts con un error
    // que no dice por qué.
    $curl = new curl(['ignoresecurity' => true]);
    $raw = $curl->get($baseurl . '/api/v1/health', [], ['connecttimeout' => 10, 'timeout' => 15]);
    $status = (int) ($curl->get_info()['http_code'] ?? 0);
    $health = json_decode((string) $raw, true);

    if ($status >= 200 && $status < 300 && is_array($health)) {
        echo $OUTPUT->notification(
            get_string('testconnection:ok', 'local_awakeinfographic', $health['model'] ?? '?'),
            \core\output\notification::NOTIFY_SUCCESS
        );
        echo html_writer::tag('pre', s(json_encode($health, JSON_PRETTY_PRINT)));
    } else {
        // Nunca se vuelca nada más que el fallo de conexión o el HTTP: el
        // cuerpo de un error del motor puede llevar detalles de su entorno.
        $detail = $status > 0
            ? get_string('testconnection:httpstatus', 'local_awakeinfographic', $status)
            : ($curl->error !== '' ? $curl->error : get_string('testconnection:noreply', 'local_awakeinfographic'));
        echo $OUTPUT->notification(
            get_string('testconnection:fail', 'local_awakeinfographic', $detail),
            \core\output\notification::NOTIFY_ERROR
        );
    }
}

// Sin el secreto compartido el iframe no puede abrirse, y el síntoma (un 403
// dentro del marco) no apunta a este ajuste por ninguna parte.
if (trim((string) get_config('local_awakeinfographic', 'embedsecret')) === '') {
    echo $OUTPUT->notification(
        get_string('testconnection:nosecret', 'local_awakeinfographic'),
        \core\output\notification::NOTIFY_WARNING
    );
}

echo html_writer::link($settingsurl, get_string('back'));
echo $OUTPUT->footer();

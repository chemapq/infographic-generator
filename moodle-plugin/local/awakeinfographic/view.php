<?php
require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/filelib.php');

$id = required_param('id', PARAM_INT);

require_login();
$context = context_system::instance();
$job = \local_awakeinfographic\job::get($id);

if (!\local_awakeinfographic\job::can_view($job, (int) $USER->id)) {
    throw new \moodle_exception('error:noaccess', 'local_awakeinfographic');
}

$PAGE->set_context($context);
$PAGE->set_url(new moodle_url('/local/awakeinfographic/view.php', ['id' => $id]));
$PAGE->set_title(format_string($job->title));
$PAGE->set_heading(format_string($job->title));
$PAGE->set_pagelayout('admin');

if (!\local_awakeinfographic\job::is_finished($job)) {
    // moodle_page::set_periodicrefreshdelay() no existe en todas las versiones
    // (comprobado: Moodle 4.4.2 no la tiene); un timeout de JS sí es estable.
    $PAGE->requires->js_init_code('setTimeout(function() { window.location.reload(); }, 15000);');
}

$usercontext = context_user::instance($job->userid);
$fs = get_file_storage();
$resultfiles = $fs->get_area_files($usercontext->id, 'local_awakeinfographic', 'result', $job->id, 'itemid', false);
$resultfile = $resultfiles ? reset($resultfiles) : null;

$previewurl = null;
$downloadurl = null;
if ($resultfile) {
    // inline (sandbox="" en el iframe) para previsualizar, attachment para el botón de descarga.
    $previewurl = \moodle_url::make_pluginfile_url(
        $usercontext->id, 'local_awakeinfographic', 'result', $job->id, '/', $resultfile->get_filename(), false
    );
    $downloadurl = \moodle_url::make_pluginfile_url(
        $usercontext->id, 'local_awakeinfographic', 'result', $job->id, '/', $resultfile->get_filename(), true
    );
}

echo $OUTPUT->header();
echo $OUTPUT->heading(format_string($job->title));

echo $OUTPUT->render_from_template('local_awakeinfographic/detail', [
    'status' => get_string('status:' . $job->status, 'local_awakeinfographic'),
    'isdone' => $job->status === \local_awakeinfographic\job::STATUS_DONE,
    'isfailed' => $job->status === \local_awakeinfographic\job::STATUS_FAILED,
    'score' => $job->score !== null ? number_format((float) $job->score, 2) . '%' : null,
    'errormessage' => $job->errormessage,
    'previewurl' => $previewurl ? $previewurl->out(false) : null,
    'downloadurl' => $downloadurl ? $downloadurl->out(false) : null,
    'deleteurl' => (new moodle_url('/local/awakeinfographic/delete.php', ['id' => $job->id]))->out(false),
    'indexurl' => (new moodle_url('/local/awakeinfographic/index.php'))->out(false),
]);

echo $OUTPUT->footer();

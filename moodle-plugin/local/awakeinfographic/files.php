<?php
/**
 * Punto de entrada único de `fileUrl()` en Moodle (`IG_CONFIG.filesBase =
 * '/local/awakeinfographic/files.php'`). Igual que `ajax/index.php` con las
 * llamadas de API, este script despacha por `PATH_INFO` las rutas de fichero
 * que `app.js`/`editor.js` ya construyen (`/api/jobs/:id/assets/…`,
 * `/api/jobs/:id/result`, `/api/jobs/:id/thumb`) hacia la File API, sin
 * tocar ninguno de los dos ficheros. Ver PLAN_MOODLE.md §4.1, §6.4, §6.10.
 */

require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/filelib.php');
require_once(__DIR__ . '/ajax/lib.php');

use function local_awakeinfographic\ajax\resolve_pathinfo;
use local_awakeinfographic\job;
use local_awakeinfographic\version;

require_login();

$path = rtrim(resolve_pathinfo(), '/');

$job = null;
if (preg_match('#^/(\d+)/#', $path, $m) || preg_match('#^/(\d+)$#', $path, $m)) {
    global $DB, $USER;
    $job = $DB->get_record('local_awakeinfographic_job', ['id' => (int) $m[1]]);
    if (!$job || !job::can_view($job, (int) $USER->id)) {
        $job = null;
    }
}
if (!$job) {
    send_file_not_found();
}

/** El original subido por el profesor: el mejor "algo" que mostrar cuando una versión no tiene captura propia. */
function local_awakeinfographic_files_send_original(\stdClass $job): void {
    $file = job::get_source_file($job);
    if (!$file) {
        send_file_not_found();
    }
    send_stored_file($file, 0, 0, false, ['filename' => 'original.png']);
}

if (preg_match('#^/\d+/assets/original\.png$#', $path)) {
    local_awakeinfographic_files_send_original($job);
}

if (preg_match('#^/\d+/assets/passes/(\d+)$#', $path, $m)) {
    $version = null;
    try {
        $version = version::get((int) $m[1]);
    } catch (\dml_missing_record_exception $e) {
        send_file_not_found();
    }
    if ((int) $version->jobid !== (int) $job->id) {
        send_file_not_found();
    }
    $file = version::get_preview_file($version, $job);
    if ($file) {
        send_stored_file($file, 0, 0, false, ['filename' => 'preview.png']);
    }
    // Sin captura propia (versiones `ai`/`manual`): se cae al original en
    // vez de un 404, para que el <img> del historial no se rompa.
    local_awakeinfographic_files_send_original($job);
}

if (preg_match('#^/\d+/thumb$#', $path)) {
    $versionno = $job->currentversion;
    $version = $versionno !== null ? version::get_by_versionno((int) $job->id, (int) $versionno) : null;
    $file = $version ? version::get_preview_file($version, $job) : null;
    if ($file) {
        send_stored_file($file, 60, 0, false, ['filename' => 'thumb.png']);
    }
    local_awakeinfographic_files_send_original($job);
}

if (preg_match('#^/\d+/result$#', $path)) {
    $requested = optional_param('pass', 0, PARAM_INT);
    $versionno = $requested > 0 ? $requested : $job->currentversion;
    $version = $versionno !== null ? version::get_by_versionno((int) $job->id, (int) $versionno) : null;
    if (!$version) {
        send_file_not_found();
    }
    $file = version::get_html_file($version, $job);
    if (!$file) {
        send_file_not_found();
    }
    send_stored_file($file, 0, 0, false, ['filename' => 'infographic.html']);
}

send_file_not_found();

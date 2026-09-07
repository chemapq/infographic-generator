<?php
/**
 * Punto de entrada único de `apiFetch()` en Moodle (`IG_CONFIG.apiBase =
 * '/local/awakeinfographic/ajax/index.php'`). `app.js`/`editor.js` no se
 * tocan: siguen construyendo rutas con la forma del motor
 * (`/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/iterate`…), así que este
 * script las despacha por `PATH_INFO` — el mismo mecanismo que usa
 * `pluginfile.php` — hacia el fichero de `ajax/` que sabe resolver cada una.
 * Ver PLAN_MOODLE.md §4.1, §6.4.
 */

define('AJAX_SCRIPT', true);

require(__DIR__ . '/../../../config.php');
require_once($CFG->libdir . '/filelib.php');

require_once(__DIR__ . '/lib.php');
require_once(__DIR__ . '/create.php');
require_once(__DIR__ . '/status.php');
require_once(__DIR__ . '/edit.php');
require_once(__DIR__ . '/savehtml.php');
require_once(__DIR__ . '/gallery.php');
require_once(__DIR__ . '/rename.php');
require_once(__DIR__ . '/delete.php');

use function local_awakeinfographic\ajax\handle_create;
use function local_awakeinfographic\ajax\handle_delete;
use function local_awakeinfographic\ajax\handle_edit;
use function local_awakeinfographic\ajax\handle_gallery;
use function local_awakeinfographic\ajax\handle_rename;
use function local_awakeinfographic\ajax\handle_savehtml;
use function local_awakeinfographic\ajax\handle_status;
use function local_awakeinfographic\ajax\respond_error;
use function local_awakeinfographic\ajax\resolve_pathinfo;

try {
    require_login();
    require_sesskey();

    $path = rtrim(resolve_pathinfo(), '/');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($path === '/api/jobs' && $method === 'POST') {
        handle_create();
    } else if ($path === '/api/gallery' && $method === 'GET') {
        handle_gallery();
    } else if (preg_match('#^/api/jobs/(\d+)$#', $path, $m) && $method === 'GET') {
        handle_status((int) $m[1]);
    } else if (preg_match('#^/api/jobs/(\d+)$#', $path, $m) && $method === 'PATCH') {
        handle_rename((int) $m[1]);
    } else if (preg_match('#^/api/jobs/(\d+)$#', $path, $m) && $method === 'DELETE') {
        handle_delete((int) $m[1]);
    } else if (preg_match('#^/api/jobs/(\d+)/iterate$#', $path, $m) && $method === 'POST') {
        handle_edit((int) $m[1]);
    } else if (preg_match('#^/api/jobs/(\d+)/text-edit$#', $path, $m) && $method === 'POST') {
        handle_savehtml((int) $m[1]);
    } else {
        respond_error(404, 'not_found', 'Ruta desconocida: ' . $method . ' ' . $path);
    }
} catch (\local_awakeinfographic\api_exception $e) {
    $extra = $e->retryafterseconds !== null ? ['retryAfterSeconds' => $e->retryafterseconds] : [];
    respond_error($e->httpstatus >= 400 && $e->httpstatus < 600 ? $e->httpstatus : 502, $e->apicode, $e->getMessage(), $extra);
} catch (\require_login_exception $e) {
    respond_error(401, 'unauthorized', get_string('error:noaccess', 'local_awakeinfographic'));
} catch (\moodle_exception $e) {
    $status = $e instanceof \required_capability_exception ? 403 : 400;
    respond_error($status, 'error', $e->getMessage());
} catch (\Throwable $e) {
    debugging('local_awakeinfographic ajax: ' . $e->getMessage(), DEBUG_NORMAL);
    respond_error(500, 'internal_error', get_string('error:internal', 'local_awakeinfographic'));
}

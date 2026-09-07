<?php
namespace local_awakeinfographic\ajax;

defined('MOODLE_INTERNAL') || die();

use local_awakeinfographic\html_guard;
use local_awakeinfographic\unsafe_html_exception;
use local_awakeinfographic\version;

/**
 * `POST /api/jobs/:id/text-edit` -> guarda el HTML que el navegador ya
 * editó. Sin motor: el profesor manda el documento entero que él mismo tiene
 * delante (`editor.js` lo serializa con `documentElement.outerHTML`).
 * Ver PLAN_MOODLE.md §6.7.
 */
function handle_savehtml(int $id): void {
    global $USER;

    $job = required_job($id);

    $body = json_body();
    $html = $body['html'] ?? '';
    if (!is_string($html) || trim($html) === '') {
        respond_error(400, 'missing_html', get_string('error:missinghtml', 'local_awakeinfographic'));
    }
    if (strlen($html) > 2 * 1024 * 1024) {
        respond_error(400, 'html_too_large', get_string('error:htmltoolarge', 'local_awakeinfographic'));
    }

    // Concurrencia optimista: si otra pestaña ya creó una versión más
    // reciente mientras esta editaba, se rechaza — ninguna versión se
    // pierde, cada una es su fila y su fichero (§6.7, §9).
    $basepass = (int) ($body['basePass'] ?? 0);
    if ($job->currentversion !== null && $basepass !== (int) $job->currentversion) {
        respond_error(409, 'stale_version', get_string('error:staleversion', 'local_awakeinfographic'));
    }

    try {
        html_guard::assert_safe($html);
    } catch (unsafe_html_exception $e) {
        respond_error(400, 'unsafe_html', get_string('error:unsafehtml', 'local_awakeinfographic'));
    }

    $newversion = version::create($job, version::ORIGIN_MANUAL, null, null, null, $html, null);

    respond_json(['versionno' => (int) $newversion->versionno]);
}

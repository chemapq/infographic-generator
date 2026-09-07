<?php
namespace local_awakeinfographic\ajax;

defined('MOODLE_INTERNAL') || die();

use local_awakeinfographic\api_client;
use local_awakeinfographic\api_exception;
use local_awakeinfographic\html_guard;
use local_awakeinfographic\job;
use local_awakeinfographic\unsafe_html_exception;
use local_awakeinfographic\version;

/**
 * `POST /api/jobs/:id/iterate` (mismo endpoint que usan tanto el editor como
 * el «Últimos ajustes» de la vista de resultado) -> `POST /api/v1/edit` del
 * motor, síncrono. Ver PLAN_MOODLE.md §6.8.
 */
function handle_edit(int $id): void {
    global $USER;

    $job = required_job($id);
    if (!job::can_edit_with_ai($job, (int) $USER->id)) {
        respond_error(403, 'forbidden', get_string('error:aieditdisabled', 'local_awakeinfographic'));
    }
    if ($job->currentversion === null) {
        respond_error(409, 'no_version', get_string('error:noversion', 'local_awakeinfographic'));
    }

    $body = json_body();
    $prompt = text_field($body, 'prompt', 2000);
    if ($prompt === '') {
        respond_error(400, 'missing_prompt', get_string('error:missingprompt', 'local_awakeinfographic'));
    }

    $target = null;
    $targetlabel = null;
    if (!empty($body['target']) && is_array($body['target']) && !empty($body['target']['label'])) {
        $target = [
            'label' => text_field($body['target'], 'label', 200),
            'selector' => text_field($body['target'], 'selector', 500) ?: null,
            'html' => text_field($body['target'], 'html', 4000) ?: null,
            'text' => text_field($body['target'], 'text', 400) ?: null,
        ];
        $targetlabel = $target['label'];
    }

    $current = version::get_by_versionno((int) $job->id, (int) $job->currentversion);
    $htmlfile = $current ? version::get_html_file($current, $job) : null;
    if (!$htmlfile) {
        respond_error(409, 'no_version', get_string('error:noversion', 'local_awakeinfographic'));
    }
    $html = $htmlfile->get_content();

    try {
        $result = (new api_client())->edit_html($html, $prompt, $target, $job->remotejobid);
    } catch (api_exception $e) {
        if (in_array($e->apicode, ['quota_exceeded', 'edit_queue_full'], true)) {
            $extra = $e->retryafterseconds !== null ? ['retryAfterSeconds' => $e->retryafterseconds] : [];
            respond_error(429, $e->apicode, $e->getMessage(), $extra);
        }
        respond_error(502, $e->apicode, $e->getMessage());
    }

    $newhtml = (string) ($result['html'] ?? '');
    try {
        html_guard::assert_safe($newhtml);
    } catch (unsafe_html_exception $e) {
        respond_error(502, 'unsafe_html', get_string('error:unsafehtml', 'local_awakeinfographic'));
    }

    $newversion = version::create($job, version::ORIGIN_AI, null, $prompt, $targetlabel, $newhtml, null);

    respond_json([
        'versionno' => (int) $newversion->versionno,
        'usage' => $result['usage'] ?? null,
    ]);
}

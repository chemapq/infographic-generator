<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

/**
 * Traduce las dos tablas de Moodle (job + version) a la forma de `JobRecord`
 * que ya esperan `app.js` y `editor.js` sin tocarlos — es lo que hace
 * innecesario reescribirlos. Ver PLAN_MOODLE.md §6.9.
 */
class job_shape {

    /**
     * Vocabulario de estado que ya entiende `STATUS_LABEL` de app.js: el de
     * Moodle (pending/submitted/running) es más granular de lo que a la
     * interfaz le hace falta distinguir.
     */
    public static function display_status(string $status): string {
        switch ($status) {
            case job::STATUS_PENDING:
            case job::STATUS_SUBMITTED:
                return 'queued';
            case job::STATUS_RUNNING:
                return 'refining';
            default:
                return $status; // done | failed
        }
    }

    /** `origin` (vocabulario del plugin) -> `kind` (vocabulario de app.js/editor.js). */
    protected static function kind_of(string $origin): string {
        return $origin === version::ORIGIN_AI ? 'iterate' : $origin; // generate | refine | manual
    }

    /**
     * @return array Forma de `JobRecord` (parcial: sin `spec` ni `verdict`,
     *     que el plugin no descarga del motor).
     */
    public static function build(\stdClass $job): array {
        $versions = version::get_for_job((int) $job->id);

        $passes = array_map(function (\stdClass $v): array {
            return [
                'n' => (int) $v->versionno,
                'kind' => self::kind_of($v->origin),
                'score' => $v->score !== null ? (float) $v->score : null,
                'verdict' => null,
                'userPrompt' => $v->prompt,
                'targetLabel' => $v->targetlabel,
                // El thumbnail se resuelve en files.php: si la versión no
                // tiene captura propia (ai/manual), cae al original.
                'screenshotFile' => (string) $v->id,
                'createdAt' => gmdate('c', (int) $v->timecreated),
            ];
        }, $versions);

        return [
            'id' => (string) $job->id,
            'status' => self::display_status($job->status),
            'error' => $job->status === job::STATUS_FAILED ? $job->errormessage : null,
            'width' => $job->width !== null ? (int) $job->width : 0,
            'height' => $job->height !== null ? (int) $job->height : 0,
            'passes' => $passes,
            'bestPass' => $job->bestversion !== null ? (int) $job->bestversion : null,
            'createdAt' => gmdate('c', (int) $job->timecreated),
        ];
    }
}

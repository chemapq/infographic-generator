<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

require_once($CFG->libdir . '/filelib.php');

/**
 * Una pasada de generación (`generate`/`refine`) o una edición (`ai`/`manual`)
 * de un job, con su propio fichero HTML —y su captura, si la tiene— en la
 * File API. Ver PLAN_MOODLE.md §6.2, §6.9.
 */
class version {
    const ORIGIN_GENERATE = 'generate';
    const ORIGIN_REFINE = 'refine';
    const ORIGIN_AI = 'ai';
    const ORIGIN_MANUAL = 'manual';

    /**
     * Inserta la fila, guarda el HTML (y la captura, si se da) en la File
     * API, y actualiza `currentversion`/`bestversion` del job. `$html` ya
     * viene validado por `html_guard` antes de llegar aquí.
     */
    public static function create(
        \stdClass $job,
        string $origin,
        ?float $score,
        ?string $prompt,
        ?string $targetlabel,
        string $html,
        ?string $previewpng
    ): \stdClass {
        global $DB;

        $versionno = self::next_versionno((int) $job->id);

        $record = new \stdClass();
        $record->jobid = $job->id;
        $record->versionno = $versionno;
        $record->origin = $origin;
        $record->score = $score;
        $record->prompt = $prompt !== null ? \core_text::substr($prompt, 0, 2000) : null;
        $record->targetlabel = $targetlabel !== null ? \core_text::substr($targetlabel, 0, 255) : null;
        $record->haspreview = $previewpng !== null ? 1 : 0;
        $record->timecreated = time();
        $record->id = $DB->insert_record('local_awakeinfographic_version', $record);

        $context = \context_user::instance($job->userid);
        $fs = get_file_storage();
        $fs->create_file_from_string([
            'contextid' => $context->id,
            'component' => 'local_awakeinfographic',
            'filearea' => 'version',
            'itemid' => $record->id,
            'filepath' => '/',
            'filename' => 'infographic.html',
        ], $html);

        if ($previewpng !== null) {
            $fs->create_file_from_string([
                'contextid' => $context->id,
                'component' => 'local_awakeinfographic',
                'filearea' => 'preview',
                'itemid' => $record->id,
                'filepath' => '/',
                'filename' => 'preview.png',
            ], $previewpng);
        }

        job::set_current_version((int) $job->id, $versionno);
        if (in_array($origin, [self::ORIGIN_GENERATE, self::ORIGIN_REFINE], true)) {
            job::update_best_version((int) $job->id);
        }

        return $record;
    }

    public static function next_versionno(int $jobid): int {
        global $DB;
        $max = $DB->get_field_sql(
            'SELECT MAX(versionno) FROM {local_awakeinfographic_version} WHERE jobid = :jobid',
            ['jobid' => $jobid]
        );
        return $max ? ((int) $max) + 1 : 1;
    }

    public static function get(int $id): \stdClass {
        global $DB;
        return $DB->get_record('local_awakeinfographic_version', ['id' => $id], '*', MUST_EXIST);
    }

    public static function get_by_versionno(int $jobid, int $versionno): ?\stdClass {
        global $DB;
        $record = $DB->get_record('local_awakeinfographic_version', ['jobid' => $jobid, 'versionno' => $versionno]);
        return $record ?: null;
    }

    /** Todas las versiones de un job, ordenadas por `versionno`. */
    public static function get_for_job(int $jobid): array {
        global $DB;
        return array_values($DB->get_records('local_awakeinfographic_version', ['jobid' => $jobid], 'versionno ASC'));
    }

    public static function get_html_file(\stdClass $version, \stdClass $job): ?\stored_file {
        $context = \context_user::instance($job->userid);
        $fs = get_file_storage();
        $files = $fs->get_area_files($context->id, 'local_awakeinfographic', 'version', $version->id, 'itemid', false);
        return $files ? reset($files) : null;
    }

    public static function get_preview_file(\stdClass $version, \stdClass $job): ?\stored_file {
        if (!$version->haspreview) {
            return null;
        }
        $context = \context_user::instance($job->userid);
        $fs = get_file_storage();
        $files = $fs->get_area_files($context->id, 'local_awakeinfographic', 'preview', $version->id, 'itemid', false);
        return $files ? reset($files) : null;
    }
}

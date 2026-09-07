<?php
namespace local_awakeinfographic\privacy;

defined('MOODLE_INTERNAL') || die();

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\userlist;
use core_privacy\local\request\writer;

/**
 * Obligatorio, y aquí no es papeleo: hay una transferencia a un tercero (el
 * motor, que a su vez llama a la API de Anthropic) con la imagen y las
 * notas del profesor. Ver PLAN_MOODLE.md §4.7.
 */
class provider implements
    \core_privacy\local\metadata\provider,
    \core_privacy\local\request\plugin\provider,
    \core_privacy\local\request\core_userlist_provider {

    public static function get_metadata(collection $collection): collection {
        $collection->add_database_table('local_awakeinfographic_job', [
            'userid' => 'privacy:metadata:job:userid',
            'title' => 'privacy:metadata:job:title',
            'status' => 'privacy:metadata:job:status',
            'timecreated' => 'privacy:metadata:job:timecreated',
        ], 'privacy:metadata:job');

        $collection->add_database_table('local_awakeinfographic_version', [
            'origin' => 'privacy:metadata:version:origin',
            'score' => 'privacy:metadata:version:score',
            'prompt' => 'privacy:metadata:version:prompt',
            'timecreated' => 'privacy:metadata:version:timecreated',
        ], 'privacy:metadata:version');

        $collection->add_subsystem_link('core_files', [], 'privacy:metadata:files');

        $collection->add_external_location_link('engine', [
            'image' => 'privacy:metadata:engine:image',
            'notes' => 'privacy:metadata:engine:notes',
        ], 'privacy:metadata:engine');

        return $collection;
    }

    protected static function has_jobs(int $userid): bool {
        global $DB;
        return $DB->record_exists('local_awakeinfographic_job', ['userid' => $userid]);
    }

    public static function get_contexts_for_userid(int $userid): contextlist {
        $contextlist = new contextlist();
        if (self::has_jobs($userid)) {
            $contextlist->add_user_context($userid);
        }
        return $contextlist;
    }

    public static function get_users_in_context(userlist $userlist): void {
        $context = $userlist->get_context();
        if ($context->contextlevel !== CONTEXT_USER) {
            return;
        }
        if (self::has_jobs((int) $context->instanceid)) {
            $userlist->add_user($context->instanceid);
        }
    }

    public static function export_user_data(approved_contextlist $contextlist): void {
        global $DB;
        $user = $contextlist->get_user();

        foreach ($contextlist->get_contexts() as $context) {
            if ($context->contextlevel !== CONTEXT_USER || (int) $context->instanceid !== (int) $user->id) {
                continue;
            }

            $jobs = $DB->get_records('local_awakeinfographic_job', ['userid' => $user->id]);
            $data = [];
            foreach ($jobs as $row) {
                $versions = $DB->get_records('local_awakeinfographic_version', ['jobid' => $row->id], 'versionno ASC');
                $data[] = [
                    'title' => $row->title,
                    'status' => $row->status,
                    'timecreated' => \core_privacy\local\request\transform::datetime($row->timecreated),
                    'versions' => array_map(fn ($v) => [
                        'versionno' => $v->versionno,
                        'origin' => $v->origin,
                        'score' => $v->score,
                        'prompt' => $v->prompt,
                        'timecreated' => \core_privacy\local\request\transform::datetime($v->timecreated),
                    ], array_values($versions)),
                ];

                // Ficheros del job: itemid = id del job (source) o de cada
                // versión (version/preview) — se exportan por su propia ruta.
                writer::with_context($context)->export_area_files(
                    [get_string('pluginname', 'local_awakeinfographic'), format_string($row->title)],
                    'local_awakeinfographic',
                    'source',
                    $row->id
                );
                foreach ($versions as $v) {
                    writer::with_context($context)->export_area_files(
                        [get_string('pluginname', 'local_awakeinfographic'), format_string($row->title), 'v' . $v->versionno],
                        'local_awakeinfographic',
                        'version',
                        $v->id
                    );
                    writer::with_context($context)->export_area_files(
                        [get_string('pluginname', 'local_awakeinfographic'), format_string($row->title), 'v' . $v->versionno],
                        'local_awakeinfographic',
                        'preview',
                        $v->id
                    );
                }
            }

            writer::with_context($context)->export_data(
                [get_string('pluginname', 'local_awakeinfographic')],
                (object) ['jobs' => $data]
            );
        }
    }

    public static function delete_data_for_all_users_in_context(\context $context): void {
        if ($context->contextlevel !== CONTEXT_USER) {
            return;
        }
        self::delete_for_userid((int) $context->instanceid);
    }

    public static function delete_data_for_user(approved_contextlist $contextlist): void {
        $user = $contextlist->get_user();
        foreach ($contextlist->get_contexts() as $context) {
            if ($context->contextlevel === CONTEXT_USER && (int) $context->instanceid === (int) $user->id) {
                self::delete_for_userid((int) $user->id);
            }
        }
    }

    public static function delete_data_for_users(approved_userlist $userlist): void {
        foreach ($userlist->get_userids() as $userid) {
            self::delete_for_userid($userid);
        }
    }

    /** El borrado local también intenta el DELETE remoto (PLAN_MOODLE.md §4.7). */
    protected static function delete_for_userid(int $userid): void {
        global $DB;
        $jobs = $DB->get_records('local_awakeinfographic_job', ['userid' => $userid]);
        foreach ($jobs as $row) {
            \local_awakeinfographic\job::delete($row);
        }
    }
}

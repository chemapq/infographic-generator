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
            'score' => 'privacy:metadata:job:score',
            'timecreated' => 'privacy:metadata:job:timecreated',
        ], 'privacy:metadata:job');

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
                $data[] = [
                    'title' => $row->title,
                    'status' => $row->status,
                    'score' => $row->score,
                    'timecreated' => \core_privacy\local\request\transform::datetime($row->timecreated),
                ];
            }

            writer::with_context($context)->export_data(
                [get_string('pluginname', 'local_awakeinfographic')],
                (object) ['jobs' => $data]
            );
            writer::with_context($context)->export_area_files(
                [get_string('pluginname', 'local_awakeinfographic')],
                'local_awakeinfographic',
                'result',
                0
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

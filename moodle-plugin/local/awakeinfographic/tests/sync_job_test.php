<?php
namespace local_awakeinfographic\task;

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/local/awakeinfographic/tests/fixtures/fake_api_client.php');
require_once($CFG->dirroot . '/local/awakeinfographic/tests/fixtures/testable_sync_job.php');

use local_awakeinfographic\fake_api_client;
use local_awakeinfographic\job;

/**
 * No ejecutado en este entorno (sin PHPUnit/Moodle disponibles aquí — ver
 * PLAN_MOODLE.md §7): revisar con `vendor/bin/phpunit` dentro de un
 * moodle-docker antes de fusionar.
 *
 * @covers \local_awakeinfographic\task\sync_job
 */
final class sync_job_test extends \advanced_testcase {

    protected function create_job(int $userid): \stdClass {
        global $DB;

        $record = new \stdClass();
        $record->userid = $userid;
        $record->courseid = null;
        $record->remotejobid = null;
        $record->idempotencykey = random_string(32);
        $record->title = 'Prueba';
        $record->width = null;
        $record->height = null;
        $record->status = job::STATUS_PENDING;
        $record->remotestatus = null;
        $record->currentversion = null;
        $record->bestversion = null;
        $record->attempts = 0;
        $record->errorcode = null;
        $record->errormessage = null;
        $record->timecreated = time();
        $record->timemodified = time();
        $record->id = $DB->insert_record('local_awakeinfographic_job', $record);
        return $record;
    }

    protected function add_source_file(\stdClass $job): void {
        $context = \context_user::instance($job->userid);
        get_file_storage()->create_file_from_string([
            'contextid' => $context->id,
            'component' => 'local_awakeinfographic',
            'filearea' => 'source',
            'itemid' => $job->id,
            'filepath' => '/',
            'filename' => 'original.png',
        ], 'contenido-de-prueba');
    }

    public function test_submit_queue_full_keeps_notes_and_maxpasses_for_next_attempt(): void {
        global $DB;
        $this->resetAfterTest();
        $user = $this->getDataGenerator()->create_user();
        $job = $this->create_job((int) $user->id);
        $this->add_source_file($job);

        $client = new fake_api_client();
        $client->jsonresponses[] = [429, ['code' => 'queue_full', 'error' => 'llena', 'retryAfterSeconds' => 45]];

        $task = testable_sync_job::make($client, ['jobid' => $job->id, 'notes' => 'Nota del profesor', 'maxpasses' => 4]);
        $task->execute();

        $reloaded = $DB->get_record('local_awakeinfographic_job', ['id' => $job->id]);
        $this->assertNull($reloaded->remotejobid);
        $this->assertSame(1, (int) $reloaded->attempts);

        // requeue() siempre crea un sync_job base (new self() dentro de la clase padre),
        // no un testable_sync_job: es la tarea real la que queda encolada.
        $adhoc = \core\task\manager::get_adhoc_tasks(sync_job::class);
        $this->assertCount(1, $adhoc);
        $data = (array) $adhoc[0]->get_custom_data();
        $this->assertSame('Nota del profesor', $data['notes']);
        $this->assertSame(4, $data['maxpasses']);
    }

    public function test_submit_success_stores_remote_job_id_and_requeues(): void {
        global $DB;
        $this->resetAfterTest();
        $user = $this->getDataGenerator()->create_user();
        $job = $this->create_job((int) $user->id);
        $this->add_source_file($job);

        $client = new fake_api_client();
        $client->jsonresponses[] = [202, ['jobId' => 'a1b2c3d4', 'status' => 'queued']];

        $task = testable_sync_job::make($client, ['jobid' => $job->id, 'notes' => '', 'maxpasses' => 3]);
        $task->execute();

        $reloaded = $DB->get_record('local_awakeinfographic_job', ['id' => $job->id]);
        $this->assertSame('a1b2c3d4', $reloaded->remotejobid);
        $this->assertSame(job::STATUS_SUBMITTED, $reloaded->status);
        $this->assertCount(1, \core\task\manager::get_adhoc_tasks(sync_job::class));
    }

    public function test_poll_in_progress_requeues_without_throwing(): void {
        global $DB;
        $this->resetAfterTest();
        $user = $this->getDataGenerator()->create_user();
        $job = $this->create_job((int) $user->id);
        $DB->set_field('local_awakeinfographic_job', 'remotejobid', 'a1b2c3d4', ['id' => $job->id]);
        $DB->set_field('local_awakeinfographic_job', 'status', job::STATUS_SUBMITTED, ['id' => $job->id]);

        $client = new fake_api_client();
        $client->jsonresponses[] = [200, ['status' => 'refining', 'width' => 800, 'height' => 600]];

        $task = testable_sync_job::make($client, ['jobid' => $job->id]);
        // No debe lanzar: PLAN_MOODLE.md §6.12, "detalle que importa". Si lanzara,
        // PHPUnit marcaría este test como fallido igualmente.
        $task->execute();

        $reloaded = $DB->get_record('local_awakeinfographic_job', ['id' => $job->id]);
        $this->assertSame(job::STATUS_RUNNING, $reloaded->status);
        $this->assertEquals(800, $reloaded->width);
        $this->assertEquals(600, $reloaded->height);
        $this->assertCount(1, \core\task\manager::get_adhoc_tasks(sync_job::class));
    }

    public function test_poll_done_rejects_unsafe_html(): void {
        global $DB;
        $this->resetAfterTest();
        $user = $this->getDataGenerator()->create_user();
        $job = $this->create_job((int) $user->id);
        $DB->set_field('local_awakeinfographic_job', 'remotejobid', 'a1b2c3d4', ['id' => $job->id]);
        $DB->set_field('local_awakeinfographic_job', 'status', job::STATUS_SUBMITTED, ['id' => $job->id]);

        $client = new fake_api_client();
        // poll(): estado ligero -> done. download_result(): estado con
        // passes[] (una sola pasada, insegura) -> html?pass=1 -> preview.png?pass=1.
        $client->jsonresponses[] = [200, ['status' => 'done', 'width' => 800, 'height' => 600]];
        $client->jsonresponses[] = [200, ['passes' => [['n' => 1, 'kind' => 'generate', 'score' => 96.5]]]];
        $client->rawresponses[] = [200, '<html><body><script>alert(1)</script></body></html>'];
        $client->rawresponses[] = [200, 'png-bytes'];

        $task = testable_sync_job::make($client, ['jobid' => $job->id]);
        $task->execute();

        $reloaded = $DB->get_record('local_awakeinfographic_job', ['id' => $job->id]);
        $this->assertSame(job::STATUS_FAILED, $reloaded->status);
        $this->assertSame('unsafe_html', $reloaded->errorcode);
        $this->assertCount(0, $DB->get_records('local_awakeinfographic_version', ['jobid' => $job->id]));
    }

    public function test_poll_done_downloads_every_pass_as_a_version_and_marks_done(): void {
        global $DB;
        $this->resetAfterTest();
        $user = $this->getDataGenerator()->create_user();
        $job = $this->create_job((int) $user->id);
        $DB->set_field('local_awakeinfographic_job', 'remotejobid', 'a1b2c3d4', ['id' => $job->id]);
        $DB->set_field('local_awakeinfographic_job', 'status', job::STATUS_SUBMITTED, ['id' => $job->id]);

        $client = new fake_api_client();
        $client->jsonresponses[] = [200, ['status' => 'done', 'width' => 800, 'height' => 600]];
        $client->jsonresponses[] = [200, ['passes' => [
            ['n' => 1, 'kind' => 'generate', 'score' => 90.0],
            ['n' => 2, 'kind' => 'refine', 'score' => 96.5],
        ]]];
        $client->rawresponses[] = [200, '<html><body><h1>Pasada 1</h1></body></html>'];
        $client->rawresponses[] = [200, 'png-bytes-1'];
        $client->rawresponses[] = [200, '<html><body><h1>Pasada 2</h1></body></html>'];
        $client->rawresponses[] = [200, 'png-bytes-2'];

        $task = testable_sync_job::make($client, ['jobid' => $job->id]);
        $task->execute();

        $reloaded = $DB->get_record('local_awakeinfographic_job', ['id' => $job->id]);
        $this->assertSame(job::STATUS_DONE, $reloaded->status);
        $this->assertEquals(800, $reloaded->width);
        $this->assertEquals(2, $reloaded->currentversion);
        $this->assertEquals(2, $reloaded->bestversion); // mejor score de las dos.

        $versions = array_values($DB->get_records('local_awakeinfographic_version', ['jobid' => $job->id], 'versionno ASC'));
        $this->assertCount(2, $versions);
        $this->assertSame('generate', $versions[0]->origin);
        $this->assertSame('refine', $versions[1]->origin);

        $context = \context_user::instance((int) $user->id);
        $files = get_file_storage()->get_area_files(
            $context->id, 'local_awakeinfographic', 'version', $versions[1]->id, 'itemid', false
        );
        $this->assertCount(1, $files);
    }

    public function test_maxattempts_marks_job_failed_with_timeout(): void {
        global $DB;
        $this->resetAfterTest();
        $user = $this->getDataGenerator()->create_user();
        $job = $this->create_job((int) $user->id);
        $DB->set_field('local_awakeinfographic_job', 'remotejobid', 'a1b2c3d4', ['id' => $job->id]);
        $DB->set_field('local_awakeinfographic_job', 'status', job::STATUS_SUBMITTED, ['id' => $job->id]);
        $DB->set_field('local_awakeinfographic_job', 'attempts', job::MAXATTEMPTS - 1, ['id' => $job->id]);

        $client = new fake_api_client();
        $client->jsonresponses[] = [200, ['status' => 'refining', 'currentScore' => 80.0, 'bestScore' => 80.0, 'passCount' => 1]];

        $task = testable_sync_job::make($client, ['jobid' => $job->id]);
        $task->execute();

        $reloaded = $DB->get_record('local_awakeinfographic_job', ['id' => $job->id]);
        $this->assertSame(job::STATUS_FAILED, $reloaded->status);
        $this->assertSame('timeout', $reloaded->errorcode);
    }
}

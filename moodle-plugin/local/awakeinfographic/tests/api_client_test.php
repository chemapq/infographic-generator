<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/local/awakeinfographic/tests/fixtures/fake_api_client.php');

/**
 * No ejecutado en este entorno (sin PHPUnit/Moodle disponibles aquí — ver
 * PLAN_MOODLE.md §7): revisar con `vendor/bin/phpunit` dentro de un
 * moodle-docker antes de fusionar. Cubre la traducción de errores de
 * api_client, no la conectividad real (eso es testconnection.php).
 *
 * @covers \local_awakeinfographic\api_client
 * @covers \local_awakeinfographic\api_exception
 */
final class api_client_test extends \advanced_testcase {

    public function test_requires_configuration(): void {
        $this->resetAfterTest();
        set_config('apibaseurl', '', 'local_awakeinfographic');
        set_config('apikey', '', 'local_awakeinfographic');

        $this->expectException(\moodle_exception::class);
        new api_client();
    }

    public function test_fake_client_replays_queued_health_response(): void {
        $client = new fake_api_client();
        $client->jsonresponses[] = [200, ['ok' => true, 'model' => 'claude-opus-4-8', 'maxPasses' => 5, 'version' => '1.0.0']];

        $result = $client->health();

        $this->assertTrue($result['ok']);
        $this->assertSame('claude-opus-4-8', $result['model']);
        $this->assertCount(1, $client->calls);
        $this->assertSame('/api/v1/health', $client->calls[0]['path']);
    }

    public function test_error_response_becomes_typed_exception_with_code_and_retry_after(): void {
        $client = new fake_api_client();
        $client->jsonresponses[] = [429, ['code' => 'queue_full', 'error' => 'La cola está llena.', 'retryAfterSeconds' => 90]];

        try {
            $client->get_status('a1b2c3d4');
            $this->fail('Se esperaba api_exception');
        } catch (api_exception $e) {
            $this->assertSame('queue_full', $e->apicode);
            $this->assertSame(429, $e->httpstatus);
            $this->assertSame(90, $e->retryafterseconds);
            $this->assertSame('La cola está llena.', $e->getMessage());
        }
    }

    public function test_job_not_found_has_no_retry_after(): void {
        $client = new fake_api_client();
        $client->jsonresponses[] = [404, ['code' => 'job_not_found', 'error' => 'Job no encontrado.']];

        try {
            $client->get_status('deadbeef');
            $this->fail('Se esperaba api_exception');
        } catch (api_exception $e) {
            $this->assertSame('job_not_found', $e->apicode);
            $this->assertNull($e->retryafterseconds);
        }
    }

    public function test_delete_job_tolerates_no_content_body(): void {
        $client = new fake_api_client();
        $client->jsonresponses[] = [204, []];

        $client->delete_job('a1b2c3d4');

        $this->assertSame('delete', $client->calls[0]['method']);
    }
}

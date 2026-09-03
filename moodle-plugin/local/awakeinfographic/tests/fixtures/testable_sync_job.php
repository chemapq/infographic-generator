<?php
namespace local_awakeinfographic\task;

defined('MOODLE_INTERNAL') || die();

require_once(__DIR__ . '/fake_api_client.php');

use local_awakeinfographic\api_client;
use local_awakeinfographic\fake_api_client;

/** `sync_job` con `make_client()` sustituido por un `fake_api_client` programado a mano. */
class testable_sync_job extends sync_job {
    public fake_api_client $client;

    public static function make(fake_api_client $client, array $customdata): self {
        $task = new self();
        $task->client = $client;
        $task->set_custom_data($customdata);
        return $task;
    }

    protected function make_client(): api_client {
        return $this->client;
    }
}

<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

/**
 * No ejecutado en este entorno (sin PHPUnit/Moodle disponibles aquí — ver
 * PLAN_MOODLE.md §7): revisar con `vendor/bin/phpunit` dentro de un
 * moodle-docker antes de fusionar.
 *
 * @covers \local_awakeinfographic\html_guard
 */
final class html_guard_test extends \basic_testcase {

    public function test_accepts_plain_html(): void {
        $this->assertTrue(html_guard::is_safe('<!DOCTYPE html><html><body><h1>Hola</h1></body></html>'));
    }

    public function test_accepts_google_fonts_link(): void {
        $html = '<link href="https://fonts.googleapis.com/css2?family=Poppins" rel="stylesheet">';
        $this->assertTrue(html_guard::is_safe($html));
    }

    public function test_rejects_script_tag(): void {
        $this->assertFalse(html_guard::is_safe('<script>alert(1)</script>'));
    }

    public function test_rejects_event_handler_attribute(): void {
        $this->assertFalse(html_guard::is_safe('<img src="x.png" onerror="alert(1)">'));
    }

    public function test_rejects_javascript_url(): void {
        $this->assertFalse(html_guard::is_safe('<a href="javascript:alert(1)">clic</a>'));
    }

    public function test_rejects_srcdoc_attribute(): void {
        $this->assertFalse(html_guard::is_safe('<iframe srcdoc="<script>alert(1)</script>"></iframe>'));
    }

    public function test_rejects_external_url_outside_allowlist(): void {
        $this->assertFalse(html_guard::is_safe('<img src="https://evil.example.com/x.png">'));
    }

    public function test_assert_safe_throws_with_reason(): void {
        $this->expectException(unsafe_html_exception::class);
        html_guard::assert_safe('<script>alert(1)</script>');
    }
}

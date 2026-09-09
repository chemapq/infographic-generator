<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

/**
 * El ticket firmado es el único límite de seguridad que le queda al plugin:
 * si se puede falsificar, cualquiera entra en la galería de cualquiera. Estas
 * pruebas fijan el contrato exacto que verifica el motor
 * (`src/services/embed.ts` en el repo del motor) — cambiar una y no la otra
 * es la forma más fácil de romper esto sin darse cuenta.
 *
 * No ejecutado en este entorno (sin PHPUnit/Moodle disponibles aquí — ver
 * PLAN_MOODLE.md §7): revisar con `vendor/bin/phpunit` dentro de un
 * moodle-docker antes de fusionar.
 *
 * @covers \local_awakeinfographic\embed
 */
final class embed_test extends \advanced_testcase {

    /** El secreto compartido de las pruebas. Cualquiera vale: solo tiene que coincidir consigo mismo. */
    const SECRET = 'secreto-de-prueba-32-caracteres!!';

    protected function setUp(): void {
        parent::setUp();
        $this->resetAfterTest();
        set_config('apibaseurl', 'https://motor.example.com', 'local_awakeinfographic');
        set_config('embedsecret', self::SECRET, 'local_awakeinfographic');
        set_config('allowaiedit', 1, 'local_awakeinfographic');
    }

    /** Deshace el base64url del ticket y devuelve el payload como array. */
    protected function payload_of(string $ticket): array {
        $body = explode('.', $ticket)[1];
        $raw = base64_decode(strtr($body, '-_', '+/'));
        return json_decode($raw, true);
    }

    /**
     * La comprobación que hace el motor, replicada aquí: el HMAC va sobre el
     * segmento ya codificado, no sobre el JSON crudo.
     */
    protected function signature_matches(string $ticket, string $secret): bool {
        [$version, $body, $signature] = explode('.', $ticket);
        $this->assertSame('v1', $version);
        $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', $body, $secret, true)), '+/', '-_'), '=');
        return hash_equals($expected, $signature);
    }

    public function test_ticket_verifies_with_the_shared_secret(): void {
        $this->setAdminUser();
        $ticket = embed::ticket();

        $this->assertTrue($this->signature_matches($ticket, self::SECRET));
    }

    public function test_ticket_does_not_verify_with_another_secret(): void {
        $this->setAdminUser();
        $ticket = embed::ticket();

        $this->assertFalse($this->signature_matches($ticket, 'otro-secreto-completamente-distinto'));
    }

    public function test_a_tampered_payload_breaks_the_signature(): void {
        $this->setAdminUser();
        [$version, $body, $signature] = explode('.', embed::ticket());

        // El payload de otro usuario, firmado con la firma del primero: es el
        // ataque que esta clase existe para impedir.
        $forged = rtrim(strtr(base64_encode(json_encode([
            'owner' => 'moodle:deadbeef:1',
            'name' => 'Intruso',
            'edit' => true,
            'exp' => time() + 120,
        ])), '+/', '-_'), '=');

        $this->assertFalse($this->signature_matches("$version.$forged.$signature", self::SECRET));
    }

    public function test_owner_id_is_per_user_and_hides_the_site_identifier(): void {
        global $CFG;

        $one = $this->getDataGenerator()->create_user();
        $two = $this->getDataGenerator()->create_user();

        $this->setUser($one);
        $ownerone = embed::owner_id();
        $this->setUser($two);
        $ownertwo = embed::owner_id();

        $this->assertNotSame($ownerone, $ownertwo);
        $this->assertSame('moodle:' . substr(sha1($CFG->siteidentifier), 0, 8) . ':' . $one->id, $ownerone);
        // El identificador del sitio es un secreto de instalación y acaba en
        // los ficheros del motor: nunca debe viajar en claro.
        $this->assertStringNotContainsString($CFG->siteidentifier, $ownerone);
    }

    public function test_payload_carries_the_owner_and_a_short_expiry(): void {
        $user = $this->getDataGenerator()->create_user();
        $this->setUser($user);

        $before = time();
        $payload = $this->payload_of(embed::ticket());

        $this->assertSame(embed::owner_id(), $payload['owner']);
        $this->assertSame(fullname($user), $payload['name']);
        // En segundos, no en milisegundos: es lo que espera el motor.
        $this->assertGreaterThanOrEqual($before + embed::TICKET_TTL, $payload['exp']);
        $this->assertLessThanOrEqual(time() + embed::TICKET_TTL, $payload['exp']);
    }

    public function test_edit_is_false_when_the_admin_turns_it_off(): void {
        $this->setAdminUser();
        $this->assertTrue($this->payload_of(embed::ticket())['edit']);

        set_config('allowaiedit', 0, 'local_awakeinfographic');
        $this->assertFalse($this->payload_of(embed::ticket())['edit']);
    }

    public function test_edit_is_false_without_the_capability(): void {
        // Un usuario recién creado no tiene ningún rol en el sistema, así que
        // tampoco `:edit`, aunque el ajuste del sitio esté encendido.
        $this->setUser($this->getDataGenerator()->create_user());

        $this->assertFalse($this->payload_of(embed::ticket())['edit']);
    }

    public function test_url_points_at_the_engine_and_carries_the_ticket(): void {
        $this->setAdminUser();
        $url = embed::url();

        $this->assertNotNull($url);
        $this->assertStringStartsWith('https://motor.example.com/embed?', $url->out(false));
        $this->assertStringStartsWith('v1.', $url->param('t'));
    }

    public function test_url_is_null_without_configuration(): void {
        $this->setAdminUser();

        set_config('embedsecret', '', 'local_awakeinfographic');
        $this->assertNull(embed::url());

        set_config('embedsecret', self::SECRET, 'local_awakeinfographic');
        set_config('apibaseurl', '', 'local_awakeinfographic');
        $this->assertNull(embed::url());
    }
}

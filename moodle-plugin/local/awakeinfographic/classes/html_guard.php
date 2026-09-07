<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

/**
 * Revalidación en PHP de **cualquier** versión antes de guardarla —venga del
 * motor (que ya sanea con `sanitizeHtml()`) o del navegador (el flujo
 * manual: el HTML lo escribe el cliente, y un cliente es siempre hostil)—.
 * Esta es la capa que importa de verdad: `pluginfile.php`/`files.php` sirven
 * este HTML desde el origen del propio Moodle. Ver PLAN_MOODLE.md §6.10.
 */
class html_guard {

    /** Hosts a los que se permite cargar recursos (Google Fonts, nada más). */
    const ALLOWED_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

    /** @throws unsafe_html_exception si el documento no pasa la comprobación. */
    public static function assert_safe(string $html): void {
        if (preg_match('/<script\b/i', $html)) {
            throw new unsafe_html_exception('contiene un bloque <script>');
        }
        if (preg_match('/\son\w+\s*=/i', $html)) {
            throw new unsafe_html_exception('contiene un atributo de evento on*');
        }
        if (preg_match('/\bjavascript\s*:/i', $html)) {
            throw new unsafe_html_exception('contiene una URL javascript:');
        }
        if (preg_match('/\bsrcdoc\s*=/i', $html)) {
            throw new unsafe_html_exception('contiene un atributo srcdoc');
        }
        if (preg_match_all('/https?:\/\/([^\s"\'<>)]+)/i', $html, $matches)) {
            foreach ($matches[1] as $match) {
                $host = strtolower(explode('/', $match)[0]);
                if (!in_array($host, self::ALLOWED_HOSTS, true)) {
                    throw new unsafe_html_exception('URL externa no permitida (' . $host . ')');
                }
            }
        }
    }

    /** `true`/`false` sin lanzar, para quien solo necesite el veredicto (p. ej. un test). */
    public static function is_safe(string $html): bool {
        try {
            self::assert_safe($html);
            return true;
        } catch (unsafe_html_exception $e) {
            return false;
        }
    }
}

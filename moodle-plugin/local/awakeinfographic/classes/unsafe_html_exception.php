<?php
namespace local_awakeinfographic;

defined('MOODLE_INTERNAL') || die();

/** Lanzada por `html_guard` cuando un documento no pasa la revalidación. Ver §6.10. */
class unsafe_html_exception extends \moodle_exception {
    public function __construct(string $reason) {
        parent::__construct('error:unsafehtml', 'local_awakeinfographic', '', null, $reason);
    }
}

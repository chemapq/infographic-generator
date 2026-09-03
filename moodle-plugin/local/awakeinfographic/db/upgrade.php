<?php
defined('MOODLE_INTERNAL') || die();

/**
 * Sin pasos todavía: la v1 instala directamente el esquema de install.xml.
 * Punto de enganche para cuando cambie (p. ej. si el banco de contenido de
 * la fase 2, PLAN_MOODLE.md §8, añade columnas).
 */
function xmldb_local_awakeinfographic_upgrade($oldversion) {
    return true;
}

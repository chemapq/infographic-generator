<?php
namespace local_awakeinfographic\privacy;

defined('MOODLE_INTERNAL') || die();

use core_privacy\local\metadata\collection;

/**
 * Obligatorio, y aquí no es papeleo: hay una transferencia a un tercero.
 *
 * Desde la 1.0.0 el plugin no guarda **nada** en Moodle —ni tablas, ni
 * ficheros, ni preferencias de usuario—: sirve la app del motor en un iframe
 * y le pasa la identidad del usuario en un ticket firmado. Por eso implementa
 * solo `metadata\provider` y no los `request\*`: sin datos locales no hay nada
 * que exportar ni que borrar a petición de nadie.
 *
 * Lo que sí hay que declarar, y es lo importante, es lo que sale de aquí: la
 * imagen que sube el profesor, sus notas, sus instrucciones de edición y su
 * identificador de usuario viajan al motor, que a su vez llama a la API de
 * Anthropic. El derecho de supresión sobre esos datos se ejerce en el motor,
 * no en Moodle.
 */
class provider implements \core_privacy\local\metadata\provider {

    public static function get_metadata(collection $collection): collection {
        $collection->add_external_location_link('engine', [
            'userid' => 'privacy:metadata:engine:userid',
            'image' => 'privacy:metadata:engine:image',
            'notes' => 'privacy:metadata:engine:notes',
            'prompt' => 'privacy:metadata:engine:prompt',
        ], 'privacy:metadata:engine');

        return $collection;
    }
}

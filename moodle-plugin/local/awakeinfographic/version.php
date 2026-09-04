<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'local_awakeinfographic';
$plugin->version   = 2026090304;
// Suelo conservador en Moodle 4.1 (2022112800): el plugin no usa ninguna API
// posterior a esa versión (Task API, Privacy API, File API y moodleform son
// estables desde mucho antes). El staging de la empresa corre 4.4.2+
// (Build: 20240821) — comprobado al fallar la instalación con el requires
// de 4.5 que traía esto antes.
$plugin->requires  = 2022112800;
// $plugin->supported tiene que ser EXACTAMENTE un rango [mínimo, máximo] de
// dos enteros con mínimo <= máximo (lib/classes/plugininfo/base.php,
// comprobación real en el core: is_int() de los dos elementos + count() == 2).
// Un array con más de dos elementos, como se puso aquí por error en su
// momento ([401, 402, 403, 404, 405, 500], 6 elementos), lanza
// "Incorrect syntax in plugin supported declaration" y aborta la instalación.
// Techo en 404 (Moodle 4.4, la que corre el staging) en vez de 500
// (Moodle 5.0): esa rama no existía cuando se publicó ese core.
$plugin->supported = array(401, 404);
$plugin->maturity  = MATURITY_ALPHA;
$plugin->release   = '0.1.0';

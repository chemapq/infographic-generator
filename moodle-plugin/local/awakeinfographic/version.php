<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'local_awakeinfographic';
$plugin->version   = 2026090303;
// Suelo conservador en Moodle 4.1 (2022112800): el plugin no usa ninguna API
// posterior a esa versión (Task API, Privacy API, File API y moodleform son
// estables desde mucho antes). El staging de la empresa corre 4.4.2+
// (Build: 20240821) — comprobado al fallar la instalación con el requires
// de 4.5 que traía esto antes.
$plugin->requires  = 2022112800;
// $plugin->supported es un RANGO [mínimo, máximo] de dos enteros (branch),
// no una lista de versiones sueltas, Y el validador de Moodle lo lee con una
// expresión regular sobre el código fuente (no ejecuta el fichero, por
// seguridad): espera la sintaxis clásica array(...), no la moderna [...].
// Techo en 404 (Moodle 4.4, la que corre el staging) para no declarar
// compatibilidad con una rama (500 / Moodle 5.0) que ese core ni siquiera
// conocía cuando se publicó — comprobado tras el "Incorrect syntax in
// plugin supported declaration" con [401, 500].
$plugin->supported = array(401, 404);
$plugin->maturity  = MATURITY_ALPHA;
$plugin->release   = '0.1.0';

<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'local_awakeinfographic';
$plugin->version   = 2026090302;
// Suelo conservador en Moodle 4.1 (2022112800): el plugin no usa ninguna API
// posterior a esa versión (Task API, Privacy API, File API y moodleform son
// estables desde mucho antes). El staging de la empresa corre 4.4.2+
// (Build: 20240821) — comprobado al fallar la instalación con el requires
// de 4.5 que traía esto antes.
$plugin->requires  = 2022112800;
// $plugin->supported es un RANGO [mínimo, máximo] de dos enteros (branch),
// no una lista de versiones sueltas — con seis elementos Moodle lo rechaza
// como "Incorrect syntax in plugin supported declaration".
$plugin->supported = [401, 500];
$plugin->maturity  = MATURITY_ALPHA;
$plugin->release   = '0.1.0';

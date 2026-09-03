<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'local_awakeinfographic';
$plugin->version   = 2026090300;
// Moodle 4.5 LTS — confirma el stamp exacto del moodle-docker que levantes:
// lo dice el version.php del core que hayas clonado (PLAN_MOODLE.md §7.2).
$plugin->requires  = 2024100700;
$plugin->supported = [405, 500];
$plugin->maturity  = MATURITY_ALPHA;
$plugin->release   = '0.1.0';

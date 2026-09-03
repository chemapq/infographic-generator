<?php
defined('MOODLE_INTERNAL') || die();

/**
 * Solo la limpieza programada se registra aquí: `sync_job` es una tarea ad
 * hoc (se encola por instancia desde create.php / desde sí misma), no una
 * tarea programada que corra sola.
 */
$tasks = [
    [
        'classname' => '\local_awakeinfographic\task\cleanup',
        'blocking' => 0,
        'minute' => '30',
        'hour' => '3',
        'day' => '*',
        'dayofweek' => '*',
        'month' => '*',
    ],
];

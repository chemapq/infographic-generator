<?php
defined('MOODLE_INTERNAL') || die();

/**
 * El plugin deja de guardar datos.
 *
 * Hasta la 0.1.0 reimplementaba la interfaz de la app dentro de Moodle y
 * mantenía una copia local de cada infografía: dos tablas, tres fileareas y
 * dos tareas de cron para sincronizarlas con el motor. Desde la 1.0.0 el
 * plugin es solo un iframe: el motor es el único dueño de los datos y aquí no
 * queda nada que sincronizar.
 *
 * Este upgrade **borra** esa copia local. Es irreversible y a propósito: la
 * alternativa era dejar dos tablas y unos ficheros que ninguna pantalla lee.
 * Lo que se hubiera generado a través del plugin sigue existiendo en el motor
 * (su carpeta `output/`), pero con el `ownerId` de la clave de API con la que
 * se creó, no con el del usuario de Moodle — así que no aparecerá en la
 * galería de nadie hasta que un administrador lo reetiquete a mano.
 *
 * El paso intermedio de la 0.1.0 (migrar `result`/`preview` a filas de
 * `_version`) se ha retirado de aquí: construía justo lo que ahora se borra,
 * así que en una instalación antigua era trabajo para nada.
 */
function xmldb_local_awakeinfographic_upgrade($oldversion) {
    global $DB;

    $dbman = $DB->get_manager();

    if ($oldversion < 2026090900) {
        // 1. Primero las tareas ad hoc encoladas. Si queda alguna, el cron
        //    intentará instanciar `\local_awakeinfographic\task\sync_job`, que
        //    ya no existe, y fallará en cada ejecución sin que nadie relacione
        //    el error con este plugin. Se filtra por nombre y no por la clase
        //    exacta porque el core las guarda con la barra inicial y no
        //    conviene depender de ese detalle.
        $DB->delete_records_select(
            'task_adhoc',
            $DB->sql_like('classname', ':classname'),
            ['classname' => '%local_awakeinfographic%']
        );

        // 2. Los ficheros: la imagen original de cada job y el HTML y la
        //    previsualización de cada versión. Viven en el contexto de usuario
        //    de quien los generó, así que hay que recorrer los contextos que
        //    tengan algo de este componente en vez de asumir uno solo.
        $fs = get_file_storage();
        $contextids = $DB->get_fieldset_select(
            'files',
            'DISTINCT contextid',
            'component = :component',
            ['component' => 'local_awakeinfographic']
        );
        foreach ($contextids as $contextid) {
            // Sin `filearea`: se van las tres (`source`, `version`, `preview`)
            // de una vez, incluida cualquiera que quedara de un esquema previo.
            $fs->delete_area_files($contextid, 'local_awakeinfographic');
        }

        // 3. Las tablas, en este orden: la FK de `_version` apunta al job.
        $versiontable = new xmldb_table('local_awakeinfographic_version');
        if ($dbman->table_exists($versiontable)) {
            $dbman->drop_table($versiontable);
        }
        $jobtable = new xmldb_table('local_awakeinfographic_job');
        if ($dbman->table_exists($jobtable)) {
            $dbman->drop_table($jobtable);
        }

        // 4. Los ajustes que ya no existen, para que no queden colgando en
        //    `mdl_config_plugins` como basura sin dueño. `apikey` se va con
        //    ellos: el plugin ya no llama a la API, y una clave olvidada en la
        //    base de datos es una clave que sigue sirviendo.
        foreach (['apikey', 'maxpassesdefault', 'polltimeoutminutes'] as $name) {
            unset_config($name, 'local_awakeinfographic');
        }

        upgrade_plugin_savepoint(true, 2026090900, 'local', 'awakeinfographic');
    }

    return true;
}

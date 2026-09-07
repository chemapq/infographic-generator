<?php
defined('MOODLE_INTERNAL') || die();

/**
 * De "solo generar" (v0.1.0) a "generar + editar" (PLAN_MOODLE.md): el
 * resultado de un job deja de ser un fichero único (`result`/`preview` con
 * itemid = job) y pasa a ser una fila de `local_awakeinfographic_version` por
 * pasada, cada una con su propio fichero (itemid = version). Para no perder
 * lo ya generado en el staging: cada job `done` gana una versión 1
 * (`origin = generate`) con sus ficheros migrados; el resto de estados no
 * tenía fichero que migrar.
 */
function xmldb_local_awakeinfographic_upgrade($oldversion) {
    global $DB;

    $dbman = $DB->get_manager();

    if ($oldversion < 2026090700) {
        $table = new xmldb_table('local_awakeinfographic_job');

        $width = new xmldb_field('width', XMLDB_TYPE_INTEGER, '6', null, null, null, null, 'title');
        if (!$dbman->field_exists($table, $width)) {
            $dbman->add_field($table, $width);
        }
        $height = new xmldb_field('height', XMLDB_TYPE_INTEGER, '6', null, null, null, null, 'width');
        if (!$dbman->field_exists($table, $height)) {
            $dbman->add_field($table, $height);
        }
        $currentversion = new xmldb_field('currentversion', XMLDB_TYPE_INTEGER, '4', null, null, null, null, 'remotestatus');
        if (!$dbman->field_exists($table, $currentversion)) {
            $dbman->add_field($table, $currentversion);
        }
        $bestversion = new xmldb_field('bestversion', XMLDB_TYPE_INTEGER, '4', null, null, null, null, 'currentversion');
        if (!$dbman->field_exists($table, $bestversion)) {
            $dbman->add_field($table, $bestversion);
        }

        $versiontable = new xmldb_table('local_awakeinfographic_version');
        if (!$dbman->table_exists($versiontable)) {
            $versiontable->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
            $versiontable->add_field('jobid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $versiontable->add_field('versionno', XMLDB_TYPE_INTEGER, '4', null, XMLDB_NOTNULL, null, null);
            $versiontable->add_field('origin', XMLDB_TYPE_CHAR, '10', null, XMLDB_NOTNULL, null, null);
            $versiontable->add_field('score', XMLDB_TYPE_NUMBER, '6,2', null, null, null, null);
            $versiontable->add_field('prompt', XMLDB_TYPE_TEXT, null, null, null, null, null);
            $versiontable->add_field('targetlabel', XMLDB_TYPE_CHAR, '255', null, null, null, null);
            $versiontable->add_field('haspreview', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0');
            $versiontable->add_field('timecreated', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $versiontable->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
            $versiontable->add_key('jobid_fk', XMLDB_KEY_FOREIGN, ['jobid'], 'local_awakeinfographic_job', ['id']);
            $versiontable->add_index('jobid_versionno', XMLDB_INDEX_UNIQUE, ['jobid', 'versionno']);
            $dbman->create_table($versiontable);
        }

        // Migra cada job `done` a una versión 1, con sus ficheros. Los demás
        // estados (pending/submitted/running/failed) no tenían fichero que
        // migrar: se quedan sin versión hasta que sync_job los termine.
        //
        // En dos pasadas a propósito: 'preview' es el mismo nombre de
        // filearea en los dos esquemas (itemid = job en el viejo, itemid =
        // versión en el nuevo), y esos dos ids son enteros que empiezan en 1
        // cada uno por su lado — pueden coincidir entre jobs distintos sin
        // que tengan nada que ver. Crear el fichero nuevo de un job antes de
        // haber borrado el viejo de OTRO job revienta la clave única de
        // mdl_files ("Duplicate entry ... for key mdl_files.mdl_file_pat_uix"),
        // visto en producción. Por eso aquí se borra TODO lo viejo primero, y
        // solo después se crea nada nuevo.
        //
        // Además es tolerante a un intento anterior que se cortase a mitad
        // (p. ej. por este mismo choque): si un job ya tiene su versión 1
        // pero sin preview, y el preview viejo seguía ahí sin borrar, esta
        // pasada lo recoge y completa la versión en vez de fallar de nuevo o
        // dejarla coja para siempre.
        if ($dbman->field_exists($table, new xmldb_field('score'))) {
            $fs = get_file_storage();
            $done = $DB->get_records('local_awakeinfographic_job', ['status' => 'done']);

            $pending = [];
            foreach ($done as $job) {
                $usercontext = \context_user::instance($job->userid);
                $existingversion = $DB->get_record(
                    'local_awakeinfographic_version', ['jobid' => $job->id, 'versionno' => 1]
                );

                $resultfiles = $fs->get_area_files(
                    $usercontext->id, 'local_awakeinfographic', 'result', $job->id, 'itemid', false
                );
                $resultfile = $resultfiles ? reset($resultfiles) : null;
                $previewfiles = $fs->get_area_files(
                    $usercontext->id, 'local_awakeinfographic', 'preview', $job->id, 'itemid', false
                );
                $previewfile = $previewfiles ? reset($previewfiles) : null;

                if (!$existingversion && !$resultfile) {
                    continue; // done sin fichero (no debería pasar) y sin versión previa: nada que migrar.
                }

                $pending[] = [
                    'job' => $job,
                    'existingversion' => $existingversion,
                    // Si ya hay versión, su HTML ya está migrado: no hace falta releerlo.
                    'html' => $existingversion ? null : $resultfile->get_content(),
                    'preview' => $previewfile ? $previewfile->get_content() : null,
                ];

                $fs->delete_area_files($usercontext->id, 'local_awakeinfographic', 'result', $job->id);
                $fs->delete_area_files($usercontext->id, 'local_awakeinfographic', 'preview', $job->id);
            }

            // Con todo lo viejo ya borrado, no hay ningún itemid libre que
            // pueda chocar: ahora sí se puede crear/completar cada versión.
            foreach ($pending as $item) {
                $job = $item['job'];
                $usercontext = \context_user::instance($job->userid);
                $version = $item['existingversion'];

                if (!$version) {
                    $version = new stdClass();
                    $version->jobid = $job->id;
                    $version->versionno = 1;
                    $version->origin = 'generate';
                    $version->score = $job->score ?? null;
                    $version->prompt = null;
                    $version->targetlabel = null;
                    $version->haspreview = 0;
                    $version->timecreated = $job->timecreated;
                    $version->id = $DB->insert_record('local_awakeinfographic_version', $version);

                    $fs->create_file_from_string([
                        'contextid' => $usercontext->id,
                        'component' => 'local_awakeinfographic',
                        'filearea' => 'version',
                        'itemid' => $version->id,
                        'filepath' => '/',
                        'filename' => 'infographic.html',
                    ], $item['html']);
                }

                if (!$version->haspreview && $item['preview'] !== null) {
                    $fs->create_file_from_string([
                        'contextid' => $usercontext->id,
                        'component' => 'local_awakeinfographic',
                        'filearea' => 'preview',
                        'itemid' => $version->id,
                        'filepath' => '/',
                        'filename' => 'preview.png',
                    ], $item['preview']);
                    $DB->set_field('local_awakeinfographic_version', 'haspreview', 1, ['id' => $version->id]);
                }

                $DB->set_field('local_awakeinfographic_job', 'currentversion', 1, ['id' => $job->id]);
                $DB->set_field('local_awakeinfographic_job', 'bestversion', 1, ['id' => $job->id]);
            }

            $dbman->drop_field($table, new xmldb_field('score'));
            $dbman->drop_field($table, new xmldb_field('passcount'));
        }

        upgrade_plugin_savepoint(true, 2026090700, 'local', 'awakeinfographic');
    }

    return true;
}

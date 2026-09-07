<?php
defined('MOODLE_INTERNAL') || die();

/**
 * Sirve los ficheros del plugin desde la File API vía la URL nativa de
 * Moodle. Registrado por contrato de la File API (backup, privacy…), pero
 * **no** es la vía que usan `app.js`/`editor.js`: esos leen `IG_CONFIG.filesBase`
 * → `files.php`, que despacha por `PATH_INFO` las rutas que ya construyen sin
 * tocarlos (ver `files.php`, PLAN_MOODLE.md §4.1). `source` tiene itemid =
 * job; `version`/`preview` tienen itemid = versión, así que hace falta un
 * salto extra para encontrar al job dueño y comprobar permisos.
 *
 * @param stdClass $course
 * @param stdClass|null $cm
 * @param context $context
 * @param string $filearea
 * @param array $args
 * @param bool $forcedownload
 * @param array $options
 * @return bool|void
 */
function local_awakeinfographic_pluginfile($course, $cm, $context, $filearea, $args, $forcedownload, array $options = []) {
    global $USER, $DB;

    require_login();

    if ($context->contextlevel !== CONTEXT_USER || !in_array($filearea, ['version', 'preview', 'source'], true)) {
        return false;
    }

    $itemid = (int) array_shift($args);
    if ($filearea === 'source') {
        try {
            $job = \local_awakeinfographic\job::get($itemid);
        } catch (\dml_missing_record_exception $e) {
            return false;
        }
    } else {
        $version = $DB->get_record('local_awakeinfographic_version', ['id' => $itemid]);
        if (!$version) {
            return false;
        }
        try {
            $job = \local_awakeinfographic\job::get((int) $version->jobid);
        } catch (\dml_missing_record_exception $e) {
            return false;
        }
    }

    if ((int) $context->instanceid !== (int) $job->userid) {
        return false;
    }
    if (!\local_awakeinfographic\job::can_view($job, (int) $USER->id)) {
        return false;
    }

    $filename = array_pop($args);
    $filepath = $args ? ('/' . implode('/', $args) . '/') : '/';

    $fs = get_file_storage();
    $file = $fs->get_file($context->id, 'local_awakeinfographic', $filearea, $itemid, $filepath, $filename);
    if (!$file || $file->is_directory()) {
        return false;
    }

    // filelifetime 0: no cachear un activo privado en proxies intermedios.
    send_stored_file($file, 0, 0, $forcedownload, $options);
}

/**
 * Nodo de navegación para llegar a «Mis infografías» sin bucear en
 * Administración del sitio. El acceso real lo sigue decidiendo la
 * capability, no este enlace.
 */
function local_awakeinfographic_extend_navigation(global_navigation $nav) {
    if (!isloggedin() || isguestuser()) {
        return;
    }
    if (!has_capability('local/awakeinfographic:generate', context_system::instance())) {
        return;
    }
    $node = $nav->add(
        get_string('pluginname', 'local_awakeinfographic'),
        new moodle_url('/local/awakeinfographic/index.php'),
        navigation_node::TYPE_CUSTOM,
        null,
        'local_awakeinfographic'
    );
    $node->showinflatnavigation = true;
}

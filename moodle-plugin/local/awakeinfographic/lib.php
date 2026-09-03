<?php
defined('MOODLE_INTERNAL') || die();

/**
 * Sirve los ficheros del plugin desde la File API: la previsualización
 * sandbox, la descarga del HTML y el original. Contexto de usuario: los
 * permisos siguen al dueño y el activo sobrevive a que se borre el curso
 * donde se creó. `filelifetime` 0 para no cachear un activo privado en
 * proxies intermedios. Ver PLAN_MOODLE.md §4.4.
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
    global $USER;

    require_login();

    if ($context->contextlevel !== CONTEXT_USER || !in_array($filearea, ['result', 'preview', 'source'], true)) {
        return false;
    }

    $itemid = (int) array_shift($args);
    try {
        $job = \local_awakeinfographic\job::get($itemid);
    } catch (\dml_missing_record_exception $e) {
        return false;
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

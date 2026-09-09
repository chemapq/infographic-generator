<?php
defined('MOODLE_INTERNAL') || die();

/**
 * Nodo de navegación para llegar a «Mis infografías» sin bucear en
 * Administración del sitio. El acceso real lo sigue decidiendo la
 * capability, no este enlace.
 *
 * No hay `local_awakeinfographic_pluginfile()`: el plugin no guarda ningún
 * fichero. Las infografías viven en el motor, que las sirve él mismo desde
 * dentro del iframe (ver classes/embed.php).
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

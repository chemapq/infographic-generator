<?php
defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_awakeinfographic', get_string('pluginname', 'local_awakeinfographic'));
    $ADMIN->add('localplugins', $settings);

    // El origen del iframe. Todo lo demás (pasadas, tamaños, cupos) lo decide
    // el motor: duplicar aquí sus ajustes solo creaba dos sitios donde mirar.
    $settings->add(new admin_setting_configtext(
        'local_awakeinfographic/apibaseurl',
        get_string('setting:apibaseurl', 'local_awakeinfographic'),
        get_string('setting:apibaseurl_desc', 'local_awakeinfographic'),
        '',
        PARAM_URL
    ));

    $settings->add(new admin_setting_configpasswordunmask(
        'local_awakeinfographic/embedsecret',
        get_string('setting:embedsecret', 'local_awakeinfographic'),
        get_string('setting:embedsecret_desc', 'local_awakeinfographic'),
        ''
    ));

    // Apaga la edición para todo el sitio, se tenga o no la capability. Es el
    // freno de mano del administrador: editar consume tokens de pago.
    $settings->add(new admin_setting_configcheckbox(
        'local_awakeinfographic/allowaiedit',
        get_string('setting:allowaiedit', 'local_awakeinfographic'),
        get_string('setting:allowaiedit_desc', 'local_awakeinfographic'),
        1
    ));

    $testurl = new moodle_url('/local/awakeinfographic/testconnection.php');
    $settings->add(new admin_setting_description(
        'local_awakeinfographic/testconnection',
        get_string('setting:testconnection', 'local_awakeinfographic'),
        html_writer::link($testurl, get_string('setting:testconnection_link', 'local_awakeinfographic'))
    ));

    // Enlace directo junto a los ajustes: sin él, abrir la app exige conocer
    // la URL de memoria.
    $ADMIN->add('localplugins', new admin_externalpage(
        'local_awakeinfographic_list',
        get_string('mylist', 'local_awakeinfographic'),
        new moodle_url('/local/awakeinfographic/index.php'),
        'local/awakeinfographic:generate'
    ));
}

<?php
defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_awakeinfographic', get_string('pluginname', 'local_awakeinfographic'));
    $ADMIN->add('localplugins', $settings);

    $settings->add(new admin_setting_configtext(
        'local_awakeinfographic/apibaseurl',
        get_string('setting:apibaseurl', 'local_awakeinfographic'),
        get_string('setting:apibaseurl_desc', 'local_awakeinfographic'),
        '',
        PARAM_URL
    ));

    $settings->add(new admin_setting_configpasswordunmask(
        'local_awakeinfographic/apikey',
        get_string('setting:apikey', 'local_awakeinfographic'),
        get_string('setting:apikey_desc', 'local_awakeinfographic'),
        ''
    ));

    $maxpassesoptions = array_combine(range(1, 8), range(1, 8));
    $settings->add(new admin_setting_configselect(
        'local_awakeinfographic/maxpassesdefault',
        get_string('setting:maxpassesdefault', 'local_awakeinfographic'),
        get_string('setting:maxpassesdefault_desc', 'local_awakeinfographic'),
        3,
        $maxpassesoptions
    ));

    $settings->add(new admin_setting_configtext(
        'local_awakeinfographic/polltimeoutminutes',
        get_string('setting:polltimeoutminutes', 'local_awakeinfographic'),
        get_string('setting:polltimeoutminutes_desc', 'local_awakeinfographic'),
        20,
        PARAM_INT
    ));

    $testurl = new moodle_url('/local/awakeinfographic/testconnection.php');
    $settings->add(new admin_setting_description(
        'local_awakeinfographic/testconnection',
        get_string('setting:testconnection', 'local_awakeinfographic'),
        html_writer::link($testurl, get_string('setting:testconnection_link', 'local_awakeinfographic'))
    ));

    // Enlaces directos junto a los ajustes: sin ellos, generar una infografía
    // exige conocer la URL de memoria (PLAN_MOODLE.md §7.3).
    $ADMIN->add('localplugins', new admin_externalpage(
        'local_awakeinfographic_list',
        get_string('mylist', 'local_awakeinfographic'),
        new moodle_url('/local/awakeinfographic/index.php'),
        'local/awakeinfographic:generate'
    ));

    $ADMIN->add('localplugins', new admin_externalpage(
        'local_awakeinfographic_create',
        get_string('newinfographic', 'local_awakeinfographic'),
        new moodle_url('/local/awakeinfographic/create.php'),
        'local/awakeinfographic:generate'
    ));
}

<?php
namespace local_awakeinfographic\form;

defined('MOODLE_INTERNAL') || die();

require_once($GLOBALS['CFG']->libdir . '/formslib.php');

/** `moodleform`: filepicker + maxpasses + notas. Ver PLAN_MOODLE.md §4.3, paso 1. */
class create_form extends \moodleform {
    protected function definition() {
        $mform = $this->_form;
        $courseid = (int) ($this->_customdata['courseid'] ?? 0);

        $mform->addElement('filepicker', 'image', get_string('form:image', 'local_awakeinfographic'), null, [
            'accepted_types' => ['web_image'],
            'maxbytes' => 25 * 1024 * 1024,
        ]);
        $mform->addRule('image', null, 'required');
        $mform->addHelpButton('image', 'form:image', 'local_awakeinfographic');

        $mform->addElement('text', 'title', get_string('form:title', 'local_awakeinfographic'), ['size' => 60]);
        $mform->setType('title', PARAM_TEXT);
        $mform->addRule('title', null, 'required');
        $mform->addRule('title', null, 'maxlength', 255, 'client');

        $maxpassesoptions = array_combine(range(1, 8), range(1, 8));
        $mform->addElement('select', 'maxpasses', get_string('form:maxpasses', 'local_awakeinfographic'), $maxpassesoptions);
        $mform->setDefault('maxpasses', (int) (get_config('local_awakeinfographic', 'maxpassesdefault') ?: 3));
        $mform->addHelpButton('maxpasses', 'form:maxpasses', 'local_awakeinfographic');

        $mform->addElement('textarea', 'notes', get_string('form:notes', 'local_awakeinfographic'), ['rows' => 4, 'cols' => 60]);
        $mform->setType('notes', PARAM_TEXT);

        $mform->addElement('checkbox', 'rightsconfirmed', get_string('form:rightsconfirmed', 'local_awakeinfographic'));
        $mform->addRule('rightsconfirmed', get_string('form:rightsconfirmed_required', 'local_awakeinfographic'), 'required');

        $mform->addElement('hidden', 'courseid', $courseid);
        $mform->setType('courseid', PARAM_INT);

        $this->add_action_buttons(true, get_string('form:submit', 'local_awakeinfographic'));
    }
}

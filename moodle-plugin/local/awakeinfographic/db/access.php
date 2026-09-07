<?php
defined('MOODLE_INTERNAL') || die();

/**
 * Solo profesores y gestores generan (PLAN_MOODLE.md, decisiones cerradas):
 * sin alumnos, sin cuotas por usuario, sin moderación en la v1.
 */
$capabilities = [
    'local/awakeinfographic:generate' => [
        'captype' => 'write',
        'contextlevel' => CONTEXT_SYSTEM,
        // Consume una API de pago: no es un riesgo de seguridad clásico, pero
        // sí uno que un administrador quiere ver antes de conceder el rol.
        'riskbitmask' => RISK_SPAM,
        'archetypes' => [
            'editingteacher' => CAP_ALLOW,
            'manager' => CAP_ALLOW,
        ],
    ],
    // Separada de `generate` a propósito: hay centros que querrán que un
    // perfil pueda retocar pero no generar de cero (PLAN_MOODLE.md §6.3).
    'local/awakeinfographic:edit' => [
        'captype' => 'write',
        'contextlevel' => CONTEXT_SYSTEM,
        'riskbitmask' => RISK_SPAM,
        'archetypes' => [
            'editingteacher' => CAP_ALLOW,
            'manager' => CAP_ALLOW,
        ],
    ],
    'local/awakeinfographic:viewall' => [
        'captype' => 'read',
        'contextlevel' => CONTEXT_SYSTEM,
        'riskbitmask' => RISK_PERSONAL,
        'archetypes' => [
            'manager' => CAP_ALLOW,
        ],
    ],
];

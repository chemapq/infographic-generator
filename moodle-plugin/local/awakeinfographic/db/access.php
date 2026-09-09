<?php
defined('MOODLE_INTERNAL') || die();

/**
 * Solo profesores y gestores generan (PLAN_MOODLE.md, decisiones cerradas):
 * sin alumnos, sin cuotas por usuario, sin moderación en la v1.
 *
 * Las dos capabilities viajan al motor dentro del ticket firmado
 * (classes/embed.php): `generate` decide quién puede abrir el iframe, y
 * `edit` si el motor acepta sus peticiones de cambio.
 *
 * Ya no hay `:viewall`. Servía para ver en Moodle las infografías de otros
 * usuarios, y desde la 1.0.0 Moodle no guarda ninguna: quien necesite ver
 * todo el historial entra por la interfaz web del motor.
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
];

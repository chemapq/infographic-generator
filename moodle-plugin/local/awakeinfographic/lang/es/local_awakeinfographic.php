<?php
defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'Awakelab Infographic';
$string['mylist'] = 'Mis infografías';
$string['frame:title'] = 'Generador de infografías de Awakelab';

$string['awakeinfographic:generate'] = 'Generar infografías con el motor de Awakelab';
$string['awakeinfographic:edit'] = 'Modificar una infografía generada (con IA o a mano)';

$string['setting:apibaseurl'] = 'URL base del motor';
$string['setting:apibaseurl_desc'] = 'Por ejemplo, https://infografias.ejemplo.com. Sin barra final. Tiene que ser HTTPS si este Moodle lo es: el navegador bloquea un iframe http:// dentro de una página https://.';
$string['setting:embedsecret'] = 'Secreto compartido con el motor';
$string['setting:embedsecret_desc'] = 'Tiene que ser exactamente el mismo valor que la variable EMBED_SECRET del motor. Con él se firma el pase de acceso de cada usuario; si no coinciden, el marco muestra «el pase de acceso no es válido».';
$string['setting:allowaiedit'] = 'Permitir modificar infografías';
$string['setting:allowaiedit_desc'] = 'Desactívalo para dejar el generador en modo solo-lectura para todo el sitio: se podrán crear infografías, pero no pedirle cambios a la IA ni retocar los textos. Es independiente del permiso de cada rol; hacen falta los dos.';
$string['setting:testconnection'] = 'Probar conexión';
$string['setting:testconnection_link'] = 'Comprobar ahora la conexión con el motor';

$string['testconnection:ok'] = 'El motor responde correctamente (modelo: {$a}).';
$string['testconnection:fail'] = 'No se pudo conectar con el motor: {$a}';
$string['testconnection:httpstatus'] = 'respondió con un código HTTP {$a}';
$string['testconnection:noreply'] = 'no hubo respuesta; comprueba la URL y que el motor esté levantado';
$string['testconnection:nosecret'] = 'Falta el secreto compartido. Sin él no se puede firmar el pase de acceso y el generador no se abrirá: rellena «Secreto compartido con el motor» con el mismo valor que tenga EMBED_SECRET en el motor.';

$string['error:notconfigured'] = 'El generador no está configurado. Pide a un administrador que rellene la URL del motor y el secreto compartido en Administración del sitio → Extensiones → Awakelab Infographic.';

$string['privacy:metadata:engine'] = 'El motor externo que genera y edita las infografías (y que a su vez llama a la API de Anthropic) es donde se guardan de verdad: Moodle no conserva ninguna copia.';
$string['privacy:metadata:engine:userid'] = 'Un identificador derivado de tu cuenta de Moodle, con el que el motor separa tus infografías de las de los demás.';
$string['privacy:metadata:engine:image'] = 'La imagen que se quiere convertir en infografía.';
$string['privacy:metadata:engine:notes'] = 'Las notas opcionales para orientar la generación.';
$string['privacy:metadata:engine:prompt'] = 'Las instrucciones de cada cambio que se le pide a la IA.';

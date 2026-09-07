<?php
defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'Awakelab Infographic';
$string['mylist'] = 'Mis infografías';

$string['awakeinfographic:generate'] = 'Generar infografías con el motor de Awakelab';
$string['awakeinfographic:edit'] = 'Pedir cambios a la IA sobre una infografía generada';
$string['awakeinfographic:viewall'] = 'Ver y borrar las infografías de cualquier usuario';

$string['setting:apibaseurl'] = 'URL base de la API del motor';
$string['setting:apibaseurl_desc'] = 'Por ejemplo, http://host.docker.internal:3000. Sin barra final.';
$string['setting:apikey'] = 'Clave de la API';
$string['setting:apikey_desc'] = 'Una de las claves declaradas en API_KEYS en el motor.';
$string['setting:maxpassesdefault'] = 'Pasadas de refinado por defecto';
$string['setting:maxpassesdefault_desc'] = 'Número de pasadas que se ofrece por defecto al crear una infografía (1-8).';
$string['setting:polltimeoutminutes'] = 'Tiempo máximo de espera (minutos)';
$string['setting:polltimeoutminutes_desc'] = 'Minutos antes de avisar de que un job está tardando más de lo normal. No cambia el tope real de reintentos (MAXATTEMPTS), es solo informativo para el profesor.';
$string['setting:allowaiedit'] = 'Permitir editar con IA';
$string['setting:allowaiedit_desc'] = 'Apaga solo «Pedir cambios a la IA» (cuesta tokens); la edición manual de textos sigue disponible siempre porque es gratis.';
$string['setting:testconnection'] = 'Probar conexión';
$string['setting:testconnection_link'] = 'Comprobar ahora la conexión con el motor';

$string['testconnection:ok'] = 'El motor responde correctamente (modelo: {$a}).';
$string['testconnection:fail'] = 'No se pudo conectar con el motor: {$a}';
$string['testconnection:maxexecutiontime'] = 'El «max_execution_time» de PHP de este Moodle es de {$a} s. Edición con IA necesita hasta 180 s: súbelo o algunas ediciones se cortarán a mitad.';

$string['warning:croninactive'] = 'Hay infografías esperando a enviarse y el cron de Moodle no parece estar corriendo. Sin cron, nada se procesará: pide a un administrador que lo revise (php admin/cli/cron.php debería ejecutarse cada minuto).';

$string['task:syncjob'] = 'Sincronizar infografía con el motor';
$string['task:cleanup'] = 'Purgar infografías fallidas antiguas';

$string['error:notconfigured'] = 'La API del motor no está configurada. Pide a un administrador que rellene la URL y la clave en Administración del sitio → Extensiones → Awakelab Infographic.';
$string['error:noaccess'] = 'No tienes permiso para ver esta infografía.';
$string['error:missingsource'] = 'Falta la imagen original: no se puede enviar al motor.';
$string['error:missingimage'] = 'No llegó ninguna imagen.';
$string['error:imagetoolarge'] = 'La imagen pesa más de 25 MB.';
$string['error:missingtitle'] = 'Falta el título.';
$string['error:missingprompt'] = 'Falta describir el cambio que quieres pedir.';
$string['error:missinghtml'] = 'No llegó el HTML editado.';
$string['error:htmltoolarge'] = 'El HTML pesa más de 2 MB.';
$string['error:aieditdisabled'] = 'La edición con IA está desactivada en este Moodle, o no tienes permiso para usarla.';
$string['error:noversion'] = 'Esta infografía todavía no tiene ninguna versión sobre la que editar.';
$string['error:staleversion'] = 'Otra pestaña guardó una versión más reciente mientras editabas. Recarga para ver el cambio y vuelve a intentarlo.';
$string['error:remotenotfound'] = 'El motor ya no tiene este job (puede que se haya borrado por retención). Genera la infografía de nuevo.';
$string['error:remotefailed'] = 'El motor no pudo generar la infografía.';
$string['error:unsafehtml'] = 'El HTML no pasó la comprobación de seguridad del plugin y se ha descartado.';
$string['error:timeout'] = 'Se agotó el tiempo de espera sin que el motor terminara.';
$string['error:internal'] = 'Ha ocurrido un error inesperado. Inténtalo de nuevo.';

$string['privacy:metadata:job'] = 'Por cada infografía generada se guarda una fila con su estado.';
$string['privacy:metadata:job:userid'] = 'El usuario que generó la infografía.';
$string['privacy:metadata:job:title'] = 'El título de la infografía.';
$string['privacy:metadata:job:status'] = 'El estado del job.';
$string['privacy:metadata:job:timecreated'] = 'Cuándo se creó.';
$string['privacy:metadata:version'] = 'Cada pasada de generación o edición de una infografía es una fila propia.';
$string['privacy:metadata:version:origin'] = 'Si la versión viene de generar, refinar, editar con IA o editar a mano.';
$string['privacy:metadata:version:score'] = 'La puntuación de similitud con el original (solo en las generadas).';
$string['privacy:metadata:version:prompt'] = 'El prompt del profesor, en las versiones editadas con IA.';
$string['privacy:metadata:version:timecreated'] = 'Cuándo se creó la versión.';
$string['privacy:metadata:files'] = 'La imagen original y el HTML y la previsualización de cada versión se guardan como ficheros del plugin.';
$string['privacy:metadata:engine'] = 'El motor externo que genera y edita el HTML (y a su vez llama a la API de Anthropic) recibe la imagen original, las notas del profesor y sus instrucciones de edición.';
$string['privacy:metadata:engine:image'] = 'La imagen que se quiere convertir en infografía.';
$string['privacy:metadata:engine:notes'] = 'Las notas opcionales del profesor para orientar la generación.';

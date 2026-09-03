<?php
defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'Awakelab Infographic';

$string['awakeinfographic:generate'] = 'Generar infografías con el motor de Awakelab';
$string['awakeinfographic:viewall'] = 'Ver y borrar las infografías de cualquier usuario';

$string['mylist'] = 'Mis infografías';
$string['newinfographic'] = 'Nueva infografía';

$string['setting:apibaseurl'] = 'URL base de la API del motor';
$string['setting:apibaseurl_desc'] = 'Por ejemplo, http://host.docker.internal:3000. Sin barra final.';
$string['setting:apikey'] = 'Clave de la API';
$string['setting:apikey_desc'] = 'Una de las claves declaradas en API_KEYS en el motor.';
$string['setting:maxpassesdefault'] = 'Pasadas de refinado por defecto';
$string['setting:maxpassesdefault_desc'] = 'Número de pasadas que se ofrece por defecto al crear una infografía (1-8).';
$string['setting:polltimeoutminutes'] = 'Tiempo máximo de espera (minutos)';
$string['setting:polltimeoutminutes_desc'] = 'Minutos antes de avisar de que un job está tardando más de lo normal. No cambia el tope real de reintentos (MAXATTEMPTS), es solo informativo para el profesor.';
$string['setting:testconnection'] = 'Probar conexión';
$string['setting:testconnection_link'] = 'Comprobar ahora la conexión con el motor';

$string['testconnection:ok'] = 'El motor responde correctamente (modelo: {$a}).';
$string['testconnection:fail'] = 'No se pudo conectar con el motor: {$a}';

$string['form:image'] = 'Imagen de la infografía';
$string['form:image_help'] = 'Sube una infografía en PNG, JPEG, WebP o GIF, de hasta 25 MB. El motor la usará como referencia para reproducirla en HTML.';
$string['form:title'] = 'Título';
$string['form:maxpasses'] = 'Pasadas de refinado';
$string['form:maxpasses_help'] = 'Cada pasada afina el resultado y cuesta más tokens. Con 2-3 pasadas suele bastar para una prueba.';
$string['form:notes'] = 'Notas para el motor (opcional)';
$string['form:rightsconfirmed'] = 'Confirmo que tengo derechos sobre esta imagen';
$string['form:rightsconfirmed_required'] = 'Debes confirmar que tienes derechos sobre la imagen antes de continuar.';
$string['form:submit'] = 'Generar infografía';
$string['form:intro'] = 'La generación tarda varios minutos: se envía al motor externo y se sondea en segundo plano. Puedes cerrar esta página; el estado se actualiza en «Mis infografías».';

$string['submitted'] = 'Infografía enviada. El estado se actualizará en segundo plano.';
$string['deleted'] = 'Infografía borrada.';
$string['delete:confirm'] = '¿Borrar la infografía «{$a}»? Esta acción no se puede deshacer.';

$string['warning:croninactive'] = 'Hay infografías esperando a enviarse y el cron de Moodle no parece estar corriendo. Sin cron, nada se procesará: pide a un administrador que lo revise (php admin/cli/cron.php debería ejecutarse cada minuto).';

$string['nojobs'] = 'Todavía no has generado ninguna infografía.';
$string['list:owner'] = 'Autor';
$string['list:status'] = 'Estado';
$string['list:score'] = 'Puntuación';
$string['list:created'] = 'Creada';
$string['list:open'] = 'Abrir';
$string['list:back'] = 'Volver al listado';

$string['view:download'] = 'Descargar HTML';
$string['view:pluginfilehint'] = 'Para usarla en un curso, insértala con el selector de archivos o enlaza esta URL.';
$string['view:waiting'] = 'Generando… esta página se actualiza sola cada 15 segundos.';
$string['view:delete'] = 'Borrar';

$string['status:pending'] = 'Pendiente de enviar';
$string['status:submitted'] = 'Enviada al motor';
$string['status:running'] = 'Generando';
$string['status:done'] = 'Lista';
$string['status:failed'] = 'Fallida';

$string['task:syncjob'] = 'Sincronizar infografía con el motor';
$string['task:cleanup'] = 'Purgar infografías fallidas antiguas';

$string['error:notconfigured'] = 'La API del motor no está configurada. Pide a un administrador que rellene la URL y la clave en Administración del sitio → Extensiones → Awakelab Infographic.';
$string['error:noaccess'] = 'No tienes permiso para ver esta infografía.';
$string['error:missingsource'] = 'Falta la imagen original: no se puede enviar al motor.';
$string['error:remotenotfound'] = 'El motor ya no tiene este job (puede que se haya borrado por retención). Genera la infografía de nuevo.';
$string['error:remotefailed'] = 'El motor no pudo generar la infografía.';
$string['error:unsafehtml'] = 'El HTML devuelto por el motor no pasó la comprobación de seguridad del plugin y se ha descartado.';
$string['error:timeout'] = 'Se agotó el tiempo de espera sin que el motor terminara.';

$string['privacy:metadata:job'] = 'Por cada infografía generada se guarda una fila con su estado y su resultado.';
$string['privacy:metadata:job:userid'] = 'El usuario que generó la infografía.';
$string['privacy:metadata:job:title'] = 'El título de la infografía.';
$string['privacy:metadata:job:status'] = 'El estado del job.';
$string['privacy:metadata:job:score'] = 'La puntuación de similitud con el original.';
$string['privacy:metadata:job:timecreated'] = 'Cuándo se creó.';
$string['privacy:metadata:files'] = 'La imagen original, el HTML generado y su previsualización se guardan como ficheros del plugin.';
$string['privacy:metadata:engine'] = 'El motor externo que genera el HTML (y a su vez llama a la API de Anthropic) recibe la imagen original y las notas del profesor.';
$string['privacy:metadata:engine:image'] = 'La imagen que se quiere convertir en infografía.';
$string['privacy:metadata:engine:notes'] = 'Las notas opcionales del profesor para orientar la generación.';

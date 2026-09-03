<?php
defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'Awakelab Infographic';

$string['awakeinfographic:generate'] = 'Generate infographics with the Awakelab engine';
$string['awakeinfographic:viewall'] = 'View and delete infographics belonging to any user';

$string['mylist'] = 'My infographics';
$string['newinfographic'] = 'New infographic';

$string['setting:apibaseurl'] = 'Engine API base URL';
$string['setting:apibaseurl_desc'] = 'For example, http://host.docker.internal:3000. No trailing slash.';
$string['setting:apikey'] = 'API key';
$string['setting:apikey_desc'] = 'One of the keys declared in API_KEYS on the engine.';
$string['setting:maxpassesdefault'] = 'Default refinement passes';
$string['setting:maxpassesdefault_desc'] = 'Number of passes offered by default when creating an infographic (1-8).';
$string['setting:polltimeoutminutes'] = 'Maximum wait time (minutes)';
$string['setting:polltimeoutminutes_desc'] = 'Minutes before warning that a job is taking longer than usual. Does not change the actual retry cap (MAXATTEMPTS); it is informational only.';
$string['setting:testconnection'] = 'Test connection';
$string['setting:testconnection_link'] = 'Check the connection with the engine now';

$string['testconnection:ok'] = 'The engine responded correctly (model: {$a}).';
$string['testconnection:fail'] = 'Could not connect to the engine: {$a}';

$string['form:image'] = 'Infographic image';
$string['form:image_help'] = 'Upload an infographic as PNG, JPEG, WebP or GIF, up to 25 MB. The engine will use it as the reference to reproduce it in HTML.';
$string['form:title'] = 'Title';
$string['form:maxpasses'] = 'Refinement passes';
$string['form:maxpasses_help'] = 'Each pass refines the result and costs more tokens. 2-3 passes are usually enough for a test.';
$string['form:notes'] = 'Notes for the engine (optional)';
$string['form:rightsconfirmed'] = 'I confirm I have the rights to use this image';
$string['form:rightsconfirmed_required'] = 'You must confirm you have the rights to the image before continuing.';
$string['form:submit'] = 'Generate infographic';
$string['form:intro'] = 'Generation takes a few minutes: it is sent to the external engine and polled in the background. You can close this page; the status updates in "My infographics".';

$string['submitted'] = 'Infographic submitted. Its status will update in the background.';
$string['deleted'] = 'Infographic deleted.';
$string['delete:confirm'] = 'Delete the infographic "{$a}"? This cannot be undone.';

$string['warning:croninactive'] = 'There are infographics waiting to be submitted and Moodle\'s cron does not seem to be running. Without cron, nothing will be processed: ask an administrator to check it (php admin/cli/cron.php should run every minute).';

$string['nojobs'] = 'You have not generated any infographic yet.';
$string['list:owner'] = 'Owner';
$string['list:status'] = 'Status';
$string['list:score'] = 'Score';
$string['list:created'] = 'Created';
$string['list:open'] = 'Open';
$string['list:back'] = 'Back to the list';

$string['view:download'] = 'Download HTML';
$string['view:pluginfilehint'] = 'To use it in a course, insert it with the file picker or link this URL.';
$string['view:waiting'] = 'Generating… this page refreshes itself every 15 seconds.';
$string['view:delete'] = 'Delete';

$string['status:pending'] = 'Pending submission';
$string['status:submitted'] = 'Submitted to the engine';
$string['status:running'] = 'Generating';
$string['status:done'] = 'Ready';
$string['status:failed'] = 'Failed';

$string['task:syncjob'] = 'Sync infographic with the engine';
$string['task:cleanup'] = 'Purge old failed infographics';

$string['error:notconfigured'] = 'The engine API is not configured. Ask an administrator to fill in the URL and key under Site administration → Plugins → Awakelab Infographic.';
$string['error:noaccess'] = 'You do not have permission to view this infographic.';
$string['error:missingsource'] = 'The original image is missing: it cannot be sent to the engine.';
$string['error:remotenotfound'] = 'The engine no longer has this job (it may have been purged by retention). Generate the infographic again.';
$string['error:remotefailed'] = 'The engine could not generate the infographic.';
$string['error:unsafehtml'] = 'The HTML returned by the engine did not pass the plugin\'s safety check and was discarded.';
$string['error:timeout'] = 'The wait timed out before the engine finished.';

$string['privacy:metadata:job'] = 'For each generated infographic, a row is kept with its status and result.';
$string['privacy:metadata:job:userid'] = 'The user who generated the infographic.';
$string['privacy:metadata:job:title'] = 'The infographic title.';
$string['privacy:metadata:job:status'] = 'The job status.';
$string['privacy:metadata:job:score'] = 'The similarity score against the original.';
$string['privacy:metadata:job:timecreated'] = 'When it was created.';
$string['privacy:metadata:files'] = 'The original image, the generated HTML and its preview are stored as plugin files.';
$string['privacy:metadata:engine'] = 'The external engine that generates the HTML (which in turn calls the Anthropic API) receives the original image and the teacher\'s notes.';
$string['privacy:metadata:engine:image'] = 'The image to be turned into an infographic.';
$string['privacy:metadata:engine:notes'] = 'The teacher\'s optional notes to steer the generation.';

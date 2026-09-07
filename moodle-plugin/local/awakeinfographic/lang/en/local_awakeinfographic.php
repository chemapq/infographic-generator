<?php
defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'Awakelab Infographic';
$string['mylist'] = 'My infographics';

$string['awakeinfographic:generate'] = 'Generate infographics with the Awakelab engine';
$string['awakeinfographic:edit'] = 'Ask the AI for changes on a generated infographic';
$string['awakeinfographic:viewall'] = 'View and delete infographics belonging to any user';

$string['setting:apibaseurl'] = 'Engine API base URL';
$string['setting:apibaseurl_desc'] = 'For example, http://host.docker.internal:3000. No trailing slash.';
$string['setting:apikey'] = 'API key';
$string['setting:apikey_desc'] = 'One of the keys declared in API_KEYS on the engine.';
$string['setting:maxpassesdefault'] = 'Default refinement passes';
$string['setting:maxpassesdefault_desc'] = 'Number of passes offered by default when creating an infographic (1-8).';
$string['setting:polltimeoutminutes'] = 'Maximum wait time (minutes)';
$string['setting:polltimeoutminutes_desc'] = 'Minutes before warning that a job is taking longer than usual. Does not change the actual retry cap (MAXATTEMPTS); it is informational only.';
$string['setting:allowaiedit'] = 'Allow AI editing';
$string['setting:allowaiedit_desc'] = 'Turns off only "Ask the AI for changes" (it costs tokens); manual text editing stays available always, since it is free.';
$string['setting:testconnection'] = 'Test connection';
$string['setting:testconnection_link'] = 'Check the connection with the engine now';

$string['testconnection:ok'] = 'The engine responded correctly (model: {$a}).';
$string['testconnection:fail'] = 'Could not connect to the engine: {$a}';
$string['testconnection:maxexecutiontime'] = 'This Moodle\'s PHP "max_execution_time" is {$a}s. AI editing can take up to 180s: raise it, or some edits will be cut off mid-way.';

$string['warning:croninactive'] = 'There are infographics waiting to be submitted and Moodle\'s cron does not seem to be running. Without cron, nothing will be processed: ask an administrator to check it (php admin/cli/cron.php should run every minute).';

$string['task:syncjob'] = 'Sync infographic with the engine';
$string['task:cleanup'] = 'Purge old failed infographics';

$string['error:notconfigured'] = 'The engine API is not configured. Ask an administrator to fill in the URL and key under Site administration → Plugins → Awakelab Infographic.';
$string['error:noaccess'] = 'You do not have permission to view this infographic.';
$string['error:missingsource'] = 'The original image is missing: it cannot be sent to the engine.';
$string['error:missingimage'] = 'No image was received.';
$string['error:imagetoolarge'] = 'The image is larger than 25 MB.';
$string['error:missingtitle'] = 'The title is missing.';
$string['error:missingprompt'] = 'Describe the change you want to ask for.';
$string['error:missinghtml'] = 'No edited HTML was received.';
$string['error:htmltoolarge'] = 'The HTML is larger than 2 MB.';
$string['error:aieditdisabled'] = 'AI editing is disabled on this Moodle, or you do not have permission to use it.';
$string['error:noversion'] = 'This infographic does not have any version to edit yet.';
$string['error:staleversion'] = 'Another tab saved a newer version while you were editing. Reload to see the change and try again.';
$string['error:remotenotfound'] = 'The engine no longer has this job (it may have been purged by retention). Generate the infographic again.';
$string['error:remotefailed'] = 'The engine could not generate the infographic.';
$string['error:unsafehtml'] = 'The HTML did not pass the plugin\'s safety check and was discarded.';
$string['error:timeout'] = 'The wait timed out before the engine finished.';
$string['error:internal'] = 'An unexpected error occurred. Please try again.';

$string['privacy:metadata:job'] = 'For each generated infographic, a row is kept with its status.';
$string['privacy:metadata:job:userid'] = 'The user who generated the infographic.';
$string['privacy:metadata:job:title'] = 'The infographic title.';
$string['privacy:metadata:job:status'] = 'The job status.';
$string['privacy:metadata:job:timecreated'] = 'When it was created.';
$string['privacy:metadata:version'] = 'Each generation pass or edit of an infographic is its own row.';
$string['privacy:metadata:version:origin'] = 'Whether the version comes from generating, refining, AI editing or manual editing.';
$string['privacy:metadata:version:score'] = 'The similarity score against the original (generated versions only).';
$string['privacy:metadata:version:prompt'] = 'The teacher\'s prompt, for versions edited with AI.';
$string['privacy:metadata:version:timecreated'] = 'When the version was created.';
$string['privacy:metadata:files'] = 'The original image and each version\'s HTML and preview are stored as plugin files.';
$string['privacy:metadata:engine'] = 'The external engine that generates and edits the HTML (which in turn calls the Anthropic API) receives the original image, the teacher\'s notes, and their edit instructions.';
$string['privacy:metadata:engine:image'] = 'The image to be turned into an infographic.';
$string['privacy:metadata:engine:notes'] = 'The teacher\'s optional notes to steer the generation.';

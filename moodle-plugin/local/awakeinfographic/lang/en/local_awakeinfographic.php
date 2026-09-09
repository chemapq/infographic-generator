<?php
defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'Awakelab Infographic';
$string['mylist'] = 'My infographics';
$string['frame:title'] = 'Awakelab infographic generator';

$string['awakeinfographic:generate'] = 'Generate infographics with the Awakelab engine';
$string['awakeinfographic:edit'] = 'Change a generated infographic (with the AI or by hand)';

$string['setting:apibaseurl'] = 'Engine base URL';
$string['setting:apibaseurl_desc'] = 'For example, https://infographics.example.com. No trailing slash. It must be HTTPS if this Moodle is: browsers block an http:// iframe inside an https:// page.';
$string['setting:embedsecret'] = 'Shared secret with the engine';
$string['setting:embedsecret_desc'] = 'Must be exactly the same value as the engine\'s EMBED_SECRET environment variable. It signs each user\'s access pass; if the two do not match, the frame shows "the access pass is not valid".';
$string['setting:allowaiedit'] = 'Allow changing infographics';
$string['setting:allowaiedit_desc'] = 'Turn this off to leave the generator read-only for the whole site: infographics can still be created, but no AI changes and no text tweaks. It is independent of each role\'s permission; both are required.';
$string['setting:testconnection'] = 'Test connection';
$string['setting:testconnection_link'] = 'Check the connection to the engine now';

$string['testconnection:ok'] = 'The engine responds correctly (model: {$a}).';
$string['testconnection:fail'] = 'Could not connect to the engine: {$a}';
$string['testconnection:httpstatus'] = 'it answered with HTTP status {$a}';
$string['testconnection:noreply'] = 'no reply at all; check the URL and that the engine is running';
$string['testconnection:nosecret'] = 'The shared secret is missing. Without it the access pass cannot be signed and the generator will not open: fill in "Shared secret with the engine" with the same value as EMBED_SECRET on the engine.';

$string['error:notconfigured'] = 'The generator is not configured. Ask an administrator to fill in the engine URL and the shared secret under Site administration → Plugins → Awakelab Infographic.';

$string['privacy:metadata:engine'] = 'The external engine that generates and edits the infographics (and which in turn calls the Anthropic API) is where they actually live: Moodle keeps no copy.';
$string['privacy:metadata:engine:userid'] = 'An identifier derived from your Moodle account, which the engine uses to keep your infographics separate from everyone else\'s.';
$string['privacy:metadata:engine:image'] = 'The image to be turned into an infographic.';
$string['privacy:metadata:engine:notes'] = 'The optional notes used to steer the generation.';
$string['privacy:metadata:engine:prompt'] = 'The instructions for each change requested from the AI.';

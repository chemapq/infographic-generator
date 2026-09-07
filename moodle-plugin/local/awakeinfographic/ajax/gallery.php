<?php
namespace local_awakeinfographic\ajax;

defined('MOODLE_INTERNAL') || die();

use local_awakeinfographic\job_shape;

/** `GET /api/gallery` -> listado desde la BD de Moodle, forma de `GalleryPage`. Ver PLAN_MOODLE.md §6.4. */
function handle_gallery(): void {
    global $DB, $USER;

    $viewall = has_capability('local/awakeinfographic:viewall', \context_system::instance());
    $limit = min(max((int) ($_GET['limit'] ?? 24), 1), 100);
    $offset = max((int) ($_GET['cursor'] ?? 0), 0);
    $q = trim((string) ($_GET['q'] ?? ''));
    $status = (string) ($_GET['status'] ?? 'all');
    $sort = (string) ($_GET['sort'] ?? 'recent');

    // count_records_select() opera sobre una sola tabla (sin alias); la
    // consulta principal necesita el alias `j.` por el JOIN con la versión
    // de mejor score. Mismas condiciones, dos juegos de parámetros.
    $buildwhere = function (string $prefix) use ($DB, $viewall, $q, $status, $USER): array {
        $conditions = [];
        $params = [];
        if (!$viewall) {
            $conditions[] = "{$prefix}userid = :userid";
            $params['userid'] = $USER->id;
        }
        if ($q !== '') {
            $conditions[] = $DB->sql_like("{$prefix}title", ':q', false);
            $params['q'] = '%' . $DB->sql_like_escape($q) . '%';
        }
        if (in_array($status, ['done', 'failed'], true)) {
            $conditions[] = "{$prefix}status = :status";
            $params['status'] = $status;
        }
        return [$conditions ? implode(' AND ', $conditions) : '1=1', $params];
    };

    [$where, $params] = $buildwhere('j.');
    $orderby = $sort === 'score' ? 'bestscore DESC, j.timemodified DESC' : 'j.timemodified DESC';

    // El score del job vive en su versión de mejor puntuación, no en el job.
    $sql = "SELECT j.*, v.score AS bestscore
              FROM {local_awakeinfographic_job} j
         LEFT JOIN {local_awakeinfographic_version} v
                ON v.jobid = j.id AND v.versionno = j.bestversion
             WHERE $where
          ORDER BY $orderby";

    $rows = array_values($DB->get_records_sql($sql, $params, $offset, $limit + 1));
    $hasmore = count($rows) > $limit;
    $rows = array_slice($rows, 0, $limit);

    $items = array_map(function (\stdClass $row) use ($DB): array {
        $passcount = $DB->count_records('local_awakeinfographic_version', ['jobid' => $row->id]);
        return [
            'id' => (string) $row->id,
            'title' => $row->title,
            'status' => job_shape::display_status($row->status),
            'updatedAt' => gmdate('c', (int) $row->timemodified),
            'bestScore' => $row->bestscore !== null ? (float) $row->bestscore : null,
            'passCount' => (int) $passcount,
            'hasResult' => $row->currentversion !== null,
        ];
    }, $rows);

    [$plainwhere, $plainparams] = $buildwhere('');
    $total = $DB->count_records_select('local_awakeinfographic_job', $plainwhere, $plainparams);

    respond_json([
        'items' => $items,
        'nextCursor' => $hasmore ? (string) ($offset + $limit) : null,
        'total' => (int) $total,
    ]);
}

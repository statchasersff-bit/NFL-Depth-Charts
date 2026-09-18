<?php
/**
 * Test harness: boots the plugin against the WordPress shims and simulates a
 * request, printing what a browser/Googlebot would receive.
 *
 * Usage: php harness.php <path> [--admin]
 *   e.g. php harness.php /nfl/nfl-depth-charts/fantasy/houston-texans/
 */

require __DIR__ . '/wp-stubs.php';

$path  = isset( $argv[1] ) ? $argv[1] : '/nfl/nfl-depth-charts/fantasy/';
$parts = explode( '?', $path, 2 );
$only  = isset( $argv[2] ) ? $argv[2] : '';

$_SERVER['REQUEST_URI']    = $path;
$_SERVER['REQUEST_METHOD'] = 'GET';
if ( isset( $parts[1] ) ) { parse_str( $parts[1], $_GET ); }

// --- Simulate the rewrite rules: /nfl/nfl-depth-charts/{view}/{team}/{pos} ---
$request = trim( (string) parse_url( $parts[0], PHP_URL_PATH ), '/' );
$base    = 'nfl/nfl-depth-charts';
if ( $request === $base || 0 === strpos( $request, $base . '/' ) ) {
	$GLOBALS['wp_is_page']    = true;
	$GLOBALS['wp_queried_id'] = 42;
	$rest = trim( substr( $request, strlen( $base ) ), '/' );
	$segs = '' === $rest ? array() : explode( '/', $rest );
	if ( isset( $segs[0] ) ) { $GLOBALS['wp_query_vars']['sc_view'] = $segs[0]; }
	if ( isset( $segs[1] ) ) { $GLOBALS['wp_query_vars']['sc_team'] = $segs[1]; }
	if ( isset( $segs[2] ) ) { $GLOBALS['wp_query_vars']['sc_position'] = $segs[2]; }
}

require __DIR__ . '/../statchasers-depth-charts/statchasers-depth-charts.php';
do_action( 'plugins_loaded' );

// --- The request lifecycle WordPress would run ---
do_action( 'parse_request' );          // sitemap interception happens here
do_action( 'wp' );                     // routing: 404s + normalization
do_action( 'template_redirect' );      // H1 buffering, fallback head registration

$route = SCDC_Route::get();
$team  = SCDC_Route::team();

echo "REQUEST  {$path}\n";
echo str_repeat( '=', 78 ) . "\n";

if ( ! empty( $GLOBALS['wp_redirect'] ) ) {
	echo "HTTP {$GLOBALS['wp_redirect'][1]} redirect -> {$GLOBALS['wp_redirect'][0]}\n";
	exit;
}

// WordPress's own canonical-redirect pass (redirect_canonical filter).
$canonical_redirect = apply_filters( 'redirect_canonical', false );
if ( $canonical_redirect ) {
	echo "HTTP 301 redirect (URL normalization) -> {$canonical_redirect}\n";
	exit;
}

$status = ! empty( $GLOBALS['wp_is_404'] ) ? 404 : 200;
echo "HTTP status              : {$status}" . ( 404 === $status ? "  (404 template, nocache headers)" : '' ) . "\n";
echo "Route type               : {$route['type']} ({$route['reason']})\n";
echo 'Detected team            : ' . ( $team ? $team['name'] . ' [' . $team['abbr'] . ']' : '—' ) . "\n";
echo 'X-SCDC-Route header      : ' . $route['type'] . ( $route['team_slug'] ? ':' . $route['team_slug'] : '' ) . "\n";
echo "Season                   : " . SCDC_Teams::season() . "\n";

if ( 404 === $status ) {
	echo "\nNo team SEO is generated for this URL — it is not one of the 32 slugs.\n";
	exit;
}

// --- What Rank Math would emit, run through the plugin's filters ---
$generic_title = 'NFL Depth Charts for Fantasy Football | All 32 Teams';
$generic_desc  = 'Free NFL depth charts for all 32 teams, updated for fantasy football.';
$generic_canon = 'https://statchasers.com/nfl/nfl-depth-charts/';

$title     = apply_filters( 'rank_math/frontend/title', $generic_title );
$desc      = apply_filters( 'rank_math/frontend/description', $generic_desc );
$canonical = apply_filters( 'rank_math/frontend/canonical', $generic_canon );
$robots    = apply_filters( 'rank_math/frontend/robots', array( 'index' => 'noindex', 'follow' => 'follow' ) );
$og_title  = apply_filters( 'rank_math/opengraph/facebook/og_title', $generic_title );
$og_desc   = apply_filters( 'rank_math/opengraph/facebook/og_description', $generic_desc );
$og_url    = apply_filters( 'rank_math/opengraph/facebook/og_url', $generic_canon );

echo "\n--- Initial HTTP response <head> (Rank Math filters applied) ---\n";
echo '<title>' . esc_html( $title ) . "</title>\n";
echo '<meta name="description" content="' . esc_attr( $desc ) . '" />' . "\n";
echo '<link rel="canonical" href="' . esc_url( $canonical ) . '" />' . "\n";
echo '<meta name="robots" content="' . esc_attr( implode( ', ', $robots ) ) . '" />' . "\n";
echo '<meta property="og:title" content="' . esc_attr( $og_title ) . '" />' . "\n";
echo '<meta property="og:description" content="' . esc_attr( $og_desc ) . '" />' . "\n";
echo '<meta property="og:url" content="' . esc_url( $og_url ) . '" />' . "\n";

// --- Breadcrumbs + schema ---
$crumbs = apply_filters(
	'rank_math/frontend/breadcrumb/items',
	array(
		array( 'Home', 'https://statchasers.com/' ),
		array( 'NFL', 'https://statchasers.com/nfl/' ),
		array( 'NFL Depth Charts', '' ),
	),
	null
);
echo "\n--- Breadcrumb trail (visible + BreadcrumbList schema) ---\n";
foreach ( $crumbs as $i => $crumb ) {
	echo ( $i ? ' > ' : '' ) . $crumb[0];
}
echo "\n";

$graph = apply_filters(
	'rank_math/json_ld',
	array(
		'WebPage' => array(
			'@type'       => 'WebPage',
			'@id'         => $canonical . '#webpage',
			'url'         => $generic_canon,
			'name'        => $generic_title,
			'description' => $generic_desc,
		),
	),
	null
);
echo "\n--- Rank Math WebPage entity ---\n";
echo 'name: ' . $graph['WebPage']['name'] . "\n";
echo 'url : ' . $graph['WebPage']['url'] . "\n";

// --- Rendered body (theme title + shortcode), through the H1 buffer ---
$body  = "<body>\n<header><a class=\"logo\">StatChasers</a></header>\n";
$body .= '<h1 class="entry-title">' . get_the_title( 42 ) . "</h1>\n";
$body .= call_user_func( $GLOBALS['shortcodes']['statchasers_depth_charts'], array() );
$body .= "\n</body>";

$body = SCDC_SEO::rewrite_h1( $body );

preg_match_all( '#<h1\b[^>]*>(.*?)</h1>#is', $body, $h1s );
echo "\n--- H1 elements in the initial HTML (" . count( $h1s[0] ) . ") ---\n";
foreach ( $h1s[0] as $h1 ) { echo $h1 . "\n"; }

if ( 'body' === $only ) {
	echo "\n--- Server-rendered tool markup ---\n" . $body . "\n";
	exit;
}

echo "\n--- Server-rendered content above the tool ---\n";
if ( preg_match( '#<nav class="scdc-breadcrumbs".*?</nav>#is', $body, $m ) ) { echo trim( preg_replace( '/\s+/', ' ', strip_tags( $m[0], '' ) ) ) . "\n"; }
if ( preg_match( '#<p class="scdc-team-intro"[^>]*>(.*?)</p>#is', $body, $m ) ) { echo 'intro   : ' . $m[1] . "\n"; }
if ( preg_match( '#<p class="scdc-team-summary-lead">(.*?)</p>#is', $body, $m ) ) { echo 'summary : ' . $m[1] . "\n"; }
preg_match_all( '#<span class="scdc-team-summary-pos">(.*?)</span>\s*<span class="scdc-team-summary-players">(.*?)</span>#is', $body, $rows, PREG_SET_ORDER );
foreach ( $rows as $row ) { echo '          ' . str_pad( $row[1], 15 ) . $row[2] . "\n"; }

preg_match_all( '#<a\s[^>]*data-scdc-team-link[^>]*>#i', $body, $links );
echo "\nCrawlable team anchors   : " . count( $links[0] ) . "\n";
if ( ! empty( $links[0] ) ) {
	preg_match( '#<a[^>]*href="([^"]+)"[^>]*data-scdc-team-slug="houston-texans"[^>]*>(?:</a>)?#i', $body, $hou );
	preg_match( '#<li><a[^>]*href="([^"]*houston-texans[^"]*)"[^>]*>([^<]*)#i', $body, $hou2 );
	if ( ! empty( $hou2 ) ) { echo 'e.g.                     : <a href="' . $hou2[1] . '">' . trim( $hou2[2] ) . "</a>\n"; }
}

// --- Tool initialization ---
if ( preg_match( '#data-team="([^"]*)"#', $body, $m ) ) { echo 'Tool initial team slug   : ' . $m[1] . "\n"; }
if ( preg_match( '#data-team-abbr="([^"]*)"#', $body, $m ) ) { echo 'Tool initial team abbr   : ' . $m[1] . "\n"; }
if ( preg_match( '#data-view="([^"]*)"#', $body, $m ) ) { echo 'Tool initial view        : ' . $m[1] . "\n"; }

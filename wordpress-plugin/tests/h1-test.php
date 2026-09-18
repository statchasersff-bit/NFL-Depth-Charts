<?php
/** H1 resolution across the three realistic Divi/theme layouts. */
require __DIR__ . '/wp-stubs.php';
$_SERVER['REQUEST_URI'] = '/nfl/nfl-depth-charts/fantasy/houston-texans/';
$_SERVER['REQUEST_METHOD'] = 'GET';
$GLOBALS['wp_is_page'] = true;
$GLOBALS['wp_queried_id'] = 42;
$GLOBALS['wp_query_vars'] = array( 'sc_view' => 'fantasy', 'sc_team' => 'houston-texans' );
require __DIR__ . '/../statchasers-depth-charts/statchasers-depth-charts.php';
do_action( 'plugins_loaded' );
do_action( 'wp' );

$tool = call_user_func( $GLOBALS['shortcodes']['statchasers_depth_charts'], array() );

$cases = array(
	'Divi/theme title module (title comes from the page)' => '<h1 class="entry-title">' . get_the_title( 42 ) . '</h1>' . $tool,
	'Divi text module with a hard-coded heading'          => '<h1 class="et_pb_module">NFL Depth Charts</h1>' . $tool,
	'Layout with no H1 at all'                            => '<div class="et_pb_section">' . $tool . '</div>',
	'Unrelated H1 elsewhere on the page'                  => '<h1 class="site-title">StatChasers</h1>' . $tool,
);

foreach ( $cases as $label => $html ) {
	$out = SCDC_SEO::rewrite_h1( $html );
	preg_match_all( '#<h1\b[^>]*>(.*?)</h1>#is', $out, $m );
	echo str_pad( $label, 52 ) . ' -> ' . count( $m[0] ) . ' H1: ';
	echo implode( ' | ', array_map( 'strip_tags', $m[0] ) ) . "\n";
}

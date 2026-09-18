<?php
/**
 * Minimal WordPress shims so the plugin's routing/SEO classes can be executed
 * and inspected outside a WordPress install. Test scaffolding only.
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'DAY_IN_SECONDS', 86400 );
define( 'HOUR_IN_SECONDS', 3600 );

$GLOBALS['wp_filters']    = array();
$GLOBALS['wp_actions_ran'] = array( 'parse_query' => 1 );
$GLOBALS['wp_query_vars'] = array();
$GLOBALS['wp_options']    = array(
	'scdc_nfl_page_id'          => 7,
	'scdc_depth_charts_page_id' => 42,
	'date_format'               => 'F j, Y',
	'time_format'               => 'g:i a',
	'scdc_refresh_meta'         => array(
		'status'            => 'success',
		'error'             => '',
		'last_refreshed'    => '2026-08-18T13:05:00+00:00',
		'last_refreshed_ts' => 1786971900,
		'teams_ok'          => 32,
		'teams_failed'      => array(),
	),
);
$GLOBALS['wp_transients'] = array();
$GLOBALS['wp_headers']    = array();
$GLOBALS['wp_status']     = 200;

function add_action( $hook, $cb, $priority = 10, $args = 1 ) { add_filter( $hook, $cb, $priority, $args ); }
function add_filter( $hook, $cb, $priority = 10, $args = 1 ) {
	$GLOBALS['wp_filters'][ $hook ][ $priority ][] = $cb;
	return true;
}
function remove_action( $hook, $cb, $priority = 10 ) { return true; }
function apply_filters( $hook ) {
	$args  = func_get_args();
	$value = isset( $args[1] ) ? $args[1] : null;
	$rest  = array_slice( $args, 2 );
	if ( empty( $GLOBALS['wp_filters'][ $hook ] ) ) { return $value; }
	$by_priority = $GLOBALS['wp_filters'][ $hook ];
	ksort( $by_priority );
	$GLOBALS['current_filter'] = $hook;
	foreach ( $by_priority as $callbacks ) {
		foreach ( $callbacks as $cb ) {
			$value = call_user_func_array( $cb, array_merge( array( $value ), $rest ) );
		}
	}
	return $value;
}
function do_action( $hook ) {
	$args = array_slice( func_get_args(), 1 );
	$GLOBALS['wp_actions_ran'][ $hook ] = 1;
	if ( empty( $GLOBALS['wp_filters'][ $hook ] ) ) { return; }
	$by_priority = $GLOBALS['wp_filters'][ $hook ];
	ksort( $by_priority );
	foreach ( $by_priority as $callbacks ) {
		foreach ( $callbacks as $cb ) { call_user_func_array( $cb, $args ); }
	}
}
function current_filter() { return isset( $GLOBALS['current_filter'] ) ? $GLOBALS['current_filter'] : ''; }
function did_action( $hook ) { return isset( $GLOBALS['wp_actions_ran'][ $hook ] ) ? 1 : 0; }
function register_activation_hook( $f, $cb ) {}
function register_deactivation_hook( $f, $cb ) {}
function add_shortcode( $tag, $cb ) { $GLOBALS['shortcodes'][ $tag ] = $cb; }
function plugin_dir_path( $file ) { return dirname( $file ) . '/'; }
function plugin_dir_url( $file ) { return 'https://statchasers.com/wp-content/plugins/statchasers-depth-charts/'; }

function __( $text, $domain = '' ) { return $text; }
function esc_html__( $text, $domain = '' ) { return esc_html( $text ); }
function esc_attr_e( $text, $domain = '' ) { echo esc_attr( $text ); }
function esc_html_e( $text, $domain = '' ) { echo esc_html( $text ); }
function esc_html( $text ) { return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' ); }
function esc_attr( $text ) { return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' ); }
function esc_url( $url ) { return htmlspecialchars( (string) $url, ENT_QUOTES, 'UTF-8' ); }
function wp_strip_all_tags( $text ) { return strip_tags( (string) $text ); }
function sanitize_title( $title ) {
	$title = strtolower( trim( (string) $title ) );
	$title = preg_replace( '/[^a-z0-9\-_]+/', '-', $title );
	return trim( (string) $title, '-' );
}
function trailingslashit( $string ) { return rtrim( (string) $string, '/\\' ) . '/'; }
function untrailingslashit( $string ) { return rtrim( (string) $string, '/\\' ); }
function home_url( $path = '/' ) { return 'https://statchasers.com' . ( '/' === substr( $path, 0, 1 ) ? $path : '/' . $path ); }
function wp_parse_url( $url, $component = -1 ) { return parse_url( $url, $component ); }
function wp_parse_str( $string, &$array ) { parse_str( $string, $array ); }
function add_query_arg( ...$a ) {
	if ( 3 === count( $a ) ) { $args = array( $a[0] => $a[1] ); $url = $a[2]; }
	else { $args = (array) $a[0]; $url = isset( $a[1] ) ? $a[1] : ''; }
	$sep = false === strpos( $url, '?' ) ? '?' : '&';
	return $url . $sep . http_build_query( $args );
}
function wp_json_encode( $data ) { return json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ); }
function wp_unslash( $value ) { return $value; }
function wp_rand( $min = 0, $max = 0 ) { return 1234; }
function wp_date( $format, $ts = null ) { return gmdate( $format, $ts ); }
function get_option( $key, $default = false ) { return array_key_exists( $key, $GLOBALS['wp_options'] ) ? $GLOBALS['wp_options'][ $key ] : $default; }
function update_option( $key, $value, $autoload = null ) { $GLOBALS['wp_options'][ $key ] = $value; return true; }
function get_transient( $key ) { return isset( $GLOBALS['wp_transients'][ $key ] ) ? $GLOBALS['wp_transients'][ $key ] : false; }
function set_transient( $key, $value, $ttl = 0 ) { $GLOBALS['wp_transients'][ $key ] = $value; return true; }
function wp_parse_args( $args, $defaults ) { return array_merge( $defaults, (array) $args ); }
function wp_upload_dir() {
	return array(
		'basedir' => __DIR__ . '/fixtures',
		'baseurl' => 'https://statchasers.com/wp-content/uploads',
	);
}
function wp_mkdir_p( $dir ) { return is_dir( $dir ) || mkdir( $dir, 0777, true ); }

function get_query_var( $var, $default = '' ) { return isset( $GLOBALS['wp_query_vars'][ $var ] ) ? $GLOBALS['wp_query_vars'][ $var ] : $default; }
function is_admin() { return false; }
function is_feed() { return false; }
function is_robots() { return false; }
function is_preview() { return false; }
function is_customize_preview() { return false; }
function is_user_logged_in() { return ! empty( $GLOBALS['wp_is_admin_user'] ); }
function current_user_can( $cap ) { return ! empty( $GLOBALS['wp_is_admin_user'] ); }
function is_page( $page = null ) { return ! empty( $GLOBALS['wp_is_page'] ); }
function get_queried_object_id() { return isset( $GLOBALS['wp_queried_id'] ) ? $GLOBALS['wp_queried_id'] : 0; }
function get_page_uri( $id ) { return 42 === (int) $id ? 'nfl/nfl-depth-charts' : ''; }
function get_permalink( $id = 0 ) {
	if ( 7 === (int) $id ) { return 'https://statchasers.com/nfl/'; }
	if ( 42 === (int) $id ) { return 'https://statchasers.com/nfl/nfl-depth-charts/'; }
	return 'https://statchasers.com/nfl/nfl-depth-charts/';
}
function get_post_field( $field, $id ) { return 42 === (int) $id ? 'NFL Depth Charts' : ''; }
function get_the_title( $id = 0 ) { return 7 === (int) $id ? 'NFL' : apply_filters( 'the_title', 'NFL Depth Charts', $id ); }
function status_header( $code ) { $GLOBALS['wp_status'] = $code; }
function nocache_headers() {}
function wp_safe_redirect( $url, $status = 302 ) { $GLOBALS['wp_redirect'] = array( $url, $status ); echo "HTTP $status redirect -> $url\n"; return true; }
function wp_enqueue_style( $h ) {}
function wp_enqueue_script( $h ) {}
function wp_register_style( $h, $s = '', $d = array(), $v = '' ) {}
function wp_register_script( $h, $s = '', $d = array(), $v = '', $f = false ) {}
function wp_doing_ajax() { return false; }
function is_wp_error( $t ) { return false; }

class WP_Query { public function set_404() { $GLOBALS['wp_is_404'] = true; } }
$GLOBALS['wp_query'] = new WP_Query();
class WP_Post {}

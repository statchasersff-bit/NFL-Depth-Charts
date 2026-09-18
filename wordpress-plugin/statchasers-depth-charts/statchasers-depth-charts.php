<?php
/**
 * Plugin Name:       StatChasers Depth Charts
 * Plugin URI:        https://statchasers.com/
 * Description:        Private admin tool that pulls NFL depth charts, caches them locally as JSON, and renders them on the front end via the [statchasers_depth_charts] shortcode. Serves 32 server-recognized, SEO-optimized team routes from the same tool. No external host required.
 * Version:           1.6.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            StatChasers
 * Text Domain:       statchasers-depth-charts
 * License:           GPL-2.0-or-later
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

define( 'SCDC_VERSION', '1.6.0' );
define( 'SCDC_PLUGIN_FILE', __FILE__ );
define( 'SCDC_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'SCDC_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

/**
 * The NFL season these pages describe. NFL season naming doesn't roll over on
 * January 1, so this is a deliberate single setting rather than date( 'Y' ):
 * change it here (or define SCDC_SEASON in wp-config.php, or use the
 * `scdc_season` filter) and every title, description, H1 and intro follows.
 */
if ( ! defined( 'SCDC_SEASON' ) ) {
	define( 'SCDC_SEASON', 2026 );
}

// Option key that stores refresh metadata (last refreshed time, status, error).
define( 'SCDC_META_OPTION', 'scdc_refresh_meta' );

// admin-post action name for the manual refresh form submission.
define( 'SCDC_REFRESH_ACTION', 'scdc_refresh_depth_charts' );

require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-store.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-teams.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-espn.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-footballguys.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-fantasypros.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-refresh.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-rewrite.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-pages.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-route.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-seo.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-team-content.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-sitemap.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-admin.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-shortcode.php';
require_once SCDC_PLUGIN_DIR . 'includes/class-scdc-hub.php';

/**
 * Boot the plugin once all classes are loaded.
 */
function scdc_bootstrap() {
	SCDC_Rewrite::instance()->hooks();
	SCDC_Route::instance()->hooks();
	SCDC_SEO::instance()->hooks();
	SCDC_Sitemap::instance()->hooks();
	SCDC_Admin::instance()->hooks();
	SCDC_Shortcode::instance()->hooks();
	SCDC_Hub::instance()->hooks();
}
add_action( 'plugins_loaded', 'scdc_bootstrap' );

/**
 * Activation: provision the /nfl/ + /nfl/nfl-depth-charts/ pages, then register the
 * rewrite rules and flush so the nested filter URLs resolve immediately.
 *
 * @return void
 */
function scdc_activate() {
	SCDC_Pages::ensure_pages();
	SCDC_Rewrite::activate();
}
register_activation_hook( __FILE__, 'scdc_activate' );
register_deactivation_hook( __FILE__, array( 'SCDC_Rewrite', 'deactivate' ) );

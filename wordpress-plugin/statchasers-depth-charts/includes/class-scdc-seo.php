<?php
/**
 * SEO for the 32 virtual team routes.
 *
 * The route itself is detected server-side by SCDC_Route; this class turns that
 * detection into the metadata WordPress/Rank Math emit for the request, before
 * a single byte of HTML is sent:
 *
 *   title       rank_math/frontend/title        "Houston Texans Depth Chart 2026 | Fantasy Football"
 *   description rank_math/frontend/description  "View the latest Houston Texans depth chart for 2026…"
 *   canonical   rank_math/frontend/canonical    self-referencing team URL
 *   robots      rank_math/frontend/robots       only ever *removes* an inherited noindex
 *   breadcrumbs rank_math/frontend/breadcrumb/items
 *   schema      rank_math/json_ld               WebPage name/url follow the team route
 *   social      rank_math/opengraph/…           og:title / og:description / og:url
 *
 * Every filter returns untouched values unless SCDC_Route says the request is
 * one of the 32 team routes, so nothing else on the site is affected. When Rank
 * Math is not active, an equivalent minimal head block is emitted instead (and
 * core's rel_canonical is removed) so the routes never emit two canonicals.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_SEO {

	/** @var SCDC_SEO|null */
	private static $instance = null;

	/** @var bool Whether a theme-rendered H1 was retitled for this request. */
	private static $h1_retitled = false;

	/**
	 * @return SCDC_SEO
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Register hooks. All of them no-op off the depth-chart team routes.
	 *
	 * @return void
	 */
	public function hooks() {
		// --- Rank Math ---
		add_filter( 'rank_math/frontend/title', array( __CLASS__, 'filter_title' ), 20 );
		add_filter( 'rank_math/frontend/description', array( __CLASS__, 'filter_description' ), 20 );
		add_filter( 'rank_math/frontend/canonical', array( __CLASS__, 'filter_canonical' ), 20 );
		add_filter( 'rank_math/frontend/robots', array( __CLASS__, 'filter_robots' ), 20 );
		add_filter( 'rank_math/frontend/breadcrumb/items', array( __CLASS__, 'filter_breadcrumbs' ), 20, 2 );
		add_filter( 'rank_math/json_ld', array( __CLASS__, 'filter_json_ld' ), 99, 2 );

		// Rank Math's OpenGraph tags. Both the colon and underscore spellings of the
		// property are registered because the exact hook name has varied between
		// Rank Math versions; filtering a value that is never emitted is a no-op,
		// and no tags are added, so duplicates are impossible.
		$og = array(
			'facebook' => array( 'og:title', 'og_title', 'og:description', 'og_description', 'og:url', 'og_url' ),
			'twitter'  => array( 'twitter:title', 'twitter_title', 'twitter:description', 'twitter_description' ),
		);
		foreach ( $og as $network => $properties ) {
			foreach ( $properties as $property ) {
				add_filter( "rank_math/opengraph/{$network}/{$property}", array( __CLASS__, 'filter_social' ), 20 );
			}
		}

		// --- Fallback when Rank Math is inactive ---
		add_action( 'template_redirect', array( __CLASS__, 'maybe_register_fallback_head' ), 5 );

		// --- H1 ---
		add_filter( 'the_title', array( __CLASS__, 'filter_the_title' ), 20, 2 );
		add_filter( 'single_post_title', array( __CLASS__, 'filter_single_post_title' ), 20, 2 );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_buffer_h1' ), 0 );

		// --- Cache/debug visibility ---
		add_action( 'template_redirect', array( __CLASS__, 'send_route_header' ), 1 );
		add_action( 'wp_footer', array( __CLASS__, 'debug_panel' ), 999 );
	}

	// ------------------------------------------------------------------- copy

	/**
	 * SEO title for a team route.
	 *
	 * @param array $team Team row from SCDC_Teams.
	 * @return string
	 */
	public static function title( $team ) {
		$title = sprintf(
			/* translators: 1: team name, 2: season year. */
			__( '%1$s Depth Chart %2$d | Fantasy Football', 'statchasers-depth-charts' ),
			$team['name'],
			SCDC_Teams::season()
		);
		return (string) apply_filters( 'scdc_seo_team_title', $title, $team, SCDC_Teams::season() );
	}

	/**
	 * Meta description for a team route.
	 *
	 * @param array $team Team row.
	 * @return string
	 */
	public static function description( $team ) {
		$description = sprintf(
			/* translators: 1: team name, 2: season year. */
			__( 'View the latest %1$s depth chart for %2$d fantasy football. See starters, backups, handcuffs, position battles, and offensive depth by position.', 'statchasers-depth-charts' ),
			$team['name'],
			SCDC_Teams::season()
		);
		return (string) apply_filters( 'scdc_seo_team_description', $description, $team, SCDC_Teams::season() );
	}

	/**
	 * On-page H1 for a team route.
	 *
	 * @param array $team Team row.
	 * @return string
	 */
	public static function heading( $team ) {
		$heading = sprintf(
			/* translators: %s: team name. */
			__( '%s Depth Chart', 'statchasers-depth-charts' ),
			$team['name']
		);
		return (string) apply_filters( 'scdc_seo_team_heading', $heading, $team );
	}

	/**
	 * Short introduction rendered above the tool on a team route.
	 *
	 * @param array $team Team row.
	 * @return string
	 */
	public static function intro( $team ) {
		$intro = sprintf(
			/* translators: 1: team name, 2: season year. */
			__( 'View the %1$s depth chart for the %2$d fantasy football season. Track starters, backups, handcuffs, and positional depth as roster roles change throughout the year.', 'statchasers-depth-charts' ),
			$team['name'],
			SCDC_Teams::season()
		);
		return (string) apply_filters( 'scdc_seo_team_intro', $intro, $team, SCDC_Teams::season() );
	}

	/**
	 * The tool page's own title, unaffected by our the_title() filter. Used for
	 * breadcrumbs and for recognizing the theme's generic H1.
	 *
	 * @return string
	 */
	public static function original_page_title() {
		$page_id = SCDC_Pages::depth_charts_page_id();
		if ( ! $page_id ) {
			$page_id = get_queried_object_id();
		}
		$title = $page_id ? get_post_field( 'post_title', $page_id ) : '';
		return is_string( $title ) ? $title : '';
	}

	// ------------------------------------------------------------ rank math

	/**
	 * @param string $title Incoming title.
	 * @return string
	 */
	public static function filter_title( $title ) {
		$team = SCDC_Route::team();
		return $team ? self::title( $team ) : $title;
	}

	/**
	 * @param string $description Incoming description.
	 * @return string
	 */
	public static function filter_description( $description ) {
		$team = SCDC_Route::team();
		return $team ? self::description( $team ) : $description;
	}

	/**
	 * Self-referencing canonical for team routes; filtered views/positions of the
	 * tool consolidate onto their team (or the main) landing URL.
	 *
	 * @param string $canonical Incoming canonical.
	 * @return string
	 */
	public static function filter_canonical( $canonical ) {
		return self::canonical_for_request( $canonical );
	}

	/**
	 * The canonical URL for this request, or the passed-through value when the
	 * request isn't one of the tool's virtual routes. The bare tool page keeps
	 * whatever canonical it already has — only the nested routes are rewritten.
	 *
	 * @param string $fallback Value to return when nothing should change.
	 * @return string
	 */
	private static function canonical_for_request( $fallback ) {
		if ( ! SCDC_Route::is_tool() ) {
			return $fallback;
		}
		if ( SCDC_Route::is_main() && '' === (string) get_query_var( 'sc_view' ) ) {
			return $fallback;
		}
		return SCDC_Route::canonical_url();
	}

	/**
	 * Never adds directives — only clears an inherited `noindex` on the team
	 * routes so they can be indexed.
	 *
	 * @param array $robots Robots directives.
	 * @return array
	 */
	public static function filter_robots( $robots ) {
		if ( ! SCDC_Route::is_team() || ! is_array( $robots ) ) {
			return $robots;
		}
		if ( isset( $robots['index'] ) && 'noindex' === $robots['index'] ) {
			$robots['index'] = 'index';
		}
		return $robots;
	}

	/**
	 * Home › NFL › NFL Depth Charts › Houston Texans Depth Chart.
	 *
	 * Rank Math builds its visible breadcrumbs and its BreadcrumbList schema from
	 * this same list, so the two always agree and nothing extra is emitted.
	 *
	 * @param array $crumbs Breadcrumb items ([ label, link, … ]).
	 * @param mixed $class  Rank Math breadcrumb instance (unused).
	 * @return array
	 */
	public static function filter_breadcrumbs( $crumbs, $class = null ) {
		$team = SCDC_Route::team();
		if ( ! $team || ! is_array( $crumbs ) || empty( $crumbs ) ) {
			return $crumbs;
		}

		// The trail currently ends on the tool page. Restore its real title (our
		// the_title() filter renamed it) and link it, then add the team leaf.
		$last  = count( $crumbs ) - 1;
		$title = self::original_page_title();
		if ( '' !== $title ) {
			$crumbs[ $last ][0] = $title;
		}
		$crumbs[ $last ][1] = SCDC_Route::main_url();

		$crumbs[] = array( self::heading( $team ), SCDC_Route::team_url( $team['slug'] ) );

		return $crumbs;
	}

	/**
	 * Point Rank Math's existing WebPage entity at the team route instead of the
	 * parent page. No new entities are added.
	 *
	 * @param array $data   JSON-LD graph, keyed by entity.
	 * @param mixed $jsonld Rank Math JsonLD instance (unused).
	 * @return array
	 */
	public static function filter_json_ld( $data, $jsonld = null ) {
		$team = SCDC_Route::team();
		if ( ! $team || ! is_array( $data ) ) {
			return $data;
		}

		$canonical  = SCDC_Route::canonical_url();
		$page_types = array( 'WebPage', 'ItemPage', 'CollectionPage', 'AboutPage', 'FAQPage' );

		foreach ( $data as $key => $entity ) {
			if ( ! is_array( $entity ) || empty( $entity['@type'] ) ) {
				continue;
			}
			$types = (array) $entity['@type'];
			if ( ! array_intersect( $types, $page_types ) ) {
				continue;
			}
			$entity['name'] = self::title( $team );
			$entity['url']  = $canonical;
			if ( isset( $entity['description'] ) ) {
				$entity['description'] = self::description( $team );
			}
			$data[ $key ] = $entity;
		}

		return $data;
	}

	/**
	 * og:title / og:description / og:url (and the Twitter equivalents) follow the
	 * team route. Rank Math's social image is left untouched.
	 *
	 * @param string $value Incoming value.
	 * @return string
	 */
	public static function filter_social( $value ) {
		$filter = (string) current_filter();

		// og:url tracks the canonical on every tool route, so the social URL and
		// the canonical never point at different pages.
		if ( false !== strpos( $filter, 'url' ) ) {
			return self::canonical_for_request( $value );
		}

		$team = SCDC_Route::team();
		if ( ! $team ) {
			return $value;
		}
		if ( false !== strpos( $filter, 'description' ) ) {
			return self::description( $team );
		}
		return self::title( $team );
	}

	// ------------------------------------------------------------- fallback

	/**
	 * Whether Rank Math is handling metadata for this request.
	 *
	 * @return bool
	 */
	public static function rank_math_active() {
		return defined( 'RANK_MATH_VERSION' ) || class_exists( 'RankMath' );
	}

	/**
	 * With Rank Math inactive, emit the team title/description/canonical (and the
	 * matching OG tags) ourselves, replacing core's page canonical so exactly one
	 * canonical is present.
	 *
	 * @return void
	 */
	public static function maybe_register_fallback_head() {
		if ( ! SCDC_Route::is_team() || self::rank_math_active() ) {
			return;
		}
		remove_action( 'wp_head', 'rel_canonical' );
		add_filter( 'pre_get_document_title', array( __CLASS__, 'fallback_document_title' ), 20 );
		add_action( 'wp_head', array( __CLASS__, 'fallback_head' ), 1 );
	}

	/**
	 * @param string $title Incoming document title.
	 * @return string
	 */
	public static function fallback_document_title( $title ) {
		$team = SCDC_Route::team();
		return $team ? self::title( $team ) : $title;
	}

	/**
	 * @return void
	 */
	public static function fallback_head() {
		$team = SCDC_Route::team();
		if ( ! $team ) {
			return;
		}
		$canonical   = SCDC_Route::canonical_url();
		$description = self::description( $team );
		$title       = self::title( $team );

		echo "\n<!-- StatChasers Depth Charts SEO -->\n";
		printf( '<meta name="description" content="%s" />' . "\n", esc_attr( $description ) );
		printf( '<link rel="canonical" href="%s" />' . "\n", esc_url( $canonical ) );
		printf( '<meta property="og:title" content="%s" />' . "\n", esc_attr( $title ) );
		printf( '<meta property="og:description" content="%s" />' . "\n", esc_attr( $description ) );
		printf( '<meta property="og:url" content="%s" />' . "\n", esc_url( $canonical ) );
		printf( '<meta property="og:type" content="article" />' . "\n" );
		printf( '<meta name="twitter:title" content="%s" />' . "\n", esc_attr( $title ) );
		printf( '<meta name="twitter:description" content="%s" />' . "\n", esc_attr( $description ) );
	}

	// ------------------------------------------------------------------- H1

	/**
	 * How the team H1 is produced:
	 *   auto      — rename the theme/Divi page title, and let the tool render a
	 *               fallback H1 that is dropped again if a theme H1 was renamed.
	 *   theme     — only rename the theme/Divi page title.
	 *   shortcode — only render the H1 inside the tool.
	 *
	 * @return string
	 */
	public static function heading_mode() {
		$mode = apply_filters( 'scdc_seo_heading_mode', 'auto' );
		return in_array( $mode, array( 'auto', 'theme', 'shortcode' ), true ) ? $mode : 'auto';
	}

	/**
	 * Whether the tool should render its own H1 (see heading_mode()).
	 *
	 * @return bool
	 */
	public static function tool_should_render_h1() {
		return SCDC_Route::is_team() && in_array( self::heading_mode(), array( 'auto', 'shortcode' ), true );
	}

	/**
	 * Rename the tool page's title on team routes, so any theme/Divi title module
	 * renders "Houston Texans Depth Chart" in the initial HTML.
	 *
	 * @param string $title   Post title.
	 * @param int    $post_id Post ID.
	 * @return string
	 */
	public static function filter_the_title( $title, $post_id = 0 ) {
		if ( ! in_array( self::heading_mode(), array( 'auto', 'theme' ), true ) ) {
			return $title;
		}
		$team = SCDC_Route::team();
		if ( ! $team || is_admin() ) {
			return $title;
		}

		$page_id = SCDC_Pages::depth_charts_page_id();
		if ( ! $page_id ) {
			$page_id = get_queried_object_id();
		}
		if ( ! $post_id || ! $page_id || (int) $post_id !== (int) $page_id ) {
			return $title;
		}

		return self::heading( $team );
	}

	/**
	 * @param string  $title Post title.
	 * @param WP_Post $post  Post object.
	 * @return string
	 */
	public static function filter_single_post_title( $title, $post = null ) {
		$post_id = ( $post instanceof WP_Post ) ? $post->ID : 0;
		return self::filter_the_title( $title, $post_id );
	}

	/**
	 * On team routes only, buffer the response so the page ends up with exactly
	 * one H1 carrying the team name.
	 *
	 * @return void
	 */
	public static function maybe_buffer_h1() {
		if ( ! SCDC_Route::is_team() || 'auto' !== self::heading_mode() ) {
			return;
		}
		if ( ! apply_filters( 'scdc_seo_h1_rewrite', true ) ) {
			return;
		}
		ob_start( array( __CLASS__, 'rewrite_h1' ) );
	}

	/**
	 * Buffer callback: retitle the first generic H1 (the page title, or any H1
	 * mentioning "depth chart") to the team heading and drop the tool's own
	 * fallback H1. If the page has no such H1, the tool's H1 is left in place.
	 *
	 * @param string $html Buffered page HTML.
	 * @return string
	 */
	public static function rewrite_h1( $html ) {
		if ( ! is_string( $html ) || '' === $html || false === stripos( $html, '<h1' ) ) {
			return $html;
		}
		$team = SCDC_Route::team();
		if ( ! $team ) {
			return $html;
		}

		$heading    = self::heading( $team );
		$page_title = self::original_page_title();
		$retitled   = false;

		$result = preg_replace_callback(
			'#<h1\b([^>]*)>(.*?)</h1>#is',
			static function ( $matches ) use ( &$retitled, $heading, $page_title ) {
				$attributes = $matches[1];
				// Skip the tool's own H1 — it is removed below when a theme H1 wins.
				if ( false !== stripos( $attributes, 'data-scdc-h1' ) ) {
					return $matches[0];
				}
				if ( $retitled ) {
					return $matches[0];
				}
				$text = trim( html_entity_decode( wp_strip_all_tags( $matches[2] ), ENT_QUOTES, 'UTF-8' ) );
				$is_page_title = ( '' !== $page_title && 0 === strcasecmp( $text, $page_title ) );
				$is_depth_chart = ( false !== stripos( $text, 'depth chart' ) );
				if ( ! $is_page_title && ! $is_depth_chart ) {
					return $matches[0]; // Unrelated H1 (site title, etc.) — leave alone.
				}
				$retitled = true;
				return '<h1' . $attributes . ' data-scdc-h1="theme">' . esc_html( $heading ) . '</h1>';
			},
			$html
		);

		if ( null === $result ) {
			return $html; // Regex bailed (e.g. PCRE backtrack limit) — ship the page as-is.
		}

		if ( $retitled ) {
			$stripped = preg_replace( '#<h1\b[^>]*data-scdc-h1="tool"[^>]*>.*?</h1>#is', '', $result, 1 );
			if ( null !== $stripped ) {
				$result = $stripped;
			}
			self::$h1_retitled = true;
		}

		return $result;
	}

	// ------------------------------------------------------- cache + debug

	/**
	 * Response header naming the detected route. Handy when verifying that a page
	 * cache/CDN keys on the full path (Houston's URL must never return Dallas).
	 *
	 * @return void
	 */
	public static function send_route_header() {
		if ( headers_sent() || ! SCDC_Route::is_tool() ) {
			return;
		}
		if ( ! apply_filters( 'scdc_send_route_header', true ) ) {
			return;
		}
		$route = SCDC_Route::get();
		$value = $route['type'] . ( $route['team_slug'] ? ':' . $route['team_slug'] : '' );
		header( 'X-SCDC-Route: ' . $value );
	}

	/**
	 * Whether the admin-only diagnostics are switched on for this request.
	 *
	 * Enabled by `?scdc_debug=1` (or `define( 'SCDC_DEBUG', true )`) AND the
	 * manage_options capability — never visible to logged-out visitors.
	 *
	 * @return bool
	 */
	public static function debug_enabled() {
		if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
			return false;
		}
		$requested = ( defined( 'SCDC_DEBUG' ) && SCDC_DEBUG )
			|| ( isset( $_GET['scdc_debug'] ) && '' !== $_GET['scdc_debug'] ); // phpcs:ignore WordPress.Security.NonceVerification
		return (bool) $requested;
	}

	/**
	 * Diagnostics for the current route: detection, team, generated metadata,
	 * season and indexability. Admin-only, and printed nowhere else.
	 *
	 * @return void
	 */
	public static function debug_panel() {
		if ( ! self::debug_enabled() || ! SCDC_Route::is_tool() ) {
			return;
		}

		$route = SCDC_Route::get();
		$team  = $route['team'];

		$rows = array(
			'Detected route'   => $route['type'] . ' (' . $route['reason'] . ')',
			'Request path'     => isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '', // phpcs:ignore
			'Detected team'    => $team ? $team['name'] . ' (' . $team['abbr'] . ')' : '— none —',
			'Team slug'        => $route['team_slug'] ? $route['team_slug'] : '— none —',
			'View / position'  => $route['view'] . ' / ' . ( $route['position'] ? $route['position'] : 'all' ),
			'SEO title'        => $team ? self::title( $team ) : '(page default)',
			'Meta description' => $team ? self::description( $team ) : '(page default)',
			'Canonical'        => SCDC_Route::canonical_url(),
			'H1'               => $team ? self::heading( $team ) : '(page default)',
			'H1 source'        => self::$h1_retitled ? 'theme/Divi heading (retitled)' : 'tool-rendered',
			'Season'           => (string) SCDC_Teams::season(),
			'Indexable'        => SCDC_Route::is_team() ? 'yes (self-referencing canonical)' : 'inherits page settings',
			'SEO plugin'       => self::rank_math_active() ? 'Rank Math' : 'none (plugin fallback tags)',
		);

		echo '<div style="position:fixed;bottom:0;left:0;right:0;z-index:99999;max-height:45vh;overflow:auto;background:#0f172a;color:#e2e8f0;font:12px/1.5 ui-monospace,monospace;padding:12px 16px;">';
		echo '<strong style="color:#38bdf8">StatChasers depth-chart route debug</strong> <span style="opacity:.7">(admin-only — remove ?scdc_debug=1 to hide)</span>';
		echo '<table style="width:100%;border-collapse:collapse;margin-top:8px">';
		foreach ( $rows as $label => $value ) {
			echo '<tr><td style="padding:2px 12px 2px 0;color:#94a3b8;white-space:nowrap">' . esc_html( $label ) . '</td>';
			echo '<td style="padding:2px 0">' . esc_html( (string) $value ) . '</td></tr>';
		}
		echo '</table></div>';
	}
}

<?php
/**
 * Server-side route detection for the depth-chart tool.
 *
 * The rewrite rules in SCDC_Rewrite already turn
 *
 *   /nfl/nfl-depth-charts/{view}/{team}/{position?}/
 *
 * into the sc_view / sc_team / sc_position query vars. This class validates
 * those segments against SCDC_Teams (the only accepted values) and classifies
 * the request *before* anything renders, so SEO metadata, the H1, the intro copy
 * and the tool's initial state all read from one server-side decision.
 *
 * Route types:
 *   none    — not the depth-chart tool at all.
 *   main    — the general all-teams landing route (/, /fantasy/, /fantasy/all-teams/…).
 *   team    — one of the 32 recognized team routes (/fantasy/houston-texans/…).
 *   invalid — the tool's path with an unrecognized view/team/position segment → 404.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Route {

	const TYPE_NONE    = 'none';
	const TYPE_MAIN    = 'main';
	const TYPE_TEAM    = 'team';
	const TYPE_INVALID = 'invalid';

	const DEFAULT_VIEW = 'fantasy';

	/** @var SCDC_Route|null */
	private static $instance = null;

	/** @var array|null Memoized detection result. */
	private static $route = null;

	/**
	 * @return SCDC_Route
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Register routing hooks: invalid-slug 404s and URL normalization.
	 *
	 * @return void
	 */
	public function hooks() {
		// Runs right after the main query is set up, before any output.
		add_action( 'wp', array( __CLASS__, 'handle_request' ), 1 );
	}

	// ---------------------------------------------------------------- detection

	/**
	 * Detect and validate the current route. Memoized per request.
	 *
	 * @return array{type:string,view:string,team:array|null,team_slug:string,position:string,reason:string}
	 */
	public static function get() {
		if ( null !== self::$route ) {
			return self::$route;
		}

		$route = array(
			'type'      => self::TYPE_NONE,
			'view'      => self::DEFAULT_VIEW,
			'team'      => null,
			'team_slug' => '',
			'position'  => '',
			'reason'    => 'not-depth-charts',
		);

		// Before the main query exists there is nothing to detect — and nothing to
		// remember either, so this answer is deliberately not memoized.
		if ( ! did_action( 'wp' ) ) {
			return $route;
		}

		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || is_feed() || is_robots() ) {
			self::$route = $route;
			return self::$route;
		}

		if ( ! self::is_tool_page() ) {
			self::$route = $route;
			return self::$route;
		}

		$raw_view     = sanitize_title( (string) get_query_var( 'sc_view' ) );
		$raw_team     = sanitize_title( (string) get_query_var( 'sc_team' ) );
		$raw_position = sanitize_title( (string) get_query_var( 'sc_position' ) );

		// --- view ---
		$views = SCDC_Teams::views();
		if ( '' === $raw_view ) {
			$route['view'] = self::DEFAULT_VIEW; // bare /nfl/nfl-depth-charts/
		} elseif ( isset( $views[ $raw_view ] ) ) {
			$route['view'] = $raw_view;
		} else {
			$route['type']   = self::TYPE_INVALID;
			$route['reason'] = 'unknown-view';
			self::$route     = $route;
			return self::$route;
		}

		// --- team ---
		if ( '' === $raw_team || 'all-teams' === $raw_team ) {
			$route['type']   = self::TYPE_MAIN;
			$route['reason'] = 'general-route';
		} else {
			$team = SCDC_Teams::get( $raw_team );
			if ( null === $team ) {
				$route['type']   = self::TYPE_INVALID;
				$route['reason'] = 'unknown-team';
				self::$route     = $route;
				return self::$route;
			}
			$route['type']      = self::TYPE_TEAM;
			$route['team']      = $team;
			$route['team_slug'] = $team['slug'];
			$route['reason']    = 'team-route';
		}

		// --- position (optional) ---
		if ( '' !== $raw_position ) {
			if ( in_array( $raw_position, SCDC_Teams::positions( $route['view'] ), true ) ) {
				$route['position'] = $raw_position;
			} else {
				$route['type']   = self::TYPE_INVALID;
				$route['reason'] = 'unknown-position';
				self::$route     = $route;
				return self::$route;
			}
		}

		self::$route = $route;
		return self::$route;
	}

	/**
	 * Whether the current main query is the depth-chart tool page (bare or nested).
	 *
	 * @return bool
	 */
	private static function is_tool_page() {
		$page_id = SCDC_Pages::depth_charts_page_id();
		$queried = get_queried_object_id();

		if ( $page_id && (int) $queried === (int) $page_id ) {
			return true;
		}

		// Fallback for installs where the page ID option was never stored: compare
		// the queried page's path with the configured tool path.
		if ( is_page() && $queried ) {
			$uri = get_page_uri( $queried );
			if ( $uri && trim( (string) $uri, '/' ) === SCDC_Rewrite::page_path() ) {
				return true;
			}
		}

		return false;
	}

	/** @return string One of the TYPE_* constants. */
	public static function type() {
		$route = self::get();
		return $route['type'];
	}

	/** @return bool True on the 32 recognized team routes. */
	public static function is_team() {
		return self::TYPE_TEAM === self::type();
	}

	/** @return bool True on the general (all-teams) routes of the tool. */
	public static function is_main() {
		return self::TYPE_MAIN === self::type();
	}

	/** @return bool True anywhere in the tool (team or general). */
	public static function is_tool() {
		return in_array( self::type(), array( self::TYPE_MAIN, self::TYPE_TEAM ), true );
	}

	/** @return array|null The detected team row, or null. */
	public static function team() {
		$route = self::get();
		return $route['team'];
	}

	/** @return string Detected view slug. */
	public static function view() {
		$route = self::get();
		return $route['view'];
	}

	/** @return string Detected position slug ('' = all positions). */
	public static function position() {
		$route = self::get();
		return $route['position'];
	}

	// ---------------------------------------------------------------------- URLs

	/**
	 * Trailing-slashed base URL of the tool page, e.g.
	 * https://statchasers.com/nfl/nfl-depth-charts/
	 *
	 * @return string
	 */
	public static function base_url() {
		return SCDC_Pages::depth_charts_url();
	}

	/**
	 * Build a tool URL from validated parts. Always lowercase, hyphenated,
	 * trailing-slashed, no query string.
	 *
	 * @param string $team_slug Team slug, or '' / 'all-teams' for the general view.
	 * @param string $view      View slug (defaults to fantasy).
	 * @param string $position  Position slug ('' = all positions).
	 * @return string
	 */
	public static function url( $team_slug = '', $view = self::DEFAULT_VIEW, $position = '' ) {
		$views = SCDC_Teams::views();
		$view  = isset( $views[ $view ] ) ? $view : self::DEFAULT_VIEW;
		$url   = trailingslashit( self::base_url() ) . $view . '/';

		$team_slug = strtolower( (string) $team_slug );
		if ( '' !== $team_slug && SCDC_Teams::is_valid( $team_slug ) ) {
			$url .= $team_slug . '/';
		} elseif ( 'all-teams' === $team_slug ) {
			$url .= 'all-teams/';
		}

		if ( '' !== $position && in_array( $position, SCDC_Teams::positions( $view ), true ) ) {
			$url .= $position . '/';
		}

		return $url;
	}

	/**
	 * Canonical URL for a team's landing page (the indexable target).
	 *
	 * @param string $team_slug Team slug.
	 * @return string
	 */
	public static function team_url( $team_slug ) {
		return self::url( $team_slug, self::DEFAULT_VIEW, '' );
	}

	/**
	 * Canonical URL for the general all-teams landing page.
	 *
	 * @return string
	 */
	public static function main_url() {
		return trailingslashit( self::base_url() ) . self::DEFAULT_VIEW . '/';
	}

	/**
	 * The exact URL of the current route (self URL, before canonical
	 * consolidation). Used for trailing-slash / letter-case normalization.
	 *
	 * @return string
	 */
	public static function self_url() {
		$route = self::get();
		if ( self::TYPE_TEAM === $route['type'] ) {
			return self::url( $route['team_slug'], $route['view'], $route['position'] );
		}
		return self::url( '', $route['view'], $route['position'] );
	}

	/**
	 * The canonical URL search engines should consolidate this route onto:
	 * team routes → that team's fantasy landing page (self-referencing for the
	 * 32 target URLs); general/filtered routes → the main landing page.
	 *
	 * @return string
	 */
	public static function canonical_url() {
		$route = self::get();
		if ( self::TYPE_TEAM === $route['type'] ) {
			return apply_filters( 'scdc_seo_team_canonical', self::team_url( $route['team_slug'] ), $route['team'] );
		}
		return apply_filters( 'scdc_seo_main_canonical', self::main_url() );
	}

	// ------------------------------------------------------------------ requests

	/**
	 * Invalid slugs 404; valid ones are normalized to the canonical URL shape
	 * (lowercase + trailing slash) and to the pretty path when legacy
	 * ?team=…/?view=… query args are used.
	 *
	 * @return void
	 */
	public static function handle_request() {
		$route = self::get();

		if ( self::TYPE_INVALID === $route['type'] ) {
			self::send_404();
			return;
		}

		if ( ! self::is_tool() ) {
			return;
		}

		self::maybe_redirect();
	}

	/**
	 * Turn the current request into a real 404 (status + template), so unknown
	 * slugs can never become indexable URLs.
	 *
	 * @return void
	 */
	private static function send_404() {
		global $wp_query;

		if ( ! $wp_query instanceof WP_Query ) {
			return;
		}

		$wp_query->set_404();
		status_header( 404 );
		nocache_headers();
	}


	/**
	 * Fold legacy query-string filters (?team=houston-texans, ?view=offense) into
	 * the pretty path with a 301, so only the clean URL is ever indexable.
	 *
	 * Trailing-slash and letter-case normalization is handled inside WordPress's
	 * own canonical-redirect pass, in SCDC_Rewrite::block_canonical_redirect().
	 *
	 * @return void
	 */
	private static function maybe_redirect() {
		if ( is_customize_preview() || is_preview() || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) {
			return;
		}
		if ( empty( $_SERVER['REQUEST_URI'] ) || empty( $_SERVER['REQUEST_METHOD'] ) || 'GET' !== $_SERVER['REQUEST_METHOD'] ) {
			return;
		}

		$request      = wp_unslash( $_SERVER['REQUEST_URI'] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$query_string = (string) wp_parse_url( $request, PHP_URL_QUERY );
		if ( '' === $query_string ) {
			return;
		}

		$args = array();
		wp_parse_str( $query_string, $args );
		if ( ! isset( $args['team'] ) && ! isset( $args['view'] ) && ! isset( $args['position'] ) ) {
			return;
		}

		$route     = self::get();
		$team_slug = $route['team_slug'];
		$view      = $route['view'];
		$position  = $route['position'];

		if ( isset( $args['team'] ) ) {
			$candidate = sanitize_title( (string) $args['team'] );
			if ( SCDC_Teams::is_valid( $candidate ) ) {
				$team_slug = $candidate;
				$position  = '';
			}
			unset( $args['team'] );
		}
		if ( isset( $args['view'] ) ) {
			$candidate = sanitize_title( (string) $args['view'] );
			$views     = SCDC_Teams::views();
			if ( isset( $views[ $candidate ] ) ) {
				$view     = $candidate;
				$position = '';
			}
			unset( $args['view'] );
		}
		if ( isset( $args['position'] ) ) {
			$candidate = sanitize_title( (string) $args['position'] );
			if ( in_array( $candidate, SCDC_Teams::positions( $view ), true ) ) {
				$position = $candidate;
			}
			unset( $args['position'] );
		}

		$destination = self::url( $team_slug, $view, $position );
		if ( ! empty( $args ) ) {
			$destination = add_query_arg( $args, $destination );
		}

		wp_safe_redirect( $destination, 301 );
		exit;
	}
}

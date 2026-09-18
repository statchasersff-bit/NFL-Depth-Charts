<?php
/**
 * Pretty-URL routing for the depth charts page.
 *
 * The page lives at /nfl/nfl-depth-charts/ and accepts nested filter segments:
 *
 *   /nfl/nfl-depth-charts/{view}/{team}/{position?}/
 *
 * e.g. /nfl/nfl-depth-charts/fantasy/buffalo-bills/rb/
 *
 * Rewrite rules map those segments to the query vars sc_view / sc_team /
 * sc_position and route the request back to the real page (via `pagename`), so
 * nested URLs render the page + shortcode instead of 404ing.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Rewrite {

	/** @var SCDC_Rewrite|null */
	private static $instance = null;

	/**
	 * @return SCDC_Rewrite
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Path of the depth charts page relative to the site root, no leading/trailing
	 * slash (e.g. "nfl/nfl-depth-charts"). Filterable for non-standard setups.
	 *
	 * @return string
	 */
	public static function page_path() {
		$path = apply_filters( 'scdc_page_path', 'nfl/nfl-depth-charts' );
		return trim( (string) $path, '/' );
	}

	/**
	 * Register runtime hooks.
	 *
	 * @return void
	 */
	public function hooks() {
		add_action( 'init', array( __CLASS__, 'add_rules' ) );
		add_filter( 'query_vars', array( __CLASS__, 'add_query_vars' ) );
		// Stop WordPress from "correcting" our nested URLs back to the bare page.
		add_filter( 'redirect_canonical', array( __CLASS__, 'block_canonical_redirect' ) );
	}

	/**
	 * Register the rewrite rules for the nested filter segments.
	 *
	 * @return void
	 */
	public static function add_rules() {
		$path     = self::page_path();
		$pagename = $path; // hierarchical page path used by the `pagename` query var.

		// {view}/{team}/{position}
		add_rewrite_rule(
			'^' . $path . '/([^/]+)/([^/]+)/([^/]+)/?$',
			'index.php?pagename=' . $pagename . '&sc_view=$matches[1]&sc_team=$matches[2]&sc_position=$matches[3]',
			'top'
		);
		// {view}/{team}
		add_rewrite_rule(
			'^' . $path . '/([^/]+)/([^/]+)/?$',
			'index.php?pagename=' . $pagename . '&sc_view=$matches[1]&sc_team=$matches[2]',
			'top'
		);
		// {view}
		add_rewrite_rule(
			'^' . $path . '/([^/]+)/?$',
			'index.php?pagename=' . $pagename . '&sc_view=$matches[1]',
			'top'
		);
	}

	/**
	 * Whitelist our filter query vars.
	 *
	 * @param array $vars Existing public query vars.
	 * @return array
	 */
	public static function add_query_vars( $vars ) {
		$vars[] = 'sc_view';
		$vars[] = 'sc_team';
		$vars[] = 'sc_position';
		return $vars;
	}

	/**
	 * WordPress's canonical redirect would strip our filter segments and bounce
	 * nested URLs back to /nfl/nfl-depth-charts/, so it is disabled there — except
	 * for the two normalizations we *do* want: a missing trailing slash and an
	 * uppercase slug both 301 to the route's own clean URL.
	 *
	 * @param string|false $redirect_url Proposed canonical URL.
	 * @return string|false
	 */
	public static function block_canonical_redirect( $redirect_url ) {
		if ( '' === (string) get_query_var( 'sc_view' ) ) {
			return $redirect_url;
		}

		if ( class_exists( 'SCDC_Route' ) && SCDC_Route::is_tool() && ! empty( $_SERVER['REQUEST_URI'] ) ) {
			$self         = SCDC_Route::self_url();
			$self_path    = (string) wp_parse_url( $self, PHP_URL_PATH );
			$request_path = (string) wp_parse_url( wp_unslash( $_SERVER['REQUEST_URI'] ), PHP_URL_PATH ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput

			$differs_only_in_shape = '' !== $self_path
				&& $request_path !== $self_path
				&& 0 === strcasecmp( untrailingslashit( $request_path ), untrailingslashit( $self_path ) );

			if ( $differs_only_in_shape ) {
				return $self;
			}
		}

		return false;
	}

	/**
	 * Activation: register rules then flush so nested URLs work immediately.
	 *
	 * @return void
	 */
	public static function activate() {
		self::add_rules();
		flush_rewrite_rules();
	}

	/**
	 * Deactivation: flush so our rules are dropped.
	 *
	 * @return void
	 */
	public static function deactivate() {
		flush_rewrite_rules();
	}
}

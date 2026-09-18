<?php
/**
 * Provisions the real WordPress pages for the NFL section on activation:
 *
 *   /nfl/                 — "NFL" hub page         ([statchasers_nfl_hub])
 *   /nfl/nfl-depth-charts/    — "NFL Depth Charts"     ([statchasers_depth_charts])
 *
 * Create-or-reuse: existing pages at those paths are kept as-is (we never
 * overwrite user content); only missing pages are created. The depth-charts
 * page path is derived from SCDC_Rewrite::page_path() so it always matches the
 * rewrite rules.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Pages {

	const OPT_NFL_PAGE = 'scdc_nfl_page_id';
	const OPT_DC_PAGE  = 'scdc_depth_charts_page_id';

	/**
	 * Ensure the parent (NFL hub) and child (Depth Charts) pages exist. Runs on
	 * activation, before the rewrite flush.
	 *
	 * @return void
	 */
	public static function ensure_pages() {
		$path  = SCDC_Rewrite::page_path(); // e.g. "nfl/nfl-depth-charts"
		$parts = explode( '/', $path );

		$child_slug  = array_pop( $parts );
		$parent_slug = ! empty( $parts ) ? implode( '/', $parts ) : '';

		// --- Parent NFL hub page ---
		$parent_id = 0;
		if ( '' !== $parent_slug ) {
			$parent_id = self::ensure_page(
				$parent_slug,
				0,
				__( 'NFL', 'statchasers-depth-charts' ),
				'[statchasers_nfl_hub]'
			);
			if ( $parent_id ) {
				update_option( self::OPT_NFL_PAGE, $parent_id, false );
			}
		}

		// --- Child NFL Depth Charts page ---
		$full_path = '' !== $parent_slug ? $parent_slug . '/' . $child_slug : $child_slug;
		$child_id  = self::ensure_page(
			$child_slug,
			$parent_id,
			__( 'NFL Depth Charts', 'statchasers-depth-charts' ),
			'[statchasers_depth_charts]',
			$full_path
		);
		if ( $child_id ) {
			update_option( self::OPT_DC_PAGE, $child_id, false );
		}
	}

	/**
	 * Find a page by path, or create it. Returns the page ID (0 on failure).
	 *
	 * @param string      $slug      Page slug (post_name).
	 * @param int         $parent_id Parent page ID (0 for top level).
	 * @param string      $title     Page title (only used when creating).
	 * @param string      $content   Page content (only used when creating).
	 * @param string|null $full_path Full path to look up (defaults to $slug).
	 * @return int
	 */
	private static function ensure_page( $slug, $parent_id, $title, $content, $full_path = null ) {
		$lookup   = null === $full_path ? $slug : $full_path;
		$existing = get_page_by_path( $lookup, OBJECT, 'page' );
		if ( $existing instanceof WP_Post ) {
			return (int) $existing->ID;
		}

		$result = wp_insert_post(
			array(
				'post_type'    => 'page',
				'post_status'  => 'publish',
				'post_title'   => $title,
				'post_name'    => $slug,
				'post_content' => $content,
				'post_parent'  => (int) $parent_id,
				// Indexable: no meta that would hide it from search engines.
			),
			true
		);

		if ( is_wp_error( $result ) || ! $result ) {
			return 0;
		}
		return (int) $result;
	}

	/**
	 * @return int Parent NFL page ID (0 if unknown).
	 */
	public static function nfl_page_id() {
		return (int) get_option( self::OPT_NFL_PAGE, 0 );
	}

	/**
	 * @return int Depth Charts page ID (0 if unknown).
	 */
	public static function depth_charts_page_id() {
		return (int) get_option( self::OPT_DC_PAGE, 0 );
	}

	/**
	 * Canonical, trailing-slashed base URL for the depth charts tool.
	 *
	 * @return string
	 */
	public static function depth_charts_url() {
		$id   = self::depth_charts_page_id();
		$base = $id ? get_permalink( $id ) : '';
		if ( ! $base ) {
			$base = home_url( '/' . SCDC_Rewrite::page_path() . '/' );
		}
		return trailingslashit( $base );
	}
}

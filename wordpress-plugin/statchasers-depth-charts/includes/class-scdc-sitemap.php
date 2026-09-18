<?php
/**
 * Virtual XML sitemap for the depth-chart routes:
 *
 *   https://statchasers.com/nfl-depth-charts-sitemap.xml
 *
 * The 32 team URLs are routes, not posts, so nothing is faked in the database.
 * The file is generated on request from SCDC_Teams and registered with Rank
 * Math's sitemap index via `rank_math/sitemap/index` (and with robots.txt when
 * Rank Math is not active).
 *
 * `lastmod` is only emitted when we genuinely know when the data changed — the
 * timestamp of the last successful depth-chart refresh. Never a synthetic date.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Sitemap {

	const FILENAME = 'nfl-depth-charts-sitemap.xml';

	/** @var SCDC_Sitemap|null */
	private static $instance = null;

	/**
	 * @return SCDC_Sitemap
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * @return void
	 */
	public function hooks() {
		// Serve the file before any sitemap plugin claims the request.
		add_action( 'parse_request', array( __CLASS__, 'maybe_serve' ), 0 );
		// List it inside Rank Math's sitemap index.
		add_filter( 'rank_math/sitemap/index', array( __CLASS__, 'add_to_rank_math_index' ) );
		// Standalone discovery when no Rank Math index exists.
		add_filter( 'robots_txt', array( __CLASS__, 'add_to_robots_txt' ), 20, 2 );
	}

	/**
	 * Absolute URL of the sitemap.
	 *
	 * @return string
	 */
	public static function url() {
		return home_url( '/' . self::FILENAME );
	}

	/**
	 * Timestamp of the last successful data refresh, or 0 when never refreshed.
	 *
	 * @return int
	 */
	private static function last_modified() {
		$meta = SCDC_Store::get_meta();
		return isset( $meta['last_refreshed_ts'] ) ? (int) $meta['last_refreshed_ts'] : 0;
	}

	/**
	 * Serve the sitemap when the request path matches, then exit.
	 *
	 * @return void
	 */
	public static function maybe_serve() {
		if ( empty( $_SERVER['REQUEST_URI'] ) ) {
			return;
		}
		$path = (string) wp_parse_url( wp_unslash( $_SERVER['REQUEST_URI'] ), PHP_URL_PATH ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$home = (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH );

		$relative = ltrim( substr( $path, strlen( $home ) ), '/' );
		if ( 0 !== strpos( $path, $home ) ) {
			$relative = ltrim( $path, '/' );
		}

		if ( self::FILENAME !== $relative ) {
			return;
		}

		self::serve();
	}

	/**
	 * Emit the XML document.
	 *
	 * @return void
	 */
	private static function serve() {
		// Sitemaps must not be served from a stale HTML page cache.
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}

		if ( ! headers_sent() ) {
			header( 'Content-Type: application/xml; charset=UTF-8' );
			header( 'X-Robots-Tag: noindex, follow', true );
			header( 'Cache-Control: max-age=3600' );
		}

		$lastmod = self::last_modified();
		$stamp   = $lastmod ? gmdate( 'c', $lastmod ) : '';

		$urls = array( SCDC_Route::main_url() );
		foreach ( SCDC_Teams::all() as $slug => $team ) {
			$urls[] = SCDC_Route::team_url( $slug );
		}

		echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
		echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
		foreach ( $urls as $url ) {
			echo "\t<url>\n";
			echo "\t\t<loc>" . esc_url( $url ) . "</loc>\n";
			if ( '' !== $stamp ) {
				echo "\t\t<lastmod>" . esc_html( $stamp ) . "</lastmod>\n";
			}
			echo "\t</url>\n";
		}
		echo '</urlset>';
		exit;
	}

	/**
	 * Append our sitemap to Rank Math's sitemap index.
	 *
	 * @param string $xml Existing index entries.
	 * @return string
	 */
	public static function add_to_rank_math_index( $xml ) {
		$lastmod = self::last_modified();

		$entry  = "\t<sitemap>\n";
		$entry .= "\t\t<loc>" . esc_url( self::url() ) . "</loc>\n";
		if ( $lastmod ) {
			$entry .= "\t\t<lastmod>" . esc_html( gmdate( 'c', $lastmod ) ) . "</lastmod>\n";
		}
		$entry .= "\t</sitemap>\n";

		return (string) $xml . $entry;
	}

	/**
	 * Advertise the sitemap in robots.txt when Rank Math isn't publishing an index.
	 *
	 * @param string $output Robots.txt body.
	 * @param bool   $public Whether the site is public.
	 * @return string
	 */
	public static function add_to_robots_txt( $output, $public ) {
		if ( ! $public || SCDC_SEO::rank_math_active() ) {
			return $output;
		}
		return $output . "\nSitemap: " . self::url() . "\n";
	}
}

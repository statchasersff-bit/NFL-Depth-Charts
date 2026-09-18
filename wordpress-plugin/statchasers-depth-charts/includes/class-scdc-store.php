<?php
/**
 * Local cache storage for depth-chart data.
 *
 * Data lives at: /wp-content/uploads/statchasers/depth-charts.json
 * Refresh metadata lives in the `scdc_refresh_meta` option.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Store {

	const SUBDIR    = 'statchasers';
	const FILENAME  = 'depth-charts.json';

	/**
	 * Absolute path to the uploads/statchasers directory.
	 *
	 * @return string
	 */
	public static function dir_path() {
		$uploads = wp_upload_dir();
		return trailingslashit( $uploads['basedir'] ) . self::SUBDIR;
	}

	/**
	 * Absolute path to the cached JSON file.
	 *
	 * @return string
	 */
	public static function file_path() {
		return trailingslashit( self::dir_path() ) . self::FILENAME;
	}

	/**
	 * Public URL to the cached JSON file (cache-busted by last-refresh time).
	 *
	 * @return string
	 */
	public static function file_url() {
		$uploads = wp_upload_dir();
		$url     = trailingslashit( $uploads['baseurl'] ) . self::SUBDIR . '/' . self::FILENAME;
		$meta    = self::get_meta();
		$version = isset( $meta['last_refreshed_ts'] ) ? (int) $meta['last_refreshed_ts'] : SCDC_VERSION;
		return add_query_arg( 'v', $version, $url );
	}

	/**
	 * Whether a cached data file currently exists.
	 *
	 * @return bool
	 */
	public static function has_data() {
		return file_exists( self::file_path() );
	}

	/**
	 * Read and decode the cached JSON file.
	 *
	 * @return array|null Decoded payload, or null if missing/unreadable.
	 */
	public static function read() {
		$path = self::file_path();
		if ( ! file_exists( $path ) ) {
			return null;
		}
		$raw = file_get_contents( $path );
		if ( false === $raw ) {
			return null;
		}
		$data = json_decode( $raw, true );
		return is_array( $data ) ? $data : null;
	}

	/**
	 * Write the payload to the cached JSON file, creating the directory if needed.
	 *
	 * @param array $payload Data to encode and store.
	 * @return bool True on success.
	 */
	public static function write( array $payload ) {
		$dir = self::dir_path();
		if ( ! wp_mkdir_p( $dir ) ) {
			return false;
		}

		// Drop an index.html so the directory can't be browsed.
		$index = trailingslashit( $dir ) . 'index.html';
		if ( ! file_exists( $index ) ) {
			@file_put_contents( $index, '' ); // phpcs:ignore
		}

		$json = wp_json_encode( $payload );
		if ( false === $json ) {
			return false;
		}

		$bytes = file_put_contents( self::file_path(), $json ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		return false !== $bytes;
	}

	/**
	 * Get refresh metadata, with sensible defaults when never refreshed.
	 *
	 * @return array
	 */
	public static function get_meta() {
		$defaults = array(
			'status'            => 'never', // never | success | partial | error
			'error'            => '',
			'last_refreshed'    => '',      // human/ISO string
			'last_refreshed_ts' => 0,       // unix timestamp (GMT)
			'teams_ok'          => 0,
			'teams_failed'      => array(),
		);
		$meta = get_option( SCDC_META_OPTION, array() );
		if ( ! is_array( $meta ) ) {
			$meta = array();
		}
		return wp_parse_args( $meta, $defaults );
	}

	/**
	 * Persist refresh metadata.
	 *
	 * @param array $meta Metadata to store.
	 * @return void
	 */
	public static function set_meta( array $meta ) {
		update_option( SCDC_META_OPTION, $meta, false );
	}
}

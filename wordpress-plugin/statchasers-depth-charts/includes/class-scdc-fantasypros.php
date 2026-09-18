<?php
/**
 * FantasyPros fetcher — fills the Fantasy tab's dedicated FAN_* columns.
 *
 * FantasyPros publishes the five fantasy positions ordered by Expert Consensus
 * Ranking. They go into FAN_QB / FAN_RB / FAN_WR / FAN_TE / FAN_K, kept separate
 * from the canonical QB/RB/WR/TE/K columns (which Footballguys/ESPN fill for the
 * Offense and Special-Teams tabs). Ported from the StatChasers app's
 * fantasyProsFetcher.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_FantasyPros {

	const POSITIONS = array( 'QB', 'RB', 'WR', 'TE', 'K' );

	private static $HEADER_TO_POSITION = array(
		'Quarterbacks'   => 'QB',
		'Running Backs'  => 'RB',
		'Wide Receivers' => 'WR',
		'Tight Ends'     => 'TE',
		'Kickers'        => 'K',
	);

	/**
	 * Canonical position -> the Fantasy-tab column key holding its FantasyPros copy.
	 *
	 * @param string $position Canonical position (QB/RB/WR/TE/K).
	 * @return string
	 */
	public static function fantasy_key( $position ) {
		return 'FAN_' . $position;
	}

	/**
	 * FantasyPros team slug: lowercase name, non-alphanumeric runs -> hyphens.
	 *
	 * @param string $team_name Full team name.
	 * @return string
	 */
	private static function team_slug( $team_name ) {
		$slug = strtolower( $team_name );
		$slug = preg_replace( '/[^a-z0-9]+/', '-', $slug );
		return trim( $slug, '-' );
	}

	/**
	 * Fetch a team's QB/RB/WR/TE/K depth order from FantasyPros. Returns the
	 * positions map (QB => players, …) or null on any network/parse failure.
	 *
	 * @param string $team_name Full team name.
	 * @return array<string,array>|null
	 */
	public static function fetch_team( $team_name ) {
		$slug = self::team_slug( $team_name );
		$url  = "https://www.fantasypros.com/nfl/depth-chart/{$slug}.php";

		$response = wp_remote_get(
			$url,
			array(
				'timeout'    => 15,
				'user-agent' => 'Mozilla/5.0 (compatible; StatChasers/1.0)',
				'headers'    => array( 'Accept' => 'text/html' ),
			)
		);
		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return null;
		}

		$positions = self::parse_html( wp_remote_retrieve_body( $response ) );
		return ! empty( $positions ) ? $positions : null;
	}

	/**
	 * Parse the five position tables out of a FantasyPros depth-chart page.
	 *
	 * @param string $html Page HTML.
	 * @return array<string,array>
	 */
	public static function parse_html( $html ) {
		$positions = array();

		$table_re = '#<table[^>]*class="[^"]*position-table[^"]*"[\s\S]*?</table>#';
		if ( ! preg_match_all( $table_re, $html, $tables ) ) {
			return $positions;
		}

		foreach ( $tables[0] as $table ) {
			if ( ! preg_match( '#<th[^>]*>(Quarterbacks|Running Backs|Wide Receivers|Tight Ends|Kickers)</th>#', $table, $hm ) ) {
				continue;
			}
			$position = self::$HEADER_TO_POSITION[ $hm[1] ];

			if ( ! preg_match_all( '#<tr class="mpb-player-\d+">[\s\S]*?</tr>#', $table, $rows ) ) {
				continue;
			}

			$players = array();
			foreach ( $rows[0] as $row ) {
				$id = null;
				if ( preg_match( '#mpb-player-(\d+)#', $row, $idm ) ) {
					$id = $idm[1];
				}
				$name = '';
				if ( preg_match( '#fp-player-name="([^"]*)"#', $row, $nm ) ) {
					$name = $nm[1];
				} elseif ( preg_match( '#class="player-name[^"]*"[^>]*>([^<]+)<#', $row, $nm ) ) {
					$name = $nm[1];
				}
				$name = self::decode_entities( $name );
				if ( '' === $name ) {
					continue;
				}
				$players[] = array(
					'rank'   => count( $players ) + 1,
					'name'   => $name,
					'id'     => $id,
					'status' => null,
				);
			}

			if ( ! empty( $players ) ) {
				$positions[ $position ] = $players;
			}
		}

		return $positions;
	}

	/**
	 * Seed the FAN_* columns from whatever currently fills the canonical columns
	 * (Footballguys, else ESPN) so the Fantasy tab still renders if FantasyPros is
	 * unavailable. Mutates $positions in place.
	 *
	 * @param array $positions Canonical positions (by reference).
	 * @return void
	 */
	public static function seed_fantasy_columns( &$positions ) {
		foreach ( self::POSITIONS as $position ) {
			if ( ! empty( $positions[ $position ] ) ) {
				// Copy by value so later movement annotation doesn't alias.
				$positions[ self::fantasy_key( $position ) ] = array_map(
					function ( $p ) {
						return $p;
					},
					$positions[ $position ]
				);
			}
		}
	}

	/**
	 * Overlay FantasyPros' ECR order onto the FAN_* columns. Mutates $positions in
	 * place; returns true if anything was applied.
	 *
	 * @param array      $positions Canonical positions (by reference).
	 * @param array|null $fp        FantasyPros positions for this team.
	 * @return bool
	 */
	public static function merge( &$positions, $fp ) {
		if ( empty( $fp ) ) {
			return false;
		}
		$applied = false;
		foreach ( self::POSITIONS as $position ) {
			if ( ! empty( $fp[ $position ] ) ) {
				$positions[ self::fantasy_key( $position ) ] = $fp[ $position ];
				$applied = true;
			}
		}
		return $applied;
	}

	private static function decode_entities( $value ) {
		$value = str_replace(
			array( '&amp;', '&#39;', '&apos;', '&quot;', '&nbsp;' ),
			array( '&', "'", "'", '"', ' ' ),
			$value
		);
		return trim( $value );
	}
}

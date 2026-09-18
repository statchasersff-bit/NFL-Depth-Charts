<?php
/**
 * Footballguys fetcher — overrides the Offense / Defense / Special-Teams columns.
 *
 * Footballguys publishes every team's depth chart on a single page (`?type=all`),
 * so this fetches once and parses all 32 teams. Folded into the same canonical
 * columns as ESPN (scheme-aware front seven). Ported from the StatChasers app's
 * footballguysFetcher.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Footballguys {

	const ALL_URL = 'https://www.footballguys.com/depth-charts?type=all';

	// Offense + special-teams slots map to a canonical column regardless of front.
	private static $FIXED = array(
		'QB' => 'QB', 'RB' => 'RB', 'WR' => 'WR', 'TE' => 'TE',
		'LT' => 'LT', 'LG' => 'LG', 'C' => 'C', 'RG' => 'RG', 'RT' => 'RT',
		'PK' => 'K', 'P' => 'P', 'LS' => 'LS', 'KR' => 'KR', 'PR' => 'PR',
	);

	// Order in which raw slots fold into a multi-slot column (keeps interleave
	// deterministic: all starters first, then the backups).
	private static $OFFENSE_ORDER = array( 'QB', 'RB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT' );
	private static $SPECIAL_ORDER = array( 'PK', 'P', 'LS', 'KR', 'PR' );
	private static $DEFENSE_ORDER = array(
		'LDE', 'RDE', 'LDT', 'RDT', 'NT',
		'WLB', 'SLB', 'MLB', 'LILB', 'RILB',
		'LCB', 'RCB', 'SCB', 'FS', 'SS',
	);

	private static $STATUS_CODES = array( 'Q', 'D', 'O', 'IR', 'SUS', 'PUP', 'NFI', 'CEL', 'EX', 'DNR' );

	/**
	 * Fetch + parse the all-teams page. Returns abbr => canonical positions, or
	 * null on any network/parse failure (caller falls back to ESPN).
	 *
	 * @return array<string,array>|null
	 */
	public static function fetch_all() {
		$response = wp_remote_get(
			self::ALL_URL,
			array(
				'timeout'    => 20,
				'user-agent' => 'Mozilla/5.0 (compatible; StatChasers/1.0)',
				'headers'    => array( 'Accept' => 'text/html' ),
			)
		);
		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return null;
		}
		$html  = wp_remote_retrieve_body( $response );
		$teams = self::parse_html( $html );
		return ! empty( $teams ) ? $teams : null;
	}

	/**
	 * Parse the all-teams HTML into abbr => canonical positions map.
	 *
	 * @param string $html Page HTML.
	 * @return array<string,array>
	 */
	public static function parse_html( $html ) {
		$by_team = array();

		$team_re = '#<div class="depth-chart col[^"]*" id="depth_chart_([A-Z]{2,3})">([\s\S]*?)(?=<div class="depth-chart col|</div></div></div>)#';
		if ( ! preg_match_all( $team_re, $html, $team_matches, PREG_SET_ORDER ) ) {
			return $by_team;
		}

		foreach ( $team_matches as $tm ) {
			$abbr  = $tm[1];
			$block = $tm[2];

			// Collect raw slot lists keyed by uppercased slot abbreviation.
			$raw_slots = array();
			$li_re     = '#<li class="depth-chart-pos depth-chart-cat-(?:off|def|st) depth-chart-pos-([a-z0-9]+)[^"]*">([\s\S]*?)</li>#';
			if ( preg_match_all( $li_re, $block, $li_matches, PREG_SET_ORDER ) ) {
				foreach ( $li_matches as $li ) {
					$slot    = strtoupper( $li[1] );
					$players = self::parse_slot_players( $li[2] );
					if ( ! empty( $players ) ) {
						$raw_slots[ $slot ] = $players;
					}
				}
			}
			if ( empty( $raw_slots ) ) {
				continue;
			}

			$scheme = self::detect_scheme( array_keys( $raw_slots ) );

			// Fold slots into canonical buckets in a stable order.
			$buckets = array();
			$push    = function ( $canon, $list ) use ( &$buckets ) {
				if ( ! isset( $buckets[ $canon ] ) ) {
					$buckets[ $canon ] = array();
				}
				$buckets[ $canon ][] = $list;
			};

			foreach ( array_merge( self::$OFFENSE_ORDER, self::$SPECIAL_ORDER ) as $slot ) {
				if ( isset( $raw_slots[ $slot ], self::$FIXED[ $slot ] ) ) {
					$push( self::$FIXED[ $slot ], $raw_slots[ $slot ] );
				}
			}
			foreach ( self::$DEFENSE_ORDER as $slot ) {
				if ( ! isset( $raw_slots[ $slot ] ) ) {
					continue;
				}
				$canon = self::canonical_defense( $slot, $scheme );
				if ( null !== $canon ) {
					$push( $canon, $raw_slots[ $slot ] );
				}
			}

			$positions = array();
			foreach ( $buckets as $canon => $slot_lists ) {
				$positions[ $canon ] = self::interleave_dedupe( $slot_lists );
			}
			$by_team[ $abbr ] = $positions;
		}

		return $by_team;
	}

	/**
	 * Parse the players from one position <li> body. Skill players are anchors
	 * (with a /player/Name/ID profile link); O-line, punters, and long snappers
	 * are plain <span>s with no id. Both carry class="player …".
	 *
	 * @param string $inner List-item inner HTML.
	 * @return array
	 */
	private static function parse_slot_players( $inner ) {
		$players = array();
		$re      = '#<(?:a|span)\b([^>]*?)\bclass="player[^"]*"([^>]*)>([^<]*)<#';
		if ( ! preg_match_all( $re, $inner, $matches, PREG_SET_ORDER ) ) {
			return $players;
		}
		foreach ( $matches as $m ) {
			$name = self::decode_entities( $m[3] );
			if ( '' === $name ) {
				continue;
			}
			$attrs = $m[1] . ' ' . $m[2];
			$id    = null;
			if ( preg_match( '#/player/[^/]*/([A-Za-z0-9]+)#', $attrs, $idm ) ) {
				$id = $idm[1];
			}
			$split     = self::split_status( $name );
			$players[] = array(
				'name'   => $split['name'],
				'id'     => $id,
				'status' => $split['status'],
			);
		}
		return $players;
	}

	/**
	 * Split "James Conner (Q)" into name + status (only for known status codes).
	 *
	 * @param string $raw Display name.
	 * @return array{name:string,status:?string}
	 */
	private static function split_status( $raw ) {
		if ( preg_match( '/^(.*?)\s*\(([^)]+)\)\s*$/', $raw, $m ) ) {
			$code = strtoupper( $m[2] );
			if ( in_array( $code, self::$STATUS_CODES, true ) ) {
				return array( 'name' => trim( $m[1] ), 'status' => $code );
			}
		}
		return array( 'name' => $raw, 'status' => null );
	}

	/**
	 * Map a defensive slot to a canonical column (scheme-aware).
	 *
	 * @param string $slot   Slot abbreviation.
	 * @param string $scheme '3-4' or '4-3'.
	 * @return string|null
	 */
	private static function canonical_defense( $slot, $scheme ) {
		switch ( $slot ) {
			case 'LDT':
			case 'RDT':
			case 'NT':
				return 'DL';
			case 'LDE':
			case 'RDE':
				return ( '3-4' === $scheme ) ? 'DL' : 'EDGE';
			case 'WLB':
			case 'SLB':
				return ( '3-4' === $scheme ) ? 'EDGE' : 'LB';
			case 'MLB':
			case 'LILB':
			case 'RILB':
				return 'LB';
			case 'LCB':
			case 'RCB':
			case 'SCB':
				return 'CB';
			case 'FS':
			case 'SS':
				return 'S';
		}
		return null;
	}

	/**
	 * 3-4 fronts list a nose tackle / inside backers; 4-3 fronts don't.
	 *
	 * @param array $slots Slot abbreviations present.
	 * @return string
	 */
	private static function detect_scheme( $slots ) {
		if ( in_array( 'NT', $slots, true ) || in_array( 'LILB', $slots, true ) || in_array( 'RILB', $slots, true ) ) {
			return '3-4';
		}
		return '4-3';
	}

	/**
	 * Merge per-slot lists into one ranked column (starters first), de-duped.
	 *
	 * @param array $slot_lists Array of player-lists.
	 * @return array
	 */
	private static function interleave_dedupe( $slot_lists ) {
		$out  = array();
		$seen = array();
		$max  = 0;
		foreach ( $slot_lists as $list ) {
			$max = max( $max, count( $list ) );
		}
		for ( $i = 0; $i < $max; $i++ ) {
			foreach ( $slot_lists as $list ) {
				if ( ! isset( $list[ $i ] ) ) {
					continue;
				}
				$p   = $list[ $i ];
				$key = ! empty( $p['id'] ) ? $p['id'] : strtolower( $p['name'] );
				if ( isset( $seen[ $key ] ) ) {
					continue;
				}
				$seen[ $key ] = true;
				$out[]        = array(
					'rank'   => count( $out ) + 1,
					'name'   => $p['name'],
					'id'     => $p['id'],
					'status' => $p['status'],
				);
			}
		}
		return $out;
	}

	private static function decode_entities( $value ) {
		$value = str_replace(
			array( '&amp;', '&#39;', '&apos;', '&quot;', '&nbsp;' ),
			array( '&', "'", "'", '"', ' ' ),
			$value
		);
		return trim( $value );
	}

	/**
	 * Override a chart's columns with Footballguys' depth order. Mutates
	 * $positions in place; returns true if anything was applied.
	 *
	 * @param array      $positions Canonical positions (by reference).
	 * @param array|null $fbg       Footballguys positions for this team.
	 * @return bool
	 */
	public static function merge( &$positions, $fbg ) {
		if ( empty( $fbg ) ) {
			return false;
		}
		foreach ( $fbg as $key => $players ) {
			if ( ! empty( $players ) ) {
				$positions[ $key ] = $players;
			}
		}
		return true;
	}
}

<?php
/**
 * Fetch + normalize NFL depth charts from ESPN.
 *
 * Mirrors the canonical, scheme-aware normalization used by the StatChasers app:
 * each team's slots are folded into canonical columns (QB, RB, WR, TE, LT, LG, C,
 * RG, RT, EDGE, DL, LB, CB, S, K, P, LS, KR, PR) grouped by side of the ball.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Espn {

	/**
	 * The 32 NFL teams with their ESPN slug.
	 *
	 * @return array<int,array{abbr:string,name:string,slug:string}>
	 */
	public static function teams() {
		return array(
			array( 'abbr' => 'ARI', 'name' => 'Arizona Cardinals',     'slug' => 'ari' ),
			array( 'abbr' => 'ATL', 'name' => 'Atlanta Falcons',        'slug' => 'atl' ),
			array( 'abbr' => 'BAL', 'name' => 'Baltimore Ravens',       'slug' => 'bal' ),
			array( 'abbr' => 'BUF', 'name' => 'Buffalo Bills',          'slug' => 'buf' ),
			array( 'abbr' => 'CAR', 'name' => 'Carolina Panthers',      'slug' => 'car' ),
			array( 'abbr' => 'CHI', 'name' => 'Chicago Bears',          'slug' => 'chi' ),
			array( 'abbr' => 'CIN', 'name' => 'Cincinnati Bengals',     'slug' => 'cin' ),
			array( 'abbr' => 'CLE', 'name' => 'Cleveland Browns',       'slug' => 'cle' ),
			array( 'abbr' => 'DAL', 'name' => 'Dallas Cowboys',         'slug' => 'dal' ),
			array( 'abbr' => 'DEN', 'name' => 'Denver Broncos',         'slug' => 'den' ),
			array( 'abbr' => 'DET', 'name' => 'Detroit Lions',          'slug' => 'det' ),
			array( 'abbr' => 'GB',  'name' => 'Green Bay Packers',      'slug' => 'gb' ),
			array( 'abbr' => 'HOU', 'name' => 'Houston Texans',         'slug' => 'hou' ),
			array( 'abbr' => 'IND', 'name' => 'Indianapolis Colts',     'slug' => 'ind' ),
			array( 'abbr' => 'JAX', 'name' => 'Jacksonville Jaguars',   'slug' => 'jax' ),
			array( 'abbr' => 'KC',  'name' => 'Kansas City Chiefs',     'slug' => 'kc' ),
			array( 'abbr' => 'LV',  'name' => 'Las Vegas Raiders',      'slug' => 'lv' ),
			array( 'abbr' => 'LAC', 'name' => 'Los Angeles Chargers',   'slug' => 'lac' ),
			array( 'abbr' => 'LAR', 'name' => 'Los Angeles Rams',       'slug' => 'lar' ),
			array( 'abbr' => 'MIA', 'name' => 'Miami Dolphins',         'slug' => 'mia' ),
			array( 'abbr' => 'MIN', 'name' => 'Minnesota Vikings',      'slug' => 'min' ),
			array( 'abbr' => 'NE',  'name' => 'New England Patriots',   'slug' => 'ne' ),
			array( 'abbr' => 'NO',  'name' => 'New Orleans Saints',     'slug' => 'no' ),
			array( 'abbr' => 'NYG', 'name' => 'New York Giants',        'slug' => 'nyg' ),
			array( 'abbr' => 'NYJ', 'name' => 'New York Jets',          'slug' => 'nyj' ),
			array( 'abbr' => 'PHI', 'name' => 'Philadelphia Eagles',    'slug' => 'phi' ),
			array( 'abbr' => 'PIT', 'name' => 'Pittsburgh Steelers',    'slug' => 'pit' ),
			array( 'abbr' => 'SF',  'name' => 'San Francisco 49ers',    'slug' => 'sf' ),
			array( 'abbr' => 'SEA', 'name' => 'Seattle Seahawks',       'slug' => 'sea' ),
			array( 'abbr' => 'TB',  'name' => 'Tampa Bay Buccaneers',   'slug' => 'tb' ),
			array( 'abbr' => 'TEN', 'name' => 'Tennessee Titans',       'slug' => 'ten' ),
			array( 'abbr' => 'WAS', 'name' => 'Washington Commanders',  'slug' => 'wsh' ),
		);
	}

	// Side-of-ball classification by ESPN parent / slot abbreviation.
	private static $OFFENSE_PARENTS    = array( 'OFF', 'OT', 'OG' );
	private static $OFFENSE_SLOTS      = array( 'QB', 'RB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'OL' );
	private static $SPECIAL_PARENTS    = array( 'ST', 'K', 'P' );
	private static $SPECIAL_SLOTS      = array( 'K', 'PK', 'P', 'LS', 'KR', 'PR', 'H' );
	private static $DEFENSE_PARENTS    = array( 'DE', 'DT', 'LB', 'CB', 'S', 'DB', 'DEF' );
	private static $DEFENSE_SLOTS      = array( 'DE', 'DT', 'NT', 'LB', 'MLB', 'OLB', 'ILB', 'CB', 'SS', 'FS', 'S', 'DB', 'NB', 'LDE', 'RDE', 'LDT', 'RDT', 'WLB', 'SLB', 'LOLB', 'ROLB', 'LILB', 'RILB', 'LCB', 'RCB' );

	/**
	 * Fetch + normalize a single team. Returns null on any failure.
	 *
	 * @param string $abbr Team abbreviation.
	 * @param string $name Team name.
	 * @param string $slug ESPN slug.
	 * @return array|null
	 */
	public static function fetch_team( $abbr, $name, $slug ) {
		$api_url = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/{$slug}/depthcharts";

		$response = wp_remote_get(
			$api_url,
			array(
				'timeout'    => 15,
				'user-agent' => 'Mozilla/5.0 (compatible; StatChasers/1.0)',
				'headers'    => array( 'Accept' => 'application/json' ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return null;
		}
		if ( 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return null;
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );
		if ( ! is_array( $data ) ) {
			return null;
		}

		return self::normalize( $data, $abbr, $name, $slug );
	}

	/**
	 * Normalize an ESPN depthcharts payload into the canonical positions matrix.
	 *
	 * @param array  $data ESPN response.
	 * @param string $abbr Team abbreviation.
	 * @param string $name Team name.
	 * @param string $slug ESPN slug (used for the logo CDN).
	 * @return array{team:array,season:int,positions:array}
	 */
	private static function normalize( $data, $abbr, $name, $slug ) {
		$season = isset( $data['season']['year'] ) ? (int) $data['season']['year'] : (int) gmdate( 'Y' );

		$logo = '';
		if ( ! empty( $data['team']['logos'][0]['href'] ) ) {
			$logo = $data['team']['logos'][0]['href'];
		} else {
			$logo = "https://a.espncdn.com/i/teamlogos/nfl/500/{$slug}.png";
		}

		$depthchart = isset( $data['depthchart'] ) && is_array( $data['depthchart'] ) ? $data['depthchart'] : array();

		// Detect base defensive front from formation names.
		$formation_names = array();
		foreach ( $depthchart as $formation ) {
			if ( isset( $formation['name'] ) ) {
				$formation_names[] = (string) $formation['name'];
			}
		}
		$scheme = self::detect_scheme( $formation_names );

		// Collect best (longest) slot list per slot abbreviation, tracking parent.
		$group_players = array(); // slotAbbr => array of players
		$slot_parent   = array(); // slotAbbr => parentAbbr

		foreach ( $depthchart as $formation ) {
			$positions = isset( $formation['positions'] ) && is_array( $formation['positions'] ) ? $formation['positions'] : array();
			foreach ( $positions as $slot ) {
				$slot_abbr   = isset( $slot['position']['abbreviation'] ) ? strtoupper( $slot['position']['abbreviation'] ) : '';
				$parent_abbr = isset( $slot['position']['parent']['abbreviation'] ) ? strtoupper( $slot['position']['parent']['abbreviation'] ) : '';
				if ( '' === $slot_abbr ) {
					continue;
				}

				$athletes = isset( $slot['athletes'] ) && is_array( $slot['athletes'] ) ? $slot['athletes'] : array();
				if ( empty( $athletes ) ) {
					continue;
				}

				// Side of ball must be recognized, else skip.
				if ( null === self::category( $slot_abbr, $parent_abbr ) ) {
					continue;
				}

				// Keep the formation that lists the most players for this slot.
				if ( isset( $group_players[ $slot_abbr ] ) && count( $group_players[ $slot_abbr ] ) >= count( $athletes ) ) {
					continue;
				}

				$players = array();
				$rank    = 1;
				foreach ( $athletes as $athlete ) {
					$status = '';
					if ( isset( $athlete['injuries'][0]['type']['abbreviation'] ) ) {
						$status = (string) $athlete['injuries'][0]['type']['abbreviation'];
					}
					$display = '';
					if ( isset( $athlete['displayName'] ) ) {
						$display = (string) $athlete['displayName'];
					} elseif ( isset( $athlete['shortName'] ) ) {
						$display = (string) $athlete['shortName'];
					} else {
						$display = 'Unknown';
					}
					$athlete_id = isset( $athlete['id'] ) ? (string) $athlete['id'] : null;
					$players[]  = array(
						'rank'     => $rank,
						'name'     => $display,
						'id'       => $athlete_id,
						'status'   => '' !== $status ? $status : null,
						// The depthcharts endpoint omits headshots; derive the stable
						// ESPN CDN URL from the numeric athlete id.
						'headshot' => self::espn_headshot_url( $athlete_id ),
					);
					$rank++;
				}

				$group_players[ $slot_abbr ] = $players;
				$slot_parent[ $slot_abbr ]   = $parent_abbr;
			}
		}

		// Fold slots into canonical column buckets.
		$buckets = array(); // canonKey => array of slot player-lists
		foreach ( $group_players as $slot_abbr => $players ) {
			$parent = isset( $slot_parent[ $slot_abbr ] ) ? $slot_parent[ $slot_abbr ] : '';
			$canon  = self::canonical_key( $slot_abbr, $parent, $scheme );
			if ( null === $canon ) {
				continue;
			}
			if ( ! isset( $buckets[ $canon ] ) ) {
				$buckets[ $canon ] = array();
			}
			$buckets[ $canon ][] = $players;
		}

		$positions = array();
		foreach ( $buckets as $canon => $slot_lists ) {
			$positions[ $canon ] = self::interleave_dedupe( $slot_lists );
		}

		// Fantasy/team DEF column is the team nickname.
		$positions['DEF'] = array(
			array(
				'rank'   => 1,
				'name'   => self::nickname( $name ),
				'id'     => null,
				'status' => null,
			),
		);

		return array(
			'team'      => array(
				'abbr' => $abbr,
				'name' => $name,
				'logo' => $logo,
			),
			'season'    => $season,
			'positions' => $positions,
		);
	}

	/**
	 * Classify a slot as offense / defense / specialTeams, or null if unknown.
	 *
	 * @param string $slot   Slot abbreviation.
	 * @param string $parent Parent abbreviation.
	 * @return string|null
	 */
	private static function category( $slot, $parent ) {
		if ( in_array( $parent, self::$OFFENSE_PARENTS, true ) || in_array( $slot, self::$OFFENSE_SLOTS, true ) ) {
			return 'offense';
		}
		if ( in_array( $parent, self::$SPECIAL_PARENTS, true ) || in_array( $slot, self::$SPECIAL_SLOTS, true ) ) {
			return 'specialTeams';
		}
		if ( in_array( $parent, self::$DEFENSE_PARENTS, true ) || in_array( $slot, self::$DEFENSE_SLOTS, true ) ) {
			return 'defense';
		}
		return null;
	}

	/**
	 * Map an ESPN slot to a canonical column key (scheme-aware for the front seven).
	 *
	 * @param string $slot   Slot abbreviation.
	 * @param string $parent Parent abbreviation.
	 * @param string $scheme '3-4' or '4-3'.
	 * @return string|null
	 */
	private static function canonical_key( $slot, $parent, $scheme ) {
		$fixed = array(
			'QB' => 'QB',
			'RB' => 'RB', 'HB' => 'RB', 'TB' => 'RB',
			'WR' => 'WR', 'LWR' => 'WR', 'RWR' => 'WR', 'SWR' => 'WR', 'SLWR' => 'WR',
			'TE' => 'TE',
			'LT' => 'LT', 'LG' => 'LG', 'C' => 'C', 'RG' => 'RG', 'RT' => 'RT',
			'K'  => 'K', 'PK' => 'K', 'P' => 'P', 'LS' => 'LS', 'KR' => 'KR', 'PR' => 'PR',
		);
		if ( isset( $fixed[ $slot ] ) ) {
			return $fixed[ $slot ];
		}

		$dl_slots   = array( 'DT', 'LDT', 'RDT', 'NT', 'NG', 'DL' );
		$edge_slots = array( 'LOLB', 'ROLB', 'RUSH', 'EDGE' );
		$end_slots  = array( 'DE', 'LDE', 'RDE' );
		$olb_slots  = array( 'WLB', 'SLB', 'OLB' );
		$ilb_slots  = array( 'MLB', 'ILB', 'LILB', 'RILB', 'MIKE', 'WILL', 'SAM', 'LB' );
		$cb_slots   = array( 'CB', 'LCB', 'RCB', 'NB', 'NCB', 'DB' );
		$s_slots    = array( 'S', 'SS', 'FS', 'SAF' );

		if ( in_array( $slot, $dl_slots, true ) ) {
			return 'DL';
		}
		if ( in_array( $slot, $edge_slots, true ) ) {
			return 'EDGE';
		}
		if ( in_array( $slot, $end_slots, true ) ) {
			return ( '3-4' === $scheme ) ? 'DL' : 'EDGE';
		}
		if ( in_array( $slot, $olb_slots, true ) ) {
			return ( '3-4' === $scheme ) ? 'EDGE' : 'LB';
		}
		if ( in_array( $slot, $ilb_slots, true ) ) {
			return 'LB';
		}
		if ( in_array( $slot, $cb_slots, true ) ) {
			return 'CB';
		}
		if ( in_array( $slot, $s_slots, true ) ) {
			return 'S';
		}

		switch ( $parent ) {
			case 'DE':
				return ( '3-4' === $scheme ) ? 'DL' : 'EDGE';
			case 'DT':
				return 'DL';
			case 'LB':
				return 'LB';
			case 'CB':
			case 'DB':
				return 'CB';
			case 'S':
				return 'S';
		}
		return null;
	}

	/**
	 * Detect base defensive front from ESPN formation names. Defaults to 4-3.
	 *
	 * @param array $names Formation names.
	 * @return string
	 */
	private static function detect_scheme( $names ) {
		foreach ( $names as $name ) {
			if ( false !== strpos( $name, '3-4' ) ) {
				return '3-4';
			}
			if ( false !== strpos( $name, '4-3' ) ) {
				return '4-3';
			}
		}
		return '4-3';
	}

	/**
	 * Merge per-slot ranked lists into one ranked column (starters first), de-duped.
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
				$p['rank']    = count( $out ) + 1;
				$out[]        = $p;
			}
		}
		return $out;
	}

	/**
	 * Last word of a team name (e.g. "Arizona Cardinals" -> "Cardinals").
	 *
	 * @param string $team_name Full team name.
	 * @return string
	 */
	private static function nickname( $team_name ) {
		$parts = preg_split( '/\s+/', trim( $team_name ) );
		return ! empty( $parts ) ? end( $parts ) : $team_name;
	}

	/**
	 * ESPN player headshot CDN. The numeric athlete id maps directly to a
	 * full-size headshot; non-numeric ids (e.g. Footballguys' "BrisJa00") aren't
	 * ESPN athletes and have no headshot here.
	 *
	 * @param string|null $id ESPN athlete id.
	 * @return string|null
	 */
	public static function espn_headshot_url( $id ) {
		if ( null === $id || '' === $id || ! ctype_digit( (string) $id ) ) {
			return null;
		}
		return 'https://a.espncdn.com/i/headshots/nfl/players/full/' . $id . '.png';
	}
}

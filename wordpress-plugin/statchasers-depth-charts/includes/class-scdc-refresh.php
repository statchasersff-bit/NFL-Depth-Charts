<?php
/**
 * Refresh orchestrator — blends the three sources, exactly like the StatChasers app:
 *
 *   1. ESPN          — baseline for every column (fallback if others fail).
 *   2. Footballguys  — overrides the Offense / Defense / Special-Teams columns.
 *   3. FantasyPros   — fills the Fantasy tab's dedicated FAN_* columns (ECR order),
 *                      seeded from the canonical columns so the tab still renders
 *                      if FantasyPros is unavailable.
 *
 * Movement (↑/↓/NEW) is diffed against the previous cached snapshot.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Refresh {

	/**
	 * Run a full blended refresh.
	 *
	 * @param array|null $previous Previous decoded payload (for movement diffing).
	 * @return array{payload:array,teams_ok:int,teams_failed:array,status:string,error:string}
	 */
	public static function run( $previous = null ) {
		$prev_positions = self::index_previous_positions( $previous );

		// Footballguys: one fetch for all 32 teams (null on failure -> ESPN stands).
		$footballguys = SCDC_Footballguys::fetch_all();

		$teams_out    = array();
		$teams_failed = array();
		$season       = (int) gmdate( 'Y' );

		foreach ( SCDC_Espn::teams() as $team ) {
			$abbr = $team['abbr'];
			$name = $team['name'];

			$normalized = SCDC_Espn::fetch_team( $abbr, $name, $team['slug'] );
			if ( null === $normalized ) {
				$teams_failed[] = $abbr;
				continue;
			}
			if ( ! empty( $normalized['season'] ) ) {
				$season = (int) $normalized['season'];
			}

			$positions = $normalized['positions'];

			// ESPN is the only source with headshots (built from its numeric athlete
			// ids). Capture them by name now, before the merges below replace players
			// with Footballguys / FantasyPros rows that carry no headshot.
			$espn_headshots = self::collect_headshots_by_name( $positions );

			// 2. Footballguys overrides Offense / Defense / Special columns.
			$fbg_team = ( $footballguys && isset( $footballguys[ $abbr ] ) ) ? $footballguys[ $abbr ] : null;
			SCDC_Footballguys::merge( $positions, $fbg_team );

			// 3. Fantasy tab: seed FAN_* from canonical, then overlay FantasyPros.
			SCDC_FantasyPros::seed_fantasy_columns( $positions );
			$fp_team = SCDC_FantasyPros::fetch_team( $name );
			SCDC_FantasyPros::merge( $positions, $fp_team );

			// Restore ESPN headshots onto the merged rows by matching player name.
			self::apply_headshots_by_name( $positions, $espn_headshots );

			// Movement vs the previous snapshot (blended positions, incl. FAN_*).
			$prev = isset( $prev_positions[ $abbr ] ) ? $prev_positions[ $abbr ] : null;
			self::apply_movement( $positions, $prev );

			$teams_out[] = array(
				'team'      => $normalized['team'],
				'positions' => $positions,
			);
		}

		$ok = count( $teams_out );

		if ( 0 === $ok ) {
			$status = 'error';
			$error  = __( 'No teams could be fetched. Please try again.', 'statchasers-depth-charts' );
		} elseif ( ! empty( $teams_failed ) ) {
			$status = 'partial';
			/* translators: %s: comma-separated team abbreviations. */
			$error = sprintf( __( 'Some teams failed to refresh: %s', 'statchasers-depth-charts' ), implode( ', ', $teams_failed ) );
		} else {
			$status = 'success';
			$error  = '';
		}

		$payload = array(
			'version'   => 1,
			'season'    => $season,
			'fetchedAt' => gmdate( 'c' ),
			'teams'     => $teams_out,
		);

		return array(
			'payload'      => $payload,
			'teams_ok'     => $ok,
			'teams_failed' => $teams_failed,
			'status'       => $status,
			'error'        => $error,
		);
	}

	/**
	 * Index a previous payload as abbr => positions for movement diffing.
	 *
	 * @param array|null $previous Decoded prior payload.
	 * @return array
	 */
	private static function index_previous_positions( $previous ) {
		$index = array();
		if ( ! is_array( $previous ) || empty( $previous['teams'] ) ) {
			return $index;
		}
		foreach ( $previous['teams'] as $team ) {
			if ( isset( $team['team']['abbr'], $team['positions'] ) ) {
				$index[ $team['team']['abbr'] ] = $team['positions'];
			}
		}
		return $index;
	}

	/**
	 * Annotate each player's `movement` (up/down/new/null) vs the prior snapshot.
	 * Mutates $positions in place.
	 *
	 * @param array      $positions Current positions matrix (by reference).
	 * @param array|null $previous  Prior positions matrix for the same team.
	 * @return void
	 */
	private static function apply_movement( &$positions, $previous ) {
		foreach ( $positions as $pos_key => &$players ) {
			$prev_players = ( is_array( $previous ) && isset( $previous[ $pos_key ] ) ) ? $previous[ $pos_key ] : array();
			$prev_rank    = array();
			foreach ( $prev_players as $pp ) {
				$k               = ! empty( $pp['id'] ) ? $pp['id'] : strtolower( $pp['name'] );
				$prev_rank[ $k ] = (int) $pp['rank'];
			}
			foreach ( $players as &$player ) {
				if ( 'DEF' === $pos_key ) {
					$player['movement'] = null;
					continue;
				}
				$k        = ! empty( $player['id'] ) ? $player['id'] : strtolower( $player['name'] );
				$movement = null;
				if ( ! array_key_exists( $k, $prev_rank ) ) {
					$movement = ! empty( $prev_players ) ? 'new' : null;
				} elseif ( (int) $player['rank'] < $prev_rank[ $k ] ) {
					$movement = 'up';
				} elseif ( (int) $player['rank'] > $prev_rank[ $k ] ) {
					$movement = 'down';
				}
				$player['movement'] = $movement;
			}
			unset( $player );
		}
		unset( $players );
	}

	/**
	 * Normalize a player name for cross-source matching: lowercase, drop periods
	 * and generational suffixes, collapse whitespace. "T.J. Sanders" and "Michael
	 * Pittman Jr." both reduce to a stable key.
	 *
	 * @param string $name Player name.
	 * @return string
	 */
	private static function normalize_name_key( $name ) {
		$name  = strtolower( (string) $name );
		$name  = str_replace( array( '.', "'" ), '', $name );
		$name  = preg_replace( '/[^a-z0-9]+/', ' ', $name );
		$words = preg_split( '/\s+/', trim( $name ) );
		$suffixes = array( 'jr', 'sr', 'ii', 'iii', 'iv', 'v' );
		while ( count( $words ) > 1 && in_array( end( $words ), $suffixes, true ) ) {
			array_pop( $words );
		}
		return implode( ' ', $words );
	}

	/**
	 * Index a positions matrix's headshots by normalized name (ESPN populates
	 * these before the Footballguys / FantasyPros merges overwrite players).
	 *
	 * @param array $positions Positions matrix.
	 * @return array<string,string> name key => headshot URL
	 */
	private static function collect_headshots_by_name( $positions ) {
		$map = array();
		foreach ( $positions as $players ) {
			if ( ! is_array( $players ) ) {
				continue;
			}
			foreach ( $players as $p ) {
				if ( ! empty( $p['headshot'] ) && ! empty( $p['name'] ) ) {
					$key = self::normalize_name_key( $p['name'] );
					if ( ! isset( $map[ $key ] ) ) {
						$map[ $key ] = $p['headshot'];
					}
				}
			}
		}
		return $map;
	}

	/**
	 * Backfill headshots onto every player (in place) by normalized-name lookup,
	 * so merged-in Footballguys / FantasyPros rows recover the ESPN headshot. Only
	 * fills gaps — never clobbers a headshot the row already carries.
	 *
	 * @param array $positions Positions matrix (by reference).
	 * @param array $by_name   name key => headshot URL.
	 * @return void
	 */
	private static function apply_headshots_by_name( &$positions, $by_name ) {
		foreach ( $positions as &$players ) {
			if ( ! is_array( $players ) ) {
				continue;
			}
			foreach ( $players as &$p ) {
				if ( empty( $p['headshot'] ) && ! empty( $p['name'] ) ) {
					$key = self::normalize_name_key( $p['name'] );
					if ( isset( $by_name[ $key ] ) ) {
						$p['headshot'] = $by_name[ $key ];
					}
				}
			}
			unset( $p );
		}
		unset( $players );
	}
}

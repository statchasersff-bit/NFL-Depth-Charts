<?php
/**
 * Single source of truth for the 32 NFL teams and the current season.
 *
 * Everything team-related (route validation, SEO titles/descriptions, canonical
 * URLs, H1 text, breadcrumbs, internal links, tool initialization and the XML
 * sitemap) reads from this class, so a team rename or a season roll-over is a
 * one-place edit.
 *
 * Season: NFL season naming does not roll over on January 1, so the value is a
 * configurable constant (override with `define( 'SCDC_SEASON', 2027 )` in
 * wp-config.php, or with the `scdc_season` filter) rather than date( 'Y' ).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Teams {

	/** Fallback season, used when SCDC_SEASON is not defined. */
	const DEFAULT_SEASON = 2026;

	/** @var array<string,array>|null Lazily built slug => team map. */
	private static $teams = null;

	/** @var array<string,string>|null Lazily built abbr => slug map. */
	private static $by_abbr = null;

	/**
	 * All 32 teams, keyed by URL slug.
	 *
	 * Fields: name (full), city, nickname, slug, abbr (matches the cached JSON's
	 * team.abbr), espn (logo/source slug), conference, division.
	 *
	 * @return array<string,array{name:string,city:string,nickname:string,slug:string,abbr:string,espn:string,conference:string,division:string}>
	 */
	public static function all() {
		if ( null !== self::$teams ) {
			return self::$teams;
		}

		$rows = array(
			// slug,                    city,             nickname,      abbr,  espn,  conf, div.
			array( 'arizona-cardinals',    'Arizona',       'Cardinals',   'ARI', 'ari', 'NFC', 'West' ),
			array( 'atlanta-falcons',      'Atlanta',       'Falcons',     'ATL', 'atl', 'NFC', 'South' ),
			array( 'baltimore-ravens',     'Baltimore',     'Ravens',      'BAL', 'bal', 'AFC', 'North' ),
			array( 'buffalo-bills',        'Buffalo',       'Bills',       'BUF', 'buf', 'AFC', 'East' ),
			array( 'carolina-panthers',    'Carolina',      'Panthers',    'CAR', 'car', 'NFC', 'South' ),
			array( 'chicago-bears',        'Chicago',       'Bears',       'CHI', 'chi', 'NFC', 'North' ),
			array( 'cincinnati-bengals',   'Cincinnati',    'Bengals',     'CIN', 'cin', 'AFC', 'North' ),
			array( 'cleveland-browns',     'Cleveland',     'Browns',      'CLE', 'cle', 'AFC', 'North' ),
			array( 'dallas-cowboys',       'Dallas',        'Cowboys',     'DAL', 'dal', 'NFC', 'East' ),
			array( 'denver-broncos',       'Denver',        'Broncos',     'DEN', 'den', 'AFC', 'West' ),
			array( 'detroit-lions',        'Detroit',       'Lions',       'DET', 'det', 'NFC', 'North' ),
			array( 'green-bay-packers',    'Green Bay',     'Packers',     'GB',  'gb',  'NFC', 'North' ),
			array( 'houston-texans',       'Houston',       'Texans',      'HOU', 'hou', 'AFC', 'South' ),
			array( 'indianapolis-colts',   'Indianapolis',  'Colts',       'IND', 'ind', 'AFC', 'South' ),
			array( 'jacksonville-jaguars', 'Jacksonville',  'Jaguars',     'JAX', 'jax', 'AFC', 'South' ),
			array( 'kansas-city-chiefs',   'Kansas City',   'Chiefs',      'KC',  'kc',  'AFC', 'West' ),
			array( 'las-vegas-raiders',    'Las Vegas',     'Raiders',     'LV',  'lv',  'AFC', 'West' ),
			array( 'los-angeles-chargers', 'Los Angeles',   'Chargers',    'LAC', 'lac', 'AFC', 'West' ),
			array( 'los-angeles-rams',     'Los Angeles',   'Rams',        'LAR', 'lar', 'NFC', 'West' ),
			array( 'miami-dolphins',       'Miami',         'Dolphins',    'MIA', 'mia', 'AFC', 'East' ),
			array( 'minnesota-vikings',    'Minnesota',     'Vikings',     'MIN', 'min', 'NFC', 'North' ),
			array( 'new-england-patriots', 'New England',   'Patriots',    'NE',  'ne',  'AFC', 'East' ),
			array( 'new-orleans-saints',   'New Orleans',   'Saints',      'NO',  'no',  'NFC', 'South' ),
			array( 'new-york-giants',      'New York',      'Giants',      'NYG', 'nyg', 'NFC', 'East' ),
			array( 'new-york-jets',        'New York',      'Jets',        'NYJ', 'nyj', 'AFC', 'East' ),
			array( 'philadelphia-eagles',  'Philadelphia',  'Eagles',      'PHI', 'phi', 'NFC', 'East' ),
			array( 'pittsburgh-steelers',  'Pittsburgh',    'Steelers',    'PIT', 'pit', 'AFC', 'North' ),
			array( 'san-francisco-49ers',  'San Francisco', '49ers',       'SF',  'sf',  'NFC', 'West' ),
			array( 'seattle-seahawks',     'Seattle',       'Seahawks',    'SEA', 'sea', 'NFC', 'West' ),
			array( 'tampa-bay-buccaneers', 'Tampa Bay',     'Buccaneers',  'TB',  'tb',  'NFC', 'South' ),
			array( 'tennessee-titans',     'Tennessee',     'Titans',      'TEN', 'ten', 'AFC', 'South' ),
			array( 'washington-commanders', 'Washington',   'Commanders',  'WAS', 'wsh', 'NFC', 'East' ),
		);

		$teams = array();
		foreach ( $rows as $row ) {
			list( $slug, $city, $nickname, $abbr, $espn, $conference, $division ) = $row;
			$teams[ $slug ] = array(
				'name'       => $city . ' ' . $nickname,
				'city'       => $city,
				'nickname'   => $nickname,
				'slug'       => $slug,
				'abbr'       => $abbr,
				'espn'       => $espn,
				'conference' => $conference,
				'division'   => $division,
			);
		}

		self::$teams = $teams;
		return self::$teams;
	}

	/**
	 * Look up a team by URL slug.
	 *
	 * @param string $slug Candidate slug (e.g. "houston-texans").
	 * @return array|null Team row, or null when the slug is not one of the 32.
	 */
	public static function get( $slug ) {
		$slug  = strtolower( trim( (string) $slug, "/ \t\n\r\0\x0B" ) );
		$teams = self::all();
		return isset( $teams[ $slug ] ) ? $teams[ $slug ] : null;
	}

	/**
	 * Look up a team by the abbreviation used in the cached JSON (e.g. "HOU").
	 *
	 * @param string $abbr Team abbreviation.
	 * @return array|null
	 */
	public static function get_by_abbr( $abbr ) {
		if ( null === self::$by_abbr ) {
			self::$by_abbr = array();
			foreach ( self::all() as $slug => $team ) {
				self::$by_abbr[ $team['abbr'] ] = $slug;
			}
		}
		$abbr = strtoupper( trim( (string) $abbr ) );
		return isset( self::$by_abbr[ $abbr ] ) ? self::get( self::$by_abbr[ $abbr ] ) : null;
	}

	/**
	 * Whether a slug is one of the 32 recognized teams.
	 *
	 * @param string $slug Candidate slug.
	 * @return bool
	 */
	public static function is_valid( $slug ) {
		return null !== self::get( $slug );
	}

	/**
	 * The NFL season these pages describe. Configure once, use everywhere.
	 *
	 * @return int
	 */
	public static function season() {
		$season = defined( 'SCDC_SEASON' ) ? (int) SCDC_SEASON : self::DEFAULT_SEASON;
		return (int) apply_filters( 'scdc_season', $season );
	}

	/**
	 * Valid view slugs => labels (mirrors the TABS map in assets/js/frontend.js).
	 *
	 * @return array<string,string>
	 */
	public static function views() {
		return array(
			'fantasy'       => __( 'Fantasy', 'statchasers-depth-charts' ),
			'offense'       => __( 'Offense', 'statchasers-depth-charts' ),
			'defense'       => __( 'Defense', 'statchasers-depth-charts' ),
			'special-teams' => __( 'Special Teams', 'statchasers-depth-charts' ),
		);
	}

	/**
	 * Valid position slugs for a view (mirrors the TABS columns in frontend.js).
	 *
	 * @param string $view View slug.
	 * @return string[]
	 */
	public static function positions( $view ) {
		$map = array(
			'fantasy'       => array( 'qb', 'rb', 'wr', 'te', 'k' ),
			'offense'       => array( 'qb', 'rb', 'wr', 'te', 'lt', 'lg', 'c', 'rg', 'rt' ),
			'defense'       => array( 'edge', 'dl', 'lb', 'cb', 's' ),
			'special-teams' => array( 'k', 'p', 'ls', 'kr', 'pr' ),
		);
		return isset( $map[ $view ] ) ? $map[ $view ] : array();
	}
}

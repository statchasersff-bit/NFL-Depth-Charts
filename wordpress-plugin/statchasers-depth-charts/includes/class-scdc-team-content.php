<?php
/**
 * Server-rendered, indexable content for the team routes.
 *
 * Everything here is emitted in the initial HTTP response (no JavaScript
 * required): the team H1, a short introduction, a factual "at a glance" summary
 * built from the *already cached* depth-chart JSON, breadcrumbs, and the
 * crawlable all-32-teams link grid.
 *
 * The summary re-uses the same cache file the tool renders from — no extra HTTP
 * calls, no second data pipeline — and is memoized in a transient keyed by team
 * + last-refresh timestamp, so a refresh invalidates it automatically and stale
 * player names are never pinned in PHP.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Team_Content {

	/** Cached per-team summaries expire with the data, and at worst after this. */
	const SUMMARY_TTL = DAY_IN_SECONDS;

	/**
	 * Team heading, rendered as the page H1 when the theme has no title to rename.
	 *
	 * @param array $team Team row.
	 * @return string
	 */
	public static function heading( $team ) {
		if ( ! SCDC_SEO::tool_should_render_h1() ) {
			return '';
		}
		return '<h1 class="scdc-seo-h1" data-scdc-h1="tool">' . esc_html( SCDC_SEO::heading( $team ) ) . '</h1>';
	}

	/**
	 * Short team-specific introduction shown directly above the tool.
	 *
	 * @param array $team Team row.
	 * @return string
	 */
	public static function intro( $team ) {
		return '<p class="scdc-seo-intro" data-scdc-intro>' . esc_html( SCDC_SEO::intro( $team ) ) . '</p>';
	}

	/**
	 * Pull this team's top-of-depth-chart players out of the cached JSON.
	 *
	 * @param array $team Team row.
	 * @return array{qb:string,rb:string[],wr:string[],te:string[],updated:int}|null
	 */
	public static function summary_data( $team ) {
		$meta    = SCDC_Store::get_meta();
		$stamp   = isset( $meta['last_refreshed_ts'] ) ? (int) $meta['last_refreshed_ts'] : 0;
		$cache_key = 'scdc_sum_' . strtolower( $team['abbr'] ) . '_' . $stamp;

		$cached = get_transient( $cache_key );
		if ( is_array( $cached ) ) {
			return $cached;
		}
		if ( 'miss' === $cached ) {
			return null;
		}

		$data = SCDC_Store::read();
		if ( ! is_array( $data ) || empty( $data['teams'] ) ) {
			set_transient( $cache_key, 'miss', HOUR_IN_SECONDS );
			return null;
		}

		$positions = null;
		foreach ( $data['teams'] as $row ) {
			if ( isset( $row['team']['abbr'] ) && $row['team']['abbr'] === $team['abbr'] ) {
				$positions = isset( $row['positions'] ) ? $row['positions'] : array();
				break;
			}
		}
		if ( null === $positions ) {
			set_transient( $cache_key, 'miss', HOUR_IN_SECONDS );
			return null;
		}

		$summary = array(
			'qb'      => self::top_names( $positions, array( 'FAN_QB', 'QB' ), 1 ),
			'rb'      => self::top_names( $positions, array( 'FAN_RB', 'RB' ), 3 ),
			'wr'      => self::top_names( $positions, array( 'FAN_WR', 'WR' ), 3 ),
			'te'      => self::top_names( $positions, array( 'FAN_TE', 'TE' ), 2 ),
			'updated' => $stamp,
		);

		if ( empty( $summary['qb'] ) && empty( $summary['rb'] ) ) {
			set_transient( $cache_key, 'miss', HOUR_IN_SECONDS );
			return null;
		}

		set_transient( $cache_key, $summary, self::SUMMARY_TTL );
		return $summary;
	}

	/**
	 * First N player names from the first populated key, in depth order.
	 *
	 * @param array    $positions Positions matrix for one team.
	 * @param string[] $keys      Keys to try, in preference order.
	 * @param int      $limit     How many names to keep.
	 * @return string[]
	 */
	private static function top_names( $positions, $keys, $limit ) {
		foreach ( $keys as $key ) {
			if ( empty( $positions[ $key ] ) || ! is_array( $positions[ $key ] ) ) {
				continue;
			}
			$names = array();
			foreach ( $positions[ $key ] as $player ) {
				if ( empty( $player['name'] ) ) {
					continue;
				}
				$names[] = (string) $player['name'];
				if ( count( $names ) >= $limit ) {
					break;
				}
			}
			if ( ! empty( $names ) ) {
				return $names;
			}
		}
		return array();
	}

	/**
	 * Position labels used by the "at a glance" summary. Shared with the front end
	 * so an in-page team switch re-renders the block with identical wording.
	 *
	 * @return array<string,string>
	 */
	public static function summary_labels() {
		return array(
			'QB' => __( 'Quarterback', 'statchasers-depth-charts' ),
			'RB' => __( 'Running backs', 'statchasers-depth-charts' ),
			'WR' => __( 'Wide receivers', 'statchasers-depth-charts' ),
			'TE' => __( 'Tight ends', 'statchasers-depth-charts' ),
		);
	}

	/**
	 * Heading of the summary block. Pass placeholders to get the JS template.
	 *
	 * @param string $team_name Team name (or a placeholder such as "{team}").
	 * @return string
	 */
	public static function summary_title( $team_name ) {
		return sprintf(
			/* translators: 1: team name, 2: season year. */
			__( '%1$s depth chart at a glance (%2$d)', 'statchasers-depth-charts' ),
			$team_name,
			SCDC_Teams::season()
		);
	}

	/**
	 * The factual lead sentence. Built only from names we actually have; pass
	 * placeholders ("{team}", "{qb}", "{rb}", "{city}") to get the JS template.
	 *
	 * @param string $team_name Team name.
	 * @param string $qb        Starting quarterback (may be '').
	 * @param string $rb        Lead running back (may be '').
	 * @param string $city      Team city.
	 * @return string
	 */
	public static function lead_sentence( $team_name, $qb, $rb, $city ) {
		if ( '' === $qb ) {
			return '';
		}
		if ( '' === $rb ) {
			return sprintf(
				/* translators: 1: team name, 2: quarterback. */
				__( 'The %1$s depth chart currently features %2$s at quarterback. Use the full depth chart below to view starters, backups, handcuffs, and positional competition.', 'statchasers-depth-charts' ),
				$team_name,
				$qb
			);
		}
		return sprintf(
			/* translators: 1: team name, 2: quarterback, 3: running back, 4: city. */
			__( 'The %1$s depth chart currently features %2$s at quarterback, with %3$s leading the backfield. Use the full depth chart below to view %4$s starters, backups, handcuffs, and positional competition.', 'statchasers-depth-charts' ),
			$team_name,
			$qb,
			$rb,
			$city
		);
	}

	/**
	 * Factual one-liner + per-position list built from the cached data. Returns an
	 * empty string when no reliable data exists (nothing is ever invented).
	 *
	 * @param array $team Team row.
	 * @return string
	 */
	public static function summary( $team ) {
		$summary = self::summary_data( $team );
		if ( ! $summary ) {
			return '';
		}

		$qb       = ! empty( $summary['qb'] ) ? $summary['qb'][0] : '';
		$rb       = ! empty( $summary['rb'] ) ? $summary['rb'][0] : '';
		$sentence = self::lead_sentence( $team['name'], $qb, $rb, $team['city'] );
		$labels   = self::summary_labels();

		$groups = array(
			'QB' => array( $labels['QB'], $summary['qb'] ),
			'RB' => array( $labels['RB'], $summary['rb'] ),
			'WR' => array( $labels['WR'], $summary['wr'] ),
			'TE' => array( $labels['TE'], $summary['te'] ),
		);

		ob_start();
		?>
		<section class="scdc-seo-summary" data-scdc-summary>
			<h2 class="scdc-seo-summary-title"><?php echo esc_html( self::summary_title( $team['name'] ) ); ?></h2>
			<?php if ( '' !== $sentence ) : ?>
				<p class="scdc-seo-summary-lead"><?php echo esc_html( $sentence ); ?></p>
			<?php endif; ?>
			<ul class="scdc-seo-summary-list">
				<?php foreach ( $groups as $abbr => $group ) : ?>
					<?php
					list( $label, $names ) = $group;
					if ( empty( $names ) ) {
						continue;
					}
					?>
					<li>
						<span class="scdc-seo-summary-pos"><?php echo esc_html( $label ); ?></span>
						<span class="scdc-seo-summary-players"><?php echo esc_html( implode( ', ', $names ) ); ?></span>
					</li>
				<?php endforeach; ?>
			</ul>
			<?php if ( ! empty( $summary['updated'] ) ) : ?>
				<p class="scdc-seo-summary-meta">
					<?php
					printf(
						/* translators: %s: formatted date/time of the last data refresh. */
						esc_html__( 'Depth chart data last updated %s.', 'statchasers-depth-charts' ),
						esc_html( wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), (int) $summary['updated'] ) )
					);
					?>
				</p>
			<?php endif; ?>
		</section>
		<?php
		return (string) ob_get_clean();
	}

	/**
	 * Crawlable links to all 32 team routes. Real anchors with real hrefs — the
	 * SPA intercepts the clicks, but Googlebot (and a middle-click) sees URLs.
	 *
	 * @param string $current_slug Slug of the team currently being viewed, if any.
	 * @return string
	 */
	public static function team_links( $current_slug = '' ) {
		$teams = SCDC_Teams::all();

		$title = '' === $current_slug
			? __( 'NFL Depth Charts by Team', 'statchasers-depth-charts' )
			: __( 'All NFL Team Depth Charts', 'statchasers-depth-charts' );

		ob_start();
		?>
		<nav class="scdc-seo-links" aria-labelledby="scdc-seo-links-title">
			<h2 class="scdc-seo-links-title" id="scdc-seo-links-title"><?php echo esc_html( $title ); ?></h2>
			<ul class="scdc-seo-links-grid">
				<?php foreach ( $teams as $slug => $team ) : ?>
					<li>
						<a
							class="scdc-seo-link<?php echo $slug === $current_slug ? ' is-current' : ''; ?>"
							href="<?php echo esc_url( SCDC_Route::team_url( $slug ) ); ?>"
							data-scdc-team-link="<?php echo esc_attr( $team['abbr'] ); ?>"
							data-scdc-team-slug="<?php echo esc_attr( $slug ); ?>"
							<?php echo $slug === $current_slug ? ' aria-current="page"' : ''; ?>
						><?php
							printf(
								/* translators: %s: team name. */
								esc_html__( '%s Depth Chart', 'statchasers-depth-charts' ),
								esc_html( $team['name'] )
							);
						?></a>
					</li>
				<?php endforeach; ?>
			</ul>
		</nav>
		<?php
		return (string) ob_get_clean();
	}

	/**
	 * Whether we should print our own visible breadcrumbs.
	 *
	 * Rank Math's own breadcrumbs (which we already filter) win when they're
	 * enabled, so the two can never disagree or double up.
	 *
	 * @return bool
	 */
	public static function should_render_breadcrumbs() {
		$default = true;
		if ( class_exists( '\RankMath\Helper' ) && method_exists( '\RankMath\Helper', 'get_settings' ) ) {
			$enabled = \RankMath\Helper::get_settings( 'general.breadcrumbs' );
			$default = ! $enabled;
		}
		return (bool) apply_filters( 'scdc_render_breadcrumbs', $default );
	}

	/**
	 * Visible breadcrumb trail: Home › NFL › NFL Depth Charts › Houston Texans
	 * Depth Chart. BreadcrumbList schema is added only when no SEO plugin is
	 * emitting one, so the graph is never duplicated.
	 *
	 * @param array $team Team row.
	 * @return string
	 */
	public static function breadcrumbs( $team ) {
		if ( ! self::should_render_breadcrumbs() ) {
			return '';
		}

		$items = self::breadcrumb_items( $team );

		ob_start();
		?>
		<nav class="scdc-breadcrumbs" aria-label="<?php esc_attr_e( 'Breadcrumb', 'statchasers-depth-charts' ); ?>">
			<ol class="scdc-breadcrumb-list">
				<?php foreach ( $items as $index => $item ) : ?>
					<li class="scdc-breadcrumb-item">
						<?php if ( $index < count( $items ) - 1 && '' !== $item['url'] ) : ?>
							<a href="<?php echo esc_url( $item['url'] ); ?>"><?php echo esc_html( $item['label'] ); ?></a>
							<span class="scdc-breadcrumb-sep" aria-hidden="true">›</span>
						<?php else : ?>
							<span aria-current="page"><?php echo esc_html( $item['label'] ); ?></span>
						<?php endif; ?>
					</li>
				<?php endforeach; ?>
			</ol>
		</nav>
		<?php
		if ( ! SCDC_SEO::rank_math_active() ) {
			$list = array();
			foreach ( $items as $index => $item ) {
				$entry = array(
					'@type'    => 'ListItem',
					'position' => $index + 1,
					'name'     => $item['label'],
				);
				if ( '' !== $item['url'] ) {
					$entry['item'] = $item['url'];
				}
				$list[] = $entry;
			}
			printf(
				'<script type="application/ld+json">%s</script>',
				wp_json_encode(
					array(
						'@context'        => 'https://schema.org',
						'@type'           => 'BreadcrumbList',
						'itemListElement' => $list,
					)
				)
			);
		}
		return (string) ob_get_clean();
	}

	/**
	 * Breadcrumb trail data (also the source for the visible trail's schema).
	 *
	 * @param array $team Team row.
	 * @return array<int,array{label:string,url:string}>
	 */
	public static function breadcrumb_items( $team ) {
		$items = array(
			array(
				'label' => __( 'Home', 'statchasers-depth-charts' ),
				'url'   => home_url( '/' ),
			),
		);

		$nfl_id = SCDC_Pages::nfl_page_id();
		if ( $nfl_id ) {
			$items[] = array(
				'label' => get_the_title( $nfl_id ),
				'url'   => trailingslashit( get_permalink( $nfl_id ) ),
			);
		}

		$items[] = array(
			'label' => SCDC_SEO::original_page_title(),
			'url'   => SCDC_Route::main_url(),
		);
		$items[] = array(
			'label' => SCDC_SEO::heading( $team ),
			'url'   => SCDC_Route::team_url( $team['slug'] ),
		);

		return apply_filters( 'scdc_breadcrumb_items', $items, $team );
	}
}

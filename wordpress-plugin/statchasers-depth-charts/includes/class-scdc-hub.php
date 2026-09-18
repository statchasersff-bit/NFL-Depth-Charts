<?php
/**
 * [statchasers_nfl_hub] — the /nfl/ hub page.
 *
 * Renders a hero, a short explanation, tool cards (with NFL Depth Charts
 * featured), popular depth-chart view links, the latest NFL/fantasy articles,
 * and internal links to the other NFL pages. Tool/link/view sets are filterable.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Hub {

	const HANDLE = 'scdc-hub';

	/** @var SCDC_Hub|null */
	private static $instance = null;

	/**
	 * @return SCDC_Hub
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
		add_shortcode( 'statchasers_nfl_hub', array( $this, 'render' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'register_assets' ) );
	}

	/**
	 * @return void
	 */
	public function register_assets() {
		wp_register_style(
			self::HANDLE,
			SCDC_PLUGIN_URL . 'assets/css/hub.css',
			array(),
			SCDC_VERSION
		);
	}

	/**
	 * Base URL for an NFL sub-page (e.g. /nfl/rankings/). Built relative to the
	 * NFL hub permalink so it works regardless of where the hub lives.
	 *
	 * @param string $slug Sub-page slug.
	 * @return string
	 */
	private function nfl_url( $slug ) {
		$id   = SCDC_Pages::nfl_page_id();
		$base = $id ? get_permalink( $id ) : home_url( '/nfl/' );
		return trailingslashit( trailingslashit( $base ) . $slug );
	}

	/**
	 * Tool cards. The first (featured) is NFL Depth Charts. Filterable via
	 * `scdc_nfl_tools`.
	 *
	 * @return array
	 */
	private function tools() {
		$dc = SCDC_Pages::depth_charts_url();

		$tools = array(
			array(
				'title'    => __( 'NFL Depth Charts', 'statchasers-depth-charts' ),
				'desc'     => __( 'Live depth charts for all 32 teams — Fantasy, Offense, Defense, and Special Teams views with search and filters.', 'statchasers-depth-charts' ),
				'url'      => $dc,
				'cta'      => __( 'Open Depth Charts', 'statchasers-depth-charts' ),
				'featured' => true,
			),
			array(
				'title' => __( 'Rankings', 'statchasers-depth-charts' ),
				'desc'  => __( 'Weekly and rest-of-season positional rankings.', 'statchasers-depth-charts' ),
				'url'   => $this->nfl_url( 'rankings' ),
			),
			array(
				'title' => __( 'Waiver Wire', 'statchasers-depth-charts' ),
				'desc'  => __( 'Top pickups and streaming targets for the week.', 'statchasers-depth-charts' ),
				'url'   => $this->nfl_url( 'waiver-wire' ),
			),
			array(
				'title' => __( 'Injury Report', 'statchasers-depth-charts' ),
				'desc'  => __( 'Latest injury news and how it shifts the depth charts.', 'statchasers-depth-charts' ),
				'url'   => $this->nfl_url( 'injury-report' ),
			),
		);

		return apply_filters( 'scdc_nfl_tools', $tools );
	}

	/**
	 * Popular depth-chart views (label => relative path under the tool base).
	 * Filterable via `scdc_nfl_popular_views`.
	 *
	 * @return array
	 */
	private function popular_views() {
		$views = array(
			__( 'Fantasy — All Teams', 'statchasers-depth-charts' )    => 'fantasy/all-teams/',
			__( 'Fantasy RBs', 'statchasers-depth-charts' )            => 'fantasy/all-teams/rb/',
			__( 'Fantasy WRs', 'statchasers-depth-charts' )            => 'fantasy/all-teams/wr/',
			__( 'Offense — WRs', 'statchasers-depth-charts' )          => 'offense/all-teams/wr/',
			__( 'Defense — CBs', 'statchasers-depth-charts' )          => 'defense/all-teams/cb/',
		);
		return apply_filters( 'scdc_nfl_popular_views', $views );
	}

	/**
	 * Internal quick links (label => url). Filterable via `scdc_nfl_quick_links`.
	 *
	 * @return array
	 */
	private function quick_links() {
		$links = array(
			__( 'Rankings', 'statchasers-depth-charts' )      => $this->nfl_url( 'rankings' ),
			__( 'Waiver Wire', 'statchasers-depth-charts' )   => $this->nfl_url( 'waiver-wire' ),
			__( 'Injury Report', 'statchasers-depth-charts' ) => $this->nfl_url( 'injury-report' ),
			__( 'Start/Sit', 'statchasers-depth-charts' )     => $this->nfl_url( 'start-sit' ),
			__( 'Trade Value', 'statchasers-depth-charts' )   => $this->nfl_url( 'trade-value' ),
			__( 'NFL News', 'statchasers-depth-charts' )      => $this->nfl_url( 'news' ),
		);
		return apply_filters( 'scdc_nfl_quick_links', $links );
	}

	/**
	 * Recent NFL/fantasy posts. Prefers an "nfl" category if one exists; otherwise
	 * the latest posts. Returns an array of WP_Post.
	 *
	 * @return WP_Post[]
	 */
	private function latest_articles() {
		$count = (int) apply_filters( 'scdc_nfl_article_count', 4 );
		if ( $count < 1 ) {
			return array();
		}

		$args = array(
			'post_type'           => 'post',
			'post_status'         => 'publish',
			'posts_per_page'      => $count,
			'ignore_sticky_posts' => true,
			'no_found_rows'       => true,
		);

		$cat = get_category_by_slug( 'nfl' );
		if ( $cat && ! is_wp_error( $cat ) ) {
			$args['cat'] = (int) $cat->term_id;
		}

		$query = new WP_Query( $args );
		return $query->posts;
	}

	/**
	 * Render the hub.
	 *
	 * @param array $atts Shortcode attributes (unused).
	 * @return string
	 */
	public function render( $atts = array() ) {
		wp_enqueue_style( self::HANDLE );

		$dc_base  = SCDC_Pages::depth_charts_url();
		$tools    = $this->tools();
		$views    = $this->popular_views();
		$links    = $this->quick_links();
		$articles = $this->latest_articles();

		ob_start();
		?>
		<div class="scdc-hub">

			<section class="scdc-hub-hero">
				<h1 class="scdc-hub-title"><?php esc_html_e( 'StatChasers NFL', 'statchasers-depth-charts' ); ?></h1>
				<p class="scdc-hub-tagline"><?php esc_html_e( 'Depth charts, rankings, and fantasy football tools for all 32 teams — updated for the season.', 'statchasers-depth-charts' ); ?></p>
				<a class="scdc-hub-cta" href="<?php echo esc_url( $dc_base ); ?>"><?php esc_html_e( 'Explore NFL Depth Charts', 'statchasers-depth-charts' ); ?></a>
			</section>

			<section class="scdc-hub-intro">
				<p><?php esc_html_e( 'StatChasers gives you a fast, no-nonsense view of the NFL: live team depth charts for all 32 teams, plus the rankings and waiver tools you need to set your fantasy lineup. Start with the depth charts below, then dig into the rest of our NFL coverage.', 'statchasers-depth-charts' ); ?></p>
			</section>

			<section class="scdc-hub-section">
				<h2 class="scdc-hub-h2"><?php esc_html_e( 'NFL Tools', 'statchasers-depth-charts' ); ?></h2>
				<div class="scdc-hub-cards">
					<?php foreach ( $tools as $tool ) : ?>
						<?php
						$featured  = ! empty( $tool['featured'] );
						$card_cls  = 'scdc-hub-card' . ( $featured ? ' scdc-hub-card-featured' : '' );
						$cta_label = ! empty( $tool['cta'] ) ? $tool['cta'] : __( 'View', 'statchasers-depth-charts' );
						?>
						<a class="<?php echo esc_attr( $card_cls ); ?>" href="<?php echo esc_url( $tool['url'] ); ?>">
							<?php if ( $featured ) : ?>
								<span class="scdc-hub-badge"><?php esc_html_e( 'Featured', 'statchasers-depth-charts' ); ?></span>
							<?php endif; ?>
							<h3 class="scdc-hub-card-title"><?php echo esc_html( $tool['title'] ); ?></h3>
							<?php if ( ! empty( $tool['desc'] ) ) : ?>
								<p class="scdc-hub-card-desc"><?php echo esc_html( $tool['desc'] ); ?></p>
							<?php endif; ?>

							<?php if ( $featured && ! empty( $views ) ) : ?>
								<div class="scdc-hub-views">
									<span class="scdc-hub-views-label"><?php esc_html_e( 'Popular views:', 'statchasers-depth-charts' ); ?></span>
									<ul>
										<?php foreach ( $views as $label => $path ) : ?>
											<li>
												<a href="<?php echo esc_url( $dc_base . ltrim( $path, '/' ) ); ?>"><?php echo esc_html( $label ); ?></a>
											</li>
										<?php endforeach; ?>
									</ul>
								</div>
							<?php endif; ?>

							<span class="scdc-hub-card-cta"><?php echo esc_html( $cta_label ); ?> &rarr;</span>
						</a>
					<?php endforeach; ?>
				</div>
			</section>

			<?php if ( ! empty( $articles ) ) : ?>
			<section class="scdc-hub-section">
				<h2 class="scdc-hub-h2"><?php esc_html_e( 'Latest NFL &amp; Fantasy Articles', 'statchasers-depth-charts' ); ?></h2>
				<ul class="scdc-hub-articles">
					<?php foreach ( $articles as $post ) : ?>
						<li>
							<a href="<?php echo esc_url( get_permalink( $post ) ); ?>"><?php echo esc_html( get_the_title( $post ) ); ?></a>
							<span class="scdc-hub-article-date"><?php echo esc_html( get_the_date( '', $post ) ); ?></span>
						</li>
					<?php endforeach; ?>
				</ul>
			</section>
			<?php endif; ?>

			<section class="scdc-hub-section">
				<h2 class="scdc-hub-h2"><?php esc_html_e( 'More NFL Coverage', 'statchasers-depth-charts' ); ?></h2>
				<ul class="scdc-hub-links">
					<?php foreach ( $links as $label => $url ) : ?>
						<li><a href="<?php echo esc_url( $url ); ?>"><?php echo esc_html( $label ); ?></a></li>
					<?php endforeach; ?>
				</ul>
			</section>

		</div>
		<?php
		return (string) ob_get_clean();
	}
}

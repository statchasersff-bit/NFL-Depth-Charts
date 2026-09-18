<?php
/**
 * Admin menu page + manual refresh handler.
 *
 * Only users with `manage_options` can see the page or trigger a refresh, and the
 * refresh form is protected by a nonce.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class SCDC_Admin {

	const MENU_SLUG = 'statchasers-data-refresh';
	const NONCE     = 'scdc_refresh_nonce';
	const CAPABILITY = 'manage_options';

	/** @var SCDC_Admin|null */
	private static $instance = null;

	/**
	 * @return SCDC_Admin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Register admin hooks.
	 *
	 * @return void
	 */
	public function hooks() {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_post_' . SCDC_REFRESH_ACTION, array( $this, 'handle_refresh' ) );
		add_action( 'admin_notices', array( $this, 'maybe_render_notice' ) );
	}

	/**
	 * Add the "StatChasers Data Refresh" admin page.
	 *
	 * @return void
	 */
	public function register_menu() {
		add_menu_page(
			__( 'StatChasers Data Refresh', 'statchasers-depth-charts' ),
			__( 'StatChasers', 'statchasers-depth-charts' ),
			self::CAPABILITY,
			self::MENU_SLUG,
			array( $this, 'render_page' ),
			'dashicons-clipboard',
			58
		);
	}

	/**
	 * Render the admin page (status panel + refresh form).
	 *
	 * @return void
	 */
	public function render_page() {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'statchasers-depth-charts' ) );
		}

		$meta      = SCDC_Store::get_meta();
		$has_data  = SCDC_Store::has_data();
		$action_url = admin_url( 'admin-post.php' );

		$status_label = array(
			'never'   => __( 'Never refreshed', 'statchasers-depth-charts' ),
			'success' => __( 'Success', 'statchasers-depth-charts' ),
			'partial' => __( 'Partial — some teams failed', 'statchasers-depth-charts' ),
			'error'   => __( 'Error', 'statchasers-depth-charts' ),
		);
		$status      = isset( $meta['status'] ) ? $meta['status'] : 'never';
		$status_text = isset( $status_label[ $status ] ) ? $status_label[ $status ] : $status;

		$last_human = '';
		if ( ! empty( $meta['last_refreshed_ts'] ) ) {
			$last_human = wp_date(
				get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
				(int) $meta['last_refreshed_ts']
			);
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'StatChasers Data Refresh', 'statchasers-depth-charts' ); ?></h1>

			<p><?php esc_html_e( 'Pull the latest NFL depth charts and cache them locally. The Fantasy tab uses FantasyPros (ECR) order; Offense / Defense / Special Teams use Footballguys; ESPN is the fallback. The front-end shortcode reads only from this local cache, so visitors never hit those sites directly.', 'statchasers-depth-charts' ); ?></p>

			<table class="widefat striped" style="max-width:640px;margin:1rem 0;">
				<tbody>
					<tr>
						<th scope="row" style="width:200px;"><?php esc_html_e( 'Status', 'statchasers-depth-charts' ); ?></th>
						<td><strong><?php echo esc_html( $status_text ); ?></strong></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Last refreshed', 'statchasers-depth-charts' ); ?></th>
						<td><?php echo $last_human ? esc_html( $last_human ) : esc_html__( '—', 'statchasers-depth-charts' ); ?></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Teams cached', 'statchasers-depth-charts' ); ?></th>
						<td><?php echo esc_html( (string) intval( $meta['teams_ok'] ) ); ?> / 32</td>
					</tr>
					<?php if ( ! empty( $meta['error'] ) ) : ?>
					<tr>
						<th scope="row"><?php esc_html_e( 'Last error', 'statchasers-depth-charts' ); ?></th>
						<td><code><?php echo esc_html( $meta['error'] ); ?></code></td>
					</tr>
					<?php endif; ?>
					<tr>
						<th scope="row"><?php esc_html_e( 'Cache file', 'statchasers-depth-charts' ); ?></th>
						<td>
							<?php if ( $has_data ) : ?>
								<code>/wp-content/uploads/<?php echo esc_html( SCDC_Store::SUBDIR . '/' . SCDC_Store::FILENAME ); ?></code>
							<?php else : ?>
								<em><?php esc_html_e( 'Not created yet.', 'statchasers-depth-charts' ); ?></em>
							<?php endif; ?>
						</td>
					</tr>
				</tbody>
			</table>

			<form method="post" action="<?php echo esc_url( $action_url ); ?>">
				<input type="hidden" name="action" value="<?php echo esc_attr( SCDC_REFRESH_ACTION ); ?>" />
				<?php wp_nonce_field( SCDC_REFRESH_ACTION, self::NONCE ); ?>
				<?php
				submit_button(
					__( 'Refresh NFL Depth Charts', 'statchasers-depth-charts' ),
					'primary large',
					'scdc_refresh_submit',
					false
				);
				?>
				<p class="description" style="margin-top:.5rem;">
					<?php esc_html_e( 'This fetches all 32 teams and may take up to a minute.', 'statchasers-depth-charts' ); ?>
				</p>
			</form>

			<h2 style="margin-top:2rem;"><?php esc_html_e( 'Display on the site', 'statchasers-depth-charts' ); ?></h2>
			<p><?php esc_html_e( 'Add this shortcode to any page or post to render the depth charts:', 'statchasers-depth-charts' ); ?></p>
			<p><code>[statchasers_depth_charts]</code></p>

			<h2 style="margin-top:2rem;"><?php esc_html_e( 'NFL pages', 'statchasers-depth-charts' ); ?></h2>
			<?php $this->render_pages_status(); ?>
		</div>
		<?php
	}

	/**
	 * Render the NFL pages status (provisioned on activation) with edit/view links
	 * and a warning if the depth-charts page is missing the shortcode.
	 *
	 * @return void
	 */
	private function render_pages_status() {
		$nfl_id = SCDC_Pages::nfl_page_id();
		$dc_id  = SCDC_Pages::depth_charts_page_id();

		if ( ! $nfl_id && ! $dc_id ) {
			echo '<p>' . esc_html__( 'Pages have not been provisioned. Deactivate and reactivate the plugin to create the /nfl/ and /nfl/nfl-depth-charts/ pages.', 'statchasers-depth-charts' ) . '</p>';
			return;
		}

		echo '<ul style="margin:.5rem 0;">';
		$this->render_page_row( __( 'NFL hub', 'statchasers-depth-charts' ), $nfl_id, 'statchasers_nfl_hub' );
		$this->render_page_row( __( 'NFL Depth Charts', 'statchasers-depth-charts' ), $dc_id, 'statchasers_depth_charts' );
		echo '</ul>';
	}

	/**
	 * One page row: title, View/Edit links, and a missing-shortcode warning.
	 *
	 * @param string $label     Human label.
	 * @param int    $page_id   Page ID (0 if absent).
	 * @param string $shortcode Expected shortcode tag.
	 * @return void
	 */
	private function render_page_row( $label, $page_id, $shortcode ) {
		echo '<li style="margin-bottom:.4rem;">';
		echo '<strong>' . esc_html( $label ) . ':</strong> ';

		if ( ! $page_id || ! get_post( $page_id ) ) {
			echo '<em>' . esc_html__( 'not found', 'statchasers-depth-charts' ) . '</em>';
			echo '</li>';
			return;
		}

		$view = get_permalink( $page_id );
		$edit = get_edit_post_link( $page_id );
		echo '<a href="' . esc_url( $view ) . '" target="_blank" rel="noopener">' . esc_html( $view ) . '</a>';
		if ( $edit ) {
			echo ' (<a href="' . esc_url( $edit ) . '">' . esc_html__( 'edit', 'statchasers-depth-charts' ) . '</a>)';
		}

		$post = get_post( $page_id );
		if ( $post && ! has_shortcode( (string) $post->post_content, $shortcode ) ) {
			echo '<br /><span style="color:#b45309;">' . sprintf(
				/* translators: %s: shortcode tag. */
				esc_html__( 'Warning: this page does not contain the [%s] shortcode.', 'statchasers-depth-charts' ),
				esc_html( $shortcode )
			) . '</span>';
		}
		echo '</li>';
	}

	/**
	 * Handle the refresh form submission (admin-post.php).
	 *
	 * @return void
	 */
	public function handle_refresh() {
		// Capability + nonce: only admins may trigger a refresh.
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'You are not allowed to refresh depth chart data.', 'statchasers-depth-charts' ) );
		}
		check_admin_referer( SCDC_REFRESH_ACTION, self::NONCE );

		// Blended refresh hits ESPN (32) + Footballguys (1) + FantasyPros (32),
		// so give it plenty of room where the host allows it.
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 300 ); // phpcs:ignore
		}

		$previous = SCDC_Store::read();
		$result   = SCDC_Refresh::run( $previous );

		$saved = false;
		if ( 'error' !== $result['status'] ) {
			$saved = SCDC_Store::write( $result['payload'] );
		}

		$now = time();
		if ( 'error' === $result['status'] || ! $saved ) {
			$status = 'error';
			$error  = ! empty( $result['error'] ) ? $result['error'] : __( 'Failed to write the cache file. Check uploads directory permissions.', 'statchasers-depth-charts' );
			// Preserve the prior last_refreshed time on hard failure.
			$prev_meta              = SCDC_Store::get_meta();
			$meta                   = $prev_meta;
			$meta['status']         = $status;
			$meta['error']          = $error;
			$meta['teams_ok']       = (int) $result['teams_ok'];
			$meta['teams_failed']   = $result['teams_failed'];
		} else {
			$status = $result['status']; // success | partial
			$meta   = array(
				'status'            => $status,
				'error'             => $result['error'],
				'last_refreshed'    => gmdate( 'c', $now ),
				'last_refreshed_ts' => $now,
				'teams_ok'          => (int) $result['teams_ok'],
				'teams_failed'      => $result['teams_failed'],
			);
		}
		SCDC_Store::set_meta( $meta );

		$redirect = add_query_arg(
			array(
				'page'        => self::MENU_SLUG,
				'scdc_result' => $status,
			),
			admin_url( 'admin.php' )
		);
		wp_safe_redirect( $redirect );
		exit;
	}

	/**
	 * Show a result notice after a refresh redirect.
	 *
	 * @return void
	 */
	public function maybe_render_notice() {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			return;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only display flag.
		if ( empty( $_GET['page'] ) || self::MENU_SLUG !== sanitize_key( wp_unslash( $_GET['page'] ) ) ) {
			return;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only display flag.
		if ( empty( $_GET['scdc_result'] ) ) {
			return;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$result = sanitize_key( wp_unslash( $_GET['scdc_result'] ) );
		$meta   = SCDC_Store::get_meta();

		if ( 'success' === $result ) {
			printf(
				'<div class="notice notice-success is-dismissible"><p>%s</p></div>',
				esc_html( sprintf(
					/* translators: %d: number of teams. */
					__( 'Depth charts refreshed successfully (%d teams).', 'statchasers-depth-charts' ),
					(int) $meta['teams_ok']
				) )
			);
		} elseif ( 'partial' === $result ) {
			printf(
				'<div class="notice notice-warning is-dismissible"><p>%s</p></div>',
				esc_html( $meta['error'] ? $meta['error'] : __( 'Refreshed with some failures.', 'statchasers-depth-charts' ) )
			);
		} else {
			printf(
				'<div class="notice notice-error is-dismissible"><p>%s</p></div>',
				esc_html( $meta['error'] ? $meta['error'] : __( 'Refresh failed.', 'statchasers-depth-charts' ) )
			);
		}
	}
}

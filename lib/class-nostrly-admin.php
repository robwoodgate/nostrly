<?php

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

class NostrlyAdmin
{
    /**
     * Register the service.
     * Brands both public and admin areas.
     */
    public function register(): void
    {
        add_action('init', [$this, 'init']);
        add_action('admin_init', [$this, 'admin_init'], 999);
        add_action('admin_enqueue_scripts', [$this, 'admin_enqueue_scripts']);
    }

    /**
     * We only load this service on the admin backend, if user is not admin.
     *
     * @return bool whether the conditional service is needed
     */
    public static function is_needed(): bool
    {
        return \is_admin() && !\wp_doing_ajax() && !\current_user_can('edit_posts');
    }

    /**
     * Used for items which affect both public and admin areas.
     */
    public function init(): void
    {
        // * Change Admin Footer (bottom left side)
        add_filter('admin_footer_text', function ($text) {
            return '<span id="footer-thankyou">'.__('Powered by Nostrly', 'nostrly').' v'.NOSTRLY_VERSION.'</span>';
        });

        // * Change browser tab title (removes "WordPress")
        add_filter('admin_title', function ($admin_title, $title) {
            return $title.' &lsaquo; '.get_bloginfo('name');
        }, 12, 2);

        // * Change wp-login logo and set default referrer policy for old browsers
        // * like Safari 10.1, which don't understand the strict-origin-when-cross-origin
        // * policy that WordPress sets by default now
        add_action('login_head', function (): void {
            echo '<style type="text/css">
                .login h1 a {
                background-image:url('.esc_url(NOSTRLY_URL.'assets/img/nostrly-logo.jpg').') !important;
                    border-radius: 50%;
                    margin: 1em auto;
                }
                body {background: #001819;}
                .login #backtoblog a, .login #nav a {
                    text-decoration: none;
                    color:#fff;
                }
                .login #backtoblog a:hover, .login #nav a:hover, .login h1 a:hover {
                    color:#f6c956;
                }
            </style>
            <!-- <meta name=\'referrer\' content=\'no-referrer-when-downgrade\' /> -->
          ';
        }, 999);

        // * Change wp-login logo url
        add_action('login_headerurl', function () {
            return esc_url(home_url());
        });

        // * Change wp-login logo text
        add_action('login_headertext', function () {
            return sprintf(__('Powered by %s', 'nostrly'), 'Nosrtly');
        });
    }

    /**
     * ADMIN: Make changes to admin area and handle callbacks.
     */
    public function admin_init(): void
    {
        global $menu, $pagenow;

        // if (!self::is_needed()) {
        //     return;
        // }

        // Redirect contributors to profile page
        if (is_admin() && !defined('DOING_AJAX') && !current_user_can('edit_posts') && current_user_can('subscriber') && !strpos($_SERVER['REQUEST_URI'], 'profile.php')) {
            wp_redirect(admin_url('profile.php#nostr'));

            exit;
        }

        $user_id = get_current_user_id();
        $ln_address = get_user_meta($user_id, '_lnp_ln_address', true);
        if (is_admin() && strpos(strtolower($ln_address), 'nostrly.com') !== false) {
            add_action('admin_notices', function () {
                wp_admin_notice(
                    __('Lightning redirect is currently disabled because you have set your Nostrly Address as your Lightning address in your Nostr profile. Please edit your profile in a Nostr client and set your lightning address to your usual wallet, then login here again.', 'Nostrly'),
                    [
                        'type' => 'error',
                        'additional_classes' => ['is-dismissible'],
                    ]
                );
            });
        }

        // * Modify Toolbar
        add_action('admin_bar_menu', function ($wp_admin_bar): void {
            $wp_admin_bar->remove_node('wp-logo');
        }, 999);

        // * Remove WP Version Number
        remove_filter('update_footer', 'core_update_footer');

        // * Remove upgrade nag
        remove_action('admin_notices', 'update_nag', 3);

        // * Remove standard Dashboard Widgets
        // remove_meta_box('dashboard_activity', 'dashboard', 'normal'); // since 3.8
        // remove_meta_box('dashboard_incoming_links', 'dashboard', 'normal');
        // remove_meta_box('dashboard_plugins', 'dashboard', 'normal');
        remove_meta_box('dashboard_primary', 'dashboard', 'normal');
        // remove_meta_box('dashboard_quick_press', 'dashboard', 'side');
        // remove_meta_box('dashboard_recent_drafts', 'dashboard', 'side');
        // remove_meta_box('dashboard_recent_comments', 'dashboard', 'normal');
        // remove_meta_box('dashboard_right_now', 'dashboard', 'normal');
        remove_meta_box('dashboard_secondary', 'dashboard', 'normal');
        remove_meta_box('dashboard_browser_nag', 'dashboard', 'normal');
        remove_meta_box('dashboard_php_nag', 'dashboard', 'normal');

        // Remove Jetpack Widget
        remove_meta_box('jetpack_summary_widget', 'dashboard', 'normal');

        // * Remove WPSEO stuff
        // remove_all_filters('user_contactmethods');
        // remove_meta_box('wpseo-dashboard-overview', 'dashboard', 'normal');

        // * Remove CF7 Stuff
        remove_meta_box('wpcf7db_summary', 'dashboard', 'normal');
    }

    /**
     * Enqueue global Admin scripts and styles.
     */
    public function admin_enqueue_scripts(): void
    {
        // First, enqueue a script to ensure our inline script gets dependencies
        // false for no external file, dependencies on jQuery, in footer
        wp_register_script('frag-highlight', '', ['jquery'], null, true);
        wp_enqueue_script('frag-highlight');
        wp_enqueue_script('jquery-effects-highlight');

        // Then we add our inline JS
        $inline_js = <<<EOL
            jQuery(function($) {
                function nostrly_highlight_hash(hash) {
                    if (hash && $(hash).length) {
                        $('html, body').animate({
                            scrollTop: $(hash).offset().top - 100
                        }, 500, function(){
                            // First highlight
                            $(hash).effect('highlight', {color:'#669966'}, 100, function(){
                                // Delay before the second highlight
                                setTimeout(function() {
                                    // Second highlight
                                    $(hash).effect('highlight', {color:'#669966'}, 100);
                                }, 500); // 500ms delay between highlights
                            });
                        });
                    }
                }
                if (window.location.hash) {
                    nostrly_highlight_hash(window.location.hash);
                }
            });
        EOL;
        wp_add_inline_script('frag-highlight', $inline_js);
    }
}

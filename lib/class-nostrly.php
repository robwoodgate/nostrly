<?php
/**
 * "Main" plugin class.
 * Responsible for menus, settings, global scripts and methods.
 */
if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}
use swentel\nostr\Key\Key;

class Nostrly
{
    public const DEFAULT_RELAYS = [
        'wss://purplepag.es',
        'wss://relay.nostr.band',
        'wss://relay.primal.net',
        'wss://relay.damus.io',
        'wss://relay.snort.social',
        'wss://nostr.bitcoiner.social',
    ];
    private static $field_added = false;

    public function init()
    {
        add_action('init', [$this, 'gmp_check_extension']);
        add_action('admin_menu', [$this, 'add_admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('login_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_filter('plugin_action_links_'.NOSTRLY_FILE, [$this, 'action_links']);
        add_filter('get_avatar_url', [$this, 'get_nostr_avatar_url'], 10, 3);
    }

    public function gmp_check_extension()
    {
        if (!extension_loaded('gmp')) {
            add_action('admin_notices', function () {
                wp_admin_notice(
                    __('Nostr Login is currently disabled because the GMP extension is not installed on your server. Please contact your hosting provider to enable it.', 'gmp-check'),
                    [
                        'type' => 'error',
                        'additional_classes' => ['is-dismissible'],
                    ]
                );
            });
        }
    }

    public function add_admin_menu()
    {
        add_options_page(__('Nostrly Settings', 'nostrly'), __('Nostrly', 'nostrly'), 'manage_options', 'nostrly', [$this, 'options_page']);
    }

    public function options_page()
    {
        // Convert hex key to NPUB
        $key = new Key();
        $root_hexkey = get_option('nostrly_rootkey');
        if (!empty($root_hexkey)) {
            $root_hexkey = $key->convertPublicKeyToBech32($root_hexkey);
        }
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Nostrly Settings', 'nostrly'); ?></h1>
            <form method="post" action="options.php">
                <?php settings_fields('nostrly_options'); ?>
                <?php do_settings_sections('nostrly_options'); ?>
                <table class="form-table">
                    <tr valign="top">
                        <th scope="row"><?php esc_html_e('Nostr Relays', 'nostrly'); ?></th>
                        <td>
                            <textarea name="nostrly_relays" rows="5" cols="50"><?php echo esc_textarea(implode("\n", self::get_relay_urls())); ?></textarea>
                            <p class="description"><?php esc_html_e('Enter one relay URL per line.', 'nostrly'); ?></p>
                        </td>
                    </tr>
                    <tr valign="top">
                        <th scope="row"><?php esc_html_e('Redirect After Login', 'nostrly'); ?></th>
                        <td>
                            <select name="nostrly_redirect">
                                <option value="admin" <?php selected(get_option('nostrly_redirect', 'admin'), 'admin'); ?>>
                                    <?php esc_html_e('Admin Dashboard', 'nostrly'); ?>
                                </option>
                                <option value="home" <?php selected(get_option('nostrly_redirect', 'admin'), 'home'); ?>>
                                    <?php esc_html_e('Home Page', 'nostrly'); ?>
                                </option>
                                <option value="profile" <?php selected(get_option('nostrly_redirect', 'admin'), 'profile'); ?>>
                                    <?php esc_html_e('User Profile', 'nostrly'); ?>
                                </option>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('NIP-05: Root Domain NPUB', 'nostrly'); ?></th>
                        <td>
                         <input type="text" name="nostrly_rootkey"  value="<?php echo esc_html($root_hexkey); ?>" placeholder="npub..." />
                         <p class="description"><?php esc_html_e('Optional. This is the Nostr public key associated with the root domain (_@domain).', 'nostrly'); ?></p>
                        </td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }

    public function register_settings()
    {
        register_setting(
            'nostrly_options',
            'nostrly_redirect',
            [
                'type' => 'string',
                'sanitize_callback' => [$this, 'sanitize_redirect_setting'],
                'default' => 'admin',
            ]
        );
        register_setting('nostrly_options', 'nostrly_relays');
        register_setting(
            'nostrly_options',
            'nostrly_rootkey',
            [
                'type' => 'string',
                'sanitize_callback' => [$this, 'sanitize_rootkey_setting'],
                // 'default' => '',
            ]
        );
    }

    public function sanitize_redirect_setting($value)
    {
        $allowed_values = ['admin', 'home', 'profile'];

        return in_array($value, $allowed_values) ? $value : 'admin';
    }

    public function sanitize_rootkey_setting($value)
    {
        if (empty($value) || 0 !== strpos($value, 'npub')) {
            return '';
        }

        try {
            $key = new Key();
            $hex = $key->convertToHex($value);

            return (string) $hex;
        } catch (Exception $e) {
            error_log($e->getMessage());

            return '';
        }
    }

    public function enqueue_scripts()
    {
        // Adds our global ajax data before jQuery
        $js = 'var nostrly_ajax = '.wp_json_encode([
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('nostrly-nonce'),
            'domain' => preg_replace('/^www\./', '', parse_url(get_site_url(), PHP_URL_HOST)),
            'relays' => self::get_relay_urls(),
            'pubkey' => get_option('nostrly_rootkey'),
        ]);
        wp_add_inline_script('jquery', $js, 'before');
        // wp_enqueue_script('nostrly-public', NOSTRLY_URL.'assets/js/nostrly-public.min.js', [], NOSTRLY_VERSION, false); // NB: head

        // Toastr - non-blocking notifications; https://github.com/CodeSeven/toastr
        wp_enqueue_script('toastr', NOSTRLY_URL.'assets/js/toastr.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_enqueue_style('toastr', NOSTRLY_URL.'assets/css/toastr.min.css', [], NOSTRLY_VERSION, false); // NB: head
    }

    /**
     * Add settings page link with plugin.
     *
     * @param mixed $links
     */
    public function action_links($links)
    {
        $settings_link = '<a href="'.admin_url('options-general.php').'?page=nostrly"> '.__('Settings', 'nostrly').'</a>';

        array_unshift(
            $links,
            $settings_link
        );

        return $links;
    }

    public function get_nostr_avatar_url($url, $id_or_email, $args)
    {
        $user = false;
        if (is_numeric($id_or_email)) {
            $user = get_user_by('id', $id_or_email);
        } elseif (is_object($id_or_email)) {
            if (!empty($id_or_email->user_id)) {
                $user = get_user_by('id', $id_or_email->user_id);
            }
        } else {
            $user = get_user_by('email', $id_or_email);
        }

        if ($user && is_object($user)) {
            $nostr_avatar = get_user_meta($user->ID, 'nostr_avatar', true);
            self::log_debug("Attempting to use Nostr avatar for user {$user->ID}: ".$nostr_avatar);
            if ($nostr_avatar) {
                return $nostr_avatar;
            }
        }

        self::log_debug('Using default avatar URL: '.$url);

        return $url;
    }

    // Add a debug logging function
    public static function log_debug($message)
    {
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log('Nostrly: '.$message);
        }
    }

    public static function get_relay_urls(): array
    {
        $relays_option = get_option('nostrly_relays', implode("\n", self::DEFAULT_RELAYS));
        $relays_array = explode("\n", $relays_option);

        // Filter and escape URLs, allowing only wss protocol
        $fn = function ($v) {return esc_url($v, ['wss']); };
        $relays_array = array_filter(array_map($fn, array_map('trim', $relays_array)));

        return empty($relays_array) ? self::DEFAULT_RELAYS : $relays_array;
    }
}

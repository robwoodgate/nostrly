<?php
if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}
use swentel\nostr\Event\Event;
use swentel\nostr\Key\Key;

class Nostrly
{
    private static $field_added = false;
    private $default_relays = [
        'wss://purplepag.es',
        'wss://relay.nostr.band',
        'wss://relay.primal.net',
        'wss://relay.damus.io',
        'wss://relay.snort.social',
        'wss://nostr.bitcoiner.social',
    ];

    public function init()
    {
        add_action('admin_menu', [$this, 'add_admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('show_user_profile', [$this, 'add_custom_user_profile_fields']);
        add_action('edit_user_profile', [$this, 'add_custom_user_profile_fields']);
        add_action('login_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('login_form', [$this, 'add_nostrly_field']);
        add_action('wp_ajax_nostrly_login', [$this, 'ajax_nostrly_login']);
        add_action('wp_ajax_nopriv_nostrly_login', [$this, 'ajax_nostrly_login']);
        add_action('wp_ajax_nostrly_register', [$this, 'ajax_nostrly_register']);
        add_action('wp_ajax_nostr_sync_profile', [$this, 'ajax_nostr_sync_profile']);
        add_action('wp_ajax_nostr_disconnect', [$this, 'ajax_nostr_disconnect']);
        add_filter('plugin_action_links_'.NOSTRLY_FILE, [$this, 'action_links']);
        add_filter('get_avatar_url', [$this, 'get_nostr_avatar_url'], 10, 3);

        $this->log_debug('Nostrly_Handler class initialized');
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
                            <textarea name="nostrly_relays" rows="5" cols="50"><?php echo esc_textarea(implode("\n", $this->get_relay_urls())); ?></textarea>
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

    public function add_custom_user_profile_fields($user)
    {
        $user_id = get_current_user_id();
        $key = new Key();
        $bech32_public = '';
        if ($public_key = get_user_meta($user->ID, 'nostr_public_key', true)) {
            $bech32_public = $key->convertPublicKeyToBech32(get_user_meta($user->ID, 'nostr_public_key', true));
        }
        ?>
        <h3><?php esc_html_e('Nostr Information', 'nostrly'); ?></h3>
        <?php wp_nonce_field('nostrly_save_profile', 'nostrly_nonce'); ?>

        <table class="form-table">
            <tr>
                <th><label><?php esc_html_e('Connect Nostr Account', 'nostrly'); ?></label></th>
                <td>
                    <?php if (!get_user_meta($user->ID, 'nostr_public_key', true)) { ?>
                        <?php if ($user->ID == $user_id) { ?>
                            <button type="button" id="nostr-connect-extension" class="button">
                                <?php esc_html_e('Sync with Nostr Extension', 'nostrly'); ?>
                            </button>
                            <p class="description">
                            <?php esc_html_e('Connect your Nostr account to sync your public key, NIP-05, and avatar', 'nostrly'); ?>
                        </p>
                        <?php } ?>
                    <?php } else { ?>
                        <?php if ($user->ID == $user_id) { ?>
                            <button type="button" id="nostr-resync-extension" class="button">
                                <?php esc_html_e('Resync Nostr Data', 'nostrly'); ?>
                            </button>
                        <?php } ?>
                        <button type="button" id="nostr-disconnect" class="button" data-user="<?php echo $user->ID; ?>">
                            <?php esc_html_e('Disconnect Nostr', 'nostrly'); ?>
                        </button>
                    <?php } ?>
                    <div id="nostr-connect-feedback" style="display:none; margin-top:10px;border-left-style: solid ;border-left-width: 4px;padding-left:4px;"></div>
                </td>
            </tr>

            <!-- Existing fields as read-only -->
            <tr>
                <th><label><?php esc_html_e('Nostr Public Key', 'nostrly'); ?></label></th>
                <td>
                    <input type="text" id="nostr_public_key"
                       value="<?php echo esc_attr($bech32_public); ?>"
                       class="text" style="width: 32rem;" readonly onclick="this.select();"/>
                </td>
            </tr>
            <tr>
                <th><label><?php esc_html_e('Nostr NIP-05', 'nostrly'); ?></label></th>
                <td>
                    <input type="text" id="nostr_nip05"
                       value="<?php echo esc_attr(get_user_meta($user->ID, 'nip05', true)); ?>"
                       class="regular-text" readonly />
                    <?php $nip05 = get_user_meta($user->ID, 'nip05', true); ?>
                    <?php if ($user->ID == $user_id && $nip05 && $nip05 !== $user->user_login.'@nostrly.com') { ?>
                        <button type="button" id="nostr-set-nip05" class="button" data-nip05="<?php echo $user->user_login; ?>@nostrly.com">
                            <?php esc_html_e('Use your Nostrly identifier', 'nostrly'); ?>
                        </button>
                    <?php } ?>
                    <p class="description">
                        <?php esc_html_e('This is your currently set NIP-05 internet identifier.', 'nostrly'); ?>
                    </p>
                </td>
            </tr>
            <!-- Add more custom fields here -->
        </table>
        <?php
    }

    public function enqueue_scripts($hook = '')
    {
        $enqueue = false;
        // Check if we're on the login page
        if (in_array($GLOBALS['pagenow'], ['wp-login.php']) || did_action('login_enqueue_scripts')) {
            $enqueue = true;
        }

        // For profile page
        if (in_array($hook, ['profile.php', 'user-edit.php'])) {
            $enqueue = true;
        }

        // Do enqueue
        if ($enqueue) {
            wp_enqueue_script('nostrly', plugin_dir_url(dirname(__FILE__)).'assets/js/nostrly.min.js', ['jquery'], '1.0', true);

            wp_localize_script('nostrly', 'nostrly_ajax', [
                'ajax_url' => admin_url('admin-ajax.php'),
                'nonce' => wp_create_nonce('nostrly-nonce'),
                'relays' => $this->get_relay_urls(),
            ]);
        }
    }

    public function add_nostrly_field()
    {
        if (self::$field_added) {
            return;
        }
        self::$field_added = true;
        ?>
        <div class="nostrly-container">
            <label for="nostrly_toggle" class="nostr-toggle-label">
                <input type="checkbox" id="nostrly_toggle">
                <span><?php esc_html_e('Use Nostr Login', 'nostrly'); ?></span>
            </label>
            <?php wp_nonce_field('nostrly-nonce', 'nostrly_nonce'); ?>
        </div>
        <p class="nostrly-field" style="display:none;">
            <label for="nostr_private_key"><?php esc_html_e('Nostr Private Key (starting with “nsec”)', 'nostrly'); ?></label>
            <input type="password" name="nostr_private_key" id="nostr_private_key" class="input" size="20" autocapitalize="off"/>
        </p>
        <p class="nostrly-buttons" style="display:none;">
            <button type="button" id="use_nostr_extension" class="button"><?php esc_html_e('Use Nostr Extension', 'nostrly'); ?></button>
            <input type="submit" name="wp-submit" id="nostr-wp-submit" class="button button-primary" value="<?php esc_attr_e('Log In with Nostr', 'nostrly'); ?>">
        </p>
        <div id="nostrly-feedback" style="display:none;"></div>
        <?php
        remove_action('login_form', [$this, 'add_nostrly_field']);
    }

    public function ajax_nostrly_login()
    {
        // Sanitize and verify nonce
        $nonce = sanitize_text_field(wp_unslash($_POST['nonce'] ?? ''));
        if (!wp_verify_nonce($nonce, 'nostrly-nonce')) {
            wp_send_json_error(['message' => __('Nonce verification failed.', 'nostrly')]);
            wp_die();
        }

        // Sanitize input data
        $metadata_json = sanitize_text_field(wp_unslash($_POST['metadata'] ?? ''));
        $authtoken = sanitize_text_field(wp_unslash($_POST['authtoken'] ?? ''));
        $authtoken = base64_decode($authtoken); // now a json encoded string

        // Verify authtoken event signature and format
        $event = new Event();
        if (!$event->verify($authtoken)) {
            $this->log_debug('Authtoken failed verification');
            wp_send_json_error(['message' => __('Invalid authtoken.', 'nostrly')]);
        }

        // Do NIP98 specific authtoken validation checks
        // @see https://github.com/nostr-protocol/nips/blob/master/98.md
        $nip98 = json_decode($authtoken);
        if (JSON_ERROR_NONE !== json_last_error()) {
            $this->log_debug('Invalid authtoken JSON: '.json_last_error_msg());
            wp_send_json_error(['message' => __('Invalid authtoken: ', 'nostrly').json_last_error_msg()]);
        }
        $this->log_debug('AUTH: '.print_r($nip98, true));
        $valid = ('27235' == $nip98->kind) ? true : false;              // NIP98 event
        $valid = (time() - $nip98->created_at <= 60) ? $valid : false;  // <60 secs old
        $tags = array_column($nip98->tags, 1, 0);                       // Expected Tags
        $this->log_debug(print_r($tags, true));
        $valid = (admin_url('admin-ajax.php') == $tags['u']) ? $valid : false;
        $valid = ('post' == $tags['method']) ? $valid : false;
        if (!$valid) {
            $this->log_debug('Authorisation is invalid or expired');
            wp_send_json_error(['message' => __('Authorisation is invalid or expired.', 'nostrly')]);
        }

        // Check if a user with this public key already exists
        $public_key = $nip98->pubkey;
        $user = $this->get_user_by_public_key($public_key);
        if ($user) {
            // Update existing user's metadata
            $this->update_user_metadata($user->ID, $metadata_json);

            // Login user
            wp_set_current_user($user->ID);
            wp_set_auth_cookie($user->ID);
            $this->log_debug('User logged in successfully: '.$user->ID);

            // Redirect
            $redirect_type = get_option('nostrly_redirect', 'admin');
            $redirect_url = match ($redirect_type) {
                'home' => home_url(),
                'profile' => get_edit_profile_url($user->ID),
                default => admin_url()
            };
            wp_send_json_success(['redirect' => $redirect_url]);
        } else {
            $this->log_debug('Login failed for public key: '.$public_key);
            wp_send_json_error(['message' => __('Login failed. Please try again.', 'nostrly')]);
        }
    }

    public function ajax_nostrly_register()
    {
        // We'll implement this method later
        wp_die();
    }

    public function ajax_nostr_sync_profile()
    {
        try {
            if (!check_ajax_referer('nostrly-nonce', 'nonce', false)) {
                throw new Exception(__('Security check failed.', 'nostrly'));
            }

            if (!is_user_logged_in()) {
                throw new Exception(__('You must be logged in.', 'nostrly'));
            }

            $user_id = get_current_user_id();
            if (!current_user_can('edit_user', $user_id)) {
                throw new Exception(__('You do not have permission to perform this action.', 'nostrly'));
            }

            // Validate and sanitize metadata input
            if (!isset($_POST['metadata']) || empty($_POST['metadata'])) {
                throw new Exception(__('No metadata provided.', 'nostrly'));
            }

            // Sanitize the JSON string before decoding
            $raw_metadata = sanitize_text_field(wp_unslash($_POST['metadata']));
            $metadata = json_decode($raw_metadata, true);
            if (JSON_ERROR_NONE !== json_last_error()) {
                throw new Exception(__('Invalid metadata format.', 'nostrly'));
            }

            // Validate public key
            if (empty($metadata['pubkey']) || !$this->is_valid_public_key($metadata['pubkey'])) {
                throw new Exception(__('Invalid public key.', 'nostrly'));
            }

            // Check for existing public key
            $existing_user = $this->get_user_by_public_key($metadata['pubkey']);
            if ($existing_user && $existing_user->ID !== $user_id) {
                throw new Exception(__('This Nostr account is already linked to another user.', 'nostrly'));
            }

            // Update Nostr Public Key
            update_user_meta($user_id, 'nostr_public_key', sanitize_text_field($metadata['pubkey']));

            // Update the other fields
            $this->update_user_metadata($user_id, $raw_metadata);

            wp_send_json_success(['message' => __('Nostr data successfully synced!', 'nostrly')]);
        } catch (Exception $e) {
            wp_send_json_error(['message' => $e->getMessage()]);
        }
    }

    public function ajax_nostr_disconnect()
    {
        try {
            if (!check_ajax_referer('nostrly-nonce', 'nonce', false)) {
                throw new Exception(__('Security check failed.', 'nostrly'));
            }

            if (!is_user_logged_in()) {
                throw new Exception(__('You must be logged in.', 'nostrly'));
            }

            $user_id = (int) $_POST['user'];
            if (!current_user_can('edit_user', $user_id)) {
                throw new Exception(__('You do not have permission to perform this action.', 'nostrly'));
            }

            // Remove Nostr-specific data
            delete_user_meta($user_id, 'nostr_public_key');
            delete_user_meta($user_id, 'nip05');
            delete_user_meta($user_id, 'nostr_avatar');

            wp_send_json_success(['message' => __('Nostr disconnected!', 'nostrly')]);
        } catch (Exception $e) {
            wp_send_json_error(['message' => $e->getMessage()]);
        }
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
            if (defined('WP_DEBUG') && WP_DEBUG) {
                error_log("Attempting to use Nostr avatar for user {$user->ID}: ".$nostr_avatar);
            }
            if ($nostr_avatar) {
                return $nostr_avatar;
            }
        }

        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log('Using default avatar URL: '.$url);
        }

        return $url;
    }

    // Add a debug logging function
    private function log_debug($message)
    {
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log('Nostrly: '.$message);
        }
    }

    private function is_valid_public_key($key)
    {
        // Implement your validation logic for Nostr public keys
        return preg_match('/^[a-f0-9]{64}$/i', $key);
    }

    private function is_valid_nip05($nip05)
    {
        // Implement your validation logic for NIP-05 identifiers
        return true; // Placeholder; replace with actual validation
    }

    private function get_user_by_public_key($public_key)
    {
        $users = get_users([
            'meta_key' => 'nostr_public_key',
            'meta_value' => sanitize_text_field($public_key),
            'number' => 1,
            'count_total' => false,
            'fields' => 'all',
        ]);

        return !empty($users) ? $users[0] : false;
    }

    private function create_new_user($public_key, $metadata_json)
    {
        $username = !empty($sanitized_metadata['name']) ? sanitize_user($sanitized_metadata['name'], true) : 'nostr_'.substr(sanitize_text_field($public_key), 0, 8);
        if (username_exists($username)) {
            $username .= '_'.wp_generate_password(4, false); // Append random characters
        }

        $email = !empty($sanitized_metadata['email']) ? sanitize_email($sanitized_metadata['email']) : sanitize_text_field($public_key).'@nostr.local';

        if (!is_email($email)) {
            // Handle invalid email, perhaps generate a default one
            $email = sanitize_text_field($public_key).'@nostr.local';
        }

        $user_id = wp_create_user($username, wp_generate_password(), $email);
        if (!is_wp_error($user_id)) {
            update_user_meta($user_id, 'nostr_public_key', sanitize_text_field($public_key));
            $this->update_user_metadata($user_id, $sanitized_metadata);
        }

        return $user_id;
    }

    private function update_user_metadata($user_id, $metadata_json)
    {
        // Decode and sanitize metadata
        $metadata = json_decode($metadata_json, true);
        if (JSON_ERROR_NONE !== json_last_error()) {
            $this->log_debug('Invalid metadata JSON: '.json_last_error_msg());

            return;
        }

        if (!empty($metadata['name'])) {
            wp_update_user(['ID' => $user_id, 'display_name' => sanitize_text_field($metadata['name'])]);
        }
        if (!empty($metadata['about'])) {
            update_user_meta($user_id, 'description', sanitize_textarea_field($metadata['about']));
        }
        if (!empty($metadata['nip05'])) {
            update_user_meta($user_id, 'nip05', sanitize_text_field($metadata['nip05']));
        }
        if (!empty($metadata['picture'])) {
            update_user_meta($user_id, 'nostr_avatar', esc_url_raw($metadata['picture']));
            $this->log_debug("Saved Nostr avatar for user {$user_id}: ".esc_url($metadata['picture']));
        }
        if (!empty($metadata['website'])) {
            wp_update_user([
                'ID' => $user_id,
                'user_url' => esc_url_raw($metadata['website']),
            ]);
        }
        // Add more metadata fields as needed
        // ...
        //
        $this->log_debug('Updated metadata for user ID: '.$user->ID);
    }

    private function get_relay_urls(): array
    {
        $relays_option = get_option('nostrly_relays', implode("\n", $this->default_relays));
        $relays_array = explode("\n", $relays_option);

        // Filter and escape URLs, allowing only wss protocol
        $fn = function ($v) {return esc_url($v, ['wss']); };
        $relays_array = array_filter(array_map($fn, array_map('trim', $relays_array)));

        return empty($relays_array) ? $this->default_relays : $relays_array;
    }
}

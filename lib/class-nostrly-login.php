<?php
/**
 * Responsible for account login and profile updates
 */
if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}
use swentel\nostr\Event\Event;
use swentel\nostr\Key\Key;

class NostrlyLogin
{
    private static $field_added = false;

    public function init()
    {
        add_action('show_user_profile', [$this, 'add_custom_user_profile_fields']);
        add_action('edit_user_profile', [$this, 'add_custom_user_profile_fields']);
        add_action('login_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('login_form', [$this, 'add_nostrly_field']);
        add_action('wp_ajax_nostrly_login', [$this, 'ajax_nostrly_login']);
        add_action('wp_ajax_nopriv_nostrly_login', [$this, 'ajax_nostrly_login']);
        add_action('wp_ajax_nostr_sync_profile', [$this, 'ajax_nostr_sync_profile']);
        add_action('wp_ajax_nostr_disconnect', [$this, 'ajax_nostr_disconnect']);
        add_filter('user_profile_update_errors', [$this, 'allow_empty_email']);
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
        <div id="nostr">
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
        </div>
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
            wp_enqueue_script('nostrly-login', plugin_dir_url(dirname(__FILE__)).'assets/js/nostrly-login.min.js', ['jquery'], '1.0', true);
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
            <label for="nostr_private_key"><?php esc_html_e('Nostr Private Key (starting with "nsec")', 'nostrly'); ?></span></label>
            <input type="password" name="nostr_private_key" id="nostr_private_key" class="input" size="20" autocapitalize="off" placeholder="nsec..." />
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
        try {
            $event = new Event();
            if (!$event->verify($authtoken)) {
                Nostrly::log_debug('Authtoken failed verification');
                wp_send_json_error(['message' => __('Invalid authtoken.', 'nostrly')]);
            }
        } catch (Throwable $e) {
            wp_send_json_error(['message' => __('Sorry, Nostr Login is currently disabled.', 'nostrly')]);
        }

        // Do NIP98 specific authtoken validation checks
        // @see https://github.com/nostr-protocol/nips/blob/master/98.md
        $nip98 = json_decode($authtoken);
        if (JSON_ERROR_NONE !== json_last_error()) {
            Nostrly::log_debug('Invalid authtoken JSON: '.json_last_error_msg());
            wp_send_json_error(['message' => __('Invalid authtoken: ', 'nostrly').json_last_error_msg()]);
        }
        Nostrly::log_debug('AUTH: '.print_r($nip98, true));
        $valid = ('27235' == $nip98->kind) ? true : false;              // NIP98 event
        $valid = (time() - $nip98->created_at <= 60) ? $valid : false;  // <60 secs old
        $tags = array_column($nip98->tags, 1, 0);                       // Expected Tags
        Nostrly::log_debug(print_r($tags, true));
        $valid = (admin_url('admin-ajax.php') == $tags['u']) ? $valid : false;
        $valid = ('post' == $tags['method']) ? $valid : false;
        if (!$valid) {
            Nostrly::log_debug('Authorisation is invalid or expired');
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
            Nostrly::log_debug('User logged in successfully: '.$user->ID);

            // Redirect
            $redirect_type = get_option('nostrly_redirect', 'admin');
            $redirect_url = match ($redirect_type) {
                'home' => home_url(),
                'profile' => get_edit_profile_url($user->ID),
                default => admin_url()
            };
            wp_send_json_success(['redirect' => $redirect_url]);
        } else {
            Nostrly::log_debug('Login failed for public key: '.$public_key);
            wp_send_json_error(['message' => __('Login failed. Please try again.', 'nostrly')]);
        }
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
     * Allows email to be left blank on profile save.
     *
     * @param mixed $errors
     */
    public function allow_empty_email($errors)
    {
        unset($errors->errors['empty_email']);
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

    private function update_user_metadata($user_id, $metadata_json)
    {
        // Decode and sanitize metadata
        $metadata = json_decode($metadata_json, true);
        if (JSON_ERROR_NONE !== json_last_error()) {
            Nostrly::log_debug('Invalid metadata JSON: '.json_last_error_msg());

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
        if (!empty($metadata['lud16'])) {
            update_user_meta($user_id, '_lnp_ln_address', sanitize_text_field($metadata['lud16']));
        }
        if (!empty($metadata['picture'])) {
            update_user_meta($user_id, 'nostr_avatar', esc_url_raw($metadata['picture']));
            Nostrly::log_debug("Saved Nostr avatar for user {$user_id}: ".esc_url($metadata['picture']));
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
        Nostrly::log_debug('Updated metadata for user ID: '.$user_id);
    }
}

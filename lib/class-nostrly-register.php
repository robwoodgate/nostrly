<?php

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}
use swentel\nostr\Event\Event;
use swentel\nostr\Key\Key;

class NostrlyRegister
{
    public const ERRORS = [
        'SHORT' => 'name is too short (min 2 chars)',
        'LONG' => 'name is too long (max 20 chars)',
        'INVALID' => 'name contains invalid characters',
        'REGISTERED' => 'name is already registered',
        'BLOCKED' => 'name is not allowed',
        'RESERVED' => 'name may become available later',
    ];

    public const PRICES = [
        '2' => '65000',
        '3' => '45000',
        '4' => '25000',
        'default' => '12500', // default
    ];

    protected const BLOCKED = [
        'admin', 'administrator', 'ceo', 'founder', 'root', 'sysadmin', 'webmaster',
        'master', 'owner', 'superuser', 'superadmin', 'support', 'help', 'contact',
        'enquires', 'press', 'pr', 'staff', 'moderator', 'mod', 'operator', 'ops',
        'security', 'secure', 'manager', 'control', 'boss', 'chief', 'head', 'lead',
        'director'];

    protected const RESERVED = [
        'rob', 'ben', 'sam', 'heidi', 'satoshi', 'nakamoto', 'bitcoin', 'btc',
        'crypto', 'blockchain', 'hodl', 'satoshinakamoto', 'cryptoking', 'bitcoinmax',
        'coinmaster', 'hashrate', 'proofofwork', 'cryptoqueen', 'bitcoinminer',
        'satoshivision', 'blockchain', 'bitcoinjesus', 'cryptoanarchist', 'hodler',
        'mstr', 'ver', 'shrem', 'voorhees', 'antonopoulos', 'winklevoss', 'saylor',
        'dorsey', 'mcafee', 'szabo',
    ];

    public function init(): void
    {
        add_shortcode('nostrly_register', [$this, 'registration_shortcode']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_scripts']);
        // Check name availability
        add_action('wp_ajax_nostrly_regcheck', [$this, 'ajax_nostrly_regcheck']);
        add_action('wp_ajax_nopriv_nostrly_regcheck', [$this, 'ajax_nostrly_regcheck']);
        // Checkout and raise invoice
        add_action('wp_ajax_nostrly_checkout', [$this, 'ajax_nostrly_checkout']);
        add_action('wp_ajax_nopriv_nostrly_checkout', [$this, 'ajax_nostrly_checkout']);
        // Check payment status and register user
        add_action('wp_ajax_nostrly_pmtcheck', [$this, 'ajax_nostrly_pmtcheck']);
        add_action('wp_ajax_nopriv_nostrly_pmtcheck', [$this, 'ajax_nostrly_pmtcheck']);
    }

    /**
     * Process registratiion shortcode.
     *
     * @param mixed      $atts
     * @param null|mixed $content
     */
    public function registration_shortcode($atts, $content = null)
    {
        // Enqueue scripts and styles
        wp_enqueue_script('nostrly-register');
        wp_enqueue_style('nostrly-register');

        $headline = esc_html('Register a Nostrly NIP-05 identifier', 'nostrly');
        $xbutton = esc_html('Use Nostr Extension', 'nostrly');
        $title_n = esc_html('Pick a name to register', 'nostrly');
        $title_k = esc_html('Enter your PUBLIC Key (NPUB or HEX)', 'nostrly');
        $warn_pk = esc_html('NB: HEX key entered. Double check this is your public key (NPUB).', 'nostrly');
        $cbutton = esc_html('Proceed to Checkout', 'nostrly');
        $sitedom = parse_url(get_site_url(), PHP_URL_HOST);

        return <<<EOL
            <div class="wrap">
                <h1>{$headline}</h1>

                <div id="pick-name">
                    <label for="reg-username">{$title_n}</label>
                    <div class="username-input">
                        <p><input type="text" id="reg-username" placeholder="username" minlength="2" maxlength="20" style="width: 12rem;"> @{$sitedom}
                        <span id="reg-status" class="reg-status">type in a name to see info...</span></p>
                    </div>
                    <label for="reg-pubkey">{$title_k}</label>
                    <input type="text" id="reg-pubkey" placeholder="npub..." maxlength="64" data-valid="no">&nbsp;
                    <button type="button" id="use-nip07" class="button">{$xbutton}</button>
                    <br><span id="pubkey-warning">{$warn_pk}&nbsp;</span>
                    <p><button disabled id="register-next" class="button">{$cbutton}</button></p>
                    <div id="reg-error" style="display: none">
                        <span id="reg-errortext"></span>
                    </div>
                    <p class="center description">By continuing, you agree to our <a href="/terms">Terms of Service</a>.
                    </p>
                </div>
                <div id="pay-invoice">
                    <p>Please pay this invoice to register <span id="registering-name"></span>.</p>
                    <p><a id="invoice-link"><img id="invoice-img"></a></p>
                    <p><button id="invoice-copy">copy</button></p>
                    <p><button id="cancel-registration">Cancel Registration</button></p>
                </div>

            </div>
            EOL;
    }

    /**
     * Enqueue scripts and styles
     * NB: Called from registration_shortcode() so we only load scripts if needed.
     */
    public function enqueue_scripts(): void
    {
        wp_register_script('nostrly-register', NOSTRLY_URL.'assets/js/nostrly-register.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_register_style('nostrly-register', NOSTRLY_URL.'assets/css/register.css', [], NOSTRLY_VERSION);
        wp_localize_script('nostrly-register', 'nostrly_ajax', [
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('nostrly-nonce'),
            'domain' => parse_url(get_site_url(), PHP_URL_HOST),
        ]);
    }

    public function ajax_nostrly_regcheck()
    {
        // receive
        //
        // data: {
        //       action: "nostrly_regcheck",
        //       nonce: nostrly_ajax.nonce,
        //       name: $username.val()
        //     }
        //
        // return
        // {
        //     "available": false,
        //     "reason": "BLOCKED""
        // }
        // {
        //     "success": true,
        //     "data": {
        //         "name": "scooby",
        //         "available": "true",
        //         "price": "12500",
        //         "length": 6
        //     }
        // }
        // {"error": "blah"}

        // Sanitize and verify nonce
        if (!wp_verify_nonce($_POST['nonce'], 'nostrly-nonce')) {
            wp_send_json_error(['message' => __('Nonce verification failed.', 'nostrly')]);
            wp_die();
        }

        // Sanitize and validate input data
        $name = sanitize_user(wp_unslash($_POST['name'] ?? ''));
        $resp = ['available' => false]; // no!
        $length = strlen($name);
        if ($length < 2) {
            $resp['reason'] = self::ERRORS['SHORT'];
            wp_send_json_error($resp);
        } elseif ($length > 20) {
            $resp['reason'] = self::ERRORS['LONG'];
            wp_send_json_error($resp);
        } elseif (preg_match('/[^a-z0-9]/', $name) > 0) {
            $resp['reason'] = self::ERRORS['INVALID'];
            wp_send_json_error($resp);
        } elseif (in_array($name, self::RESERVED)) {
            $resp['reason'] = self::ERRORS['RESERVED'];
            wp_send_json_error($resp);
        } elseif (in_array($name, self::BLOCKED)) {
            $resp['reason'] = self::ERRORS['BLOCKED'];
            wp_send_json_error($resp);
        } elseif (username_exists($name)) {
            $resp['reason'] = self::ERRORS['REGISTERED'];
            wp_send_json_error($resp);
        }

        // All good, get pricing
        $sats = self::PRICES['default']; // Base price
        if (array_key_exists($length, self::PRICES)) {
            $sats = self::PRICES[$length];
        }

        // Send pricing
        $resp = [
            'name' => $name,
            'available' => 'true',
            'price' => $sats,
            'length' => $length
        ];
        wp_send_json_success($resp);
    }

    public function ajax_nostrly_checkout()
    {
        // todo
    }

    public function ajax_nostrly_pmtcheck()
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
                $this->log_debug('Authtoken failed verification');
                wp_send_json_error(['message' => __('Invalid authtoken.', 'nostrly')]);
            }
        } catch (Throwable $e) {
            wp_send_json_error(['message' => __('Sorry, Nostr Login is currently disabled.', 'nostrly')]);
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

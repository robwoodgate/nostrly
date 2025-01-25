<?php

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}
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
        'default' => '1', // default
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
    protected $domain;

    public function init(): void
    {
        add_shortcode('nostrly_register', [$this, 'registration_shortcode']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_scripts']);
        // Check name availability
        add_action('wp_ajax_nostrly_usrcheck', [$this, 'ajax_nostrly_usrcheck']);
        add_action('wp_ajax_nopriv_nostrly_usrcheck', [$this, 'ajax_nostrly_usrcheck']);
        // Checkout and raise invoice
        add_action('wp_ajax_nostrly_checkout', [$this, 'ajax_nostrly_checkout']);
        add_action('wp_ajax_nopriv_nostrly_checkout', [$this, 'ajax_nostrly_checkout']);
        // Check payment status and register user
        add_action('wp_ajax_nostrly_pmtcheck', [$this, 'ajax_nostrly_pmtcheck']);
        add_action('wp_ajax_nopriv_nostrly_pmtcheck', [$this, 'ajax_nostrly_pmtcheck']);

        $this->domain = parse_url(get_site_url(), PHP_URL_HOST);
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
        $nxbutton = esc_html('Use Nostr Extension', 'nostrly');
        $title_nr = esc_html('Pick a name to register', 'nostrly');
        $title_pk = esc_html('Enter your PUBLIC Key (NPUB or HEX)', 'nostrly');
        $warn_hpk = esc_html('NB: HEX key entered. Double check this is your public key (NPUB).', 'nostrly');
        $cobutton = esc_html('Proceed to Checkout', 'nostrly');
        $copy_inv = esc_html('Copy', 'nostrly');
        $cancelrg = esc_html('Cancel Registration', 'nostrly');
        $subtitle = esc_html('Please pay this invoice to register', 'nostrly');
        $sitedom = parse_url(get_site_url(), PHP_URL_HOST);

        return <<<EOL
            <div id="nostrly-register" class="wrap">
                <h2>{$headline}</h2>

                <div id="pick-name">
                    <label for="reg-username">{$title_nr}</label>
                    <div class="username-input">
                        <p><input type="text" id="reg-username" placeholder="username" minlength="2" maxlength="20" style="width: 12rem;"> @{$sitedom}
                        <span id="reg-status" class="reg-status">type in a name to see info...</span></p>
                    </div>
                    <label for="reg-pubkey">{$title_pk}</label>
                    <input type="text" id="reg-pubkey" placeholder="npub..." maxlength="64" data-valid="no">&nbsp;
                    <button type="button" id="use-nip07" class="button">{$nxbutton}</button>
                    <br><span id="pubkey-warning">{$warn_hpk}&nbsp;</span>
                    <p><button disabled id="register-next" class="button">{$cobutton}</button></p>
                    <div id="reg-error" style="display: none">
                        <span id="reg-errortext"></span>
                    </div>
                    <p class="center description">By continuing, you agree to our <a href="/terms">Terms of Service</a>.
                    </p>
                </div>
                <div id="pay-invoice" style="display:none;">
                    <p>{$subtitle} <span id="name-to-register"></span></p>
                    <p id="amount_to_pay"></p>
                    <p><a id="invoice-link"><img id="invoice-img"/></a></p>
                    <p><button id="invoice-copy" class="button">{$copy_inv}</button></p>
                    <p><button id="cancel-registration" class="button">{$cancelrg}</button></p>
                </div>
                <div id="payment-failed" style="display:none;">
                    <p>Eek! Looks like someone beat you to it, or registration failed for some reason.</p>
                    <p>Please contact us to get a refund WITH the NPUB you used to register, and the payment hash below if you completed payment.</p>
                    <p><pre id="phash"></pre></p
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

    /**
     * Get price for username.
     *
     * @param string $name username to check
     *
     * @return string Price eg: '65000'
     */
    public function get_price($name): string
    {
        $length = strlen($name);
        $sats = self::PRICES['default']; // Base price
        if (array_key_exists($length, self::PRICES)) {
            $sats = self::PRICES[$length];
        }

        return (string) $sats;
    }

    /**
     * Checks username is valid and does not exist.
     *
     * @param string $name  username to check
     * @param array  &$resp adds reason for failure
     *
     * @return bool True: username can be registered
     */
    public function username_isvalid($name, array &$resp = []): bool
    {
        $length = strlen($name);
        $resp['available'] = true; // optimism
        if (preg_match('/[^a-z0-9]/', $name) > 0) {
            $resp['reason'] = self::ERRORS['INVALID'];
            $resp['available'] = false;
            $valid = false;
        } elseif ($length < 2) {
            $resp['reason'] = self::ERRORS['SHORT'];
            $resp['available'] = false;
        } elseif ($length > 20) {
            $resp['reason'] = self::ERRORS['LONG'];
            $resp['available'] = false;
        } elseif (in_array($name, self::RESERVED)) {
            $resp['reason'] = self::ERRORS['RESERVED'];
            $resp['available'] = false;
        } elseif (in_array($name, self::BLOCKED)) {
            $resp['reason'] = self::ERRORS['BLOCKED'];
            $resp['available'] = false;
        } elseif (username_exists($name)) {
            $resp['reason'] = self::ERRORS['REGISTERED'];
            $resp['available'] = false;
        }
        $resp['name'] = sanitize_text_field($name).'@'.$this->domain;
        $resp['length'] = $length;

        return (false == $resp['available']) ? false : true;
    }

    /**
     * Checks username is available.
     *
     * @return JSON
     *
     * {"success": true,
     *  "data": {
     *     "name": "scooby@nostrly.com",
     *     "available": true,
     *     "price": "12500",
     *     "length": 6
     * }}
     *
     * {"success": false,
     *  "data": {
     *     "name": "scooby@nostrly.com",
     *     "available": false,
     *     "reason": "BLOCKED"
     * }}
     */
    public function ajax_nostrly_usrcheck()
    {
        // Sanitize and verify nonce
        if (!wp_verify_nonce($_POST['nonce'] ?? '', 'nostrly-nonce')) {
            wp_send_json_error(['message' => __('Nonce verification failed.', 'nostrly')]);
        }

        // Sanitize and validate input data
        $resp = [];
        $name = sanitize_user(wp_unslash($_POST['name'] ?? ''));
        if (!$this->username_isvalid($name, $resp)) {
            wp_send_json_error($resp);
        }

        // Add in pricing
        $resp['price'] = $this->get_price($name);
        wp_send_json_success($resp);
    }

    /**
     * Creates a lightning invoice.
     *
     * @return JSON Lightning invoice
     *
     * {"post_id":0,"amount":65000,"token":"abc123...","payment_request":"lnbc1..."}
     */
    public function ajax_nostrly_checkout()
    {
        // Sanitize and verify nonce
        if (!wp_verify_nonce($_POST['nonce'] ?? '', 'nostrly-nonce')) {
            wp_send_json_error(['message' => __('Nonce verification failed.', 'nostrly')]);
        }

        // Sanitize input
        $name = sanitize_text_field($_POST['name'] ?? '');
        $pubkey = $this->sanitize_pubkey($_POST['pubkey'] ?? ''); // now hex

        // Validate name
        $resp = [];
        if (!$this->username_isvalid($name, $resp)) {
            wp_send_json_error(['message' => $resp['reason']]);
        }

        // Validate pubkey
        if (empty($pubkey)) {
            wp_send_json_error(['message' => 'Invalid public key']);
        }

        // Check pubkey does not already have an account
        $user = $this->get_user_by_public_key($pubkey);
        if ($user) {
            wp_send_json_error(['message' => 'Your NPUB is already associated with an account']);
        }

        // Check for orders in progress
        $existing_pk = get_transient('nostrly_'.$name, $pubkey);
        if (false !== $existing_pk && $existing_pk != $pubkey) {
            wp_send_json_error(['message' => 'This name is currently being ordered. Try again in 10 minutes.']);
        }

        // Prepare invoice request payload
        $payload = [
            'amount' => $this->get_price($name),
            'currency' => 'btc',
            'memo' => "NIP-05 identifier: {$name}@{$this->domain}",
        ];

        // Use WP REST API internally
        // @see https://wpscholar.com/blog/internal-wp-rest-api-calls/
        // We catch exceptions as the endpoint contacts an external LN server
        try {
            $request = new WP_REST_Request('POST', '/lnp-alby/v1/invoices');
            $request->set_body_params($payload);
            $response = rest_do_request($request);
            if ($response->is_error()) {
                wp_send_json_error(['message' => $response->get_error_message()]);
            }
            $server = rest_get_server();
            $data = $server->response_to_data($response, false); // array
        } catch (Exception $e) {
            error_log($e->getMessage());
            wp_send_json_error(['message' => $e->getMessage()]);
        }

        // Save pubkey transient to prevent overlapping orders
        set_transient('nostrly_'.$name, $pubkey, 720); // 12 minutes

        // Return the invoice data
        wp_send_json_success($data);
    }

    public function ajax_nostrly_pmtcheck()
    {
        // Sanitize and verify nonce
        if (!wp_verify_nonce($_POST['nonce'] ?? '', 'nostrly-nonce')) {
            wp_send_json_error(['message' => __('Nonce verification failed.', 'nostrly')]);
        }

        // Validate token
        $token = sanitize_text_field($_POST['token'] ?? '');
        if (!$token) {
            wp_send_json_error(['message' => __('Invalid token.', 'nostrly')]);
        }

        // Validate name
        $resp = [];
        $name = sanitize_text_field($_POST['name'] ?? '');
        if (!$this->username_isvalid($name, $resp)) {
            wp_send_json_error(['message' => $resp['reason']]);
        }

        // Check invoice payment status
        // We can't use WP REST API internally as the endpoint uses wp_send_json
        // and this terminates script execution immediately
        $api_url = get_rest_url().'lnp-alby/v1/invoices/verify';
        $response = wp_remote_post($api_url, [
            'headers' => [
                'Content-Type' => 'application/json',
            ],
            'body' => json_encode(['token' => $token]),
            'data_format' => 'body',
        ]);

        // Check for errors in the API response
        if (is_wp_error($response)) {
            wp_send_json_error($response->get_error_message());

            return;
        }

        // Check invoice payment status
        // Expected: 200 (paid), 402 (not paid), or 404 (not found)
        $body = json_decode(wp_remote_retrieve_body($response), true);
        $code = wp_remote_retrieve_response_code($response);
        if (empty($body['settled']) && 200 != $code) {
            if (402 == $code) {
                // not paid yet, but ok to wait
                wp_send_json_success($body);
            }
            // Bad news
            wp_send_json_error(['message' => __('Invoice not found.', 'nostrly')]);
        }

        // TODO
        wp_send_json_success($body);

        return;
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

    private function sanitize_pubkey($hexpub)
    {
        try {
            $key = new Key();

            $value = $key->convertPublicKeyToBech32($hexpub);
            if (empty($value) || 0 !== strpos($value, 'npub')) {
                return '';
            }
            $hex = $key->convertToHex($value);

            return (string) $hex;
        } catch (Exception $e) {
            error_log($e->getMessage());

            return '';
        }
    }
}

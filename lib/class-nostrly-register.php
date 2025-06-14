<?php
/**
 * Responsible for account username registrations
 */
if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}
use Firebase\JWT;
use GuzzleHttp\Exception\ClientException;
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
        '2' => '21000',
        '3' => '10000',
        '4' => '9000',
        '5' => '8000',
        '6' => '7000',
        '7' => '6000',
        '8' => '5000',
        '9' => '4000',
        '10' => '3000',
        'default' => '2100', // default
    ];

    protected const BLOCKED = [
        'admin', 'administrator', 'ceo', 'founder', 'root', 'sysadmin', 'webmaster',
        'master', 'owner', 'superuser', 'superadmin', 'support', 'help', 'contact',
        'enquires', 'press', 'pr', 'staff', 'moderator', 'mod', 'operator', 'ops',
        'security', 'secure', 'manager', 'control', 'boss', 'chief', 'head', 'lead',
        'director', 'nostr', 'nostrly'];

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

        $this->domain = preg_replace('/^www\./', '', parse_url(get_site_url(), PHP_URL_HOST));
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
        wp_enqueue_script('confetti');
        wp_enqueue_style('nostrly-register');

        $nxbutton = esc_html('Use Nostr Extension', 'nostrly');
        $title_nr = esc_html('Pick a name to register', 'nostrly');
        $title_pk = esc_html('Enter your PUBLIC Key (NPUB or HEX)', 'nostrly');
        $warn_hpk = esc_html('NB: HEX key entered. Double check this is your public key (NPUB).', 'nostrly');
        $cobutton = esc_html('Proceed to Checkout', 'nostrly');
        $copy_inv = esc_html('Copy', 'nostrly');
        $cancelrg = esc_html('Cancel Registration', 'nostrly');
        $subtitle = esc_html('Please pay this invoice to register', 'nostrly');
        $copypass = esc_html('Copy Password', 'nostrly');
        $cashupay = esc_html('Pay with Cashu ecash?', 'nostrly');
        $sitedom = preg_replace('/^www\./', '', parse_url(get_site_url(), PHP_URL_HOST));
        $profile = admin_url('profile.php');

        return <<<EOL
            <div id="nostrly-register" class="wrap">
                <div id="pick-name">
                    <label for="reg-username">{$title_nr}</label>
                    <div class="username-input">
                        <p><input type="text" id="reg-username" placeholder="username" minlength="2" maxlength="20" style="width: 20rem;"> <span style=font-size:1.5rem;">@{$sitedom}</span>
                        <span id="reg-status" class="reg-status">type a name to see availability and pricing...</span></p>
                    </div>
                    <label for="reg-pubkey">{$title_pk}</label>
                    <input type="text" id="reg-pubkey" placeholder="npub..." maxlength="64">
                    <button type="button" id="use-nip07" class="button">{$nxbutton}</button>
                    <br><span id="pubkey-warning">{$warn_hpk}&nbsp;</span>
                    <div id="reg-error">
                        <span id="reg-errortext"></span>
                    </div>
                    <p><button disabled id="register-next" class="button" data-orig="{$cobutton}">{$cobutton}</button></p>
                    <p class="center description">By continuing, you agree to our <a href="/terms">Terms of Service</a>.
                    </p>
                </div>
                <div id="pay-invoice" style="display:none;">
                    <h2>{$subtitle}<br><span id="name-to-register"></span></h2>
                    <p id="amount_to_pay"></p>
                    <p><a id="invoice-link"><img id="invoice-img"/></a></p>
                    <p><button id="invoice-copy" class="button">{$copy_inv}</button></p>
                    <p><button id="cancel-registration" class="button">{$cancelrg}</button></p>
                    <p><a href="" id="cashu-link" target="_blank">Pay with Cashu ecash?</a></p>
                </div>
                <div id="payment-failed" style="display:none;">
                    <h2>Houston, we have a problem...</h2>
                    <p>Eek! Looks like registration failed for some reason.</p>
                    <p>Please contact us to WITH the NPUB you used to register, and the payment hash below (if you completed payment).</p>
                    <p>We will get the registration completed or refund your payment if the name is not registerable.</p>
                    <p><input type="text" id="payment-hash" maxlength="64"></p>
                </div>
                <div id="payment-suceeded" style="display:none;">
                    <h2>Congratulations!</h2>
                    <p>You have successfully registered: <span id="name-registered"></span></p>
                    <p><strong>YOUR NEXT STEP:</strong> is to add it as the Verified Nostr Address (NIP-05) in your NOSTR profile.</p>
                    <p>You can do this in your favourite NOSTR client, or in <a href="{$profile}#nostr_info">your Nostrly account</a>.</p>
                    <p>As a backup, you can also login using your Nostr Address and the password below:</p>
                    <p style="text-align:center;"><input type="text" id="nip05-password" value="" /></p>
                    <p style="text-align:center;"><button id="password-button" class="button">{$copypass}</button></p>
                    <p style="text-align:center;">Please store this password securely. You can change this password and optionally add an email address for account recovery by logging in to <a href="{$profile}">your Nostrly account.</a></p>
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
        wp_register_script('confetti', 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_register_style('nostrly-register', NOSTRLY_URL.'assets/css/register.css', [], NOSTRLY_VERSION);
    }

    /**
     * Get price for username.
     * Allows NOSTRLY_PRICES override to be set in WP-Config.
     *
     * @param string $name username to check
     *
     * @return string Price eg: '65000'
     */
    public function get_price($name): string
    {
        $length = strlen($name);
        $prices = defined('NOSTRLY_PRICES') ? NOSTRLY_PRICES : self::PRICES;
        $sats = $prices['default'] ?? self::PRICES['default']; // Base price
        if (array_key_exists($length, $prices)) {
            $sats = $prices[$length];
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
            wp_send_json_error(['message' => __('Session Expired. Please refresh the page and try again.', 'nostrly')]);
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
            wp_send_json_error(['message' => __('Session Expired. Please refresh the page and try again.', 'nostrly')]);
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
            wp_send_json_error(['message' => 'This name is currently reserved. Try again later.']);
        }

        // Prepare invoice request payload
        $payload = [
            'amount' => $this->get_price($name),
            'currency' => 'btc',
            'memo' => "{$name} Nostrly Address",
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
        } catch (ClientException $e) {
            $response = $e->getResponse();
            error_log('ajax_nostrly_checkout error: '.$response->getBody()->getContents());
            wp_send_json_error(['message' => 'There was a problem creating the invoice. Please contact us']);
        } catch (Exception $e) {
            error_log('ajax_nostrly_checkout error: '.$e->getMessage());
            wp_send_json_error(['message' => 'There was a problem creating the invoice. Please contact us']);
        }

        // Decode the token to get payment hash
        try {
            $jwt = JWT\JWT::decode($data['token'], new JWT\Key(BLN_PUBLISHER_PAYWALL_JWT_KEY, BLN_PUBLISHER_PAYWALL_JWT_ALGORITHM));
            // error_log(print_r($jwt, true));
        } catch (Exception $e) {
            error_log('ajax_nostrly_checkout error: '.$e->getMessage());
            wp_send_json_error(['message' => 'There was a problem creating the invoice. Please contact us']);
        }

        // Tweak the data
        unset($data['post_id']);
        $data['payment_hash'] = $jwt->{'r_hash'};

        // BLN Publisher doesn't save comment, so lets save the name there
        global $wpdb;
        $wpdb->update($wpdb->prefix.'lightning_publisher_payments', [
            'comment' => $name,
        ], ['payment_hash' => $data['payment_hash']]);

        // Save pubkey transient to prevent overlapping orders
        set_transient('nostrly_'.$name, $pubkey, 720); // 12 minutes

        // Return the invoice data
        wp_send_json_success($data);
    }

    public function ajax_nostrly_pmtcheck()
    {
        // Sanitize and verify nonce
        if (!wp_verify_nonce($_POST['nonce'] ?? '', 'nostrly-nonce')) {
            wp_send_json_error(['message' => __('Session Expired. Please refresh the page and try again.', 'nostrly')]);
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
        try {
            $api_url = get_rest_url().'lnp-alby/v1/invoices/verify';
            $response = wp_remote_post($api_url, [
                'headers' => [
                    'Content-Type' => 'application/json',
                ],
                'body' => json_encode(['token' => $token]),
                'data_format' => 'body',
            ]);
        } catch (Exception $e) {
            error_log($e->getMessage());
            wp_send_json_error(['message' => $e->getMessage()]);
        }

        // Check for errors in the API response
        if (is_wp_error($response)) {
            wp_send_json_error(['message' => $response->get_error_message()]);

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
            wp_send_json_error(['message' => __('Invoice not found or expired.', 'nostrly')]);
        }

        // Create user
        $password = wp_generate_password();
        $existing_user = get_user_by('login', $name);
        $user_id = wp_create_user($name, $password);
        $public_key = get_transient('nostrly_'.$name);
        if (!is_wp_error($user_id) && false !== $public_key) {
            // Set public key
            update_user_meta($user_id, 'nostr_public_key', sanitize_text_field($public_key));

            // Login user. This is ok here because it will ONLY happen
            // when the account is first being created (wp_create_user).
            // wp_set_current_user($user_id);
            // wp_set_auth_cookie($user_id);
            wp_send_json_success(['paid' => true, 'password' => $password]);
        }

        // Still here... bad!
        wp_send_json_error(['message' => 'Account creation failed. Please contact us.']);
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

    private function sanitize_pubkey($hexpub)
    {
        try {
            $key = new Key();

            $value = $key->convertPublicKeyToBech32($hexpub);
            if (empty($value) || 0 !== strpos($value, 'npub')) {
                return '';
            }
            $hex = $key->convertToHex($value);
            if (!ctype_xdigit($hex) || 64 !== strlen($hex)) {
                return ''; // Ensure it's exactly 64 hex characters
            }

            return (string) $hex;
        } catch (Exception $e) {
            error_log($e->getMessage());

            return '';
        }
    }
}

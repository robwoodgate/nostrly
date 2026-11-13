<?php
/**
 * Responsible for account username registrations
 */
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
        // Paid in Sats webhook
        add_action('rest_api_init', [$this, 'register_routes']);

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

        $nxbutton = esc_html__('Use Nostr Extension', 'nostrly');
        $title_nr = esc_html__('Pick a name to register', 'nostrly');
        $title_pk = esc_html__('Enter your PUBLIC Key (NPUB or HEX)', 'nostrly');
        $warn_hpk = esc_html__('NB: HEX key entered. Double check this is your public key (NPUB).', 'nostrly');
        $cobutton = esc_html__('Proceed to Checkout', 'nostrly');
        $copy_inv = esc_html__('Copy', 'nostrly');
        $cancelrg = esc_html__('Cancel Registration', 'nostrly');
        $subtitle = esc_html__('Please pay this invoice to register', 'nostrly');
        $copypass = esc_html__('Copy Password', 'nostrly');
        $cashupay = esc_html__('Pay with Cashu ecash?', 'nostrly');
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
        wp_register_script('nostrly-register', NOSTRLY_URL.'assets/js/nostrly-register.min.js', ['nostrly-vendor'], NOSTRLY_VERSION, false); // NB: head
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
     * Creates a lightning invoice for a name, via Paid in Sats.
     *
     * @return JSON {"amount":65000,"token":"abc123...","payment_request":"lnbc1...","payment_hash":"..."}
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

        // Check for orders in progress, and reuse this buyer's open invoice
        $order = get_transient('nostrly_'.$name);
        if (false !== $order) {
            if (!is_array($order) || $order['pubkey'] !== $pubkey) {
                wp_send_json_error(['message' => 'This name is currently reserved. Try again later.']);
            }
            wp_send_json_success($order['data']);
        }

        $payment = $this->paidinsats('POST', '/api/v1/payments', [
            'amount' => (int) $this->get_price($name),
            'currency' => 'SAT',
            'reference' => "{$name} Nostrly Address",
            'memo' => "Nostrly: {$name}",
            'external_reference' => "nostrly:{$name}:{$pubkey}",
        ]);
        if (empty($payment['payment_request'])) {
            wp_send_json_error(['message' => 'There was a problem creating the invoice. Please contact us']);
        }
        $data = [
            'amount' => (int) $payment['total_sats'],
            'token' => $payment['id'],
            'payment_request' => $payment['payment_request'],
            'payment_hash' => $payment['payment_hash'],
        ];

        // Reserve the name for as long as the invoice is open
        $ttl = max(60, strtotime($payment['expires_at']) - time());
        set_transient('nostrly_'.$name, ['pubkey' => $pubkey, 'data' => $data], $ttl);

        // Only this response carries the code that collects the password
        $data['token'] .= '.'.$this->claim_code($payment['id']);
        wp_send_json_success($data);
    }

    /**
     * Polled by the register page: reports the payment and, once paid, hands
     * the new account its backup password (once).
     */
    public function ajax_nostrly_pmtcheck()
    {
        // Sanitize and verify nonce
        if (!wp_verify_nonce($_POST['nonce'] ?? '', 'nostrly-nonce')) {
            wp_send_json_error(['message' => __('Session Expired. Please refresh the page and try again.', 'nostrly')]);
        }

        // Validate token: the payment id, then the claim code if this page has it
        if (!preg_match('/^([0-9a-f]{16,64})(?:\.([0-9a-f]{64}))?$/', (string) ($_POST['token'] ?? ''), $m)) {
            wp_send_json_error(['message' => __('Invalid token.', 'nostrly')]);
        }
        $token = $m[1];
        $can_claim = isset($m[2]) && hash_equals($this->claim_code($token), $m[2]);

        // The webhook may have registered the account already
        $user = $this->get_user_by_payment($token);
        if (!$user) {
            $payment = $this->paidinsats('GET', '/api/v1/payments/'.$token);
            $state = $payment['state'] ?? '';
            if ('pending' === $state) {
                wp_send_json_success(['paid' => false]); // not paid yet, but ok to wait
            }
            if ('paid' !== $state) {
                wp_send_json_error(['message' => __('Invoice not found or expired.', 'nostrly')]);
            }
            $user = $this->fulfil($payment);
            if (is_wp_error($user) && ($registered = $this->get_user_by_payment($token))) {
                $user = $registered; // the webhook got there first
            }
            if (is_wp_error($user)) {
                error_log('nostrly_pmtcheck: '.$token.' '.$user->get_error_message());
                wp_send_json_error(['message' => 'Account creation failed. Please contact us.']);
            }
        }

        // The password is shown once, to the page that created the invoice
        $password = '';
        if ($can_claim && delete_user_meta($user->ID, 'nostrly_password_unclaimed')) {
            $password = wp_generate_password();
            wp_set_password($password, $user->ID);
        }
        wp_send_json_success(['paid' => true, 'password' => $password]);
    }

    public function register_routes(): void
    {
        register_rest_route('nostrly/v1', '/paidinsats', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_paidinsats_webhook'],
            'permission_callback' => '__return_true', // signed: see callback
        ]);
    }

    /**
     * Paid in Sats webhook: registers the account when its payment is paid.
     * Answers 200 to anything correctly signed, as a retry cannot fix a refusal.
     */
    public function rest_paidinsats_webhook(WP_REST_Request $request)
    {
        $secret = defined('NOSTRLY_PIS_WEBHOOK_SECRET') ? NOSTRLY_PIS_WEBHOOK_SECRET : '';
        $body = $request->get_body();
        parse_str(str_replace(',', '&', (string) $request->get_header('x-paidinsats-signature')), $sig);
        $t = (string) ($sig['t'] ?? '');
        $mac = hash_hmac('sha256', $t.'.'.$body, $secret);
        if (!$secret || !ctype_digit($t) || abs(time() - (int) $t) > 300
            || !hash_equals($mac, (string) ($sig['v1'] ?? ''))) {
            return new WP_REST_Response(['error' => 'bad_signature'], 401);
        }

        $event = json_decode($body, true);
        $payment = $event['payment'] ?? [];
        $ref = (string) ($payment['external_reference'] ?? '');
        if ('payment.paid' === ($event['event'] ?? '') && 0 === strpos($ref, 'nostrly:')) {
            $user = $this->fulfil($payment);
            if (is_wp_error($user)) {
                error_log('nostrly webhook: '.($payment['id'] ?? '').' '.$user->get_error_message());
            }
        }

        return new WP_REST_Response(['ok' => true], 200);
    }

    /**
     * Registers the account a paid payment was for. Safe to call twice.
     * The name and pubkey come from the payment's external_reference.
     *
     * @param array $payment a Paid in Sats payment object
     *
     * @return WP_Error|WP_User
     */
    private function fulfil(array $payment)
    {
        $id = (string) ($payment['id'] ?? '');
        $ref = (string) ($payment['external_reference'] ?? '');
        if ('paid' !== ($payment['state'] ?? '') || '' === $id
            || !preg_match('/^nostrly:([a-z0-9]{2,20}):([0-9a-f]{64})$/', $ref, $m)) {
            return new WP_Error('nostrly_payment', 'not a paid registration');
        }
        [, $name, $pubkey] = $m;

        $user = $this->get_user_by_payment($id);
        if ($user) {
            return $user;
        }
        if ((int) ($payment['total_sats'] ?? 0) < (int) $this->get_price($name)) {
            return new WP_Error('nostrly_payment', "underpaid for {$name}");
        }
        $resp = [];
        if (!$this->username_isvalid($name, $resp)) {
            return new WP_Error('nostrly_payment', "{$name}: {$resp['reason']}");
        }
        if ($this->get_user_by_public_key($pubkey)) {
            return new WP_Error('nostrly_payment', "pubkey for {$name} already has an account");
        }

        $user_id = wp_create_user($name, wp_generate_password());
        if (is_wp_error($user_id)) {
            return $user_id;
        }
        update_user_meta($user_id, 'nostr_public_key', $pubkey);
        update_user_meta($user_id, 'nostrly_payment_id', $id);
        update_user_meta($user_id, 'nostrly_password_unclaimed', 1);
        delete_transient('nostrly_'.$name);

        return get_user_by('id', $user_id);
    }

    /**
     * Calls the Paid in Sats API with the key from wp-config.
     *
     * @return null|array decoded response, null on any failure
     */
    private function paidinsats(string $method, string $path, ?array $body = null): ?array
    {
        if (!defined('NOSTRLY_PIS_API_KEY')) {
            error_log('nostrly: NOSTRLY_PIS_API_KEY is not set');

            return null;
        }
        $base = defined('NOSTRLY_PIS_URL') ? NOSTRLY_PIS_URL : 'https://paidinsats.com';
        $response = wp_remote_request($base.$path, [
            'method' => $method,
            'timeout' => 20,
            'headers' => [
                'Authorization' => 'Bearer '.NOSTRLY_PIS_API_KEY,
                'Content-Type' => 'application/json',
            ],
            'body' => null === $body ? null : wp_json_encode($body),
        ]);
        $code = wp_remote_retrieve_response_code($response);
        if (is_wp_error($response) || $code < 200 || $code > 299) {
            $why = is_wp_error($response) ? $response->get_error_message() : $code.' '.wp_remote_retrieve_body($response);
            error_log("nostrly: paidinsats {$method} {$path} failed: {$why}");

            return null;
        }
        $data = json_decode(wp_remote_retrieve_body($response), true);

        return is_array($data) ? $data : null;
    }

    private function claim_code(string $payment_id): string
    {
        return hash_hmac('sha256', $payment_id, wp_salt('auth'));
    }

    private function get_user_by_payment(string $payment_id)
    {
        $users = get_users([
            'meta_key' => 'nostrly_payment_id',
            'meta_value' => $payment_id,
            'number' => 1,
            'count_total' => false,
        ]);

        return !empty($users) ? $users[0] : false;
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

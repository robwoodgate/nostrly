<?php
/**
 * Responsible for our various tool shortcodes
 */
if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

class NostrlyTools
{
    protected $domain;

    public function init(): void
    {
        add_shortcode('nostrly_key_converter', [$this, 'key_converter_shortcode']);
        add_shortcode('nostrly_nip19_decoder', [$this, 'nip19_decoder_shortcode']);
        add_shortcode('nostrly_zapevent', [$this, 'zapevent_shortcode']);
        add_shortcode('nostrly_nip09_deleter', [$this, 'nip09_deleter_shortcode']);
        add_shortcode('nostrly_cashu_redeem', [$this, 'cashu_redeem_shortcode']);
        add_shortcode('nostrly_cashu_lock', [$this, 'cashu_lock_shortcode']);
        add_shortcode('nostrly_cashu_witness', [$this, 'cashu_witness_shortcode']);
        add_shortcode('nostrly_cashu_cache', [$this, 'cashu_cache_shortcode']);
        add_shortcode('nostrly_cashu_gather', [$this, 'cashu_gather_shortcode']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_filter('script_loader_src', [$this, 'script_loader_src'], 9999);
        add_filter('style_loader_src', [$this, 'script_loader_src'], 9999);

        $this->domain = preg_replace('/^www\./', '', parse_url(get_site_url(), PHP_URL_HOST));
    }

    /**
     * Key converter shortcode.
     *
     * @param mixed      $atts
     * @param null|mixed $content
     */
    public function key_converter_shortcode($atts, $content = null)
    {
        // Enqueue scripts and styles
        wp_enqueue_script('nostrly-tools');
        // wp_enqueue_style('nostrly-tools');

        $nlab = esc_attr('Nostr public key (npub):', 'nostrly');
        $xlab = esc_attr('Nostr public key (hex):', 'nostrly');
        $npub = esc_attr('Paste your npub here', 'nostrly');
        $xpub = esc_attr('Paste your hex key here', 'nostrly');
        $reset = esc_html('Reset fields', 'nostrly');

        return <<<EOL
                <div class="form" id="key_converter">
                    <style>
                        #key_converter label {
                            display: block;
                            font-weight: bold;
                            margin-bottom: 0.25rem;
                        }
                        #key_converter input {
                            border-radius: 6px;
                            margin-bottom: 1.24rem;
                            text-transform: lowercase !important;
                            width: 100%;
                        }
                    </style>
                    <form>
                        <label for="npub">{$nlab}</label>
                        <input type="text" placeholder="{$npub}" value="" id="npub">
                        <label for="hex">{$xlab}</label>
                        <input type="text" placeholder="{$xpub}" value="" id="hex">
                        <input type="reset" class="button reset" value="{$reset}">
                    </form>
                </div>
            EOL;
    }

    /**
     * Key converter shortcode.
     *
     * @param mixed      $atts
     * @param null|mixed $content
     */
    public function nip19_decoder_shortcode($atts, $content = null)
    {
        // Enqueue scripts and styles
        wp_enqueue_script('nostrly-tools');
        // wp_enqueue_style('nostrly-tools');

        $nlab = esc_attr('NIP-19 entity:', 'nostrly');
        $xlab = esc_attr('Decoded entity:', 'nostrly');
        $entity = esc_attr('npub | nsec | nprofile | nevent | naddr | nrelay | note', 'nostrly');
        $decode = esc_attr('The decoded entity will appear here', 'nostrly');
        $reset = esc_html('Reset fields', 'nostrly');

        return <<<EOL
                <div class="form" id="nip19_decoder">
                    <style>
                        #nip19_decoder label {
                            display: block;
                            font-weight: bold;
                            margin-bottom: 0.25rem;
                        }
                        #nip19_decoder input {
                            border-radius: 6px;
                            margin-bottom: 1.24rem;
                            text-transform: lowercase !important;
                            width: 100%;
                        }
                    </style>
                    <form>
                        <label for="nip19_entity">{$nlab}</label>
                        <input type="text" placeholder="{$entity}" value="" id="nip19_entity">
                        <label for="decode">{$xlab}</label>
                        <textarea id="nip19_decode" rows="10" cols="50" placeholder="{$decode}"></textarea>
                        <input type="reset" class="button reset" value="{$reset}">
                    </form>
                </div>
            EOL;
    }

    /**
     * Event zapper shortcode.
     *
     * @param mixed      $atts
     * @param null|mixed $content
     */
    public function zapevent_shortcode($atts, $content = null)
    {
        // Enqueue scripts and styles
        wp_enqueue_script('nostrly-tools');
        wp_enqueue_script('confetti');
        // wp_enqueue_style('nostrly-tools');

        $nlab = esc_attr('Note ID (nevent) or User Public Key (npub):', 'nostrly');
        $alab = esc_attr('Amount (in sats):', 'nostrly');
        $clab = esc_attr('Comment (optional):', 'nostrly');
        $cancl = esc_html('Cancel', 'nostrly');
        $copyl = esc_html('Copy Invoice', 'nostrly');
        $payb = esc_html('Zap Now', 'nostrly');
        $reset = esc_html('Reset fields', 'nostrly');

        return <<<EOL
                <div class="form" id="zapevent">
                    <style>
                        #zapevent label {
                            display: block;
                            font-weight: bold;
                            margin-bottom: 0.25rem;
                        }
                        #zapevent input {
                            border-radius: 6px;
                            margin-bottom: 1.24rem;
                            text-transform: lowercase !important;
                            width: 100%;
                        }
                        #zap-pay {
                            text-align: center;
                        }
                        #zap-to {
                            font-size: 1.8rem;
                            font-weight: bold;
                            margin-bottom: 0;
                        }
                        #zap-invoice-copy {
                            margin-right: 20px;
                        }
                        #zap-amount, #zap-sent {
                            font-size: 1.5rem;
                            line-height: 1;
                            margin: 0.5rem 0 1.5rem 0;
                        }
                        #zap-pay-button:disabled {
                            opacity: 0.6;
                        }
                    </style>
                    <form id="zap-init">
                        <label for="nevent">{$nlab}</label>
                        <input type="text" placeholder="nevent | npub" value="" id="nevent">
                        <label for="amount">{$alab}</label>
                        <input type="text" placeholder="21" value="" id="amount">
                        <label for="comment">{$clab}</label>
                        <input type="text" placeholder="sent via nostrly web zap 🫡" value="" id="comment">
                        <p><button id="zap-pay-button" disabled class="button">{$payb}</button>&nbsp;&nbsp;&nbsp;<a href="#" id="zap-reset">Reset defaults</a></p>
                    </form>
                    <div id="zap-pay" style="display:none;">
                        <p id="zap-to"></p>
                        <p id="zap-amount"></p>
                        <p id="zap-sent" style="display:none;">Success! Zap sent.</p>
                        <p><a id="zap-invoice-link"><img id="zap-invoice-img"/></a></p>
                        <p><button id="zap-invoice-copy" class="button">{$copyl}</button>
                        <button id="zap-cancel" class="button">{$cancl}</button></p>
                        <p><a id="zap-cashu-link" target="_blank">Pay with Cashu ecash?</a></p>
                    </div>
                </div>
            EOL;
    }

    /**
     * NIP-09 event delete shortcode.
     *
     * @param mixed      $atts
     * @param null|mixed $content
     */
    public function nip09_deleter_shortcode($atts, $content = null)
    {
        // Enqueue scripts and styles
        wp_enqueue_script('nostrly-tools');
        wp_enqueue_script('confetti');

        $nlab = esc_attr('Note ID (nevent):', 'nostrly');
        $delb = esc_html('Request Delete', 'nostrly');
        $reset = esc_html('Reset fields', 'nostrly');
        $delok = esc_attr('Delete request sent!');

        return <<<EOL
                <div class="form" id="delevent">
                    <style>
                        #delevent label {
                            display: block;
                            font-weight: bold;
                            margin-bottom: 0.25rem;
                        }
                        #delevent input {
                            border-radius: 6px;
                            margin-bottom: 1.24rem;
                            text-transform: lowercase !important;
                            width: 100%;
                        }
                        #del-sent {
                            font-size: 1.5rem;
                            font-weight: bold;
                            line-height: 1;
                            margin: 0.5rem 0 1.5rem 0;
                            text-align: center;
                        }
                        #del-button:disabled {
                            opacity: 0.6;
                        }
                    </style>
                    <form id="del-init">
                        <p id="del-sent" data-orig="{$delok}" style="display:none;">{$delok}</p>
                        <label for="del-nevent">{$nlab}</label>
                        <input type="text" placeholder="nevent" value="" id="del-nevent">
                        <p><button id="del-button" disabled class="button">{$delb}</button>&nbsp;&nbsp;&nbsp;<a href="#" id="del-reset">{$reset}</a></p>
                    </form>
                </div>
            EOL;
    }

    /**
     * Cashu redeem shortcode.
     *
     * @param mixed      $atts
     * @param null|mixed $content
     */
    public function cashu_redeem_shortcode($atts, $content = null)
    {
        // Enqueue scripts and styles
        wp_enqueue_script('nostrly-cashu-redeem');
        wp_enqueue_script('confetti');

        $token_label = esc_attr('Cashu token (or emoji 🥜)', 'nostrly');
        $token = esc_attr('Paste the Cashu ecash token (or ecash emoji 🥜) to redeem...', 'nostrly');
        $pkey_label = esc_html('Compatible Extension Not Detected - Enter Private Key To Unlock Token', 'nostrly');
        $pkey_desc = sprintf(esc_html('Your private key is NEVER sent to our server or the mint. For maximum security, however, we recommend using a %5$snip60%4$s compatible Nostr extension like %1$sAlby%4$s, %2$sAKA Profiles%4$s or %3$snos2X%4$s.', 'nostrly'),
            '<a href="https://getalby.com/products/browser-extension" target="_blank">',
            '<a href="https://chromewebstore.google.com/detail/aka-profiles/ncmflpbbagcnakkolfpcpogheckolnad" target="_blank">',
            '<a href="https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp" target="_blank">',
            '</a>',
            '<a href="https://github.com/nostr-protocol/nips/pull/1890" target="_blank">',
        );
        $pkey = esc_html('Token Private Key (P2PK / nsec)', 'nostrly');
        $lnurl_label = esc_html('Lightning address/invoice/LNURL', 'nostrly');
        $lnurl = esc_html('Enter a Lightning address, Lightning invoice or LNURL', 'nostrly');
        $redeem = esc_html('Redeem Token', 'nostrly');

        return <<<EOL
                <style>
                    #cashu-redeem {
                      margin-bottom: 40px;
                    }
                    #cashu-redeem label {
                      font-weight: bold;
                      margin-bottom: 0;
                      text-align: left;
                    }
                    #cashu-redeem .sublabel {
                        font-size: 0.8rem;
                    }
                    #cashu-redeem input, #cashu-redeem textarea {
                      border-radius: 6px;
                      padding: 6px 15px;
                      width: 100%;
                    }
                    .center {
                      text-align: center;
                    }
                    .hidden {
                      display: none;
                    }
                    .text-wrapper {
                      margin: 3px auto;
                      position: relative;
                      width: 100%;
                    }
                    .text-remover {
                      border-radius: 6px;
                      font-size: 20px;
                      font-weight: bolder;
                      padding: 5px 10px;
                      position: absolute;
                      right: 0;
                      top: 0;
                    }
                    #lightningStatus, #tokenStatus {
                      color: #37e837;
                      font-size: 1.5rem;
                      font-weight: bold;
                      line-height: 1.35;
                      margin: 0.5em 0;
                      text-align: center;
                    }
                    #lightningStatus {
                      font-size: 1.25rem;
                    }
                    #redeem {
                        margin: 1em auto;
                    }
                </style>
                <div id="cashu-redeem">
                  <label for="token">{$token_label}</label>
                  <div id="tokenWrapper" class="text-wrapper">
                    <textarea id="token" rows="4" cols="50" placeholder="{$token}"></textarea>
                    <button id="tokenRemover" class="text-remover hidden">&times;</button>
                  </div>
                  <div id="pkeyWrapper" class="text-wrapper hidden">
                    <label for="pkey">{$pkey_label}</label>
                    <div class="sublabel text-wrapper">$pkey_desc</div>
                    <input type="text" placeholder="{$pkey}" value="" id="pkey">
                  </div>
                  <label for="lnurl">{$lnurl_label}</label>
                  <div id="lnurlWrapper" class="text-wrapper">
                    <input type="text" placeholder="{$lnurl}" value="" id="lnurl">
                    <button id="lnurlRemover" class="text-remover hidden">&times;</button>
                  </div>
                  <div class="center">
                    <p id="tokenStatus" class="text-wrapper"></p>
                    <p id="lightningStatus" class="text-wrapper"></p>
                    <button id="redeem" class="button" disabled>{$redeem}</button>
                  </div>
                </div>
            EOL;
    }

    /**
     * Cashu lock shortcode.
     *
     * @param mixed      $atts
     * @param null|mixed $content
     */
    public function cashu_lock_shortcode($atts, $content = null)
    {
        // Enqueue scripts and styles
        wp_enqueue_script('nostrly-cashu-lock');
        wp_enqueue_script('confetti');

        $nxbutton = esc_html('Use Nostr Extension', 'nostrly');
        $subtitle = esc_html('Lightning Invoice', 'nostrly');
        $copy_inv = esc_html('Copy', 'nostrly');
        $copy_token = esc_html('Copy Token', 'nostrly');
        $copy_emoji = esc_html('Copy 🥜', 'nostrly');
        $cancel = esc_html('Cancel', 'nostrly');

        return <<<EOL
                <style>
                    /* Base form styling */
                    #cashu-lock-form {
                        margin-bottom: 40px;
                    }
                    #cashu-lock-form label {
                        display: block;
                        font-weight: bold;
                        margin-bottom: 0;
                        text-align: left;
                    }
                    #cashu-lock-form label.center {
                        text-align: center;
                    }
                    #cashu-lock-form div {
                        margin-bottom: 1rem;
                    }
                    /* Common input styles */
                    #cashu-lock-form input,
                    #cashu-lock-form textarea,
                    #cashu-lock-form select,
                    #cashu-lock-success textarea {
                        border-radius: 6px;
                        margin-bottom: 0.25em;
                        padding: 6px 15px;
                        width: 100%;
                    }
                    #cashu-lock-form input[type="checkbox"] {
                        height: 1rem;
                        margin-right: 0.25rem;
                        width: 1rem;
                    }
                    /* Validation feedback */
                    #cashu-lock-form [data-valid="no"] {
                        border: 2px solid rgb(204, 55, 55);
                        background-color: rgba(204, 55, 55, 0.3);
                        color: white;
                    }
                    /* Utility classes */
                    .center {
                        text-align: center;
                    }
                    .hidden {
                        display: none;
                    }
                    .strong {
                        font-weight: bold;
                    }
                    .description {
                        font-size: 0.85rem;
                        margin-top: 0.5rem;
                        color: #ccc;
                    }
                    /* Refund NPUB container */
                    #refund-npub-container {
                        display: flex;
                    }
                    #refund-npub {
                        flex: 1;
                        margin-right: 5px;
                        max-width: calc(100% - 14rem);
                        text-align: left;
                    }
                    #use-nip07 {
                        flex: 0 0 auto;
                        width: 13rem;
                    }
                    /* Buttons and interactive elements */
                    #lock-next {
                        margin: 1em auto;
                        max-width: 20em;
                    }
                    #lock-next:disabled {
                        opacity: 0.6;
                    }
                    #add_donation {
                        max-width: 180px;
                        display: block;
                        margin: 0 auto;
                    }
                    #clear-history {
                        border-radius: 6px;
                        display: inline-block;
                        margin: 0 0.25rem;
                        padding: 0 0.5rem;
                    }
                    /* Payment section */
                    #cashu-lock-pay .subtitle {
                        font-weight: bold;
                        margin-top: 2rem;
                    }
                    #payby-cashu {
                        margin-top: 0.5rem;
                        padding: 1rem;
                        max-width: 300px;
                    }
                    .mint_url {
                        border: 1px solid white;
                        border-radius: 6px;
                        display: inline-block;
                        margin: 0.5rem;
                        padding: 0 10px;
                        width: fit-content;
                    }
                    #amount_to_pay,
                    .copytkn,
                    .copyemj {
                        border-radius: 6px;
                        display: inline-block;
                        background-color: #FF9900;
                        color: #000;
                        padding: 0 0.25rem;
                    }
                    #locked-emoji-copy {
                        margin-left: 1rem;
                    }
                    /* History section */
                    #history {
                        border: 1px solid #ccc;
                        border-radius: 6px;
                        margin-top: 3rem;
                        padding: 1px;
                    }
                    #history ul {
                        margin-left: 0;
                        padding-left: 0;
                    }
                    .history-item {
                        border-top: 1px solid #ccc;
                        cursor: pointer;
                        list-style: none;
                        padding: 5px;
                        text-align: left;
                    }
                    .history-item:hover {
                        color: #fff;
                    }
                    /* Multisig and refund key options */
                    #cashu-lock-form a#add-multisig,
                    #cashu-lock-form a#add-refund-keys {
                        display: block;
                        margin-top: 0.5rem;
                        font-size: 0.9rem;
                        color: #FF9900;
                        text-decoration: none;
                    }
                    #cashu-lock-form a#add-multisig:hover,
                    #cashu-lock-form a#add-refund-keys:hover {
                        text-decoration: underline;
                    }
                    #multisig-options,
                    #refund-keys-options {
                        margin-top: 0.75rem;
                        padding: 0.75rem;
                        background-color: rgba(255, 255, 255, 0.05);
                        border-radius: 6px;
                        transition: all 0.3s ease;
                    }
                    #cashu-lock-form textarea {
                        resize: vertical;
                        min-height: 60px;
                        font-family: monospace;
                    }
                    #n-sigs {
                        width: 80px;
                        display: inline-block;
                        margin-left: 0.5rem;
                    }
                    /* Media queries */
                    @media (max-width: 600px) {
                        #refund-npub-container {
                            flex-direction: column;
                        }
                        #refund-npub {
                            max-width: 100%;
                            margin-right: 0;
                            margin-bottom: 5px;
                        }
                        #use-nip07 {
                            width: 100%;
                        }
                        #n-sigs {
                            width: 100%;
                            margin-left: 0;
                            margin-top: 0.25rem;
                        }
                        #multisig-options,
                        #refund-keys-options {
                            padding: 0.5rem;
                        }
                    }
                </style>
                <div id="cashu-lock-form">
                    <div>
                        <label for="mint-select">Choose a Mint:</label>
                        <select id="mint-select" name="mint-select" required>
                            <option value="" disabled selected>Select a mint...</option>
                            <option value="http://localhost:3338">http://localhost:3338 (TEST MINT)</option>
                            <option value="https://mint.minibits.cash/Bitcoin">https://mint.minibits.cash/Bitcoin</option>
                            <option value="https://mint.103100.xyz">https://mint.103100.xyz</option>
                            <option value="https://mint.coinos.io">https://mint.coinos.io</option>
                            <option value="discover">Discover more mints...</option>
                        </select>
                        <div class="description">Choose the NUT-11 compliant mint you are comfortable using. If a mint is not in the list, it may not be NUT-11 compliant, or is not known to <a href="https://audit.8333.space" target="_blank">Cashu Auditor</a> (in which case, <a href="https://audit.8333.space" target="_blank">donating a token from that mint</a> will add it to the list)</div>
                    </div>
                    <div>
                        <label for="lock-value">Token Value (sats):</label>
                        <input type="number" id="lock-value" name="lock-value" min="1" step="1" placeholder="1000" required>
                    </div>
                    <div>
                        <label>
                            <input type="checkbox" id="prefer-nip61">
                            Prefer NIP-61 Pubkeys?
                        </label>
                        <div class="description">Check this box if you want NutLock to replace Nostr NPUBs with the user's corresponding NIP-61 pubkey, if found. This adds security, but may make the token harder to redeem as not all Cashu wallets support NIP-61. <a href="https://www.nostrly.com/cashu-witness/" target="_blank">Cashu Witness</a> and <a href="https://www.nostrly.com/cashu-redeem/" target="_blank">Cashu Redeem</a> support NIP-61.</div>
                    </div>
                    <div>
                        <label>
                            <input type="checkbox" id="use-p2bk">
                            Use Pay-to-Blinded-Key (P2BK)?
                        </label>
                        <div class="description"><strong>WARNING: THIS IS AN EXPERIMENTAL OPTION! Don't be reckless!</strong><br>Check this box if you want NutLock to blind all public keys and create a <a href="https://github.com/cashubtc/nuts/pull/291" target="_blank">P2BK secret</a>. This adds privacy, but requires a PRIVATE KEY, or a NIP-60 wallet (for NIP-61 pubkeys), to redeem. You CANNOT sign P2BK tokens with NIP-07. <a href="https://www.nostrly.com/cashu-witness/" target="_blank">Cashu Witness</a> and <a href="https://www.nostrly.com/cashu-redeem/" target="_blank">Cashu Redeem</a> support P2BK.</div>
                    </div>
                    <div>
                        <label for="lock-npub">Lock Token to Public Key (NPUB/P2PK):</label>
                        <input type="text" id="lock-npub" name="lock-npub" placeholder="npub1... | 02..." required>
                        <div class="description">Token will be exclusively redeemable by the owner of this public key until the lock expires</div>
                        <a href="#" id="add-multisig">+ Add Multisig</a>
                        <div id="multisig-options" class="hidden">
                            <label for="extra-lock-keys">Additional Locking Pubkeys (one per line or CSV):</label>
                            <textarea id="extra-lock-keys" name="extra-lock-keys" rows="3" placeholder="npub1...\n02..."></textarea>
                            <label for="n-sigs">Signatures Required (n_sigs):</label>
                            <input type="number" id="n-sigs" name="n-sigs" min="1" step="1" value="1" required>
                            <div class="description">Number of signatures needed to unlock (e.g., 2 for 2-of-3 multisig).</div>
                        </div>
                    </div>
                    <div>
                        <label for="lock-expiry">Lock Expires (Local Time):</label>
                        <input type="datetime-local" id="lock-expiry" name="lock-expiry" required>
                    </div>
                    <!-- Refund Token Section -->
                    <div>
                        <label for="refund-npub">Refund Public Key (NPUB/P2PK):</label>
                        <div id="refund-npub-container">
                            <input type="text" id="refund-npub" name="refund-npub" placeholder="npub1... | 02...">
                            <button type="button" id="use-nip07" class="button">{$nxbutton}</button>
                        </div>
                        <div class="description">Token will be exclusively redeemable by the owner of this public key after the lock expires.<br>Leave blank if you want the token to be redeemable by anyone after the lock expires.<br><strong>WARNING:</strong> A refund lock never expires. Make sure the public key is correct!<br><strong>NOTE:</strong> Not all Cashu wallets support refund public keys yet. Both <a href="https://www.nostrly.com/cashu-witness/" target="_blank">Cashu Witness</a> and <a href="https://www.nostrly.com/cashu-redeem/">Cashu Redeem</a> do.</div>
                        <a href="#" id="add-refund-keys">+ Add More Refund Keys</a>
                        <div id="refund-keys-options" class="hidden">
                            <label for="extra-refund-keys">Additional Refund Pubkeys (one per line or CSV):</label>
                            <textarea id="extra-refund-keys" name="extra-refund-keys" rows="3" placeholder="npub1...\n02..."></textarea>
                            <div class="description">Any one of these keys can claim the token after expiry.</div>
                        </div>
                    </div>
                    <div class="center">
                        <label for="add_donation" class="center">Do you want to add a donation for the NutLock developers?</label>
                        <input id="add_donation" type="number" placeholder="100" min="0"/>
                        <button type="submit" id="lock-next">Create Locked Token</button>
                    </div>
                    <div id="history" class="center">
                        <h2>NutLock History</h2>
                        <div id="nutlock-history"></div>
                        <div>
                            <button id="clear-history">Clear History</button>
                        </div>
                    </div>
                </div>
                <div id="cashu-lock-pay" class="center hidden">
                    <div class="strong">Pay Lightning Invoice:</div>
                    <p><a id="invoice-link"><img id="invoice-img"/></a></p>
                    <p><button id="invoice-copy" class="button">{$copy_inv}</button></p>
                    <div class="subtitle">Or paste a <span id="amount_to_pay"></span> Cashu token from:</div>
                    <div class="mint_url" id="mint_url"></div>
                    <div><input id="payby-cashu" type="text" placeholder="CashuB..."></p></div>
                    <p class="description"><span id="min_fee"></span><br>*overpaid tokens / LN Fees will be donated to Cashu NutLock</p>
                </div>
                <div id="cashu-lock-success" class="center hidden">
                    <h2>Your Locked Token</h2>
                    <textarea id="locked-token" rows="10" cols="50"></textarea>
                    <p><button id="locked-token-copy" class="button">{$copy_token}</button><button id="locked-emoji-copy" class="button">{$copy_emoji}</button></p>
                </div>
            EOL;
    }

    /**
     * Cashu Witness shortcode.
     *
     * @param mixed      $atts
     * @param null|mixed $content
     */
    public function cashu_witness_shortcode($atts, $content = null)
    {
        // Enqueue scripts and styles
        wp_enqueue_script('nostrly-cashu-witness');

        $token_label = esc_attr('Locked Cashu token (or emoji 🥜)', 'nostrly');
        $token = esc_attr('Paste a Locked Cashu ecash token (or ecash emoji 🥜) to witness...', 'nostrly');
        $copy_token = esc_html('Copy Token', 'nostrly');
        $copy_emoji = esc_html('Copy 🥜', 'nostrly');
        $cancel = esc_html('Cancel', 'nostrly');

        return <<<EOL
            <style>
                /* Base form styling */
                #cashu-witness-form {
                    margin-bottom: 40px;
                }
                #cashu-witness-form label {
                    display: block;
                    font-weight: bold;
                    margin-bottom: 0;
                    text-align: left;
                }
                #cashu-witness-form label.center {
                    text-align: center;
                }
                #cashu-witness-form div {
                    margin-bottom: 1rem;
                }
                /* Common input styles */
                #cashu-witness-form input,
                #cashu-witness-form textarea,
                #cashu-witness-success textarea {
                    border-radius: 6px;
                    margin-bottom: 0.25em;
                    padding: 6px 15px;
                    width: 100%;
                }
                /* Validation feedback */
                #cashu-witness-form [data-valid="no"] {
                    border: 2px solid rgb(204, 55, 55);
                    background-color: rgba(204, 55, 55, 0.3);
                    color: white;
                }
                /* Utility classes */
                .center {
                    text-align: center;
                }
                .hidden {
                    display: none;
                }
                .strong {
                    font-weight: bold;
                }
                .description {
                    font-size: 0.85rem;
                    margin-top: 0.5rem;
                    color: #ccc;
                }
                /* NIP-07 button */
                #use-nip07 {
                    margin: 1em auto;
                    max-width: 200px;
                }
                #use-nip07:disabled {
                    opacity: 0.6;
                }
                /* Witness info and status */
                #witness-info {
                    margin-top: 0.75rem;
                    padding: 0.75rem;
                    background-color: rgba(255, 255, 255, 0.05);
                    border-radius: 6px;
                    text-align: left;
                    font-size: 0.9rem;
                    border: 1px solid #444;
                }
                #witness-info ul {
                    margin: 0.5rem 0;
                    padding-left: 20px;
                }
                #witness-info li {
                    margin-bottom: 0.25rem;
                    display: flex;
                    align-items: center;
                    font-family: monospace;
                }
                #witness-info .status-icon {
                    width: 10px;
                    height: 10px;
                    margin-right: 8px;
                    border-radius: 50%;
                    display: inline-block;
                }
                #witness-info .signed .status-icon {
                    background-color: #0f0;
                }
                #witness-info .pending .status-icon {
                    background-color: #f00;
                }
                #witness-info .summary {
                    margin-top: 0.5rem;
                    font-style: italic;
                    color: #ccc;
                }
                /* Success section */
                #cashu-witness-success .subtitle {
                    font-weight: bold;
                    margin-top: 1rem;
                }
                .copytkn,
                .copyemj {
                    border-radius: 6px;
                    display: inline-block;
                    background-color: #FF9900;
                    color: #000;
                    padding: 0 0.25rem;
                    cursor: pointer;
                }
                #witnessed-emoji-copy {
                    margin-left: 1rem;
                }
                /* History section */
                #history {
                    border: 1px solid #ccc;
                    border-radius: 6px;
                    margin-top: 3rem;
                    padding: 1px;
                }
                #history ul {
                    margin-left: 0;
                    padding-left: 0;
                }
                .history-item {
                    border-top: 1px solid #ccc;
                    cursor: pointer;
                    list-style: none;
                    padding: 5px;
                    text-align: left;
                }
                .history-item:hover {
                    color: #fff;
                }
                /* Media queries */
                @media (max-width: 600px) {
                    #use-nip07 {
                        max-width: 100%;
                    }
                    #witness-info {
                        padding: 0.5rem;
                    }
                }
            </style>
            <div id="cashu-witness-form">
                <div>
                    <label for="token">{$token_label}</label>
                    <textarea id="token" name="token" rows="5" placeholder="{$token}" required></textarea>
                    <div id="witness-info" class="hidden"></div>
                </div>
                <div id="signers" class="hidden">
                    <div>
                        <label for="privkey">Private Key (NSEC or Hex):</label>
                        <input type="text" id="privkey" name="privkey" placeholder="nsec1... | hex">
                        <div class="description">Paste a private key to automatically sign the P2PK proofs. Keys are processed locally in your browser only. Your private key is NEVER sent to our server or the mint. For maximum security, however, we recommend using a <a href="https://github.com/nostr-protocol/nips/pull/1890" target="_blank" rel="noopener"><em>nip60</em></a> compatible Nostr extension like <a href="https://getalby.com/products/browser-extension" target="_blank" rel="noopener">Alby</a>, <a href="https://github.com/fiatjaf/nos2x" target="_blank" rel="noopener">NOS2X</a>, or <a href="https://chromewebstore.google.com/detail/aka-profiles/ncmflpbbagcnakkolfpcpogheckolnad" target="_blank" rel="noopener">AKA Profiles</a>. If you have a <a href="https://www.nostrly.com/cashu-nutzapme/">NIP-60 Cashu Wallet</a>, you may be able to unlock your token using a regular NIP-07 signer. Your name may not appear above in this case.</div>
                    </div>
                    <div class="center">
                        <button type="button" id="use-nip07" class="button" disabled>Use NIP-07 Signer</button>
                    </div>
                </div>
                <div id="unlock" class="hidden center">
                    <button type="button" id="unlock-token" class="button">Unlock Token</button>
                </div>
                <div id="history" class="center">
                    <h2>Witness History</h2>
                    <div id="witness-history"></div>
                    <div>
                        <button id="clear-history">Clear History</button>
                    </div>
                </div>
            </div>
            <div id="cashu-witness-success" class="center hidden">
                <h2 id="witnessed-heading">Your Witnessed Token</h2>
                <textarea id="witnessed-token" rows="10" cols="50"></textarea>
                <p>
                    <button id="witnessed-token-copy" class="button">{$copy_token}</button>
                    <button id="witnessed-emoji-copy" class="button">{$copy_emoji}</button>
                </p>
            </div>
        EOL;
    }

    /**
     * NIP-60 wallet shortcode.
     *
     * @param mixed      $atts
     * @param null|mixed $content
     */
    public function cashu_cache_shortcode($atts, $content = null)
    {
        // Enqueue scripts and styles
        wp_enqueue_script('nostrly-cashu-cache');

        $get_relays = esc_html('Add My Relays', 'nostrly');
        $open_wallet = esc_html('Fetch Existing Wallet', 'nostrly');
        $create_wallet = esc_html('Create Wallet', 'nostrly');
        $copy_nsec = esc_html('Copy NSEC Format', 'nostrly');
        $copy_hex = esc_html('Copy Hex Format', 'nostrly');

        return <<<EOL
                <style>
                    /* Base form styling */
                    #nip60-wallet-form {
                        margin-bottom: 40px;
                    }
                    #nip60-wallet-form label, .label {
                        display: block;
                        font-weight: bold;
                        text-align: left;
                    }
                    #nip60-wallet-form div {
                        margin-bottom: 1rem;
                    }
                    /* Common input styles */
                    #nip60-wallet-form input,
                    #nip60-wallet-form textarea,
                    #nip60-wallet-form select,
                    #live-key,
                    #old-keys {
                        border-radius: 6px;
                        padding: 6px 15px;
                        width: 100%;
                        box-sizing: border-box;
                    }
                    #update-options input[type=checkbox] {
                        width: auto;
                    }
                    #update-options label {
                        font-weight: normal;
                    }
                    /* Validation feedback */
                    #nip60-wallet-form [data-valid="no"] {
                        border: 2px solid #cc3737;
                        background-color: rgba(204, 55, 55, 0.3);
                        color: #fff;
                    }
                    /* Utility classes */
                    .center {
                        text-align: center;
                    }
                    .hidden {
                        display: none;
                    }
                    .description {
                        font-size: 0.85rem;
                        margin: 0.25rem 0;
                        color: #ccc;
                    }
                    /* Relays container */
                    #relays-container {
                        display: flex;
                        align-items: stretch;
                        gap: 5px;
                    }
                    #relays {
                        flex: 1;
                        text-align: left;
                    }
                    #get-relays {
                        border-radius: 6px;
                        flex: 0 0 13rem;
                    }
                    /* Buttons */
                    #create-wallet {
                        display: block;
                        margin: 1em auto;
                        max-width: 20em;
                    }
                    #create-wallet:disabled {
                        opacity: 0.6;
                    }
                    #copy-key {
                        margin-left: 1rem;
                    }
                    /* Textarea styling */
                    #nip60-wallet-form textarea {
                        resize: vertical;
                        min-height: 100px;
                        font-family: monospace;
                    }
                    /* Success section */
                    #nip60-wallet-success {
                        margin-top: 2rem;
                    }
                    #live-key, #old-keys {
                        font-family: monospace;
                        text-align: center;
                    }
                    #live-key {
                        font-weight: bold;
                        margin-bottom: 0.5rem;
                        background-color: #f3c2c2;
                        border: 1px solid #ccc;
                    }
                    /* Media queries */
                    @media (max-width: 600px) {
                        #relays-container {
                            flex-direction: column;
                            gap: 5px;
                        }
                        #relays {
                            margin-bottom: 5px;
                        }
                        #get-relays {
                            width: 100%;
                        }
                    }
                </style>
                <div id="nip60-wallet-form">
                    <div class="center">
                        <button type="submit" id="open-wallet">{$open_wallet}</button>
                    </div>
                    <div>
                        <label for="mint-select">Mints (one per line):</label>
                        <select id="mint-select" name="mint-select">
                            <option value="" disabled selected>Loading mints...</option>
                        </select>
                        <textarea id="mints" name="mints" rows="4" placeholder="https://mint.minibits.cash/Bitcoin\nhttps://mint.103100.xyz"></textarea>
                        <div class="description">Choose the NUT-11 compliant mints you are comfortable using. If a mint is not in the list, it may not be NUT-11 compliant, or is not known to <a href="https://audit.8333.space" target="_blank">Cashu Auditor</a> (in which case, <a href="https://audit.8333.space" target="_blank">donating a token from that mint</a> will add it to the list)</div>
                    </div>
                    <div>
                        <label for="relays">Relays (one per line):</label>
                        <div id="relays-container">
                            <textarea id="relays" name="relays" rows="4" placeholder="wss://relay.damus.io\nwss://nostr.mom"></textarea>
                            <button type="button" id="get-relays" class="button">{$get_relays}</button>
                        </div>
                        <div class="description">These are the Nostr relays where your ecash will be stored (max recommended 2-4). Use the button to fetch your relays if using a NIP-07 extension.</div>
                    </div>
                    <div id="update-options">
                        <div class="label">Wallet Update Options:</div>
                        <label for="rotate-keys">
                            <input type="checkbox" id="rotate-keys" checked disabled>
                            Rotate your wallet key
                        </label>
                        <div class="description">Adds a new private key and NIP-61 public locking key to your wallet. Rotating keys improves privacy. You will be able to copy your key(s) in the last step.</div>
                    </div>
                    <div class="center">
                        <button type="submit" id="create-wallet" disabled>{$create_wallet}</button>
                        <div class="description" id="create-warning"><strong>WARNING:</strong> This will replace any existing wallet. To preserve keys, fetch your existing wallet first.</div>
                        <div class="description">Note: You should <a href="https://www.nostrly.com/cashu-gather/">gather any unclaimed NutZaps</a> before updating your wallet.</div>
                    </div>
                </div>
                <div id="nip60-wallet-success" class="center hidden">
                    <h2>Your Wallet Private Key(s)</h2>
                    <div class="description">These are your NIP-60 wallet's private key(s) in nsec format. The first is your live key, the rest are old keys. It's important to keep them safe and backed up. You can optionally also import them as P2PK keys in a wallet like Cashu.me</div>
                    <input type="text" id="live-key" readonly class="live-key" placeholder="Live key will appear here">
                    <textarea id="old-keys" rows="4" placeholder="Previous private keys (if any)"></textarea>
                    <p>
                        <button id="copy-nsec" class="button">{$copy_nsec}</button>
                        <button id="copy-hex" class="button">{$copy_hex}</button>
                    </p>
                </div>
            EOL;
    }

    /**
     * Cashu Gather shortcode.
     *
     * @param mixed      $atts
     * @param null|mixed $content
     */
    public function cashu_gather_shortcode($atts, $content = null)
    {
        // Enqueue scripts and styles
        wp_enqueue_script('nostrly-cashu-gather');

        $fetch_nutzaps = esc_html('Gather Unclaimed NutZaps', 'nostrly');
        $copy_token = esc_html('Copy Token', 'nostrly');
        $copy_emoji = esc_html('Copy 🥜', 'nostrly');

        return <<<EOL
            <style>
                /* Base styling */
                #cashu-gather-container {
                    margin-bottom: 40px;
                }
                #cashu-gather-container .center {
                    text-align: center;
                }
                #cashu-gather-container .hidden {
                    display: none;
                }
                /* Button styling */
                #fetch-nutzaps, #clear-history {
                    margin: 1em auto;
                    max-width: 20em;
                }
                #fetch-nutzaps:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                /* Token list styling */
                #token-list, #token-history-list {
                    margin-top: 2rem;
                    padding: 0;
                    list-style: none;
                    text-align: left;
                    margin-left: 0;
                    padding-left: 0;
                }
                #token-list li {
                    margin-bottom: 1rem;
                    padding: 0.75rem;
                    background-color: rgba(0, 255, 0, 0.1); /* Subtle green for new tokens */
                    border: 1px solid #0f0;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 6px;
                }
                #token-history-list .history-item {
                    margin-bottom: 1rem;
                    padding: 0.75rem;
                    background-color: rgba(255, 255, 255, 0.05);
                    border: 1px solid #444;
                    border-radius: 6px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 6px;
                }
                #token-list .token, #token-history-list .token {
                    font-family: monospace;
                    word-break: break-all;
                    flex-grow: 1;
                    margin-right: 1rem;
                    text-align: left;
                }
                #token-list button, #token-history-list button {
                    margin-left: 0.5rem;
                    flex-shrink: 0;
                }
                /* History section */
                #token-history {
                    margin-top: 3rem;
                    padding: 1rem;
                    border: 1px solid #ccc;
                    border-radius: 6px;
                }
                #token-history ul {
                    margin-left: 0;
                    padding-left: 0;
                }
                .copy-token,
                .copy-emoji {
                    border-radius: 6px;
                    display: inline-block;
                    background-color: #FF9900;
                    color: #000;
                    padding: 0 0.25rem;
                    cursor: pointer;
                    margin-right: 0.5rem;
                    margin-top: 0.25rem;
                    margin-bottom: 0.25rem;
                    text-align: center;
                }
                .options {
                    margin-top: 1rem;
                }
                .options label {
                    display: block;
                    margin-bottom: 0.5rem;
                }
                .options small {
                    display: block;
                    color: #888;
                    font-size: 0.8em;
                    margin-top: 0.2em;
                }
                /* Media queries */
                @media (max-width: 600px) {
                    #token-list .token, #token-history-list .token {
                        text-align: center;
                    }
                    #token-list li, #token-history-list li {
                        flex-direction: column;
                        align-items: center;
                    }
                    #token-list button, #token-history-list button {
                        margin-left: 0;
                        margin-top: 0.5rem;
                    }
                }
            </style>
            <div id="cashu-gather-container">
                <div class="center">
                    <div class="options">
                        <label>
                            <input type="checkbox" id="fetch-all-mints" checked>
                            Fetch from all mints (not just your NIP-61 NutZap mints)
                        </label>
                        <label>
                            <input type="checkbox" id="mark-invalid-redeemed">
                            <span>Clear Invalid NutZaps</span>
                            <small>(Marks NutZaps that can't be redeemed as processed, so they won't appear again.)</small>
                        </label>
                    </div>
                    <button type="button" id="fetch-nutzaps" class="button" aria-label="Fetch unclaimed NutZaps">{$fetch_nutzaps}</button>
                </div>
                <div id="new-tokens"class="center hidden">
                    <h2>Newly Gathered Tokens</h2>
                    <ul id="token-list"></ul>
                </div>
                <div id="token-history" class="center">
                    <h2>Gathering History</h2>
                    <ul id="token-history-list"></ul>
                    <button type="button" id="clear-history" class="button" aria-label="Clear token history">Clear History</button>
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
        wp_register_script('nostrly-cashu-redeem', NOSTRLY_URL.'assets/js/nostrly-cashu-redeem.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_register_script('nostrly-cashu-lock', NOSTRLY_URL.'assets/js/nostrly-cashu-lock.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_register_script('nostrly-cashu-witness', NOSTRLY_URL.'assets/js/nostrly-cashu-witness.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_register_script('nostrly-cashu-cache', NOSTRLY_URL.'assets/js/nostrly-cashu-cache.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_register_script('nostrly-cashu-gather', NOSTRLY_URL.'assets/js/nostrly-cashu-gather.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_register_script('nostrly-tools', NOSTRLY_URL.'assets/js/nostrly-tools.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_register_script('confetti', 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_enqueue_script('window-nostr', 'https://unpkg.com/window.nostr.js/dist/window.nostr.js', [], 'latest', true);
        $js = "window.wnjParams = {
            position: 'bottom',
            accent: 'purple',
            // compactMode: true,
            disableOverflowFix: true
          }";
        wp_add_inline_script('window-nostr', $js, 'before');
    }

    /**
     * Remove ver=xxx from unpkg scripts
     * @param  string $src Script SRC
     * @return string      Modified script SRC
     */
    function script_loader_src($src) {
        if (strpos($src, 'unpkg.com') !== false) { // Only apply to unpkg URLs
            $src = remove_query_arg('ver', $src);
        }
        return $src;
    }
}

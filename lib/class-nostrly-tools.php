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
        wp_enqueue_script('nostrly-cashu');
        wp_enqueue_script('confetti');

        $token_label = esc_attr('Cashu token (or emoji 🥜)', 'nostrly');
        $token = esc_attr('Paste the Cashu ecash token (or ecash emoji 🥜) to redeem...', 'nostrly');
        $pkey_label = esc_html('Compatible Extension Not Detected - Enter Private Key To Unlock Token', 'nostrly');
        $pkey_desc = sprintf(esc_html('Your private key is NEVER sent to our server or the mint. For maximum security, however, we recommend using a %5$ssignString()%4$s compatible Nostr extension like %1$sAlby%4$s, or %2$sAKA Profiles (v1.0.9+)%4$s'/* or %3$snos2X%4$s.'*/, 'nostrly'),
            '<a href="https://getalby.com/products/browser-extension" target="_blank">',
            '<a href="https://github.com/neilck/aka-extension/" target="_blank">',
            '<a href="https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp" target="_blank">',
            '</a>',
            '<a href="https://github.com/nostr-protocol/nips/pull/1842" target="_blank">',
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
                    #cashu-lock-pay .subtitle {
                      font-weight: bold;
                      margin-top: 2rem;
                    }
                    #cashu-lock-form input,
                    #cashu-lock-form textarea,
                    #cashu-lock-form select,
                    #cashu-lock-success textarea {
                      border-radius: 6px;
                      margin-bottom: 0.25em;
                      padding: 6px 15px;
                      width: 100%;
                    }
                    // #cashu-lock-form input[data-valid="yes"],
                    // #cashu-lock-form select[data-valid="yes"] {
                    //   border: 2px solid rgb(49, 194, 54);
                    //   background-color: rgba(49, 194, 54, 0.3);
                    //   color: white;
                    // }
                    #cashu-lock-form input[data-valid="no"],
                    #cashu-lock-form select[data-valid="no"] {
                      border: 2px solid rgb(204, 55, 55);
                      background-color: rgba(204, 55, 55, 0.3);
                      color: white;
                    }
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
                        font-size: 0.9rem;
                        margin-top: 0.5rem;
                    }
                    #refund-npub-container {
                        display: flex;
                    }
                    #refund-npub {
                        flex: 1;
                        margin-right: 5px;
                        max-width: calc(100% - 14rem);
                        text-align: left;
                        width: 100%;
                    }
                    #use-nip07 {
                        flex: 0 0 auto;
                        width: 13rem;
                    }
                    #lock-next {
                        margin: 1em auto;
                        max-width: 20em;
                    }
                    #lock-next:disabled {
                      opacity: 0.6;
                    }
                    .mint_url {
                        border: 1px solid white;
                        border-radius: 6px;
                        display: inline-block;
                        margin: 0.5rem;
                        padding: 0 10px;
                        width: fit-content;
                    }
                    #add_donation {
                        max-width:  180px;
                        display: block;
                        margin: 0 auto;
                    }
                    #payby-cashu {
                        margin-top: 0.5rem;
                        padding: 1rem;
                        max-width: 300px;
                    }
                    #amount_to_pay, .copytkn, .copyemj {
                      border-radius: 6px;
                      display:inline-block;
                      background-color: #FF9900;
                      color: #000;
                      padding: 0 0.25rem;
                    }
                    #locked-emoji-copy {
                        margin-left: 1rem;
                    }
                    #history {
                      border: 1px solid #ccc;
                      border-radius: 6px;
                      margin-top: 3rem;
                      padding: 1px;
                    }
                    #history ul {
                      margin-left:0;
                      padding-left:0;
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
                    #clear-history {
                        border-radius: 6px;
                        display: inline-block;
                        margin: 0 0.25rem;
                        padding: 0 0.5rem;
                    }
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
                    }
                }
                </style>
                <div id="cashu-lock-form">
                    <div>
                        <label for="mint-select">Choose a Mint:</label>
                        <select id="mint-select" name="mint-select" required>
                            <option value="" disabled selected>Select a mint...</option>
                            <option value="https://mint.minibits.cash/Bitcoin">https://mint.minibits.cash/Bitcoin</option>
                            <option value="https://stablenut.cashu.network">https://stablenut.cashu.network</option>
                            <option value="https://mint.lnvoltz.com">https://mint.lnvoltz.com</option>
                            <option value="discover">Discover more mints...</option>
                        </select>
                    </div>
                    <div>
                        <label for="lock-value">Token Value (sats):</label>
                        <input type="number" id="lock-value" name="lock-value" min="1" step="1" placeholder="1000" required>
                    </div>
                    <div>
                        <label for="lock-npub">Lock Token to Public Key (NPUB/P2PK):</label>
                        <input type="text" id="lock-npub" name="lock-npub" placeholder="npub1... | 02..." required>
                        <div class="description">Token will be exclusively redeemable by the owner of this public key until the lock expires</div>
                    </div>
                    <div>
                        <label for="lock-expiry">Lock Expires (Local Time):</label>
                        <input type="datetime-local" id="lock-expiry" name="lock-expiry" required>
                    </div>
                    <div>
                        <label for="refund-npub">Refund Public Key (NPUB/P2PK):</label>
                        <div id="refund-npub-container">
                            <input type="text" id="refund-npub" name="refund-npub" placeholder="npub1... | 02...">
                            <button type="button" id="use-nip07" class="button">{$nxbutton}</button>
                        </div>
                        <div class="description">Token will be exclusively redeemable by the owner of this public key after the lock expires.<br>Leave blank if you want the token to be redeemable by anyone after the lock expires.<br><strong>WARNING:</strong> A refund lock never expires. Make sure the public key is correct!<br><strong>NOTE:</strong> Not all Cashu wallets support refund public keys yet. <a href="https://www.nostrly.com/cashu-redeem/">Nostrly Cashu Redeem</a> does.</div>
                    </div>
                    <div class="center">
                        <label for="add_donation" class="center">Do you want to add a donation for the NutLock developers?</label>
                        <input id="add_donation" type="number" placeholder="100"/>
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
                    <div class="mint_url">https://mint.minibits.cash/Bitcoin</div>
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
     * Enqueue scripts and styles
     * NB: Called from registration_shortcode() so we only load scripts if needed.
     */
    public function enqueue_scripts(): void
    {
        wp_register_script('nostrly-cashu', NOSTRLY_URL.'assets/js/nostrly-cashu.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_register_script('nostrly-cashu-lock', NOSTRLY_URL.'assets/js/nostrly-cashu-lock.min.js', [], NOSTRLY_VERSION, false); // NB: head
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

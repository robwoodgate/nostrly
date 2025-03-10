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
        add_action('wp_enqueue_scripts', [$this, 'enqueue_scripts']);

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
     * NIP-09 event delete shortcode.
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
        $lnurl_label = esc_html('Lightning address/invoice/LNURL', 'nostrly');
        $lnurl = esc_html('Enter a Lightning address, Lightning invoice or LNURL', 'nostrly');
        $redeem = esc_html('Redeem Token', 'nostrly');

        return <<<EOL
                <style>
                    #cashu-redeem {
                      text-align: center;
                    }
                    #cashu-redeem label {
                      margin-bottom: 0;
                    }
                    #cashu-redeem input, #cashu-redeem textarea {
                      border-radius: 6px;
                      width: 100%;
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
                    }
                    #lightningStatus {
                      font-size: 1.25rem;
                    }
                    #redeem {
                        margin-top: 1em;
                    }
                </style>
                <div id="cashu-redeem">
                  <label for="token">{$token_label}</label>
                  <div id="tokenWrapper" class="text-wrapper">
                    <textarea id="token" rows="4" cols="50" placeholder="{$token}"></textarea>
                    <button id="tokenRemover" class="text-remover hidden">&times;</button>
                  </div>
                  <label for="lnurl">{$lnurl_label}</label>
                  <div id="lnurlWrapper" class="text-wrapper">
                    <input type="text" placeholder="{$lnurl}" value="" id="lnurl">
                    <button id="lnurlRemover" class="text-remover hidden">&times;</button>
                  </div>
                  <p id="tokenStatus" class="text-wrapper"></p>
                  <p id="lightningStatus" class="text-wrapper"></p>
                  <button id="redeem" class="button" disabled>{$redeem}</button>
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
        wp_register_script('nostrly-tools', NOSTRLY_URL.'assets/js/nostrly-tools.min.js', [], NOSTRLY_VERSION, false); // NB: head
        wp_register_script('confetti', 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js', [], NOSTRLY_VERSION, false); // NB: head
    }
}

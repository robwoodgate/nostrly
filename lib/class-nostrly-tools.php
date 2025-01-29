<?php

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

class NostrlyTools
{
    protected $domain;

    public function init(): void
    {
        add_shortcode('nostrly_key_converter', [$this, 'key_converter_shortcode']);
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

        $npub = esc_html('Paste your npub here', 'nostrly');
        $xpub = esc_html('Paste your hex key here', 'nostrly');
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
                        <label for="npub">Nostr public key (npub):</label>
                        <input type="text" placeholder="{$npub}" value="" id="npub">
                        <label for="hex">Nostr public key (hex):</label>
                        <input type="text" placeholder="{$xpub}" value="" id="hex">
                        <input type="reset" class="button reset" value="{$reset}">
                    </form>
                </div>
            EOL;
    }

    /**
     * Enqueue scripts and styles
     * NB: Called from registration_shortcode() so we only load scripts if needed.
     */
    public function enqueue_scripts(): void
    {
        wp_register_script('nostrly-tools', NOSTRLY_URL.'assets/js/nostrly-tools.min.js', [], NOSTRLY_VERSION, false); // NB: head
        // wp_register_style('nostrly-tools', NOSTRLY_URL.'assets/css/tools.css', [], NOSTRLY_VERSION);
        // wp_localize_script('nostrly-tools', 'nostrly_ajax', [
        //     'ajax_url' => admin_url('admin-ajax.php'),
        //     'nonce' => wp_create_nonce('nostrly-nonce'),
        //     'domain' => preg_replace('/^www\./', '', parse_url(get_site_url(), PHP_URL_HOST)),
        // ]);
    }
}

<?php

/**
 * LUD-16 Lightning address redirection for users.
 * https://github.com/lnurl/luds/blob/luds/16.md.
 *
 * Example redirect: https://<domain>/.well-known/lnurlp/<local_part>
 *
 * @author    Rob Woodgate <rob@cogmentis.com>
 */

use swentel\nostr\Key\Key;

/**
 * SET PATHS!
 */
$wp_load = '../../../../wp-load.php';
$composer_autoloader = '../vendor/autoload.php';
// $wp_load = '../cms/wp-load.php';
// $composer_autoloader = '../cms/wp-content/plugins/nostrly-saas/vendor/autoload.php';

// Set CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');

// Prevent caching
header('Expires: Sun, 01 Jan 2014 00:00:00 GMT');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Cache-Control: post-check=0, pre-check=0', false);
header('Pragma: no-cache');

// Init WP basics
define('SHORTINIT', true);
if (is_readable($wp_load)) {
    require_once $wp_load;
} else {
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"ERROR","reason":"Service unavailable"}';

    exit;
}
global $wpdb;

// Try to load Composer
if (is_readable($composer_autoloader)) {
    require_once $composer_autoloader;
} else {
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"ERROR","reason":"Service not available"}';

    exit;
}

// Lookup name and get pubkey and Lightning address
$name = sanitize_text_field(strtolower($_GET['name'] ?? ''));
$user = $wpdb->get_row($wpdb->prepare(
    "SELECT ln.meta_value as ln_address, pk.meta_value as pubkey FROM {$wpdb->prefix}users u
        JOIN {$wpdb->prefix}usermeta ln ON (u.ID = ln.user_id AND ln.meta_key = '_lnp_ln_address')
        JOIN {$wpdb->prefix}usermeta pk ON (u.ID = pk.user_id AND pk.meta_key = 'nostr_public_key')
        WHERE user_login = %s",
    $name
));
// print_r($user);

// Bail if user not found
if (empty($user) || empty($user->pubkey)) {
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"ERROR","reason":"Nostrly User not found"}';

    exit;
}

// Fall back to npub.cash address if LN address is not set, or user has set
// their Nostrly address as their Nostr zap address
if (empty($user->ln_address) || false !== strpos(strtolower($user->ln_address), 'nostrly.com')) {
    try {
        $key = new Key();
        $npub = $key->convertPublicKeyToBech32($user->pubkey);
        if (!empty($npub) && 0 === strpos($npub, 'npub')) {
            $user->ln_address = $npub.'@npub.cash';
        }
    } catch (Exception $e) {
        error_log($e->getMessage());
    }
}

// Bail if LN address is still not set (pubkey was bad)
if (empty($user->ln_address)) {
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"ERROR","reason":"User does not have a Lightning Address"}';

    exit;
}

// Build lnurl
$parts = explode('@', $user->ln_address);
$lnurl = 'https://'.$parts[1].'/.well-known/lnurlp/'.$parts[0];
header("Location: {$lnurl}", true, 307);

exit; // superflous, but hey!

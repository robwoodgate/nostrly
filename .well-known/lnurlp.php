<?php

/**
 * LUD-16 Lightning address redirection for users.
 * https://github.com/lnurl/luds/blob/luds/16.md.
 *
 * Example redirect: https://<domain>/.well-known/lnurlp/<local_part>
 *
 * @author    Rob Woodgate <rob@cogmentis.com>
 */

// Set CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');

// Prevent caching
header('Expires: Sun, 01 Jan 2014 00:00:00 GMT');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Cache-Control: post-check=0, pre-check=0', FALSE);
header('Pragma: no-cache');

// Init WP basics
define('SHORTINIT', true);

require_once '../cms/wp-load.php';
global $wpdb;

// Lookup name / Lightning address
$name = sanitize_text_field(strtolower($_GET['name'] ?? ''));
$ln_address = $wpdb->get_var($wpdb->prepare(
    "SELECT meta_value FROM {$wpdb->prefix}usermeta
        JOIN {$wpdb->prefix}users ON (ID = user_id)
        WHERE user_login = %s and meta_key = '_lnp_ln_address'",
    $name
));

// Bail if not set
if (empty($ln_address)) {
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"ERROR","reason":"Could not get user information"}';

    exit;
}

// Bail if user has set their Nostrly address as their Nostr zap address
// as we can only redirect, we are not a wallet
if (strpos(strtolower($ln_address), 'nostrly.com') !== false) {
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"ERROR","reason":"User has not set a valid Lightning Address in their Nostr profile"}';

    exit;
}

// Build lnurl
$parts = explode('@', $ln_address);
$lnurl = 'https://'.$parts[1].'/.well-known/lnurlp/'.$parts[0];
header("Location: {$lnurl}", true, 307);

exit;

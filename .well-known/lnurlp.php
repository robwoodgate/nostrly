<?php

/**
 * LUD-16 Lightning address lookup for users.
 * https://github.com/lnurl/luds/blob/luds/16.md.
 *
 * Returns the payRequest of the user's own Lightning address provider.
 * Example: https://<domain>/.well-known/lnurlp/<local_part>
 *
 * @author    Rob Woodgate <rob@cogmentis.com>
 */

use swentel\nostr\Key\Key;

/**
 * SET PATHS! Or override any of these in an lnurlp-config.php next to this file.
 */
$wp_load = '../../../../wp-load.php';
$composer_autoloader = '../vendor/autoload.php';
// $wp_load = '../cms/wp-load.php';
// $composer_autoloader = '../cms/wp-content/plugins/nostrly-saas/vendor/autoload.php';

// Alert targets; blank either to disable it. Alerts are throttled to one an hour.
$alert_ntfy = ''; // ntfy topic URL
$alert_mail = ''; // email address

// Providers whose payRequest is fetched and served from here; others get a redirect.
$proxy_hosts = ['npub.cash', 'walletofsatoshi.com', 'mannabitcoin.com'];

if (is_readable(__DIR__.'/lnurlp-config.php')) {
    require __DIR__.'/lnurlp-config.php';
}

/**
 * Fail the request with an LNURL error, and page once an hour while it persists.
 */
function lnurlp_fail(string $reason, string $detail): void
{
    global $alert_ntfy, $alert_mail;
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['status' => 'ERROR', 'reason' => $reason]);
    $stamp = sys_get_temp_dir().'/nostrly-lnurlp-alert';
    if (!is_file($stamp) || filemtime($stamp) < time() - 3600) {
        touch($stamp);
        $host = $_SERVER['HTTP_HOST'] ?? 'nostrly';
        $title = "LNURL lookup down on {$host}";
        $body = "{$reason}\n{$detail}\n".gmdate('c');
        if ('' !== $alert_ntfy) {
            @file_get_contents($alert_ntfy, false, stream_context_create(['http' => [
                'method' => 'POST',
                'header' => "Title: {$title}\r\nPriority: high\r\nContent-Type: text/plain\r\n",
                'content' => $body,
                'timeout' => 3,
            ]]));
        }
        if ('' !== $alert_mail) {
            @mail($alert_mail, $title, $body);
        }
    }

    exit;
}

/**
 * Fetches a payRequest server-side, or returns null if it cannot.
 * Redirects are not followed. Capped at 5 seconds and 256 KB.
 */
function lnurlp_fetch(string $url): ?string
{
    $body = '';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_USERAGENT => 'lnurlp-proxy/1.0',
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$body): int {
            $body .= $chunk;

            return strlen($body) > 262144 ? 0 : strlen($chunk);
        },
    ]);
    if (!curl_exec($ch)) {
        return null;
    }

    // LUD-01: only the JSON body counts, whatever the status code.
    $json = json_decode($body, true);

    return is_array($json) && !array_is_list($json) ? $body : null;
}

// The plugin folder is whatever WordPress installed the last upload as; find
// the autoloader in it if the fixed path is stale.
if (!is_readable($composer_autoloader)) {
    foreach (glob(dirname($composer_autoloader, 3).'/nostrly-saas*/vendor/autoload.php') ?: [] as $found) {
        $composer_autoloader = $found;

        break;
    }
}

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
    lnurlp_fail('Service unavailable', "wp-load not readable at {$wp_load}");
}
global $wpdb;

// Try to load Composer
if (is_readable($composer_autoloader)) {
    require_once $composer_autoloader;
} else {
    lnurlp_fail('Service not available', "composer autoloader not readable at {$composer_autoloader}");
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

// Bail if LN address is still not set (pubkey was bad) or is malformed
$parts = explode('@', trim((string) $user->ln_address));
if (2 !== count($parts) || '' === $parts[0] || '' === $parts[1]) {
    header('Content-Type: application/json; charset=utf-8');
    echo '{"status":"ERROR","reason":"User does not have a Lightning Address"}';

    exit;
}

// Build lnurl and serve a listed provider's payRequest as our own response
$lnurl = 'https://'.$parts[1].'/.well-known/lnurlp/'.rawurlencode($parts[0]);
$json = in_array(strtolower($parts[1]), $proxy_hosts, true) ? lnurlp_fetch($lnurl) : null;
if (null !== $json) {
    header('Content-Type: application/json; charset=utf-8');
    echo $json;

    exit;
}

// Redirect for any other provider, or if the fetch failed.
header("Location: {$lnurl}", true, 307);

exit; // superflous, but hey!

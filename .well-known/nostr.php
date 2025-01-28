<?php

/**
 * Returns the NIP-05 mapping for users.
 * https://github.com/nostr-protocol/nips/blob/master/05.md.
 *
 * Example responses:
 * {"names": {"rob": "b0635d6a9851d3aed0cd6c..."}}
 * {"names": {"_": "b0635d6a9851d3aed0cd6c..."}}
 * {"names": {}}
 *
 * @author    Rob Woodgate <rob@cogmentis.com>
 */

// Set CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Content-Type: application/json; charset=utf-8');

// Init WP basics
define( 'SHORTINIT', true );
require_once '../cms/wp-load.php';
global $wpdb;

// Lookup name / hex pubkey
$name = sanitize_text_field(strtolower($_GET['name'] ?? ''));
if ('_' === substr($name, 0, 1)) {
    $hexkey = get_option('nostrly_rootkey');
    $name = '_';
} else {
    $hexkey = $wpdb->get_var($wpdb->prepare(
        "SELECT meta_value FROM {$wpdb->prefix}usermeta
        JOIN {$wpdb->prefix}users ON (ID = user_id)
        WHERE user_login = %s and meta_key = 'nostr_public_key'",
        $name
    ));
}

// Build response
$resp = ['names' => []];
if (!empty($hexkey)) {
    $resp['names'] = [$name => $hexkey];
}
echo json_encode($resp, JSON_FORCE_OBJECT);

<?php
/*
Plugin Name: Nostrly SaaS
Plugin URI: https://www.nostrly.com/
Description: Adds Admin screens for Nostrly App
Version: 1.0
Author: Cogmentis Ltd
Author URI: https://www.cogmentis.com
*/


if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

// * Try to load the Composer if it exists.
$composer_autoloader = __DIR__.'/vendor/autoload.php';
if (is_readable($composer_autoloader)) {
    require $composer_autoloader;
}

// Include necessary files
require_once plugin_dir_path(__FILE__) . 'includes/class-nostrly.php';

function nostrly_plugin_init() {
    $nostrly = new Nostrly();
    $nostrly->init();
}
add_action('plugins_loaded', 'nostrly_plugin_init');

function nostrly_use_avatar_url($url, $id_or_email, $args) {
    $user = false;
    if (is_numeric($id_or_email)) {
        $user = get_user_by('id', $id_or_email);
    } elseif (is_object($id_or_email)) {
        if (!empty($id_or_email->user_id)) {
            $user = get_user_by('id', $id_or_email->user_id);
        }
    } else {
        $user = get_user_by('email', $id_or_email);
    }

    if ($user && is_object($user)) {
        $nostr_avatar = get_user_meta($user->ID, 'nostr_avatar', true);
        if (defined('WP_DEBUG') && WP_DEBUG) {
            error_log("Attempting to use Nostr avatar for user {$user->ID}: " . $nostr_avatar);
        }
        if ($nostr_avatar) {
            return $nostr_avatar;
        }
    }

    if (defined('WP_DEBUG') && WP_DEBUG) {
        error_log("Using default avatar URL: " . $url);
    }
    return $url;
}
add_filter('get_avatar_url', 'nostrly_use_avatar_url', 10, 3);

// Load plugin text domain
function nostrly_load_textdomain() {
    load_plugin_textdomain('nostrly', false, dirname(plugin_basename(__FILE__)) . '/languages');
}
add_action('plugins_loaded', 'nostrly_load_textdomain');

// Add a debug logging function
function nostrly_debug_log($message) {
    if (defined('WP_DEBUG') && WP_DEBUG) {
        error_log('Nostr Login: ' . $message);
    }
}

<?php

/*
Plugin Name: Nostrly SaaS
Plugin URI: https://www.nostrly.com/
Description: Adds Admin screens for Nostrly App
Version: 12.3.0
Author: Rob Woodgate
Author URI: https://www.cogmentis.com
License: (c) 2025 All rights reserved
*/

// * No direct access
if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

// * Try to load the Composer if it exists.
$composer_autoloader = __DIR__.'/vendor/autoload.php';
if (is_readable($composer_autoloader)) {
    require $composer_autoloader;
}

// * Define Plugin Constants
define('NOSTRLY_PATH', plugin_dir_path(__FILE__));
define('NOSTRLY_URL', plugin_dir_url(__FILE__));
define('NOSTRLY_SLUG', plugin_basename(__DIR__));
define('NOSTRLY_FILE', plugin_basename(__FILE__));
define('NOSTRLY_VERSION', '12.3.0-alpha');

// * Instantiate main plugin
require_once NOSTRLY_PATH.'lib/class-nostrly.php';
(new Nostrly())->init();

// * Instantiate login / profile
require_once NOSTRLY_PATH.'lib/class-nostrly-login.php';
(new NostrlyLogin())->init();

// * Instantiate registration
require_once NOSTRLY_PATH.'lib/class-nostrly-register.php';
(new NostrlyRegister())->init();

// * Instantiate tools
require_once NOSTRLY_PATH.'lib/class-nostrly-tools.php';
(new NostrlyTools())->init();

// * Instantiate admin screens
require_once NOSTRLY_PATH.'lib/class-nostrly-admin.php';
(new NostrlyAdmin())->register();

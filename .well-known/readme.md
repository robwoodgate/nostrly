=== Nostrly ===
This folder should be placed at the web root.
It is not part of the plugin for performance reasons.

lnurlp.php serves the payRequest for each user's Lightning address. Providers
in $proxy_hosts are fetched server-side; any other provider gets a 307 redirect.

To change settings without editing it, add an lnurlp-config.php next to it that
assigns $wp_load, $composer_autoloader, $alert_ntfy, $alert_mail or $proxy_hosts.

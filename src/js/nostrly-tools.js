// Imports
import * as nip19 from 'nostr-tools/nip19';

jQuery(function($) {

    // DOM elements
    const $npub = $("#npub");
    const $hex = $("#hex");
    const $reset = $(".reset");

    // Event listeners
    $npub.on("input", () => {
        let { type, data } = nip19.decode($npub.val());
        $hex.val(data);
    });

    $hex.on("input", () => {
        let npub = nip19.npubEncode($hex.val())
        $npub.val(npub);
    });

    $reset.on("click", () => {
        $npub.val('');
        $hex.val('');
    });

});

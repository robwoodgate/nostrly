// Imports
import * as nip19 from 'nostr-tools/nip19';

jQuery(function($) {

    // DOM elements
    const $npub = $("#npub");   // key converter
    const $hex = $("#hex");     // key converter
    const $nip19 = $("#nip19_entity");    // nip19 decoder
    const decode = $("#nip19_decode");    // nip19 decoder
    const $reset = $(".reset"); // univeral

    // Event listeners
    $npub.on("input", () => {
        let { type, data } = nip19.decode($npub.val());
        $hex.val(data);
    });

    $hex.on("input", () => {
        let npub = nip19.npubEncode($hex.val())
        $npub.val(npub);
    });

    $nip19.on("input", () => {
        try {
            let result = nip19.decode($nip19.val())
            decode.val(JSON.stringify(result, null, 2));
        } catch(e) {
            decode.val(e);
        }
    });

    $reset.on("click", () => {
        $npub.val('');
        $hex.val('');
    });

});

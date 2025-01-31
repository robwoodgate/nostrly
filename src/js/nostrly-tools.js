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
            let result = nip19.decode($nip19.val());
            if (result.type == 'nsec') {
                // nostr-tools doesn't hex string nsec automatically
                result.data = toHexString(result.data);
            }
            decode.val(JSON.stringify(result, null, 2)); // pretty print
        } catch(e) {
            decode.val(e);
        }
    });

    $reset.on("click", () => {
        $npub.val('');
        $hex.val('');
    });

    function toHexString(bytes) {
        return Array.from(bytes, byte =>
            ("00" + (byte & 0xFF).toString(16)).slice(-2)
        ).join('');
    }

});

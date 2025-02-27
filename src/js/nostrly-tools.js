// Imports
import * as nip19 from 'nostr-tools/nip19';
import { nip57, signEvent } from 'nostr-tools';
import { verifyEvent, SimplePool } from 'nostr-tools';

jQuery(function($) {

    console.log('Starting Nostrly tools');

    // Get our custom relays and create pool
    const relays = nostrly_ajax.relays;
    const pool = new SimplePool();

    /**
     * Key Converter and nip19 decoder
     */
    const $npub  = $("#npub");            // key converter
    const $hex   = $("#hex");             // key converter
    const $nip19 = $("#nip19_entity");    // nip19 decoder
    const decode = $("#nip19_decode");    // nip19 decoder
    const $reset = $(".reset");           // univeral
    $npub.on("input", () => {
        let { type, data } = nip19.decode($npub.val());
        $hex.val(data);
    });
    $hex.on("input", () => {
        let npub = nip19.npubEncode($hex.val());
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
    $reset.on("click", (e) => {
        e.preventDefault();
        $npub.val('');
        $hex.val('');
    });

    /**
     * NIP-09 Event Delete
     */
    const $delevent = $("#del-nevent");
    const $delsent = $("#del-sent");
    const $delbutton = $("#del-button");
    const $delreset = $("#del-reset");
    $delevent.on("input", () => {
        $delbutton.prop("disabled", true);
        try {
            let note = nip19.decode($delevent.val());
            // console.log(note);
            const { type, data } = note;
            if ('nevent' == type) {
                $delbutton.prop("disabled", false);
            }
        } catch(e) {
            console.log(e);
        }
    });
    $delbutton.on("click", handleEventDelete);
    $delreset.on("click", (e) => {
        e.preventDefault();
        $delsent.hide().text($delsent.attr("data-orig"));
        $delevent.val('');
        $delbutton.prop("disabled", true);
        $(".preamble").show();
    });
    async function handleEventDelete(e) {
        e.preventDefault();
        $(".preamble").hide();
        // Check for Nostr extension
        if (typeof window.nostr === 'undefined') {
            console.error("Nostr extension not found");
            alert('Nostr extension not found. Please install or enable your Nostr extension.');
            return;
        }
        let note = nip19.decode($delevent.val());
        // console.log(note);
        const { type, data } = note;
        let delreq = await window.nostr.signEvent({
            kind: 5,
            created_at: Math.round(Date.now() / 1e3),
            content: "",
            tags: [
              ["e", data.id],
              ["k", data.kind.toString()],
            ]
        });
        // console.log(delreq);
        // Check pubkeys match
        if (delreq.pubkey != data.author) {
            $delsent.text('ERROR: You are not the author of this note!').show();
            return;
        }
        // Get user relays from cache, or request them from user
        let userRelays = await getUserRelays();
        await Promise.any(pool.publish(userRelays, delreq));
        console.log('published delete request to at least one relay!');
        doConfettiBomb();
        $delsent.show();
        $delevent.val('');
        $delbutton.prop("disabled", true);
    }

    /**
     * Web Zapper
     */
    const $nevent = $("#nevent");
    const $amount = $("#amount");
    const $comment = $("#comment");
    const $paybutton = $("#zap-pay-button");
    const $resetzap = $("#zap-reset");
    $paybutton.on("click", handleWebZap);
    $nevent.on("input", () => {
        $paybutton.prop("disabled", true);
        try {
            let note = nip19.decode($nevent.val());
            // console.log(note);
            const { type, data } = note;
            if ('npub' == type || 'nevent' == type) {
                $paybutton.prop("disabled", false);
            }
        } catch(e) {
            console.log(e);
        }
    });
    let zapDefaults = JSON.parse(localStorage.getItem("nostrly-webzap-defaults"));
    if (zapDefaults) {
        $amount.val(zapDefaults.sats);
        $comment.val(zapDefaults.comment);
    }
    $resetzap.on("click", (e) => {
        e.preventDefault();
        try { localStorage.removeItem("nostrly-webzap-defaults"); } catch(e) { }
        $amount.val('');
        $comment.val('');
        $(".preamble").show();
    });
    async function handleWebZap(e) {

        e.preventDefault();
        $(".preamble").hide();

        // Check for Nostr extension
        if (typeof window.nostr === 'undefined') {
            console.error("Nostr extension not found");
            alert('Nostr extension not found. Please install or enable your Nostr extension.');
            return;
        }

        // Get author and event id from note or npub
        let note = nip19.decode($nevent.val());
        const { type, data } = note;
        let { author, id } = data;
        if ('npub' == type) {
            author = data;
        }

        // Sanitize amount and convert to millisats, default to 21 sats
        const sats = parseInt($amount.val(), 10) || 21;
        const amount = sats * 1000;
        const comment = $comment.val() || 'sent via nostrly web zap 🫡';
        localStorage.setItem("nostrly-webzap-defaults", JSON.stringify({
            sats: sats, comment: $comment.val()
        }));

        // Get user relays from cache, or request them from user
        let userRelays = await getUserRelays();

        // Build and sign zap
        let zap = await window.nostr.signEvent(nip57.makeZapRequest({
          profile: author,
          event: id,
          amount: amount,
          relays: userRelays,
          comment: comment
        }));
        let encZap = encodeURI(JSON.stringify(zap));

        // Get a Lightning invoice from author
        const authorProfile = await getProfileFromPubkey(author);
        const authorMeta = JSON.parse(authorProfile.content);
        const callback = await nip57.getZapEndpoint(authorProfile);
        const {pr} = await fetchJson(`${callback}?amount=${amount}&nostr=${encZap}`);
        console.log(pr);

        // Eek, something went wrong...
        if (!pr) {
            alert("Sorry, our request for a Zap invoice failed.");
        }

        // Go to payment...
        const img = 'https://quickchart.io/chart?cht=qr&chs=200x200&chl='+pr;
        $("#zap-init").hide();
        $("#zap-pay").show();

        $("#zap-to").text(`Send Zap⚡️ to ${authorMeta.name}`);
        $("#zap-invoice-link").attr("href", `lightning:${pr}`);
        $("#zap-cashu-link").attr("href", `/cashu-redeem/?autopay=1&ln=${pr}`);
        $("#zap-amount").text(sats+' sats');
        $("#zap-invoice-img").attr("src", img);

        setupCopyButton("#zap-invoice-copy", pr);
        $("#zap-cancel").on("click", () => {
            location.reload();
        });

        // Subscribe to receipt events
        console.log('ZAP: ',zap);
        let paymentReceived = false;
        let timeoutId; // keep ref outside
        const since = Math.round(Date.now() / 1000);
        let sub = pool.subscribeMany(
            userRelays,
            [{ kinds: [9735], "#p": [author], "since": since}],
            {
                onevent(event) {
                  // onevent is only called once, the first time the event is received
                  // Check the bolt11 invoice matches our one
                  let bolt11 = event.tags.find(([t]) => t === "bolt11"); // zap sender
                  if (bolt11 && bolt11[1] == pr) {
                    $("#zap-sent").show();
                    $("#zap-invoice-img, #zap-amount, #zap-invoice-copy").hide();
                    $("#zap-cancel").text('Reset');
                    doConfettiBomb();
                    paymentReceived = true;
                    clearTimeout(timeoutId);
                    sub.close(); // Close the subscription since we've found our match
                  }
                  console.log("RECEIPT: ", event);
                },
                oneose() {
                    console.log("EOSE - End of Stored Events. Still listening for new events.");
                    timeoutId = setTimeout(() => {
                        if (!paymentReceived) {
                            console.log("Timeout reached, payment not received.");
                            $("#zap-sent").text('The Zap invoice timed out').show();
                            $("#zap-invoice-img, #zap-amount, #zap-invoice-copy").hide();
                            $("#zap-cancel").text('Reset');
                            sub.close(); // Unsubscribe if payment wasn't received
                        }
                    }, 600000); // 600 seconds timeout (10 mins)
                }
            }
        );
    }

    async function fetchJson(url) {
        try {
            // Use jQuery's AJAX method to make the request
            const response = await $.ajax({
                url: url,
                type: 'GET',
                dataType: 'json'
            });

            // Something went wrong
            if (!response.pr) {
                return null;
            }

            // Destructuring the response to match the stub's return structure
            return { pr: response.pr };
        } catch (error) {
            console.error("Error fetching JSON:", error);
            // Re-throw the error to be handled by the caller if necessary
            // throw error;
        }
    }

    async function getProfileFromPubkey(pubkey) {
        try {
            // Query for the profile event (kind:0)
            const profileEvent = await pool.get(relays, {
                kinds: [0],
                authors: [pubkey]
            });

            if (!profileEvent) {
                console.log("Profile not found for public key: ", pubkey);
                return null;
            }

            // Verify the event signature for security
            if (!verifyEvent(profileEvent)) {
                console.error("Invalid event signature");
                return null;
            }

            // Return the JSON content
            return profileEvent;

        } catch (error) {
            console.error("Error fetching or parsing profile:", error);
            return null;
        }
    }

    function setupCopyButton(selector, text) {
        $(selector).on("click", function() {
            let orig = $(this).text();
            navigator.clipboard.writeText(text).catch(e => console.error('Failed to copy:', e));
            $(this).text("Copied!");
            setTimeout(() => $(this).text(orig), 1000);
        });
    }

    function doConfettiBomb() {
        // Do the confetti bomb
        var duration = 0.25 * 1000; //secs
        var end = Date.now() + duration;

        (function frame() {
            // launch a few confetti from the left edge
            confetti({
                particleCount: 7,
                angle: 60,
                spread: 55,
                origin: {
                    x: 0
                }
            });
            // and launch a few from the right edge
            confetti({
                particleCount: 7,
                angle: 120,
                spread: 55,
                origin: {
                    x: 1
                }
            });

            // keep going until we are out of time
            if (Date.now() < end) {
                requestAnimationFrame(frame);
            }
        }());
        confetti.reset();
    }

    // Get user's relays
    async function getUserRelays() {
        // Get user relays from cache, or request them from user
        let userRelays = JSON.parse(localStorage.getItem("nostrly-user-relays"));
        if (!userRelays) {
            const relayObject = await window.nostr.getRelays();
            userRelays = Object.keys(relayObject);
            localStorage.setItem("nostrly-user-relays", JSON.stringify(userRelays));
        }
        // console.log('USER RELAYS: ', userRelays);
        return userRelays;
    }

    // Helper function
    function toHexString(bytes) {
        return Array.from(bytes, byte =>
            ("00" + (byte & 0xFF).toString(16)).slice(-2)
        ).join('');
    }
});

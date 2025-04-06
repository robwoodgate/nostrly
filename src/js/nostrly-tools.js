// Imports
import * as nip19 from "nostr-tools/nip19";
import {
  nip57,
  signEvent,
  finalizeEvent,
  generateSecretKey,
} from "nostr-tools";
import { verifyEvent, SimplePool } from "nostr-tools";
import { doConfettiBomb } from "./utils.ts";

jQuery(function ($) {
  console.log("Starting Nostrly tools");

  // Get our custom relays and create pool
  const relays = nostrly_ajax.relays;
  const pool = new SimplePool();

  /**
   * Key Converter and nip19 decoder
   */
  const $npub = $("#npub"); // key converter
  const $hex = $("#hex"); // key converter
  const $nip19 = $("#nip19_entity"); // nip19 decoder
  const decode = $("#nip19_decode"); // nip19 decoder
  const $reset = $(".reset"); // univeral
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
      if (result.type == "nsec") {
        // nostr-tools doesn't hex string nsec automatically
        result.data = toHexString(result.data);
      }
      decode.val(JSON.stringify(result, null, 2)); // pretty print
    } catch (e) {
      decode.val(e);
    }
  });
  $reset.on("click", (e) => {
    e.preventDefault();
    $npub.val("");
    $hex.val("");
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
      if ("nevent" == type) {
        $delbutton.prop("disabled", false);
      }
    } catch (e) {
      console.log(e);
    }
  });
  $delbutton.on("click", handleEventDelete);
  $delreset.on("click", (e) => {
    e.preventDefault();
    $delsent.hide().text($delsent.attr("data-orig"));
    $delevent.val("");
    $delbutton.prop("disabled", true);
    $(".preamble").show();
  });
  async function handleEventDelete(e) {
    e.preventDefault();
    $(".preamble").hide();
    // Check for Nostr extension
    if (typeof window.nostr === "undefined") {
      console.error("Nostr extension not found");
      alert(
        "Nostr extension not found. Please install or enable your Nostr extension.",
      );
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
      ],
    });
    // console.log(delreq);
    // Check pubkeys match
    if (delreq.pubkey != data.author) {
      $delsent.text("ERROR: You are not the author of this note!").show();
      return;
    }
    // Get user relays from cache, or request them from user
    let userRelays = await getUserRelays();
    await Promise.any(pool.publish(userRelays, delreq));
    console.log("published delete request to at least one relay!");
    doConfettiBomb();
    $delsent.show();
    $delevent.val("");
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
  let isAnon = false;
  $paybutton.on("click", handleWebZap);
  $nevent.on("input", () => {
    $paybutton.prop("disabled", true);
    try {
      let note = nip19.decode($nevent.val());
      // console.log(note);
      const { type, data } = note;
      if ("npub" == type || "nevent" == type) {
        $paybutton.prop("disabled", false);
      }
    } catch (e) {
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
    try {
      localStorage.removeItem("nostrly-webzap-defaults");
    } catch (e) {}
    $amount.val("");
    $comment.val("");
    $(".preamble").show();
  });
  async function handleWebZap(e) {
    e.preventDefault();
    $(".preamble").hide();

    // Get author and event id from note or npub
    let note = nip19.decode($nevent.val());
    const { type, data } = note;
    let { author, id } = data;
    if ("npub" == type) {
      author = data;
    }

    // Sanitize amount and convert to millisats, default to 21 sats
    const sats = parseInt($amount.val(), 10) || 21;
    const amount = sats * 1000;
    const comment = $comment.val() || "sent via nostrly web zap 🫡";
    localStorage.setItem(
      "nostrly-webzap-defaults",
      JSON.stringify({
        sats: sats,
        comment: $comment.val(),
      }),
    );

    // Build and sign zap
    let zap = await makeZapEvent({
      profile: author,
      event: id,
      amount: amount,
      relays: relays,
      comment: comment,
    });
    console.log("ZAP: ", zap);

    // Get a Lightning invoice from author
    const metaProfile = await getProfileFromPubkey(author);
    const callback = await nip57.getZapEndpoint(metaProfile);
    let encZap = encodeURIComponent(JSON.stringify(zap));
    let url = `${callback}?amount=${amount}&nostr=${encZap}`;
    if (comment) {
      url = `${url}&comment=${encodeURIComponent(comment)}`;
    }
    const res = await fetch(url);
    const { pr, reason, status } = await res.json();

    // Eek, something went wrong...
    if (status === "ERROR" || !pr) {
      alert("Sorry, our request for a Zap invoice failed.");
    }
    console.log(pr);

    // Go to payment...
    const img = "https://quickchart.io/chart?cht=qr&chs=200x200&chl=" + pr;
    $("#zap-init").hide();
    $("#zap-pay").show();

    const authorMeta = JSON.parse(metaProfile.content);
    const anon = isAnon === true ? "Anonymous " : "";
    $("#zap-to").text(`Send ${anon}Zap⚡️ to ${authorMeta.name}`);
    $("#zap-invoice-link").attr("href", `lightning:${pr}`);
    $("#zap-cashu-link").attr("href", `/cashu-redeem/?autopay=1&ln=${pr}`);
    $("#zap-amount").text(sats + " sats");
    $("#zap-invoice-img").attr("src", img);

    setupCopyButton("#zap-invoice-copy", pr);
    $("#zap-cancel").on("click", () => {
      location.reload();
    });

    // Subscribe to receipt events
    let paymentReceived = false;
    let timeoutId; // keep ref outside
    let since = Math.round(Date.now() / 1000);
    let sub = pool.subscribeMany(
      relays,
      [{ kinds: [9735], "#p": [author], since: since }],
      {
        onevent(event) {
          // onevent is only called once, the first time the event is received
          // Check the bolt11 invoice matches our one
          let bolt11 = event.tags.find(([t]) => t === "bolt11"); // zap sender
          if (bolt11 && bolt11[1] == pr) {
            $("#zap-sent").show();
            $(
              "#zap-invoice-img, #zap-amount, #zap-invoice-copy, #zap-cashu-link",
            ).hide();
            $("#zap-cancel").text("Reset");
            doConfettiBomb();
            paymentReceived = true;
            clearTimeout(timeoutId);
            sub.close(); // Close the subscription since we've found our match
          }
          console.log("RECEIPT: ", event);
        },
        oneose() {
          console.log(
            "EOSE - End of Stored Events. Still listening for new events.",
          );
          timeoutId = setTimeout(() => {
            if (!paymentReceived) {
              console.log("Timeout reached, payment not received.");
              $("#zap-sent").text("The Zap invoice timed out").show();
              $("#zap-invoice-img, #zap-amount, #zap-invoice-copy").hide();
              $("#zap-cancel").text("Reset");
              sub.close(); // Unsubscribe if payment wasn't received
            }
          }, 600000); // 600 seconds timeout (10 mins)
        },
      },
    );
  }

  // Query for the profile event (kind:0)
  async function getProfileFromPubkey(pubkey) {
    try {
      // Query for the profile event (kind:0)
      return await pool.get(relays, {
        kinds: [0],
        authors: [pubkey],
      });
    } catch (error) {
      console.error("Error fetching or parsing profile:", error);
      return null;
    }
  }

  function setupCopyButton(selector, text) {
    $(selector).on("click", function () {
      let orig = $(this).text();
      navigator.clipboard
        .writeText(text)
        .catch((e) => console.error("Failed to copy:", e));
      $(this).text("Copied!");
      setTimeout(() => $(this).text(orig), 1000);
    });
  }

  // Build zap event, allowing it to be anonymous
  const makeZapEvent = async ({
    profile,
    event,
    amount,
    relays,
    comment,
    anon,
  }) => {
    const zapEvent = nip57.makeZapRequest({
      profile,
      event,
      amount,
      relays,
      comment,
    });

    // Informal tag used by apps like Damus
    // They should display zap as anonymous
    if (!canUseNip07Signer() || anon) {
      zapEvent.tags.push(["anon"]);
    }

    return await signEvent(zapEvent, anon);
  };

  // Sign event using NIP07, or sign anonymously
  const signEvent = async (zapEvent, anon) => {
    if (canUseNip07Signer() && !anon) {
      try {
        const signed = await window.nostr.signEvent(zapEvent);
        if (signed) {
          return signed;
        }
      } catch (e) {
        // fail silently and sign event as an anonymous user
      }
    }
    isAnon = true;
    return finalizeEvent(zapEvent, generateSecretKey());
  };

  // Check for Nostr Extension
  const canUseNip07Signer = () => {
    return window !== undefined && window.nostr !== undefined;
  };

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
    return Array.from(bytes, (byte) =>
      ("00" + (byte & 0xff).toString(16)).slice(-2),
    ).join("");
  }
});

// Imports
import * as nip19 from "nostr-tools/nip19";
import {
  nip57,
  finalizeEvent,
  generateSecretKey,
  EventTemplate,
  Event,
} from "nostr-tools";
import { SimplePool } from "nostr-tools";
import { copyTextToClipboard, doConfettiBomb, getErrorMessage } from "./utils";
import toastr from "toastr";
import { getUserRelays } from "./nostr";

declare const nostrly_ajax: {
  relays: string[];
};

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
    let { data }: nip19.DecodeResult = nip19.decode($npub.val() as string);
    $hex.val(data as string);
  });
  $hex.on("input", () => {
    let npub: nip19.NPub = nip19.npubEncode($hex.val() as string);
    $npub.val(npub);
  });
  $nip19.on("input", () => {
    try {
      let decoded: nip19.DecodeResult = nip19.decode($nip19.val() as string);
      let out: typeof decoded | { type: string; data: string } = decoded;
      if (decoded.type == "nsec") {
        // nostr-tools doesn't hex string nsec automatically
        out = { ...decoded, data: toHexString(decoded.data as Uint8Array) };
      }
      decode.val(JSON.stringify(out, null, 2)); // pretty print
    } catch (e) {
      const msg = getErrorMessage(e);
      decode.val(msg);
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
      let note: nip19.DecodeResult = nip19.decode($delevent.val() as string);
      // console.log(note);
      const { type } = note;
      if ("nevent" == type) {
        $delbutton.prop("disabled", false);
      }
    } catch (e) {
      const msg = getErrorMessage(e);
      console.log(msg);
    }
  });
  $delbutton.on("click", handleEventDelete);
  $delreset.on("click", (e) => {
    e.preventDefault();
    $delsent.hide().text($delsent.attr("data-orig") as string);
    $delevent.val("");
    $delbutton.prop("disabled", true);
    $(".preamble").show();
  });
  async function handleEventDelete(e: JQuery.ClickEvent) {
    if (
      typeof window?.nostr?.signEvent === "undefined" ||
      typeof window?.nostr?.getPublicKey === "undefined"
    ) {
      toastr.error("NIP-07 Extension not found");
      throw new Error("NIP-07 Extension not found");
    }
    e.preventDefault();
    $(".preamble").hide();

    let decoded: nip19.DecodeResult = nip19.decode($delevent.val() as string);
    // console.log(decoded);
    const { type, data } = decoded;
    if ("nevent" !== type) {
      toastr.error("Not a Nostr nevent");
      throw new Error("Not a Nostr nevent");
    }
    let delreq = await window.nostr.signEvent({
      kind: 5,
      created_at: Math.round(Date.now() / 1e3),
      content: "",
      tags: [
        ["e", data.id],
        ["k", data?.kind?.toString() ?? ""],
      ],
    });
    // console.log(delreq);
    // Check pubkeys match
    if (delreq.pubkey != data.author) {
      $delsent.text("ERROR: You are not the author of this note!").show();
      return;
    }
    // Get user relays from cache, or request them from user
    const pubkey = await window?.nostr?.getPublicKey();
    let userRelays = await getUserRelays(pubkey);
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
      let note: nip19.DecodeResult = nip19.decode($nevent.val() as string);
      // console.log(note);
      const { type } = note;
      if ("npub" == type || "nevent" == type) {
        $paybutton.prop("disabled", false);
      }
    } catch (e) {
      const msg = getErrorMessage(e);
      console.log(msg);
    }
  });
  let zapDefaults = JSON.parse(
    localStorage.getItem("nostrly-webzap-defaults") as string,
  );
  if (zapDefaults) {
    $amount.val(zapDefaults.sats);
    $comment.val(zapDefaults.comment);
  }
  $resetzap.on("click", (e) => {
    e.preventDefault();
    try {
      localStorage.removeItem("nostrly-webzap-defaults");
    } catch (_e) {}
    $amount.val("");
    $comment.val("");
    $(".preamble").show();
  });
  async function handleWebZap(e: JQuery.ClickEvent) {
    e.preventDefault();
    $(".preamble").hide();

    // Get author and event id from note or npub
    let note: nip19.DecodeResult = nip19.decode($nevent.val() as string);
    const { type, data } = note;
    let author: string | undefined;
    let id: string | null = null;
    if ("nevent" == type) {
      ({ author, id } = data);
    }
    if ("npub" == type) {
      author = data;
    }
    if (!author) {
      toastr.error("Cannot zap this nevent, it has no author...");
      throw new Error("Cannot zap this nevent, it has no author...");
    }

    // Sanitize amount and convert to millisats, default to 21 sats
    const sats = parseInt($amount.val() as string, 10) || 21;
    const amount = sats * 1000;
    const comment = ($comment.val() as string) || "sent via nostrly web zap 🫡";
    localStorage.setItem(
      "nostrly-webzap-defaults",
      JSON.stringify({
        sats: sats,
        comment: $comment.val(),
      }),
    );

    // Build and sign zap
    let zap = await makeZapEvent({
      profile: author ?? "",
      event: id,
      amount: amount,
      relays: relays,
      comment: comment,
      anon: false,
    });
    console.log("ZAP: ", zap);

    // Get a Lightning invoice from author
    const metaProfile = await getProfileFromPubkey(author);
    if (!metaProfile) {
      toastr.error("Cound not get Nostr profile for author.");
      throw new Error("Cound not get Nostr profile for author.");
    }
    const callback = await nip57.getZapEndpoint(metaProfile);
    let encZap = encodeURIComponent(JSON.stringify(zap));
    let url = `${callback}?amount=${amount}&nostr=${encZap}`;
    if (comment) {
      url = `${url}&comment=${encodeURIComponent(comment)}`;
    }
    const res = await fetch(url);
    const { pr, status } = await res.json();

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
    $("#zap-invoice-copy").on("click", () => {
      copyTextToClipboard(pr);
    });
    $("#zap-cancel").on("click", () => {
      location.reload();
    });

    // Subscribe to receipt events
    let paymentReceived = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined; // keep ref outside
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
  async function getProfileFromPubkey(pubkey: string) {
    try {
      // Query for the profile event (kind:0)
      return await pool.get(relays, {
        kinds: [0],
        authors: [pubkey],
      });
    } catch (e) {
      toastr.error("Error fetching or parsing profile");
      console.error("Error fetching or parsing profile:", e);
      return null;
    }
  }

  // Build zap event, allowing it to be anonymous
  const makeZapEvent = async ({
    profile,
    event,
    amount,
    relays,
    comment,
    anon,
  }: {
    profile: string;
    event: string | null;
    amount: number;
    relays: string[];
    comment: string;
    anon: boolean;
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
    if (typeof window?.nostr?.signEvent === "undefined" || anon) {
      zapEvent.tags.push(["anon"]);
    }

    return await signEvent(zapEvent, anon);
  };

  // Sign event using NIP07, or sign anonymously
  const signEvent = async (
    zapEvent: EventTemplate,
    anon: boolean,
  ): Promise<Event> => {
    if (!anon) {
      try {
        const signed = await window.nostr?.signEvent?.(zapEvent);
        if (signed) return signed;
      } catch (_e) {
        // fail silently and sign event as an anonymous user
      }
    }
    isAnon = true;
    return finalizeEvent(zapEvent, generateSecretKey());
  };

  // Helper function
  function toHexString(bytes: Uint8Array) {
    return Array.from(bytes, (byte) =>
      ("00" + (byte & 0xff).toString(16)).slice(-2),
    ).join("");
  }
});

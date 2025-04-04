// Imports
import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  CheckStateEnum,
  getEncodedTokenV4,
} from "@cashu/cashu-ts";
import { decode } from "@gandlaf21/bolt11-decode";
import {
  SimplePool,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip04,
  nip19,
} from "nostr-tools";
import {
  encode as emojiEncode,
  decode as emojiDecode,
} from "./emoji-encoder.ts";
import { getContactDetails, sendViaNostr, maybeConvertNpub } from "./nostr.ts";
import { copyTextToClipboard, delay, getTokenAmount } from "./utils.ts";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import toastr from "toastr";

// DOM ready
jQuery(function ($) {
  // Init constants
  const relays = nostrly_ajax.relays;
  const pool = new SimplePool();
  const params = new URL(document.location.href).searchParams;

  // Init vars
  let wallet;
  let mintUrl = "";
  let expireTime; // unix TS
  let lockP2PK; // P2PKey
  let refundP2PK; // P2PKey
  let proofs = [];
  let tokenAmount = 0;
  let timeout = null; // For debounce

  // DOM elements
  const $divOrderFm = $("#cashu-lock");
  const $divPayment = $("#cashu-lock-pay");
  const $divSuccess = $("#cashu-lock-success");
  const $mintSelect = $("#mint-select");
  const $lockValue = $("#lock-value");
  const $lockNpub = $("#lock-npub");
  const $lockExpiry = $("#lock-expiry");
  const $refundNpub = $("#refund-npub");
  const $nip07Button = $("#use-nip07");
  const $orderButton = $("#lock-next");
  const $amountToPay = $("#amount_to_pay");
  const $invoiceLink = $("#invoice-link");
  const $invoiceCopy = $("#invoice-copy");
  const $payByCashu = $("#payby_cashu");
  const $lockedToken = $("#locked_token");

  // Input handlers
  $mintSelect.on("input", () => {
    mintUrl = $mintSelect.val();
    console.log("mintUrl:>>", mintUrl);
  });
  $lockValue.on("input", () => {
    tokenAmount = parseInt($lockValue.val(), 10);
    console.log("tokenAmount:>>", tokenAmount);
  });
  $lockExpiry.on("input", () => {
    expireTime = Math.floor(new Date($lockExpiry.val()).getTime() / 1000);
    console.log("expireTime:>>", expireTime);
  });
  // $orderButton.on("click", getMintQuote);

  // Checks Lock and Refund Public Keys
  const handlePubkeyInput = ($input, setKeyFn, errorMsgPrefix) => {
    let timeout;
    $input.on("input", () => {
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const key = $input.val();
        $input.attr("data-valid", "");
        if (!key) return;
        if (isPublicKeyValid(key)) {
          const p2pk = maybeConvertNpub(key);
          setKeyFn(p2pk);
          console.log("p2pk:>>", p2pk);
          const { name } = await getContactDetails(key, relays);
          if (name) {
            toastr.success(`Valid NPUB: <strong>${name}</strong>`);
          } else {
            toastr.success("Valid P2PK Public Key");
          }
        } else {
          toastr.error(`${errorMsgPrefix} Public Key`);
          $input.attr("data-valid", "no");
        }
      }, 1000);
    });
  };
  handlePubkeyInput($lockNpub, (key) => (lockP2PK = key), "Invalid Lock");
  handlePubkeyInput($refundNpub, (key) => (refundP2PK = key), "Invalid Refund");

  // Use NIP-07 to fetch public key
  $nip07Button.on("click", useNip07);
  async function useNip07() {
    try {
      const pubkey = await window.nostr.getPublicKey();
      if (pubkey) {
        $refundNpub.val(nip19.npubEncode(pubkey));
        $refundNpub.trigger("input"); // validation
      } else {
        throw new Error("Could not fetch public key from NIP-07 signer.");
      }
    } catch (e) {
      toastr.error(e);
      console.error(e);
    }
  }

  // Checks public key is valid
  const isPublicKeyValid = (key) => {
    key = maybeConvertNpub(key); // converts if in npub format
    const regex = /^(02|03)[0-9a-fA-F]{64}$/; // P2PK ECC Key
    if (key && regex.test(key)) {
      return true;
    }
    return false;
  };

  // Handle Cashu payment
  const processCashuPayment = () => {
    // Wait for paste to finish
    setTimeout(async () => {
      try {
        let token = $payByCashu.val();
        if (!token.startsWith("cashu")) {
          token = emojiDecode(token);
        }
        const decoded = getDecodedToken(token);
        if (!decoded) {
          throw new Error("Could not process token");
        }
        // Check this token is from same mint
        if (decoded.mint != $mintSelect.val()) {
          throw new Error("Token is not from " + $mintSelect.val());
        }
        // Create a wallet connected to same mint as token
        const mintUrl = decoded.mint;
        const mint = new CashuMint(mintUrl);
        const wallet = new CashuWallet(mint);
        await wallet.loadMint();
        // Receive the token to the wallet (creates new proofs)
        const proofs = await wallet.receive(token);
        const newToken = getEncodedTokenV4({ mint: mintUrl, proofs: proofs });
        const emoji = emojiEncode("\uD83E\uDD5C", newToken);
        sendViaNostr(nostrly_ajax.pubkey, "Cashu Donation: " + emoji, relays); // async fire-forget
        toastr.success("Donation received! Thanks for your support 🧡");
      } catch (error) {
        console.error(error);
        toastr.error(error.message);
      } finally {
        $payByCashu.val("");
      }
    }, 200);
  };
  $payByCashu.on("paste", processCashuPayment);

  // Confetti bomb
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
          x: 0,
        },
      });
      // and launch a few from the right edge
      confetti({
        particleCount: 7,
        angle: 120,
        spread: 55,
        origin: {
          x: 1,
        },
      });

      // keep going until we are out of time
      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    })();
    confetti.reset();
  }
});

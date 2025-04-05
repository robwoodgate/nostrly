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
import {
  copyTextToClipboard,
  delay,
  getTokenAmount,
  getWalletWithUnit,
  getMintProofs,
  storeMintProofs,
} from "./utils.ts";
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
  $mintSelect.on("input", async () => {
    mintUrl = $mintSelect.val();
    try {
      wallet = await getWalletWithUnit(mintUrl); // Load wallet
      proofs = getMintProofs(mintUrl); // Load saved proofs
      console.log("proofs:>>", getTokenAmount(proofs));
      toastr.success(`Loaded Mint: ${mintUrl}`);
    } catch (e) {
      toastr.error(e);
    }
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
        token = getDecodedToken(token);
        // Check this token is from same mint
        if (token.mint != mintUrl) {
          throw new Error("Token is not from " + mintUrl);
        }
        // Check this token unit from same mint
        if (token.unit !== wallet.unit) {
          throw new Error(
            `Unit mismatch: Needed ${wallet.unit}, Received ${token.unit}`,
          );
        }
        // Check token was big enough
        if (getTokenAmount(token.proofs) < tokenAmount) {
          throw new Error(
            `Amount mismatch: Needed at least ${tokenAmount}, Received ${getTokenAmount(token.proofs)}`,
          );
        }
        // Add token proofs to our working array
        // NB: Not saving them here as the token proofs have not been received
        // and so could be already spent or subject to double spend.
        proofs = [...proofs, ...token.proofs];
        console.log("proofs:>>", getTokenAmount(proofs));

        toastr.success("Received! Creating locked token...");
        createLockedToken();
      } catch (error) {
        toastr.error(error.message);
        console.error(error);
      } finally {
        $payByCashu.val("");
      }
    }, 200);
  };
  $payByCashu.on("paste", processCashuPayment);

  // handle Locked token and donation
  const createLockedToken = async () => {
    try {
      const { send: p2pkProofs, keep: donationProofs } = await wallet.send(
        tokenAmount,
        proofs,
        {
          includeFees: true, // Account for potential swap fees
          includeDleq: true, // Allows offline spending
          p2pk: {
            pubkey: lockP2PK,
            locktime: expireTime,
            refundKeys: [refundP2PK],
          },
        },
      );
      // Send donation
      if (donationProofs) {
      }
    } catch (e) {
      toastr.error(error.message);
      console.error(error);
    }
  };
});

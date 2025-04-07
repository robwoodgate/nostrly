// Imports
import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  CheckStateEnum,
  getEncodedTokenV4,
  MintQuoteState,
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
import {
  getContactDetails,
  sendViaNostr,
  maybeConvertNpub,
  isPublicKeyValid,
  p2pkeyToNpub,
} from "./nostr.ts";
import {
  copyTextToClipboard,
  delay,
  debounce,
  formatAmount,
  getTokenAmount,
  getWalletWithUnit,
  getMintProofs,
  storeMintProofs,
  getLockedTokens,
  storeLockedToken,
  clearLockedTokens,
} from "./utils.ts";
import { handleCashuDonation } from "./cashu-donate.js";
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
  let feeAmount = 0;

  // DOM elements
  const $divOrderFm = $("#cashu-lock-form");
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
  const $invoiceImg = $("#invoice-img");
  const $invoiceCopy = $("#invoice-copy");
  const $payByCashu = $("#payby-cashu");
  const $lockedToken = $("#locked-token");
  const $lockedCopy = $("#locked-token-copy");
  const $historyDiv = $("#nutlock-history");
  const $refreshHistory = $("#refresh-history");
  const $clearHistory = $("#clear-history");

  // Page handlers
  function showOrderForm() {
    $divOrderFm.show();
    $divPayment.hide();
    $divSuccess.hide();
  }
  function showPaymentPage() {
    $divOrderFm.hide();
    $divPayment.show();
    $divSuccess.hide();
  }
  function showSuccessPage() {
    $divOrderFm.hide();
    $divPayment.hide();
    $divSuccess.show();
  }

  // Input handlers
  $mintSelect.on("input", async () => {
    mintUrl = $mintSelect.val();
    try {
      wallet = await getWalletWithUnit(mintUrl); // Load wallet
      proofs = getMintProofs(mintUrl); // Load saved proofs
      console.log("proofs total:>>", getTokenAmount(proofs));
      console.log("proofs:>>", proofs);
      toastr.success(`Loaded Mint: ${mintUrl}`);
      $mintSelect.attr("data-valid", "");
    } catch (e) {
      toastr.error(e);
      $mintSelect.attr("data-valid", "no");
    }
    console.log("mintUrl:>>", mintUrl);
    checkIsReadyToOrder();
  });
  $lockValue.on("input", () => {
    tokenAmount = parseInt($lockValue.val(), 10); // Base10 int
    console.log("tokenAmount:>>", tokenAmount);
    feeAmount = Math.max(Math.ceil(tokenAmount * 0.01), 50); // 1%, min 50 sats
    console.log("feeAmount:>>", feeAmount);
    checkIsReadyToOrder();
  });
  const checkMinDate = debounce((expireTime) => {
    const now = Math.floor(new Date().getTime() / 1000);
    console.log("now:>>", now);
    if (expireTime < now) {
      $lockExpiry.attr("data-valid", "no");
      toastr.error("Expiry is in the past.");
      console.log("Expiry is in the past.");
    } else {
      $lockExpiry.attr("data-valid", "");
    }
  }, 500);
  $lockExpiry.on("input", () => {
    expireTime = Math.floor(new Date($lockExpiry.val()).getTime() / 1000);
    console.log("expireTime:>>", expireTime);
    // Check if expireTime is less than now
    checkMinDate(expireTime);
    checkIsReadyToOrder();
  });
  $orderButton.on("click", async () => {
    showPaymentPage();
    const quote = await wallet.createMintQuote(tokenAmount + feeAmount);
    console.log("quote:>>", quote);
    $amountToPay.text(formatAmount(tokenAmount + feeAmount));
    $invoiceLink.attr("href", `lightning:${quote.request}`);
    const img =
      "https://quickchart.io/chart?cht=qr&chs=200x200&chl=" + quote.request;
    $invoiceImg.attr("src", img);
    $invoiceCopy.on("click", () => {
      copyTextToClipboard(quote.request);
    });

    setTimeout(() => checkQuote(quote.quote), 5000);
  });
  $refreshHistory.on("click", () => {
    loadNutLockHistory();
  });
  $clearHistory.on("click", () => {
    clearLockedTokens();
    loadNutLockHistory(); // refresh
  });

  // Checks Lock and Refund Public Keys
  const handlePubkeyInput = ($input, setKeyFn, errorMsgPrefix) => {
    let timeout;
    $input.on("input", () => {
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const key = $input.val();
        $input.attr("data-valid", "");
        setKeyFn(undefined);
        if (!key) {
          checkIsReadyToOrder();
          return;
        }
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
        checkIsReadyToOrder();
      }, 200);
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

  // Handles order button status
  const setOrderButtonState = debounce((isDisabled) => {
    $orderButton.prop("disabled", isDisabled);
  }, 200);
  const checkIsReadyToOrder = () => {
    if (
      wallet &&
      tokenAmount > 0 &&
      expireTime &&
      lockP2PK &&
      (refundP2PK || !$refundNpub.val())
    ) {
      setOrderButtonState(false);
      return true;
    }
    setOrderButtonState(true);
    return false;
  };
  checkIsReadyToOrder();
  // Set default expire time and trigger check ready
  $lockExpiry
    .val(new Date(Date.now() + 864e5).toISOString().slice(0, 11) + "23:59") // default midnight
    .trigger("input");

  // Check Mint Quote for payment
  const checkQuote = async (quote) => {
    const newquote = await wallet.checkMintQuote(quote);
    if (newquote.state === MintQuoteState.PAID) {
      const ps = await wallet.mintProofs(tokenAmount + feeAmount, quote);
      proofs = [...proofs, ...ps];
      storeMintProofs(mintUrl, proofs, true); // Store all for safety
      createLockedToken();
    } else if (getTokenAmount(proofs) > tokenAmount + feeAmount) {
      // Paid by Cashu, or previous lightning payment, so stop checking
    } else {
      await delay(5000);
      checkQuote(quote);
    }
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
        const totalNeeded = tokenAmount + feeAmount;
        if (getTokenAmount(token.proofs) < totalNeeded) {
          throw new Error(
            `Token is ${formatAmount(getTokenAmount(token.proofs))}.<br>Expected at least ${formatAmount(totalNeeded)}. `,
          );
        }
        // Add token proofs to our working array
        // NB: Not saving them here as the token proofs have not been received
        // and so could be already spent or subject to double spend.
        proofs = [...proofs, ...token.proofs];
        console.log("proofs:>>", getTokenAmount(proofs));

        toastr.success("Received! Creating locked token...");
        createLockedToken();
      } catch (e) {
        toastr.error(e);
        console.error(e);
      } finally {
        $payByCashu.val("");
      }
    }, 200);
  };
  $payByCashu.on("paste", processCashuPayment);

  // handle Locked token and donation
  const createLockedToken = async () => {
    try {
      // const refundKeys = refundP2PK ? [refundP2PK] : undefined;
      // Current cashu-ts library doesn't spread the array, so for now...
      // see: https://github.com/cashubtc/cashu-ts/pull/282
      const refundKeys = refundP2PK ? refundP2PK : undefined;
      const { send: p2pkProofs, keep: donationProofs } = await wallet.swap(
        tokenAmount,
        proofs,
        {
          p2pk: {
            pubkey: lockP2PK,
            locktime: expireTime,
            refundKeys: refundKeys,
          },
        },
      );
      console.log("p2pkProofs:>>", p2pkProofs);
      console.log("donationProofs:>>", donationProofs);
      // Send donation (will spend these proofs)
      if (donationProofs) {
        const donationToken = getEncodedTokenV4({
          mint: mintUrl,
          proofs: donationProofs,
        });
        handleCashuDonation(donationToken);
      }
      // Return locked token
      const lockedToken = getEncodedTokenV4({
        mint: mintUrl,
        proofs: p2pkProofs,
      });
      const npub = p2pkeyToNpub(lockP2PK);
      let { name } = await getContactDetails(npub, relays);
      if (!name) {
        name = npub.slice(0, 11);
      }
      storeLockedToken(lockedToken, tokenAmount, name); // for safety / history
      $lockedToken.val(lockedToken);
      showSuccessPage();
      $lockedToken.on("click", () => {
        copyTextToClipboard(lockedToken);
      });
      $lockedCopy.on("click", () => {
        copyTextToClipboard(lockedToken);
      });
      storeMintProofs(mintUrl, [], true); // zap the proof store
    } catch (e) {
      toastr.error(e);
      console.error(e);
      storeMintProofs(mintUrl, proofs, true); // overwrite proofs store
      showOrderForm();
    }
  };

  const loadNutLockHistory = () => {
    // Load history
    const history = getLockedTokens();
    $historyDiv.empty();
    if (history.length === 0) {
      $historyDiv.html("<p>No NutLocks found.</p>");
      return;
    }
    // Create a list of history items
    const $list = $("<ul></ul>");
    history.forEach((entry) => {
      const date = new Date(entry.date).toLocaleString();
      const name =
        entry.name.length > 20 ? entry.name.slice(0, 20) + "..." : entry.name;
      const amount = formatAmount(entry.amount);
      const token =
        entry.token.length > 20
          ? entry.token.slice(0, 20) + "..."
          : entry.token;
      const $item = $(`
        <li class="history-item">
          ${date} - ${name} - ${amount}
        </li>
      `);
      // Add click handler to select the token
      $item.on("click", () => {
        copyTextToClipboard(entry.token);
      });
      $list.append($item);
    });
    // Append list to div
    $historyDiv.append($list);
  };
  loadNutLockHistory(); // load now
});

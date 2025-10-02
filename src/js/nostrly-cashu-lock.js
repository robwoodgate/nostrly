// Imports
import {
  getDecodedToken,
  getEncodedTokenV4,
  MintQuoteState,
  OutputData,
  P2PKBuilder,
  Wallet,
} from "@cashu/cashu-ts";
import { nip19 } from "nostr-tools";
import {
  encode as emojiEncode,
  decode as emojiDecode,
} from "./emoji-encoder.ts";
import {
  getContactDetails,
  maybeConvertNpubToP2PK,
  convertP2PKToNpub,
  getNip61Info,
} from "./nostr.ts";
import { isPublicKeyValidP2PK, getNut11Mints } from "./nut11.ts";
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
import { handleCashuDonation } from "./cashu-donate.ts";
import toastr from "toastr";

// DOM ready
jQuery(function ($) {
  // Init constants
  const relays = nostrly_ajax.relays;
  const MIN_FEE = 1; // sats
  const PCT_FEE = 1; // 1%
  const MAX_SECRET = 512; // Characters (mint limit)

  // Init vars
  /** @type {import('@cashu/cashu-ts').Wallet} */
  let wallet = null;
  let mintUrl = "";
  let expireTime; // unix TS
  let lockP2PK; // P2PKey
  let refundP2PK; // P2PKey
  let proofs = [];
  let tokenAmount = 0;
  let feeAmount = 0;
  let donationAmount = 0;
  let extraLockKeys = [];
  let extraRefundKeys = [];
  let nSigValue = 1;
  let lockKeys = []; // sanitized keys
  let refundKeys = []; // sanitized keys

  // DOM elements
  const $divOrderFm = $("#cashu-lock-form");
  const $divPayment = $("#cashu-lock-pay");
  const $divSuccess = $("#cashu-lock-success");
  const $mintSelect = $("#mint-select");
  const $lockValue = $("#lock-value");
  const $preferNip61 = $("#prefer-nip61");
  const $useP2BK = $("#use-p2bk");
  const $lockNpub = $("#lock-npub");
  const $lockExpiry = $("#lock-expiry");
  const $refundNpub = $("#refund-npub");
  const $nip07Button = $("#use-nip07");
  const $orderButton = $("#lock-next");
  const $amountToPay = $("#amount_to_pay");
  const $mintUrl = $("#mint_url");
  const $invoiceLink = $("#invoice-link");
  const $invoiceImg = $("#invoice-img");
  const $invoiceCopy = $("#invoice-copy");
  const $payByCashu = $("#payby-cashu");
  const $lockedToken = $("#locked-token");
  const $lockedCopyToken = $("#locked-token-copy");
  const $lockedCopyEmoji = $("#locked-emoji-copy");
  const $historyDiv = $("#nutlock-history");
  const $clearHistory = $("#clear-history");
  const $preamble = $(".preamble");
  const $addDonation = $("#add_donation");
  const $addMultisig = $("#add-multisig");
  const $multisigOptions = $("#multisig-options");
  const $extraLockKeys = $("#extra-lock-keys");
  const $nSigs = $("#n-sigs");
  const $addRefundKeys = $("#add-refund-keys");
  const $refundKeysOptions = $("#refund-keys-options");
  const $extraRefundKeys = $("#extra-refund-keys");
  const $minFee = $("#min_fee");
  $minFee.text(
    `Includes estimated Mint fees of ${PCT_FEE}% (min ${MIN_FEE} sats).`,
  );
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
    $preamble.hide();
  }
  function showSuccessPage() {
    $divOrderFm.hide();
    $divPayment.hide();
    $divSuccess.show();
    $preamble.hide();
  }

  // Input handlers
  $mintSelect.on("input", async () => {
    // Handle discover mints option
    if ("discover" == $mintSelect.val()) {
      $mintSelect.prop("disabled", true);
      toastr.info("Updating Mint list...");
      const mints = await getNut11Mints();
      console.log("mints:>>", mints);
      if (mints) {
        $mintSelect.children("option:not(:first)").remove(); // remove current
        $.each(mints, function (_key, value) {
          $mintSelect.append(
            $("<option></option>").attr("value", value).text(value),
          );
        });
        toastr.clear();
        toastr.success("Mint list updated");
      } else {
        toastr.clear();
        toastr.error("Mint discovery failed.");
      }
      $mintSelect.prop("disabled", false);
      return;
    }
    // Lookup selected mint
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
    feeAmount = Math.max(Math.ceil((tokenAmount * PCT_FEE) / 100), MIN_FEE); // 1% with MIN_FEE
    console.log("feeAmount:>>", feeAmount);
    checkIsReadyToOrder();
  });
  $addDonation.on("input", () => {
    donationAmount = Math.abs(parseInt($addDonation.val(), 10)); // Base10 int
    console.log("donationAmount:>>", donationAmount);
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
    const totalNeeded = tokenAmount + feeAmount + donationAmount;
    const quote = await wallet.createMintQuote(totalNeeded);
    console.log("quote:>>", quote);
    $amountToPay.text(formatAmount(totalNeeded));
    $mintUrl.text(mintUrl);
    $invoiceLink.attr("href", `lightning:${quote.request}`);
    const img =
      "https://quickchart.io/chart?cht=qr&chs=200x200&chl=" + quote.request;
    $invoiceImg.attr("src", img);
    $invoiceCopy.on("click", () => {
      copyTextToClipboard(quote.request);
    });

    setTimeout(() => checkQuote(quote.quote), 5000);
  });
  $clearHistory.on("click", () => {
    clearLockedTokens();
    loadNutLockHistory(); // refresh
  });
  // Toggle multisig options
  $addMultisig.on("click", (e) => {
    e.preventDefault();
    $multisigOptions.slideToggle();
  });
  $addRefundKeys.on("click", (e) => {
    e.preventDefault();
    $refundKeysOptions.slideToggle();
  });

  /**
   * Checks if npub has a NIP-61 P2PK pubkey
   * @param  {string} p2pkey P2PK Pubkey (prefixed 02...)
   * @param  {array} relays  Optional relays (DEFAULT_RELAYS used if unset)
   * @return {string}        NIP-61 hex pubkey or original key
   */
  const doNip61Check = async function (p2pkey, relays) {
    const sliced = p2pkey.slice(2); // Convert to Nostr format key
    const { name, hexpub } = await getContactDetails(sliced, relays);
    console.log("name", name);
    console.log("hexpub", hexpub);
    // Unknown Nostr ID
    if (!name) {
      return p2pkey;
    }
    // Is already a NIP-61
    if (hexpub !== sliced) {
      toastr.info(`${name}'s NIP-61 P2PK KEY`);
      return p2pkey;
    }
    // Prefers NPUB
    if (!$preferNip61.is(":checked")) {
      toastr.info(`${name}'s NPUB P2PK KEY`);
      return p2pkey;
    }
    // Prefers NIP-61
    const { pubkey, mints } = await getNip61Info(sliced);
    console.log("NIP61:", pubkey, mints);
    if (pubkey) {
      const nip61Key = "02" + pubkey;
      toastr.info(
        `Using ${name}'s NIP-61 P2PK KEY for security: <code>${nip61Key}</code>`,
      );
      return nip61Key;
    }
    // Default: use NPUB
    toastr.warning(
      `${name} does not have a NIP-61 P2PK Key. The token will be locked to their NPUB, and they will have to use a compatible NIP-07 signer or enter their NSEC to unlock`,
    );
    return p2pkey;
  };

  /**
   * Parses and validates public keys from a given text string.
   * The text can contain one or multiple public keys separated by newlines or commas.
   * Each key is validated, converted if necessary, and checked against NIP-61.
   * Invalid keys are reported via toastr, and duplicates are removed.
   *
   * @param {string} text - The input text containing one or more public keys.
   * @returns {Promise<string[]>} A promise that resolves to an array of unique, valid public keys.
   */
  async function parsePubkeys(text) {
    // Parse, trim, filter and deduplicate
    const keys = [
      ...new Set(
        text
          .trim()
          .split(/[\n,]+/)
          .map((k) => k.trim())
          .map((k) => maybeConvertNpubToP2PK(k))
          .filter(Boolean),
      ),
    ];
    console.log("keys:>>", keys);
    const validKeys = [];
    for (const p2pk of keys) {
      if (isPublicKeyValidP2PK(p2pk)) {
        const nip61 = await doNip61Check(p2pk);
        if (nip61) {
          validKeys.push(nip61);
        }
      } else {
        toastr.error(`Invalid pubkey: ${p2pk}`);
      }
    }
    // Final dedup (for NIP-61 conversions)
    return [...new Set(validKeys)];
  }

  /**
   * Sets up event listeners and processes public key input for a given jQuery input element.
   * Enforces paste-only behavior, validates the input, and updates the UI and state accordingly.
   * Supports both single-line inputs and textareas for handling one or multiple keys.
   *
   * @param {jQuery} $input - The jQuery object representing the input element (input or textarea).
   * @param {function} setKeyFn - A callback function to update the state with the processed key(s).
   *                              For single-line inputs, it receives a string or undefined.
   *                              For textareas, it receives an array of strings or an empty array.
   * @param {boolean} [isTextarea=false] - Indicates if the input is a textarea (true) or a single-line input (false).
   * @param {string} [errorMsgPrefix="Invalid"] - The prefix for error messages displayed to the user.
   */
  const handlePubkeyInput = (
    $input,
    setKeyFn,
    isTextarea = false,
    errorMsgPrefix = "Invalid",
  ) => {
    let timeout;
    let isPasting = false;
    // Detect paste and process after a short delay
    $input.on("paste", () => {
      isPasting = true;
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        await processInput();
        isPasting = false;
      }, 200);
    });
    // Block non-paste inputs with a warning
    $input.on("input", (_e) => {
      if (!isPasting && $input.val()) {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
          toastr.warning("Please paste only!");
          await processInput();
          isPasting = false;
        }, 200);
      }
    });
    // Process the pasted input
    const processInput = async () => {
      const text = $input.val();
      $input.attr("data-valid", "");
      // Handle empty input
      if (!text) {
        setKeyFn(isTextarea ? [] : undefined);
        checkIsReadyToOrder();
        return;
      }
      // Parse and validate keys
      const keys = await parsePubkeys(text);
      if (keys.length > 0) {
        if (isTextarea) {
          // Handle textarea (multi-key input)
          $input.val(keys.join("\n") + "\n");
          setKeyFn(keys);
          toastr.success("Valid public keys processed");
        } else {
          // Handle single-line input
          if (keys.length === 1) {
            $input.val(keys[0]);
            setKeyFn(keys[0]);
            toastr.success("Valid P2PK Public Key");
          } else {
            toastr.error("Only one key is allowed for this input");
            $input.attr("data-valid", "no");
            setKeyFn(undefined);
          }
        }
      } else {
        // No valid keys found
        $input.attr("data-valid", "no");
        toastr.error(
          isTextarea
            ? "No valid public keys found"
            : `${errorMsgPrefix} Public Key`,
        );
        setKeyFn(isTextarea ? [] : undefined);
      }
      checkIsReadyToOrder();
    };
  };
  handlePubkeyInput(
    $lockNpub,
    (key) => (lockP2PK = key),
    false,
    "Invalid Lock",
  );
  handlePubkeyInput(
    $refundNpub,
    (key) => (refundP2PK = key),
    false,
    "Invalid Refund",
  );
  handlePubkeyInput($extraLockKeys, (keys) => (extraLockKeys = keys), true);
  handlePubkeyInput($extraRefundKeys, (keys) => (extraRefundKeys = keys), true);

  // Handle n_sigs
  $nSigs.on("input", () => {
    nSigValue = parseInt($nSigs.val(), 10);
    if (nSigValue < 1) {
      $nSigs.val(1);
      nSigValue = 1;
      toastr.error("Signatures required must be at least 1");
    }
    console.log("n_sigs:>>", nSigValue);
    checkIsReadyToOrder();
  });

  // Use NIP-07 to fetch public key
  $nip07Button.on("click", useNip07);
  async function useNip07() {
    try {
      const pubkey = await window.nostr.getPublicKey();
      if (pubkey) {
        $refundNpub.val(nip19.npubEncode(pubkey));
        $refundNpub.trigger("paste"); // validation
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
  const checkIsReadyToOrder = async () => {
    // Check wallet is loaded first... as we can't check secret length without it
    if (!wallet) {
      setOrderButtonState(true);
      return false;
    }

    // Deduplicate lockKeys and refundKeys while filtering falsy values
    lockKeys = [...new Set([lockP2PK, ...extraLockKeys].filter(Boolean))];
    refundKeys = [...new Set([refundP2PK, ...extraRefundKeys].filter(Boolean))];
    const hasValidRefunds = !$refundNpub.val() || refundKeys.length > 0;
    console.log("lockKeys:>", lockKeys);
    console.log("refundKeys:>", refundKeys);
    // Check secret length is under MAX_SECRET characters as some mints have
    // this limit. To do this, let's create a 1 sat blinded message with p2pk
    // @see: https://github.com/cashubtc/nuts/pull/234
    const keyset = await wallet.keyChain.getKeyset();
    const testBlindedMessage = OutputData.createSingleP2PKData(
      {
        pubkey: lockKeys,
        locktime: expireTime,
        refundKeys: refundKeys.length ? refundKeys : undefined,
        nsig: nSigValue,
      },
      1, // for testing
      keyset.id,
    );
    const secretDecode = new TextDecoder().decode(testBlindedMessage.secret);
    const secretLength = secretDecode.length;
    console.log("secret:>>", secretDecode);
    console.log("secret length:>>", secretDecode.length);
    if (secretLength > MAX_SECRET) {
      toastr.error(
        "Your token's secret will be too long. Please remove some Lock or Refund keys.",
      );
    }

    if (
      tokenAmount > 0 &&
      expireTime &&
      lockP2PK &&
      hasValidRefunds &&
      $extraLockKeys.attr("data-valid") !== "no" &&
      $extraRefundKeys.attr("data-valid") !== "no" &&
      secretLength <= MAX_SECRET
    ) {
      setOrderButtonState(false);
      return true;
    }
    setOrderButtonState(true);
    return false;
  };
  checkIsReadyToOrder();

  // Set local date to 23:59 in YYYY-MM-DDThh:mm format (for datetime-local
  // input) and trigger checkIsReadyToOrder... uses Swedish ('sv') locale hack
  $lockExpiry
    .val(
      new Date(new Date().setHours(23, 59))
        .toLocaleString("sv", { dateStyle: "short", timeStyle: "short" })
        .replace(" ", "T"),
    ) // default midnight
    .trigger("input");

  // Check Mint Quote for payment
  const checkQuote = async (quote) => {
    const newquote = await wallet.checkMintQuote(quote);
    const totalNeeded = tokenAmount + feeAmount + donationAmount;
    if (newquote.state === MintQuoteState.PAID) {
      const ps = await wallet.mintProofs(totalNeeded, quote);
      proofs = [...proofs, ...ps];
      storeMintProofs(mintUrl, proofs, true); // Store all for safety
      createLockedToken();
    } else if (getTokenAmount(proofs) >= totalNeeded) {
      // Paid by Cashu token, or saved lightning payment
      createLockedToken();
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
        const totalNeeded = tokenAmount + feeAmount + donationAmount;
        if (getTokenAmount(token.proofs) < totalNeeded) {
          throw new Error(
            `Token is ${formatAmount(getTokenAmount(token.proofs))}.<br>Expected at least ${formatAmount(totalNeeded)}. `,
          );
        }
        // Add token proofs to our working array, ensuring all secrets are unique
        // NB: Not saving them here as the token proofs have not been received
        // and so could be already spent or subject to double spend.
        proofs = [...proofs, ...token.proofs];
        const uniqueProofs = Array.from(
          new Map(proofs.map((proof) => [proof.secret, proof])).values(),
        );
        proofs = uniqueProofs;
        console.log("proofs:>>", getTokenAmount(proofs));

        toastr.success("Received! Creating locked token...");
        // We don't createLockedToken() here...
        // We let checkQuote() handle it as it checks stored proofs
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
      const p2pk = new P2PKBuilder()
        .addLockPubkey(lockKeys)
        .lockUntil(expireTime)
        .addRefundPubkey(refundKeys)
        .requireLockSignatures(nSigValue)
        .requireRefundSignatures(1);
      if ($useP2BK.is(":checked")) {
        p2pk.blindKeys();
      }
      const p2pkOptions = p2pk.toOptions();
      console.log("p2pkOptions", p2pkOptions);
      const { send: p2pkProofs, keep: donationProofs } = await wallet.ops
        .send(tokenAmount, proofs)
        .asP2PK(p2pkOptions)
        .run();
      console.log("p2pkProofs:>>", p2pkProofs);
      console.log("donationProofs:>>", donationProofs);

      // Check if locked
      if (p2pkProofs.length) {
        try {
          const secretData = JSON.parse(p2pkProofs[0].secret);
          console.log("secretData:>>", secretData);
          if (secretData[0] !== "P2PK") {
            toastr.warning("Token not locked—unexpected P2PK format.");
          }
        } catch (e) {
          toastr.warning("Token not locked—random secret detected.");
        }
      }

      if (donationProofs) {
        const donationToken = getEncodedTokenV4({
          mint: mintUrl,
          proofs: donationProofs,
        });
        handleCashuDonation(donationToken, "Cashu NutLock Donation");
      }

      const lockedToken = getEncodedTokenV4({
        mint: mintUrl,
        proofs: p2pkProofs,
      });
      const npub = convertP2PKToNpub(lockP2PK);
      let { name } = await getContactDetails(npub, relays);
      if (!name) name = npub.slice(0, 11);
      storeLockedToken(lockedToken, tokenAmount, name); // for safety / history
      $lockedToken.val(lockedToken);
      showSuccessPage();
      $lockedToken.on("click", () => copyTextToClipboard(lockedToken));
      $lockedCopyToken.on("click", () => copyTextToClipboard(lockedToken));
      $lockedCopyEmoji.on("click", () =>
        copyTextToClipboard(emojiEncode("\uD83E\uDD5C", lockedToken)),
      );
      storeMintProofs(mintUrl, [], true); // zap the proof store
    } catch (e) {
      toastr.remove(); // clears any messages
      toastr.error(e.message || "Error creating locked token.");
      console.error(e);
      proofs = getMintProofs(mintUrl); // revert to saved proofs
      showOrderForm();
      toastr.info("There was an error creating your token. Please try again.");
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
      // const token =
      //   entry.token.length > 20
      //     ? entry.token.slice(0, 20) + "..."
      //     : entry.token;
      const $item = $(`
        <li class="history-item">
          <span class="copytkn">Copy Token</span>&nbsp;&nbsp;<span class="copyemj">Copy 🥜</span> &nbsp; ${date} - ${name} - ${amount}
        </li>
      `);
      // Add click handler to select the token
      $item.children(".copytkn").on("click", () => {
        copyTextToClipboard(entry.token);
      });
      $item.children(".copyemj").on("click", () => {
        copyTextToClipboard(emojiEncode("\uD83E\uDD5C", entry.token));
      });
      $list.append($item);
    });
    // Append list to div
    $historyDiv.append($list);
  };
  loadNutLockHistory(); // load now
});

// Imports
import {
  bytesToHex,
  encodeSpendReceipt,
  getEncodedToken,
  isBlsKeyset,
  lockToNutrootOptions,
  lockToP2PKOptions,
  LockBuilder,
  MintQuoteState,
  NUTROOT_NUMS_KEY,
  OutputData,
  Proof,
  sha256,
  Token,
  Wallet,
  type NutrootLeaf,
} from "@cashu/cashu-ts";
import { nip19 } from "nostr-tools";
import { encode as emojiEncode, decode as emojiDecode } from "./emoji-encoder";
import {
  getContactDetails,
  maybeConvertNpubToP2PK,
  convertP2PKToNpub,
  getNip61Info,
} from "./nostr";
import { isPublicKeyValidP2PK, getNut11Mints } from "./nut11";
import {
  copyTextToClipboard,
  delay,
  debounce,
  describeNutrootLeaf,
  formatAmount,
  getTokenAmount,
  getWalletWithUnit,
  getMintProofs,
  storeMintProofs,
  getLockedTokens,
  storeLockedToken,
  clearLockedTokens,
  getErrorMessage,
  withStaleRetry,
} from "./utils";
import { handleCashuDonation } from "./cashu-donate";
import toastr from "toastr";

declare const nostrly_ajax: {
  relays: string[];
};

// DOM ready
type LockType = "refundable" | "permanent" | "auditable";

jQuery(function ($) {
  // Init constants
  const relays = nostrly_ajax.relays;
  const MIN_FEE = 1; // sats
  const PCT_FEE = 1; // 1%
  const MAX_SECRET = 1024; // Characters (mint limit)

  // Init vars
  let wallet: Wallet;
  let mintUrl: string;
  let expireTime: number; // unix TS
  let lockP2PK: string; // P2PKey
  let refundP2PK: any; // P2PKey
  let proofs: Proof[] = [];
  let tokenAmount: number = 0;
  let feeAmount: number = 0;
  let donationAmount: number = 0;
  let extraLockKeys: string[] = [];
  let extraRefundKeys: string[] = [];
  let nSigValue: number = 1;
  let rSigValue: number = 1;
  let lockKeys: string[] = []; // sanitized keys
  let refundKeys: string[] = []; // sanitized keys
  let isV3Mint = false; // active keyset is v3 (nutroot)
  let lockType: LockType = "refundable";
  let fallbackTime: number | undefined; // v3 staged-reclaim leaf, unix TS
  let lockHash: string | undefined; // SHA-256 hex the main path must open
  let lockPreimage: string | undefined; // its secret, when NutLock made it
  let quoteLockPrivkey: string; // NUT-20 lock key for the current mint quote

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
  const $lockedCopyReceipt = $("#locked-receipt-copy");
  const $lockedReceiptHint = $("#locked-receipt-hint");
  const $lockHash = $("#lock-hash");
  const $makeSecret = $("#make-secret");
  const $lockPreimage = $("#lock-preimage");
  const $lockPreimageHex = $("#lock-preimage-hex");
  const $hashlockOption = $("#hashlock-option");
  const $useDisclose = $("#use-disclose");
  const $discloseOption = $("#disclose-option");
  const $extraPaths = $("#extra-paths");
  const $addPath = $("#add-path");
  const $pathRows = $("#path-rows");
  const $lockSummary = $("#lock-summary");
  const $pathsLimit = $("#paths-limit");
  const MAX_TREE_LEAVES = 8; // NUT-10 cap; the main and refund locks take leaves too
  const $historyDiv = $("#nutlock-history");
  const $clearHistory = $("#clear-history");
  const $preamble = $(".preamble");
  const $addDonation = $("#add_donation");
  const $addMultisig = $("#add-multisig");
  const $multisigOptions = $("#multisig-options");
  const $extraLockKeys = $("#extra-lock-keys");
  const $nSigs = $("#n-sigs");
  const $rSigs = $("#r-sigs");
  const $addRefundKeys = $("#add-refund-keys");
  const $refundKeysOptions = $("#refund-keys-options");
  const $extraRefundKeys = $("#extra-refund-keys");
  const $v3Note = $("#v3-note");
  const $v3Fallback = $("#v3-fallback");
  const $refundBlankNote = $("#refund-blank-note");
  const $refundV3Note = $("#refund-v3-note");
  const $refundFallback = $("#refund-fallback");
  const $lockTypeRadios = $("input[name='lock-type']");
  const $lockTypeAuditable = $("#lock-type-auditable");
  const $lockTypeNotes = $("#lock-type [data-lock-type]");
  const $refundableOptions = $("#refundable-options");
  const $permanentWarning = $("#permanent-warning");
  const $confirmPermanent = $("#confirm-permanent");
  const $p2bkOption = $("#p2bk-option");
  const $lockUntilNote = $("#lock-until-note");
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
    mintUrl = $mintSelect.val() as string;
    try {
      // ?legacy=1 binds to the mint's pre-v3 keyset, for testing NUT-11 locks
      const legacy = new URLSearchParams(location.search).has("legacy");
      wallet = await getWalletWithUnit(mintUrl, "sat", { legacy });
      proofs = getMintProofs(mintUrl); // Load saved proofs
      console.log("proofs total:>>", getTokenAmount(proofs));
      console.log("proofs:>>", proofs);
      isV3Mint = isBlsKeyset(wallet.keysetId);
      $v3Note.toggle(isV3Mint);
      applyFallbackVisibility();
      $refundBlankNote.toggle(!isV3Mint);
      $refundV3Note.toggle(isV3Mint);
      $lockTypeAuditable.toggle(isV3Mint);
      $discloseOption.toggle(isV3Mint);
      $extraPaths.toggle(isV3Mint);
      if (!isV3Mint && lockType === "auditable") {
        $lockTypeRadios.filter("[value='refundable']").prop("checked", true);
      }
      applyLockType();
      toastr.success(`Loaded Mint: ${mintUrl}`);
      $mintSelect.attr("data-valid", "");
    } catch (e) {
      const msg = getErrorMessage(e);
      toastr.error(msg);
      $mintSelect.attr("data-valid", "no");
    }
    console.log("mintUrl:>>", mintUrl);
    checkIsReadyToOrder();
  });
  $lockValue.on("input", () => {
    tokenAmount = parseInt($lockValue.val() as string, 10); // Base10 int
    console.log("tokenAmount:>>", tokenAmount);
    feeAmount = Math.max(Math.ceil((tokenAmount * PCT_FEE) / 100), MIN_FEE); // 1% with MIN_FEE
    console.log("feeAmount:>>", feeAmount);
    checkIsReadyToOrder();
  });
  $addDonation.on("input", () => {
    donationAmount = Math.abs(parseInt($addDonation.val() as string, 10)); // Base10 int
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
  // Re-reads the fallback field so a later expiry change re-judges it
  const validateFallback = (quiet = false) => {
    const val = $refundFallback.val() as string;
    fallbackTime = val ? Math.floor(new Date(val).getTime() / 1000) : undefined;
    $refundFallback.attr("data-valid", "");
    if (fallbackTime && expireTime && fallbackTime <= expireTime) {
      $refundFallback.attr("data-valid", "no");
      if (!quiet) {
        toastr.error("Fallback date must be after the lock expiry.");
      }
      fallbackTime = undefined;
    }
    console.log("fallbackTime:>>", fallbackTime);
  };
  $lockExpiry.on("input", () => {
    expireTime = Math.floor(
      new Date($lockExpiry.val() as string).getTime() / 1000,
    );
    console.log("expireTime:>>", expireTime);
    // Check if expireTime is less than now
    checkMinDate(expireTime);
    validateFallback(true); // expiry moves can invalidate (or revalidate) it
    checkIsReadyToOrder();
  });
  $refundFallback.on("input", () => {
    validateFallback();
    checkIsReadyToOrder();
  });
  $orderButton.on("click", async () => {
    showPaymentPage();
    if (!wallet) {
      return;
    }
    const totalNeeded = tokenAmount + feeAmount + donationAmount;
    // Every v5 mint quote is locked (NUT-20); the key is ours to hold for minting
    const { pubkey, privkey } = await wallet.createQuoteLockKey();
    quoteLockPrivkey = privkey;
    const quote = await wallet.createMintQuoteBolt11(totalNeeded, pubkey);
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
  // Lock type drives which fields apply; auditable is one unblinded key
  const applyLockType = () => {
    lockType =
      ($lockTypeRadios.filter(":checked").val() as LockType) ?? "refundable";
    const permanent = lockType !== "refundable";
    $lockTypeNotes.each((_i, el) => {
      $(el).toggle($(el).data("lock-type") === lockType);
    });
    $refundableOptions.toggle(!permanent);
    $lockUntilNote.toggle(!permanent);
    $permanentWarning.toggle(permanent);
    if (!permanent) $confirmPermanent.prop("checked", false);
    // Auditable is a preset: one unblinded key, permanent, publicly verifiable, no extras
    const auditable = lockType === "auditable";
    $addMultisig.toggle(!auditable);
    if (auditable) $multisigOptions.hide();
    $p2bkOption.toggle(!auditable);
    if (auditable) $useP2BK.prop("checked", false);
    $useDisclose.prop("disabled", auditable);
    if (auditable) $useDisclose.prop("checked", true);
    $hashlockOption.toggle(!auditable);
    if (auditable) setLockHash("");
    $extraPaths.toggle(isV3Mint && !auditable);
  };

  // Hashlock: a 64-hex SHA-256, pasted or made here (then the secret is shown once)
  const setLockHash = (text: string) => {
    const hex = text.trim().toLowerCase();
    $lockHash.val(hex).attr("data-valid", "");
    lockHash = undefined;
    if (hex && !/^[0-9a-f]{64}$/.test(hex)) {
      $lockHash.attr("data-valid", "no");
    } else if (hex) {
      lockHash = hex;
    }
    // The secret only belongs to the hash it was made for
    if (
      !lockPreimage ||
      bytesToHex(sha256(hexToBytesSafe(lockPreimage))) !== lockHash
    ) {
      lockPreimage = undefined;
      $lockPreimage.hide();
    }
  };
  const hexToBytesSafe = (hex: string) =>
    Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
  $lockHash.on("input", () => {
    setLockHash($lockHash.val() as string);
    checkIsReadyToOrder();
  });
  $makeSecret.on("click", () => {
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);
    lockPreimage = bytesToHex(secret);
    setLockHash(bytesToHex(sha256(secret)));
    $lockPreimageHex.text(lockPreimage);
    $lockPreimage.show();
    checkIsReadyToOrder();
  });
  $lockPreimage.children(".copypre").on("click", () => {
    if (lockPreimage) copyTextToClipboard(lockPreimage);
  });

  // Extra spending paths: one leaf per row, read off the DOM at build time
  $addPath.on("click", (e) => {
    e.preventDefault();
    const $row = $(
      (
        $("#path-row-template")[0] as HTMLTemplateElement
      ).content.firstElementChild!.cloneNode(true) as HTMLElement,
    );
    $pathRows.append($row);
    updatePathsLimit();
    handlePubkeyInput(
      $row.find(".path-keys"),
      (keys: string[]) => $row.data("keys", keys),
      true,
    );
    $row.find(".path-cond").on("change", () => {
      $row
        .find(".path-after")
        .toggle($row.find(".path-cond").val() === "after");
      checkIsReadyToOrder();
    });
    $row
      .find(".path-nsigs, .path-after, .path-disclose")
      .on("input change", () => checkIsReadyToOrder());
    $row.find(".path-remove").on("click", (ev) => {
      ev.preventDefault();
      $row.remove();
      updatePathsLimit();
      checkIsReadyToOrder();
    });
  });
  const readPaths = (): NutrootLeaf[] => {
    if (!isV3Mint || lockType === "auditable") return [];
    return $pathRows
      .children(".path-row")
      .toArray()
      .map((el, i) => {
        const $row = $(el);
        const keys = ($row.data("keys") as string[] | undefined) ?? [];
        if (!keys.length)
          throw new Error(`Spending path ${i + 1} needs at least one key`);
        const n = parseInt($row.find(".path-nsigs").val() as string, 10) || 1;
        if (n > keys.length) {
          throw new Error(
            `Spending path ${i + 1} asks for ${n} signatures from ${keys.length} keys`,
          );
        }
        const cond = $row.find(".path-cond").val();
        const disclosure = $row.find(".path-disclose").is(":checked")
          ? { disclosure: 1 }
          : {};
        if (cond === "after") {
          const time = Math.floor(
            new Date($row.find(".path-after").val() as string).getTime() / 1000,
          );
          if (!Number.isFinite(time))
            throw new Error(`Spending path ${i + 1} needs a date`);
          return { type: "after", n, keys, time, ...disclosure };
        }
        if (cond === "hash") {
          if (!lockHash)
            throw new Error(
              `Spending path ${i + 1} needs the secret hash above`,
            );
          return { type: "hashlock", n, keys, hash: lockHash, ...disclosure };
        }
        return { type: "threshold", n, keys, ...disclosure };
      });
  };

  // What this lock says, in the words the receiver will read
  const renderLockSummary = (lock: LockBuilder) => {
    const options = lock.toOptions();
    const lines: string[] = [];
    if (isV3Mint) {
      const encoded = lockToNutrootOptions(options);
      lines.push(
        encoded.receiverKey === NUTROOT_NUMS_KEY
          ? "No key path: only the spending paths below can claim it"
          : "Key path: the lock key claims it directly, invisibly to the mint",
      );
      for (const leaf of encoded.leaves ?? []) {
        lines.push(describeNutrootLeaf(typeof leaf === "string" ? leaf : leaf));
      }
      if (encoded.blindKeys?.length)
        lines.push(`${encoded.blindKeys.length} key(s) blinded`);
    } else {
      const m = options.mainKeys?.length ?? 0;
      lines.push(
        `NUT-11 lock: ${options.requiredMainSignatures ?? 1} of ${m} signature(s)` +
          (options.hashlock ? " plus the secret" : ""),
      );
      if (options.locktime) {
        lines.push(
          `After ${new Date(options.locktime * 1000).toLocaleString()}: ${options.refundKeys?.length ? `${options.requiredRefundSignatures ?? 1} of ${options.refundKeys.length} refund signature(s)` : "anyone"}`,
        );
      }
    }
    $lockSummary
      .html(
        `<strong>What this lock says:</strong><ul>${lines.map((l) => `<li>${$("<i>").text(l).html()}</li>`).join("")}</ul>`,
      )
      .show();
  };
  $lockTypeRadios.on("change", () => {
    applyLockType();
    checkIsReadyToOrder();
  });
  $confirmPermanent.on("change", () => checkIsReadyToOrder());
  $useDisclose.on("change", () => checkIsReadyToOrder());
  $useP2BK.on("change", () => checkIsReadyToOrder());

  /**
   * Checks if npub has a NIP-61 P2PK pubkey
   * @param  p2pkey P2PK Pubkey (prefixed 02...)
   * @param  relays  Optional relays (DEFAULT_RELAYS used if unset)
   * @return NIP-61 hex pubkey or original key
   */
  const doNip61Check = async function (
    p2pkey: string,
    relays?: string[],
  ): Promise<string> {
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
      const nip61Key = pubkey;
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
   * @param text - The input text containing one or more public keys.
   * @returns A promise that resolves to an array of unique, valid public keys.
   */
  async function parsePubkeys(text: string): Promise<string[]> {
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
    $input: JQuery,
    setKeyFn: Function,
    isTextarea: boolean = false,
    errorMsgPrefix: string = "Invalid",
    excludeKey?: () => string | undefined,
  ) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
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
    // Block non-paste inputs with a warning; an emptied field (cut/delete)
    // must still process so the stored key is cleared with it
    $input.on("input", (_e) => {
      if (isPasting) {
        return;
      }
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        if ($input.val()) {
          toastr.warning("Please paste only!");
        }
        await processInput();
        isPasting = false;
      }, 200);
    });
    // Process the pasted input
    const processInput = async () => {
      const text = $input.val() as string;
      $input.attr("data-valid", "");
      // Handle empty input
      if (!text) {
        setKeyFn(isTextarea ? [] : undefined);
        checkIsReadyToOrder();
        return;
      }
      // Parse and validate keys, dropping any duplicate of the main key field
      let keys = await parsePubkeys(text);
      const mainKey = excludeKey?.();
      if (mainKey && keys.includes(mainKey)) {
        keys = keys.filter((k) => k !== mainKey);
        toastr.info("Removed duplicate of the main key");
        if (!keys.length) {
          $input.val("");
          setKeyFn([]);
          checkIsReadyToOrder();
          return;
        }
      }
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
    (key: string) => (lockP2PK = key),
    false,
    "Invalid Lock",
  );
  handlePubkeyInput(
    $refundNpub,
    (key: string) => (refundP2PK = key),
    false,
    "Invalid Refund",
  );
  handlePubkeyInput(
    $extraLockKeys,
    (keys: string[]) => (extraLockKeys = keys),
    true,
    "Invalid",
    () => lockP2PK,
  );
  handlePubkeyInput(
    $extraRefundKeys,
    (keys: string[]) => (extraRefundKeys = keys),
    true,
    "Invalid",
    () => refundP2PK,
  );

  // Handle signatures required
  $nSigs.on("input", () => {
    nSigValue = parseInt($nSigs.val() as string, 10);
    if (nSigValue < 1) {
      $nSigs.val(1);
      nSigValue = 1;
      toastr.error("Signatures required must be at least 1");
    }
    console.log("n_sigs:>>", nSigValue);
    checkIsReadyToOrder();
  });

  // The fallback leaf only exists for a refund multisig on a v3 mint
  const applyFallbackVisibility = () => {
    const show = isV3Mint && rSigValue > 1;
    $v3Fallback.toggle(show);
    if (!show) {
      $refundFallback.val("").attr("data-valid", "");
      fallbackTime = undefined;
    }
  };

  // Handle refund signatures required
  $rSigs.on("input", () => {
    rSigValue = parseInt($rSigs.val() as string, 10);
    if (rSigValue < 1) {
      $rSigs.val(1);
      rSigValue = 1;
      toastr.error("Signatures required must be at least 1");
    }
    console.log("n_sigs_refund:>>", rSigValue);
    applyFallbackVisibility();
    checkIsReadyToOrder();
  });

  // Use NIP-07 to fetch public key
  $nip07Button.on("click", () => useNip07($refundNpub));
  $("#use-nip07-lock").on("click", () => useNip07($lockNpub));
  async function useNip07($target: JQuery) {
    try {
      if (typeof window?.nostr?.getPublicKey === "undefined") {
        throw new Error("NIP-07 signer not detected.");
      }
      const pubkey = await window?.nostr?.getPublicKey();
      if (pubkey) {
        $target.val(nip19.npubEncode(pubkey));
        $target.trigger("paste"); // validation
      } else {
        throw new Error("Could not fetch public key from NIP-07 signer.");
      }
    } catch (e) {
      const msg = getErrorMessage(e);
      toastr.error(msg);
      console.error(e);
    }
  }

  // Builds the semantic lock from the current form state; the wallet
  // encodes it for the active keyset (NUT-11/14 tags pre-v3, nutroot on v3)
  // One path for every lock type: auditable is the preset "one unblinded key, permanent,
  // publicly verifiable", which the encoder turns into NUMS plus one leaf (auditableLock's shape)
  const buildLock = () => {
    const auditable = lockType === "auditable";
    const lock = new LockBuilder()
      .addMainPubkey(auditable ? [lockP2PK] : lockKeys)
      .requireMainSignatures(auditable ? 1 : nSigValue);
    if (!auditable && lockHash) lock.addHashlock(lockHash);
    if (!auditable && $useP2BK.is(":checked")) lock.blindKeys();
    if (auditable || $useDisclose.is(":checked")) lock.disclose();
    if (lockType === "refundable") {
      lock.lockUntil(expireTime).addRefundPubkey(refundKeys);
      if (refundKeys.length) lock.requireRefundSignatures(rSigValue);
      // v3 staged reclaim: a later window where any single refund key suffices
      if (isV3Mint && fallbackTime && refundKeys.length && rSigValue > 1) {
        lock.addLeaf({
          type: "after",
          n: 1,
          keys: refundKeys,
          time: fallbackTime,
        });
      }
    }
    for (const leaf of readPaths()) lock.addLeaf(leaf);
    return lock;
  };

  // The tree holds 8 leaves and the main and refund locks take some, so count rows, filled or
  // not, against what the lock uses: counted structurally, so a half-filled form still counts
  const lockLeafCount = () => {
    const auditable = lockType === "auditable";
    const mainIsLeaf =
      auditable ||
      !!lockHash ||
      lockKeys.length > 1 ||
      nSigValue > 1 ||
      $useDisclose.is(":checked");
    const refund =
      lockType === "refundable"
        ? 1 + (fallbackTime && rSigValue > 1 ? 1 : 0)
        : 0;
    return (mainIsLeaf ? 1 : 0) + refund;
  };
  const updatePathsLimit = () => {
    const over =
      lockLeafCount() + $pathRows.children().length - MAX_TREE_LEAVES;
    $addPath.toggle(over < 0);
    $pathsLimit
      .text(
        over > 0
          ? `Too many spending paths for one tree (8): remove ${over}.`
          : "The tree is full: a Nutroot lock holds at most 8 spending paths.",
      )
      .toggle(over >= 0);
  };

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
    lockKeys = [
      ...new Set(
        [lockP2PK, ...(lockType === "auditable" ? [] : extraLockKeys)].filter(
          Boolean,
        ),
      ),
    ];
    if (!lockKeys.length) return false;
    refundKeys = [...new Set([refundP2PK, ...extraRefundKeys].filter(Boolean))];
    if (isV3Mint) updatePathsLimit(); // before any early return: empty rows still count
    // v3 refundable locks need a refund key: nutroot has no anyone-after-expiry
    const hasValidRefunds = isV3Mint
      ? refundKeys.length > 0
      : !$refundNpub.val() || refundKeys.length > 0;
    const permanent = lockType !== "refundable";
    const typeReady = permanent
      ? $confirmPermanent.is(":checked")
      : Boolean(expireTime) && hasValidRefunds;
    console.log("lockKeys:>", lockKeys);
    console.log("refundKeys:>", refundKeys);
    // v3 pre-flight: surface anything the nutroot encoder would refuse (eg a
    // threshold above the key count) once the form is otherwise complete
    if (isV3Mint && typeReady) {
      try {
        const issues = buildLock().validate("v3");
        if (issues.length) {
          toastr.error(issues[0].message);
          setOrderButtonState(true);
          return false;
        }
      } catch (e) {
        toastr.error(getErrorMessage(e));
        setOrderButtonState(true);
        return false;
      }
    }
    // Live summary of the lock as the receiver will read it
    try {
      if (lockP2PK) renderLockSummary(buildLock());
      else $lockSummary.hide();
    } catch {
      $lockSummary.hide();
    }
    // Check secret length is under MAX_SECRET characters as some mints have
    // this limit. To do this, let's create a 1 sat blinded message with p2pk
    // @see: https://github.com/cashubtc/nuts/pull/234
    // v3 secrets are fixed-size points, so only pre-v3 tag secrets need it
    let secretLength = 0;
    if (!isV3Mint) {
      let secretDecode = "";
      try {
        const keyset = wallet.keyChain.getKeyset(wallet.keysetId);
        const testBlindedMessage = OutputData.createSingleP2PKData(
          lockToP2PKOptions(buildLock().toOptions()),
          1, // for testing
          keyset.id,
        );
        secretDecode = new TextDecoder().decode(testBlindedMessage.secret);
      } catch (e) {
        const msg = getErrorMessage(e);
        toastr.error(msg);
        console.error(e);
      }
      secretLength = secretDecode.length;
      console.log("secret:>>", secretDecode);
      console.log("secret length:>>", secretLength);
      if (secretLength > MAX_SECRET) {
        toastr.error(
          "Your token's secret will be too long. Please remove some Lock or Refund keys.",
        );
      }
    }

    if (
      tokenAmount > 0 &&
      typeReady &&
      lockP2PK &&
      $lockHash.attr("data-valid") !== "no" &&
      $extraLockKeys.attr("data-valid") !== "no" &&
      $extraRefundKeys.attr("data-valid") !== "no" &&
      $refundFallback.attr("data-valid") !== "no" &&
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
  const checkQuote = async (quote: string) => {
    if (!wallet) {
      throw new Error("Wallet instance not found!");
    }
    const newquote = await wallet.checkMintQuoteBolt11(quote);
    const totalNeeded = tokenAmount + feeAmount + donationAmount;
    if (newquote.state === MintQuoteState.PAID) {
      // v5 needs the full quote object (amount accounting), not the bare id
      const ps = await withStaleRetry(() =>
        wallet.mintProofsBolt11(totalNeeded, newquote, {
          privkey: quoteLockPrivkey,
        }),
      );
      proofs = [...proofs, ...ps];
      storeMintProofs(mintUrl, proofs, true); // Store all for safety
      createLockedToken();
    } else if (getTokenAmount(proofs).greaterThanOrEqual(totalNeeded)) {
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
        if (!wallet) {
          throw new Error("Wallet instance not found!");
        }
        let token: string | Token = $payByCashu.val() as string;
        if (!token.startsWith("cashu")) {
          token = emojiDecode(token);
        }
        token = wallet.decodeToken(token);
        // Check this token is from same mint as wallet
        if (token.mint != mintUrl) {
          throw new Error("Token is not from " + mintUrl);
        }
        // Check this token unit matches wallet unit
        if (token.unit !== wallet.unit) {
          throw new Error(
            `Unit mismatch: Needed ${wallet.unit}, Received ${token.unit}`,
          );
        }
        // Check token was big enough
        const totalNeeded = tokenAmount + feeAmount + donationAmount;
        if (getTokenAmount(token.proofs).lessThan(totalNeeded)) {
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
        const msg = getErrorMessage(e);
        toastr.error(msg);
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
      if (!wallet) {
        throw new Error("Wallet instance not found!");
      }
      const lockOptions = buildLock().toOptions();
      console.log("lockOptions", lockOptions);
      const {
        send: p2pkProofs,
        keep: donationProofs,
        receipts,
      } = await withStaleRetry(() =>
        wallet.ops.send(tokenAmount, proofs).asLocked(lockOptions).run(),
      );
      // Spend receipt (v3 inputs only): the spent proofs, harmless once spent, plus what opens
      // their NUT-07 commitments. Witness verifies the bundle.
      const spent = proofs.filter(
        (p) => !donationProofs.some((k) => k.secret === p.secret),
      );
      const receipt = receipts?.length
        ? encodeSpendReceipt({
            token: getEncodedToken({ mint: mintUrl, proofs: spent }),
            receipts,
          })
        : "";
      console.log("p2pkProofs:>>", p2pkProofs);
      console.log("donationProofs:>>", donationProofs);

      if (donationProofs.length) {
        const donationToken = getEncodedToken({
          mint: mintUrl,
          proofs: donationProofs,
        });
        handleCashuDonation(donationToken, "Cashu NutLock Donation");
      }

      const lockedToken = getEncodedToken({
        mint: mintUrl,
        proofs: p2pkProofs,
      });
      const npub = convertP2PKToNpub(lockP2PK);
      let { name } = await getContactDetails(npub, relays);
      if (!name) name = npub.slice(0, 11);
      storeLockedToken(lockedToken, tokenAmount, name, lockPreimage); // for safety / history
      $lockedToken.val(lockedToken);
      showSuccessPage();
      $lockedToken.on("click", () => copyTextToClipboard(lockedToken));
      $lockedCopyToken.on("click", () => copyTextToClipboard(lockedToken));
      $lockedCopyEmoji.on("click", () =>
        copyTextToClipboard(emojiEncode("\uD83E\uDD5C", lockedToken)),
      );
      $lockedCopyReceipt.toggle(receipt !== "");
      $lockedReceiptHint.toggle(receipt !== "");
      $lockedCopyReceipt
        .off("click")
        .on("click", () => copyTextToClipboard(receipt));
      storeMintProofs(mintUrl, [], true); // zap the proof store
    } catch (e) {
      const msg = getErrorMessage(e, "Error creating locked token.");
      toastr.remove(); // clears any messages
      toastr.error(msg);
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
          <span class="copytkn">Copy Token</span>&nbsp;&nbsp;<span class="copyemj">Copy 🥜</span>${entry.preimage ? '&nbsp;&nbsp;<span class="copypre">Copy Secret</span>' : ""} &nbsp; ${date} - ${name} - ${amount}
        </li>
      `);
      $item.children(".copypre").on("click", () => {
        copyTextToClipboard(entry.preimage!);
      });
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

  // Witness's "counter-lock" link: their hash, their refund key as the main
  // key, and an expiry ahead of theirs. The refund key and mint are the user's
  const q = new URLSearchParams(location.search);
  if (q.get("hash")) {
    $lockHash.val(q.get("hash")!).trigger("input");
    if (q.get("pubkey")) $lockNpub.val(q.get("pubkey")!).trigger("paste");
    const expiry = Number(q.get("expiry"));
    if (expiry) {
      const local = new Date(expiry * 1000);
      local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
      $lockExpiry.val(local.toISOString().slice(0, 16)).trigger("input");
    }
    if (q.get("disclose")) $useDisclose.prop("checked", true);
    toastr.info(
      "Counter-lock prefilled from Witness: choose the mint and add your refund key",
    );
  }
});

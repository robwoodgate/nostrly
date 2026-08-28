// Imports
import {
  getEncodedToken,
  getTokenMetadata,
  getP2PKExpectedWitnessPubkeys,
  getP2PKSigFlag,
  getP2PKWitnessSignatures,
  signP2PKProofs,
  hasP2PKSignedProof,
  verifyP2PKSpendingConditions,
  Amount,
  Proof,
  Wallet,
  Token,
  ConsoleLogger,
  CashuNip07,
  type ReceiveConfig,
  type SpendOption,
  type SpendOptions,
} from "@cashu/cashu-ts";
import { decode as emojiDecode, encode as emojiEncode } from "./emoji-encoder";
import {
  getNip60Wallet,
  isPrivkeyValid,
  maybeConvertNsecToP2PK,
  signNip60Proofs,
  signWithNip07,
} from "./nostr";
import {
  copyTextToClipboard,
  debounce,
  describeNutrootLeaf,
  describeV3KeyPath,
  doConfettiBomb,
  formatAmount,
  getErrorMessage,
  getTokenAmount,
  getWalletWithUnit,
  isBlsProof,
} from "./utils";
import { getContactDetails, convertP2PKToNpub } from "./nostr";
import toastr from "toastr";
import { handleCashuDonation } from "./cashu-donate";

declare const nostrly_ajax: {
  relays: string[];
};

// DOM ready
jQuery(function ($) {
  // Init vars
  let wallet: Wallet | undefined;
  let mintUrl: string;
  let unit: string;
  let proofs: Proof[];
  let allProofs: Proof[] = []; // every live proof, including ones not displayed
  let tokenAmount: Amount;
  let privkey: string;
  let p2pkParams: { pubkeys: string[]; n_sigs: number } = {
    pubkeys: [],
    n_sigs: 0,
  };
  let spendAuthorised = false;
  let isV3 = false; // proofs are on a v3 (nutroot) keyset
  const hasNip07 = typeof window?.nostr?.getPublicKey !== "undefined";
  let nip07Pubkey: string | undefined; // 02-prefixed, once the extension is asked
  let nip07Privkeys: string[] = []; // NIP-60 wallet keys unlocked via the extension

  // Every key this page can sign with directly: pasted, plus NIP-60 via NIP-07
  const signingKeys = () => [
    ...(privkey ? [maybeConvertNsecToP2PK(privkey)] : []),
    ...nip07Privkeys,
  ];
  // A leaf the extension can complete: read at call time, since extensions may
  // inject window.nostr after this script runs
  const extensionCanSign = (opt: SpendOption) =>
    Boolean(nip07Pubkey && window.nostr && CashuNip07.canSign(window.nostr)) &&
    CashuNip07.completes(opt, nip07Pubkey!);
  const logger = new ConsoleLogger("debug");

  // DOM elements
  const $divForm = $("#cashu-witness-form");
  const $divSuccess = $("#cashu-witness-success");
  const $token = $("#token");
  const $privkey = $("#privkey");
  const $signersDiv = $("#signers");
  const $useNip07 = $("#use-nip07");
  const $unlockDiv = $("#unlock");
  const $unlockToken = $("#unlock-token");
  const $witnessInfo = $("#witness-info");
  const $witnessedHeading = $("#witnessed-heading");
  const $witnessedToken = $("#witnessed-token");
  const $copyToken = $("#witnessed-token-copy");
  const $copyEmoji = $("#witnessed-emoji-copy");
  const $historyDiv = $("#witness-history");
  const $clearHistory = $("#clear-history");
  const $donateCashu = $("#donate_cashu");

  // Donation input
  $donateCashu.on("paste", () => {
    setTimeout(async () => {
      handleCashuDonation(
        $donateCashu.val() as string,
        "Cashu Redeem Donation",
      );
      $donateCashu.val("");
    }, 200);
    console.log("donation");
  });

  // Reset vars
  const resetVars = function () {
    $token.attr("data-valid", "");
    wallet = undefined;
    mintUrl = "";
    unit = "sat";
    proofs = [];
    allProofs = [];
    tokenAmount = Amount.zero();
    privkey = "";
    p2pkParams = { pubkeys: [], n_sigs: 0 };
    spendAuthorised = false;
    isV3 = false;
    $witnessInfo.hide().empty();
  };

  // Page handlers
  async function showForm() {
    $divForm.show();
    $divSuccess.hide();
  }
  function showSuccess() {
    $divForm.hide();
    $divSuccess.show();
    doConfettiBomb();
  }

  // Input handlers
  $token.on("input", debounce(processToken, 200));
  $privkey.on("paste", (_e) => {
    setTimeout(() => {
      privkey = $privkey.val() as string;
      if (isPrivkeyValid(privkey)) {
        $privkey.attr("data-valid", "");
        if (isV3) {
          displayV3Info(true); // re-assess the tree with this key
        } else {
          signAndWitnessToken(false);
        }
        $privkey.val("");
      } else {
        $privkey.attr("data-valid", "no");
        toastr.error("Invalid private key");
      }
    }, 100); // Delay to ensure paste value is available
  });
  $useNip07.on("click", () =>
    isV3 ? loadNip07ForV3() : signAndWitnessToken(true),
  );
  $copyToken.on("click", () =>
    copyTextToClipboard($witnessedToken.val() as string),
  );
  $copyEmoji.on("click", () =>
    copyTextToClipboard(
      emojiEncode("\uD83E\uDD5C", $witnessedToken.val() as string),
    ),
  );
  $clearHistory.on("click", () => {
    clearWitnessHistory();
    loadWitnessHistory();
  });
  $unlockToken.on("click", unlockToken);

  // Process the input token
  async function processToken() {
    try {
      // Reset vars
      resetVars();

      // check token
      let tokenEncoded: string = $token.val() as string;
      if (!tokenEncoded) {
        return;
      }
      if (!tokenEncoded.startsWith("cashu")) {
        const decoded = emojiDecode(tokenEncoded);
        if (decoded) {
          tokenEncoded = decoded;
          $token.val(decoded);
        }
      }
      const metadata = getTokenMetadata(tokenEncoded);
      if (!metadata.mint || !metadata.proofAmounts.length) {
        throw new Error("Invalid token format");
      }
      mintUrl = metadata.mint;
      unit = metadata.unit;
      wallet = await getWalletWithUnit(mintUrl, unit);
      const token: Token = wallet.decodeToken(tokenEncoded);
      // Drop spent proofs first: one spent input fails a whole unlock swap
      const { unspent } = await wallet.groupProofsByState(token.proofs);
      if (!unspent.length) {
        throw new Error("Token already spent");
      }
      if (unspent.length < token.proofs.length) {
        allProofs = unspent;
        $token.val(
          getEncodedToken({ mint: metadata.mint, unit, proofs: unspent }),
        );
        toastr.warning(
          `${token.proofs.length - unspent.length} proof(s) already spent - token regenerated with the rest`,
        );
      } else {
        allProofs = token.proofs;
      }
      proofs = allProofs.filter((p) => p.secret.includes("P2PK"));
      if (!proofs.length) {
        // Nutroot: every proof is locked to its point secret; spend_info
        // says who can spend it, so witness X-rays them all
        const v3 = allProofs.filter(isBlsProof);
        if (!v3.length) {
          toastr.error("This is not a locked token. Go spend it anywhere!");
          return;
        }
        isV3 = true;
        proofs = v3;
      }
      if (proofs.length < allProofs.length) {
        // Mixed token: the display covers one kind; unlock handles them all
        const otherAmount = getTokenAmount(allProofs).subtract(
          getTokenAmount(proofs),
        );
        toastr.info(
          `Token also carries ${formatAmount(otherAmount, unit)} in other proofs (not shown). Unlocking includes them.`,
        );
      }
      if (!isV3) {
        proofs.forEach((proof) => {
          if ("SIG_ALL" == getP2PKSigFlag(proof.secret)) {
            throw new Error("Sorry, SIG_ALL tokens are not supported yet");
          }
        });
        p2pkParams.pubkeys = getP2PKExpectedWitnessPubkeys(proofs[0].secret);
        p2pkParams.n_sigs = verifyP2PKSpendingConditions(
          proofs[0],
        ).main.requiredSigners;
      }
      tokenAmount = getTokenAmount(proofs);
      console.log("token:>>", token);
      console.log("proofs:>>", proofs);
      toastr.success(
        `Valid token: ${formatAmount(tokenAmount, unit)} from ${mintUrl}`,
      );
      $token.attr("data-valid", "");
    } catch (e) {
      const message = getErrorMessage(e, "Invalid token");
      toastr.error(message);
      console.error("processToken error:", e);
      resetVars();
    }
    if (isV3) {
      await displayV3Info();
    } else {
      displayWitnessInfo();
    }
    checkNip07ButtonState();
  }

  // Display witness requirements
  function displayWitnessInfo() {
    if (!proofs[0]?.secret) {
      return;
    }
    const proof = proofs[0];
    const verification = verifyP2PKSpendingConditions(proof, logger);
    const { lockState, locktime } = verification;
    const mainPubkeys = verification.main.pubkeys;
    const refundPubkeys = verification.refund.pubkeys;
    const mainRequiredSigners = verification.main.requiredSigners;
    const refundRequiredSigners = verification.refund.requiredSigners;
    const hasP2BK = proofs.some((p) => p?.p2pk_e);

    const getSignedKeys = (pubkeys: string[]): string[] => {
      const keys: string[] = [];
      pubkeys.forEach((pub) => {
        try {
          if (hasP2PKSignedProof(pub, proof)) {
            keys.push(pub);
          }
        } catch (e) {
          console.error("Verification error:", e);
        }
      });
      return [...new Set(keys)];
    };

    const mainSignedPubkeys = getSignedKeys(mainPubkeys);
    const refundSignedPubkeys = getSignedKeys(refundPubkeys);
    spendAuthorised = verification.success;

    let html = `<div><strong>Token Value:</strong><ul><li>${formatAmount(tokenAmount, unit)} from ${mintUrl}</li></ul></div>`;
    html += "<strong>Witness Requirements:</strong><ul>";
    if (lockState === "PERMANENT") {
      html += `<li>Locktime: permanently locked (no expiry)</li>`;
    } else if (lockState === "ACTIVE") {
      html += `<li>Locktime: active until ${new Date(locktime * 1000).toLocaleString().slice(0, -3)}</li>`;
    } else {
      html += `<li>Locktime: expired</li>`;
    }

    const mainRemaining = Math.max(
      mainRequiredSigners - mainSignedPubkeys.length,
      0,
    );
    const mainSpendable = mainRequiredSigners === 0 || mainRemaining === 0;
    html += `<li>Locktime MultiSig: ${mainSignedPubkeys.length}/${mainRequiredSigners} signatures (${mainPubkeys.length} eligible)${mainSpendable ? " - spendable" : ""}</li>`;

    const refundPathActive =
      lockState === "EXPIRED" && refundPubkeys.length > 0;
    if (
      !refundPubkeys.length &&
      lockState === "EXPIRED" &&
      mainRequiredSigners === 0
    ) {
      html += `<li>Unlocked: locktime expired and no refund keys (anyone can spend)</li>`;
    }

    // if (mainPubkeys.length) {
    //   html += `<li>Locktime Pubkeys:</li>`;
    // }
    html += `<ul>`;

    const updateContactName = (
      id: string,
      npub: string,
      p2pkey: string,
      relays: string[],
    ) => {
      getContactDetails(npub, relays).then(({ name, hexpub }) => {
        if (name) {
          const nip61 = hexpub != p2pkey.slice(2) ? "(NIP-61)" : "(NPUB)";
          $(`#${id}`).replaceWith(
            `<a href="https://njump.me/${npub}" target="_blank">${name}</a> ${nip61}`,
          );
        } else if (hasP2BK) {
          $(`#${id}`).append(" (P2BK)");
        }
      });
    };

    for (const pub of mainPubkeys) {
      const npub = convertP2PKToNpub(pub);
      const isSigned = mainSignedPubkeys.includes(pub);
      const keyId = `main-${npub}`;
      const keyholder = `<span id="${keyId}">${pub.slice(0, 12)}...${pub.slice(-12)}</span>`;
      html += `<li class="${isSigned ? "signed" : "pending"}"><span class="status-icon"></span>${keyholder}: ${
        isSigned ? "Signed" : "Pending"
      }</li>`;
      updateContactName(keyId, npub, pub, nostrly_ajax.relays);
    }
    if (mainPubkeys.length) {
      html += `</ul>`;
    }

    if (refundPubkeys.length) {
      if (refundPathActive) {
        const refundRemaining = Math.max(
          refundRequiredSigners - refundSignedPubkeys.length,
          0,
        );
        const refundSpendable =
          refundRequiredSigners === 0 || refundRemaining === 0;
        html += `<li>Refund MultiSig: active (${refundSignedPubkeys.length}/${refundRequiredSigners} signatures, ${refundPubkeys.length} eligible)${refundSpendable ? " - spendable" : ""}</li>`;
      } else {
        html += `<li>Refund MultiSig: configured, becomes active after locktime expiry</li>`;
      }
      // html += `<li>Refund Pubkeys:</li>`;
      html += `<ul>`;
      for (const pub of refundPubkeys) {
        const npub = convertP2PKToNpub(pub);
        const isSigned = refundSignedPubkeys.includes(pub);
        const keyId = `refund-${npub}`;
        const keyholder = `<span id="${keyId}">${pub.slice(0, 12)}...${pub.slice(-12)}</span>`;
        html += `<li class="${isSigned ? "signed" : "pending"}"><span class="status-icon"></span>${keyholder}: ${
          isSigned ? "Signed" : "Pending"
        }</li>`;
        updateContactName(keyId, npub, pub, nostrly_ajax.relays);
      }
      html += `</ul>`;
    }

    if (verification.success) {
      if (refundPathActive && mainSpendable) {
        html += `<p class="summary">Spendable now. Locktime MultiSig is valid, and Refund MultiSig is also available.</p>`;
      } else {
        html += `<p class="summary">Spendable now via ${verification.path.toLowerCase()} pathway.</p>`;
      }
      $unlockDiv.show();
    } else {
      const refundRemaining = Math.max(
        refundRequiredSigners - refundSignedPubkeys.length,
        0,
      );
      const reminders = [
        mainRemaining > 0 ? `${mainRemaining} more for main` : null,
        refundPathActive && refundRemaining > 0
          ? `${refundRemaining} more for refund`
          : null,
      ].filter(Boolean);
      if (reminders.length) {
        html += `<p class="summary">Need ${reminders.join("; ")}.</p>`;
      }
      $unlockDiv.hide();
    }

    if (hasP2BK) {
      html += `<p class="summary">Token is P2BK encoded (unlock token below to convert).</p>`;
      if (verification.success) {
        $unlockDiv.show();
      }
    }

    html += `</ul>`;
    $witnessInfo.show().html(html);
  }

  // Display v3 (nutroot) spending conditions: the key path, then each
  // disclosed tree leaf with this wallet's own satisfiability assessment
  async function displayV3Info(attempted = false) {
    const proof = proofs[0];
    if (!proof || !wallet) {
      return;
    }
    const privkeys = signingKeys();
    let spend: SpendOptions = { keyPath: false, script: [] };
    try {
      spend = await wallet.spendOptions(
        proof,
        privkeys.length ? { privkeys } : undefined,
      );
    } catch (e) {
      console.error("spendOptions error:", e);
      toastr.error(
        getErrorMessage(e, "Could not read this token's spending conditions"),
      );
      return;
    }
    const keyPath = describeV3KeyPath(proof);
    const canSpend = (o: SpendOption) => o.satisfiable || extensionCanSign(o);
    spendAuthorised = spend.keyPath || spend.script.some(canSpend);
    // A silent re-render after a paste or NIP-07 click reads as a broken button
    if (attempted) {
      if (spendAuthorised) {
        toastr.success("Your key unlocks this token");
      } else {
        toastr.warning("That key does not unlock the key path or any leaf");
      }
    }

    const updateContactName = (id: string, npub: string) => {
      getContactDetails(npub, nostrly_ajax.relays).then(({ name }) => {
        if (name) {
          $(`#${id}`).replaceWith(
            `<a href="https://njump.me/${npub}" target="_blank">${name}</a>`,
          );
        }
      });
    };

    let html = `<div><strong>Token Value:</strong><ul><li>${formatAmount(tokenAmount, unit)} from ${mintUrl}</li></ul></div>`;
    html += `<div><strong>Nutroot Token:</strong> the token secret is itself a public key, with any conditions hidden inside it, taproot-style. The mint cannot see the details below unless they are used.</div>`;
    html += `<strong>Key Path:</strong><ul>`;
    html += `<li>Locked to&nbsp;<span style="font-family:monospace">${proof.secret.slice(0, 12)}...${proof.secret.slice(-12)}</span></li>`;
    const keyPathText =
      keyPath.kind === "receiver-keyed" && spend.keyPath
        ? "A blinded recipient key: your key unlocks it."
        : keyPath.text;
    html += `<li class="${spend.keyPath ? "signed" : "pending"}"><span class="status-icon"></span>${keyPathText}</li>`;
    html += `</ul>`;

    if (spend.script.length) {
      html += `<strong>Script Leaves (any ONE unlocks the token):</strong><ul>`;
      for (const opt of spend.script) {
        let status = "";
        const extSign = extensionCanSign(opt);
        if (opt.satisfiable) {
          status = " - unlockable with your key";
        } else if (extSign) {
          status = " - unlockable with your Nostr extension";
        } else if (opt.blockedBy === "locktime") {
          status = " - not yet active"; // the leaf text already names the date
        } else if (opt.blockedBy === "preimage") {
          status = " - needs its secret preimage";
        } else if (privkeys.length) {
          status = " - your key does not unlock this leaf";
        }
        html += `<li class="${canSpend(opt) ? "signed" : "pending"}"><span class="status-icon"></span>Leaf ${opt.leafIndex + 1}: ${describeNutrootLeaf(opt.leaf)}${status}</li>`;
        const held = new Set(opt.keys.map((k) => k.keyIndex));
        html += `<ul>`;
        opt.leaf.keys.forEach((pub, keyIndex) => {
          const npub = convertP2PKToNpub(pub);
          const keyId = `leaf-${opt.leafIndex}-${npub}`;
          const keyholder = `<span id="${keyId}">${pub.slice(0, 12)}...${pub.slice(-12)}</span>`;
          const mine = held.has(keyIndex)
            ? ": your key"
            : extSign && pub === nip07Pubkey
              ? ": your Nostr key"
              : "";
          html += `<li class="${mine ? "signed" : "pending"}"><span class="status-icon"></span>${keyholder}${mine}</li>`;
          updateContactName(keyId, npub);
        });
        html += `</ul>`;
      }
      html += `</ul>`;
    }

    if (spendAuthorised) {
      html +=
        keyPath.kind === "bearer" && !spend.script.length
          ? `<p class="summary">Unlock below to sweep into a fresh token only you hold (invalidates this one).</p>`
          : `<p class="summary">Unlock below to convert into a normal token, spendable in any Cashu wallet.</p>`;
      $unlockDiv.show();
    } else {
      if (keyPath.kind === "receiver-keyed" || spend.script.length) {
        html += `<p class="summary">Paste a private key below, or use your NIP-07 signer, to check whether it can unlock this token.</p>`;
      }
      $unlockDiv.hide();
    }
    $witnessInfo.show().html(html);
    checkNip07ButtonState();
  }

  // Check NIP-07 button state and handle unlocked tokens
  function checkNip07ButtonState() {
    console.log("hasNip07", hasNip07);
    console.log("tokenAmount", tokenAmount);
    console.log("proofs length", proofs.length);
    if (spendAuthorised) {
      $signersDiv.hide();
      $useNip07.prop("disabled", true);
      return;
    }
    if (isV3) {
      // The extension helps a nutroot unlock two ways: NIP-60 wallet keys it
      // decrypts, and signSchnorr for a leaf that lists the Nostr key verbatim
      $signersDiv.show();
      $useNip07
        .show()
        .prop(
          "disabled",
          typeof window?.nostr?.getPublicKey === "undefined" || !proofs.length,
        );
      $("#witness-sig-legacy").hide();
      $("#witness-sig-v3").show();
      return;
    }
    $useNip07.show();
    $("#witness-sig-legacy").show();
    $("#witness-sig-v3").hide();
    const isLocked = p2pkParams.pubkeys.length > 0;
    if (isLocked && !tokenAmount.isZero() && proofs.length) {
      $signersDiv.show();
      if (hasNip07) {
        $useNip07.prop("disabled", false);
      } else {
        $useNip07.prop("disabled", true);
      }
    } else {
      $signersDiv.hide();
      $useNip07.prop("disabled", true);
    }
  }

  // Ask the extension for its pubkey and any NIP-60 wallet keys, then re-assess the tree
  async function loadNip07ForV3() {
    try {
      if (typeof window?.nostr?.getPublicKey === "undefined") {
        throw new Error("NIP-07 signer not detected.");
      }
      const pubkey = await window.nostr.getPublicKey();
      nip07Pubkey = await CashuNip07.pubkey(window.nostr);
      if (typeof window.nostr.nip44?.decrypt !== "undefined") {
        ({ privkeys: nip07Privkeys } = await getNip60Wallet(pubkey));
      }
      if (!nip07Privkeys.length && !CashuNip07.canSign(window.nostr)) {
        toastr.warning(
          "No NIP-60 wallet keys found, and this signer cannot sign a Nutroot leaf directly.",
        );
      }
      await displayV3Info(true);
    } catch (e) {
      toastr.error(getErrorMessage(e, "NIP-07 signer failed"));
      console.error(e);
    }
  }

  // Sign and witness the token
  async function signAndWitnessToken(useNip07 = false) {
    try {
      toastr.info("Signing each of the proofs in this token...");
      let originalProofs = [...proofs]; // Store original state
      let signedProofs = [...proofs];
      console.log("signedProofs before:>>", signedProofs);

      // Handle NIP-60 wallet
      signedProofs = await signNip60Proofs(signedProofs);

      // Handle NIP-07 signing
      if (useNip07) {
        signedProofs = await signWithNip07(signedProofs);
        console.log("signedProofs after NIP-07:>>", signedProofs);
      }

      // Handle secret key input
      if (privkey) {
        if (!isPrivkeyValid(privkey)) {
          throw new Error("No valid private key provided");
        }
        signedProofs = signP2PKProofs(
          signedProofs,
          maybeConvertNsecToP2PK(privkey),
          logger,
        );
        console.log("signedProofs after privkey:>>", signedProofs);
      }

      // Count proofs that had signatures added in this operation
      let signedCount = 0;
      for (let i = 0; i < originalProofs.length; i++) {
        const originalSigs = getP2PKWitnessSignatures(
          originalProofs[i].witness,
        );
        const newSigs = getP2PKWitnessSignatures(signedProofs[i].witness);
        console.log("newSigs:>>", newSigs);
        console.log("originalSigs:>>", originalSigs);
        if (newSigs.length > originalSigs.length) {
          signedCount++;
        }
      }
      console.log("p2pkParams:>>", p2pkParams);
      console.log("signedCount:>>", signedCount);
      if (signedCount === 0) {
        toastr.error("No proofs needed signing with this key");
        return;
      }

      console.log("signedProofs after:>>", signedProofs);
      console.log("Encoding token...");
      // Re-encode every live proof: signed ones updated, the rest (eg
      // nutroot proofs in a mixed token) pass through untouched
      const bySecret = new Map(signedProofs.map((p) => [p.secret, p]));
      const witnessedToken = getEncodedToken({
        mint: mintUrl,
        proofs: allProofs.map((p) => bySecret.get(p.secret) ?? p),
        unit: unit,
      });
      $witnessedToken.val(witnessedToken);
      const verification = verifyP2PKSpendingConditions(
        signedProofs[0],
        logger,
      );
      let status = verification.success
        ? `Spendable (${verification.path})`
        : `Partially signed: ${verification.main.receivedSigners.length}/${verification.main.requiredSigners}`;
      storeWitnessHistory(witnessedToken, tokenAmount, status);
      showSuccess();
      toastr.success(
        `Added signatures to ${signedCount} proof${signedCount > 1 ? "s" : ""}!`,
      );
    } catch (e) {
      console.error("Error in signAndWitnessToken:", e);
      const message = getErrorMessage(e, "Failed to sign token");
      toastr.error(message);
    }
  }

  // Receives the token for an unlocked one
  async function unlockToken() {
    try {
      console.log("unit:>>", unit);
      wallet = await getWalletWithUnit(mintUrl, unit); // Load wallet
      const config: ReceiveConfig = {};
      // The key serves both encodings in a mixed token: NUT-11 proofs are
      // signed with it, nutroot proofs sign the unlock transaction
      const privkeys = signingKeys();
      if (privkeys.length) {
        config.privkey = privkeys;
      }
      // Nutroot proofs the key path cannot spend go through their first
      // satisfiable leaf as a script path plan
      const plans = await wallet.planScriptPaths(
        allProofs,
        privkeys.length ? { privkeys } : undefined,
      );
      // Leaves only the extension can complete get a cosign hook, which
      // signSchnorr answers once the transaction digest is known
      const planned = new Set(plans.map((p) => p.secret));
      for (const proof of allProofs.filter(isBlsProof)) {
        if (planned.has(proof.secret)) continue;
        const spend = await wallet.spendOptions(
          proof,
          privkeys.length ? { privkeys } : undefined,
        );
        if (spend.keyPath) continue;
        const opt = spend.script.find(extensionCanSign);
        if (opt) {
          plans.push({
            secret: proof.secret,
            leafIndex: opt.leafIndex,
            cosign: CashuNip07.cosign(window.nostr!),
          });
        }
      }
      if (plans.length) {
        config.scriptPath = plans;
      }
      const unlockedProofs = await wallet.receive(
        $token.val() as string,
        config,
      );
      const unlockedToken = getEncodedToken({
        mint: mintUrl,
        proofs: unlockedProofs,
        unit: unit,
      });
      storeWitnessHistory(unlockedToken, tokenAmount, "Unlocked");
      $witnessedToken.val(unlockedToken);
      $witnessedHeading.text("Your Unlocked Token");
      showSuccess();
      toastr.success(
        `Successfully unlocked token! You can receive it using any Cashu wallet`,
      );
    } catch (e) {
      console.error("Error unlocking token:", e);
      const message = getErrorMessage(e, "Failed to unlock token");
      toastr.error(message);
    }
  }

  interface WitnessHistoryItem {
    token: string;
    amount: number | string; // Amount.toJSON() returns number | string
    date: string; // ISO string from Date.toISOString()
    status: string;
  }

  // Store witness history
  function storeWitnessHistory(
    token: string,
    amount: Amount,
    status: string,
  ): void {
    const history = getWitnessHistory();
    history.push({
      token,
      amount: amount.toJSON(),
      date: new Date().toISOString(),
      status,
    });
    localStorage.setItem("cashu-witness-history", JSON.stringify(history));
  }

  // Get witness history
  function getWitnessHistory(): WitnessHistoryItem[] {
    const history = localStorage.getItem("cashu-witness-history");
    return history ? JSON.parse(history) : [];
  }

  // Clear witness history
  function clearWitnessHistory(): void {
    localStorage.removeItem("cashu-witness-history");
  }

  // Load witness history (descending order)
  function loadWitnessHistory() {
    const history: WitnessHistoryItem[] = getWitnessHistory();
    $historyDiv.empty();
    if (history.length === 0) {
      $historyDiv.html("<p>No witnessed tokens found.</p>");
      return;
    }
    const $list = $("<ul></ul>");
    history
      .sort((a: { date: any }, b: { date: string }) =>
        b.date.localeCompare(a.date),
      ) // Descending order
      .forEach((entry) => {
        const date = new Date(entry.date).toLocaleString();
        const amount = formatAmount(entry.amount);
        const status = entry.status || "unknown";
        const $item = $(`
          <li class="history-item">
            <span class="copytkn">Copy Token</span> <span class="copyemj">Copy 🥜</span> ${date} - ${amount} - ${status}
          </li>
        `);
        $item.children(".copytkn").on("click", () => {
          copyTextToClipboard(entry.token);
        });
        $item.children(".copyemj").on("click", () => {
          copyTextToClipboard(emojiEncode("\uD83E\uDD5C", entry.token));
        });
        $list.append($item);
      });
    $historyDiv.append($list);
  }

  // Initialize
  loadWitnessHistory();
  showForm();
});

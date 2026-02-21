// Imports
import {
  getDecodedToken,
  getEncodedTokenV4,
  getP2PKLockState,
  getP2PKExpectedWitnessPubkeys,
  getP2PKNSigs,
  getP2PKNSigsRefund,
  getP2PKSigFlag,
  getP2PKWitnessSignatures,
  getP2PKLocktime,
  getP2PKWitnessPubkeys,
  getP2PKWitnessRefundkeys,
  signP2PKProofs,
  hasP2PKSignedProof,
  verifyP2PKSpendingConditions,
  Proof,
  Wallet,
  Token,
  ConsoleLogger,
} from "@cashu/cashu-ts";
import { decode as emojiDecode, encode as emojiEncode } from "./emoji-encoder";
import {
  isPrivkeyValid,
  maybeConvertNsecToP2PK,
  signNip60Proofs,
  signWithNip07,
} from "./nostr";
import {
  copyTextToClipboard,
  debounce,
  doConfettiBomb,
  formatAmount,
  getErrorMessage,
  getTokenAmount,
  getWalletWithUnit,
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
  let tokenAmount: number;
  let privkey: string;
  let p2pkParams: { pubkeys: string[]; n_sigs: number } = {
    pubkeys: [],
    n_sigs: 0,
  };
  let spendAuthorised = false;
  let signedPubkeys: string[] = [];
  const hasNip07 = typeof window?.nostr?.getPublicKey !== "undefined";
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
    tokenAmount = 0;
    privkey = "";
    p2pkParams = { pubkeys: [], n_sigs: 0 };
    spendAuthorised = false;
    signedPubkeys = [];
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
        signAndWitnessToken(false);
        $privkey.val("");
      } else {
        $privkey.attr("data-valid", "no");
        toastr.error("Invalid private key");
      }
    }, 100); // Delay to ensure paste value is available
  });
  $useNip07.on("click", () => signAndWitnessToken(true));
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
      const token: Token = getDecodedToken(tokenEncoded);
      if (!token.proofs.length || !token.mint.length) {
        throw new Error("Invalid token format");
      }
      mintUrl = token.mint;
      unit = token.unit || "sat";
      proofs = token.proofs.filter((p) => p.secret.includes("P2PK"));
      if (!proofs.length) {
        toastr.error("This is not a P2PK locked token. Go spend it anywhere!");
        return;
      }
      proofs.forEach((proof) => {
        if ("SIG_ALL" == getP2PKSigFlag(proof.secret)) {
          throw new Error("Sorry, SIG_ALL tokens are not supported yet");
        }
      });
      tokenAmount = getTokenAmount(proofs);
      p2pkParams.pubkeys = getP2PKExpectedWitnessPubkeys(proofs[0].secret);
      p2pkParams.n_sigs = getP2PKNSigs(proofs[0].secret);
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
    displayWitnessInfo();
    checkNip07ButtonState();
  }

  // Display witness requirements
  function displayWitnessInfo() {
    if (!proofs[0]?.secret) {
      return;
    }
    const proof = proofs[0];
    const locktime = getP2PKLocktime(proof.secret);
    const lockState = getP2PKLockState(proof.secret);
    const mainPubkeys = getP2PKWitnessPubkeys(proof.secret);
    const refundPubkeys = getP2PKWitnessRefundkeys(proof.secret);
    const mainRequiredSigners = getP2PKNSigs(proof.secret);
    const refundRequiredSigners = getP2PKNSigsRefund(proof.secret);
    const verification = verifyP2PKSpendingConditions(proof, logger);
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
    signedPubkeys = [
      ...new Set([...mainSignedPubkeys, ...refundSignedPubkeys]),
    ];
    spendAuthorised = verification.success;

    let html = `<div><strong>Token Value:</strong><ul><li>${formatAmount(tokenAmount, unit)} from ${mintUrl}</li></ul></div>`;
    html += "<strong>Witness Requirements:</strong><ul>";
    if (lockState === "PERMANENT") {
      html += `<li>Main locktime: permanently locked (no expiry)</li>`;
    } else if (lockState === "ACTIVE") {
      html += `<li>Main locktime: active until ${new Date(locktime * 1000).toLocaleString().slice(0, -3)}</li>`;
    } else {
      html += `<li>Main locktime: expired</li>`;
    }

    const mainRemaining = Math.max(
      mainRequiredSigners - mainSignedPubkeys.length,
      0,
    );
    const mainSpendable = mainRequiredSigners === 0 || mainRemaining === 0;
    html += `<li>Main pathway: ${mainSignedPubkeys.length}/${mainRequiredSigners} signatures (${mainPubkeys.length} eligible)${mainSpendable ? " - spendable" : ""}</li>`;

    const refundPathActive =
      lockState === "EXPIRED" && refundPubkeys.length > 0;
    if (
      !refundPubkeys.length &&
      lockState === "EXPIRED" &&
      mainRequiredSigners === 0
    ) {
      html += `<li>Unlocked: locktime expired and no refund keys (anyone can spend)</li>`;
    }

    if (mainPubkeys.length) {
      html += `<li>Main pubkeys:</li><ul>`;
    }

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
        html += `<li>Refund pathway: active (${refundSignedPubkeys.length}/${refundRequiredSigners} signatures, ${refundPubkeys.length} eligible)${refundSpendable ? " - spendable" : ""}</li>`;
      } else {
        html += `<li>Refund pathway: configured, becomes active after locktime expiry</li>`;
      }
      html += `<li>Refund pubkeys:</li><ul>`;
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
        html += `<p class="summary">Spendable now. Main pathway is valid, and refund pathway is also available.</p>`;
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
    const isLocked = p2pkParams.pubkeys.length > 0;
    if (isLocked && tokenAmount > 0 && proofs.length) {
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
      const witnessedToken = getEncodedTokenV4({
        mint: mintUrl,
        proofs: signedProofs,
        unit: unit,
      });
      $witnessedToken.val(witnessedToken);
      const verification = verifyP2PKSpendingConditions(
        signedProofs[0],
        logger,
      );
      let status = verification.success
        ? `Spendable (${verification.path})`
        : `Partially signed: ${verification.receivedSigners.length}/${verification.requiredSigners}`;
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
      const unlockedProofs = await wallet.receive($token.val() as string);
      const unlockedToken = getEncodedTokenV4({
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
    amount: number;
    date: string; // ISO string from Date.toISOString()
    status: string;
  }

  // Store witness history
  function storeWitnessHistory(
    token: string,
    amount: number,
    status: string,
  ): void {
    const history = getWitnessHistory();
    history.push({
      token,
      amount,
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

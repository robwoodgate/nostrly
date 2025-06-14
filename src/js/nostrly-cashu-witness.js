// Imports
import { getDecodedToken, getEncodedTokenV4 } from "@cashu/cashu-ts";
import {
  getP2PKExpectedKWitnessPubkeys,
  getP2PKNSigs,
  getP2PKSigFlag,
  getP2PKWitnessSignatures,
  getP2PKLocktime,
  signP2PKProofs,
  hasP2PKSignedProof,
} from "@cashu/cashu-ts/crypto/client/NUT11";
import { nip19 } from "nostr-tools";
import {
  decode as emojiDecode,
  encode as emojiEncode,
} from "./emoji-encoder.ts";
import { isPrivkeyValid, maybeConvertNsecToP2PK } from "./nostr.ts";
import { sha256Hex } from "./nut11.ts";
import {
  copyTextToClipboard,
  debounce,
  doConfettiBomb,
  formatAmount,
  getTokenAmount,
  getWalletWithUnit,
} from "./utils.ts";
import {
  getContactDetails,
  convertP2PKToNpub,
  getNip60Wallet,
} from "./nostr.ts";
import toastr from "toastr";
import { handleCashuDonation } from "./cashu-donate.js";

// DOM ready
jQuery(function ($) {
  // Init vars
  let wallet;
  let mintUrl = "";
  let unit = "sat";
  let proofs = [];
  let tokenAmount = 0;
  let nip07Pubkey = "";
  let privkey = "";
  let p2pkParams = { pubkeys: [], n_sigs: 0 };
  let signedPubkeys = [];

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
      handleCashuDonation($donateCashu.val(), "Cashu Redeem Donation");
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
    nip07Pubkey = "";
    privkey = "";
    p2pkParams = { pubkeys: [], n_sigs: 0 };
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
  $privkey.on("paste", (e) => {
    setTimeout(() => {
      privkey = $privkey.val();
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
  $copyToken.on("click", () => copyTextToClipboard($witnessedToken.val()));
  $copyEmoji.on("click", () =>
    copyTextToClipboard(emojiEncode("\uD83E\uDD5C", $witnessedToken.val())),
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
      let tokenEncoded = $token.val();
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
      const token = getDecodedToken(tokenEncoded);
      if (!token.proofs.length || !token.mint.length) {
        throw new Error("Invalid token format");
      }
      mintUrl = token.mint;
      unit = token.unit;
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
      p2pkParams.pubkeys = getP2PKExpectedKWitnessPubkeys(proofs[0].secret);
      p2pkParams.n_sigs = getP2PKNSigs(proofs[0].secret);
      console.log("token:>>", token);
      console.log("proofs:>>", proofs);
      toastr.success(
        `Valid token: ${formatAmount(tokenAmount, unit)} from ${mintUrl}`,
      );
      $token.attr("data-valid", "");
    } catch (e) {
      toastr.error(e.message || "Invalid token");
      console.error("processToken error:", e);
      resetVars();
    }
    checkNip07ButtonState();
    displayWitnessInfo();
  }

  // Display witness requirements
  function displayWitnessInfo() {
    if (!proofs[0]?.secret) {
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const locktime = getP2PKLocktime(proofs[0].secret);
    if (!p2pkParams.pubkeys.length) {
      let html = `<div><strong>Token Value:</strong><ul><li>${formatAmount(tokenAmount, unit)} from ${mintUrl}</li></ul></div>`;
      html += "<strong>Witness Requirements:</strong><ul>";
      if (!locktime || locktime <= now) {
        html += `<li>Token is unlocked (no signatures required).</li>`;
      } else {
        html += `<li>No valid pubkeys found.</li>`;
      }
      html += `</ul>`;
      $witnessInfo.show().html(html);
      return;
    }
    const { pubkeys, n_sigs } = p2pkParams;
    pubkeys.forEach((pub) => {
      try {
        if (hasP2PKSignedProof(pub, proofs[0])) {
          signedPubkeys.push(pub);
        }
      } catch (e) {
        console.error("Verification error:", e);
      }
    });
    signedPubkeys = [...new Set(signedPubkeys)];
    console.log("signedPubkeys:>>", signedPubkeys);
    let html = `<div><strong>Token Value:</strong><ul><li>${formatAmount(tokenAmount, unit)} from ${mintUrl}</li></ul></div>`;
    html += "<strong>Witness Requirements:</strong><ul>";
    if (locktime == Infinity) {
      html += `<li>Permanently Locked</li>`;
    } else if (locktime > now) {
      html += `<li>Locked until ${new Date(locktime * 1000).toLocaleString().slice(0, -3)}</li>`;
    }
    if (n_sigs > 1) {
      html += `<li>Multisig: ${n_sigs} of ${pubkeys.length} signatures required</li>`;
    } else {
      html += `<li>Single signature required</li>`;
    }
    html += `<li>Expected Public Keys:</li><ul>`;
    // Define a function to handle the async update
    const updateContactName = (npub, p2pkey, relays) => {
      getContactDetails(npub, relays).then(({ name, hexpub }) => {
        if (name) {
          const nip61 = hexpub != p2pkey.slice(2) ? "(NIP-61)" : "(NPUB)";
          $(`#${npub}`).replaceWith(
            `<a href="https://njump.me/${npub}" target="_blank">${name}</a> ${nip61}`,
          );
        }
      });
    };
    for (const pub of pubkeys) {
      const npub = convertP2PKToNpub(pub);
      const isSigned = signedPubkeys.includes(pub);
      const keyholder = `<span id="${npub}">${pub.slice(0, 12)}...${pub.slice(-12)}</span>`;
      html += `<li class="${isSigned ? "signed" : "pending"}"><span class="status-icon"></span>${keyholder}: ${
        isSigned ? "Signed" : "Pending"
      }</li>`;
      updateContactName(npub, pub, nostrly_ajax.relays);
    }
    html += `</ul>`;
    const remainingSigs = n_sigs - signedPubkeys.length;
    if (remainingSigs > 0) {
      html += `<p class="summary">Need ${remainingSigs} more signature${
        remainingSigs > 1 ? "s" : ""
      }.</p>`;
    } else {
      html += `<p class="summary">All required signatures (${n_sigs}) collected!</p>`;
      $signersDiv.hide();
      console.log("All signed!");
      $unlockDiv.show();
    }
    html += `</ul>`;
    $witnessInfo.show().html(html);
  }

  // Check NIP-07 button state and handle unlocked tokens
  function checkNip07ButtonState() {
    const hasNip07 = typeof window?.nostr?.getPublicKey !== "undefined";
    console.log("hasNip07", hasNip07);
    console.log("tokenAmount", tokenAmount);
    console.log("proofs length", proofs.length);
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
      const hasNip44 = typeof window?.nostr?.nip44?.decrypt !== "undefined";
      const hasSignString =
        typeof window?.nostr?.signSchnorr !== "undefined" ||
        typeof window?.nostr?.signString !== "undefined" ||
        typeof window?.nostr?.nip60?.signSecret !== "undefined";

      toastr.info("Signing each of the proofs in this token...");
      let originalProofs = [...proofs]; // Store original state
      let signedProofs = [...proofs];
      console.log("signedProofs before:>>", signedProofs);

      // Handle NIP-60 wallet
      if (hasNip44) {
        nip07Pubkey = await window.nostr.getPublicKey();
        console.log("nip07Pubkey:>>", nip07Pubkey);
        const { privkeys } = await getNip60Wallet(nip07Pubkey);
        if (privkeys.length > 0) {
          console.log("signing using nip60...");
          privkeys.forEach((privkey) => {
            signedProofs = signP2PKProofs(signedProofs, privkey);
          });
        }
      }
      console.log("signedProofs after NIP-60:>>", signedProofs);

      if (useNip07) {
        signedProofs = await signWithNip07(signedProofs);
        console.log("signedProofs after NIP-07:>>", signedProofs);
      } else {
        if (!privkey || !isPrivkeyValid(privkey)) {
          throw new Error("No valid private key provided");
        }
        signedProofs = signP2PKProofs(
          signedProofs,
          maybeConvertNsecToP2PK(privkey),
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
      const totalSigs = signedPubkeys.length + 1; // To account for this signing
      const remainingSigs = p2pkParams.n_sigs - totalSigs;
      let status =
        remainingSigs > 0
          ? `Partially signed: ${totalSigs}/${p2pkParams.n_sigs}`
          : `Fully Signed`;
      storeWitnessHistory(witnessedToken, tokenAmount, status);
      showSuccess();
      toastr.success(
        `Added signatures to ${signedCount} proof${signedCount > 1 ? "s" : ""}!`,
      );
    } catch (e) {
      console.error("Error in signAndWitnessToken:", e);
      toastr.info(e.message || "Failed to sign token");
    }
  }

  // Sign proofs with NIP-07 (aligned with reference functions)
  async function signWithNip07(proofs) {
    const signedProofs = proofs.map((proof) => ({ ...proof }));
    for (const [index, proof] of signedProofs.entries()) {
      if (!proof.secret.includes("P2PK")) continue;
      const pubkeys = getP2PKExpectedKWitnessPubkeys(proof.secret);
      const n_sigs = getP2PKNSigs(proof.secret);
      console.log("getP2PKExpectedKWitnessPubkeys:>>", pubkeys);
      if (!pubkeys.length) continue;
      let signatures = getP2PKWitnessSignatures(proof.witness);

      const hash = sha256Hex(proof.secret);
      let pubkey = "";
      let sig = "";
      let signedSig = "";
      let signedHash = "";
      try {
        if (typeof window?.nostr?.nip60?.signSecret !== "undefined") {
          ({
            hash: signedHash,
            sig: signedSig,
            pubkey,
          } = await window.nostr.nip60.signSecret(proof.secret));
          console.log("signSecret result:", {
            hash: signedHash,
            sig: signedSig,
            pubkey,
          });
        } else if (typeof window?.nostr?.signString !== "undefined") {
          ({
            hash: signedHash,
            sig: signedSig,
            pubkey,
          } = await window.nostr.signString(proof.secret));
          console.log("signString result:", {
            hash: signedHash,
            sig: signedSig,
            pubkey,
          });
        } else if (typeof window?.nostr?.signSchnorr !== "undefined") {
          pubkey = await window.nostr.getPublicKey();
          signedSig = await window.nostr.signSchnorr(hash);
          signedHash = hash;
          console.log("signSchnorr pubkey:", pubkey);
          console.log("signSchnorr sig:", signedSig);
        }
        const normalizedPubkey = "02" + pubkey;
        console.log("normalizedPubkey:", normalizedPubkey);
        console.log("signedHash:", signedHash);
        console.log("hash:", hash);
        if (signedHash === hash && pubkeys.includes(normalizedPubkey)) {
          sig = signedSig;
          console.log("adding sig:", sig);
        }
      } catch (e) {
        toastr.warning(`Skipped signing proof ${index + 1}: ${e.message}`);
        console.error("NIP-07 signing error:", e);
        continue;
      }
      if (sig && !hasP2PKSignedProof(pubkey, proof)) {
        signedProofs[index].witness = {
          signatures: [...signatures, sig],
        };
        console.log("added sig!", sig);
      }
    }
    return signedProofs;
  }

  // Receives the token for an unlocked one
  async function unlockToken() {
    try {
      console.log("unit:>>", unit);
      wallet = await getWalletWithUnit(mintUrl, unit); // Load wallet
      const unlockedProofs = await wallet.receive($token.val());
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
      toastr.error(e.message || "Failed to unlock token");
    }
  }

  // Store witness history
  function storeWitnessHistory(token, amount, status) {
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
  function getWitnessHistory() {
    const history = localStorage.getItem("cashu-witness-history");
    return history ? JSON.parse(history) : [];
  }

  // Clear witness history
  function clearWitnessHistory() {
    localStorage.removeItem("cashu-witness-history");
  }

  // Load witness history (descending order)
  function loadWitnessHistory() {
    const history = getWitnessHistory();
    $historyDiv.empty();
    if (history.length === 0) {
      $historyDiv.html("<p>No witnessed tokens found.</p>");
      return;
    }
    const $list = $("<ul></ul>");
    history
      .sort((a, b) => new Date(b.date) - new Date(a.date)) // Descending order
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

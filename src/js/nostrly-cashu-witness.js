// Imports
import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  getEncodedTokenV4,
} from "@cashu/cashu-ts";
import { nip19 } from "nostr-tools";
import {
  decode as emojiDecode,
  encode as emojiEncode,
} from "./emoji-encoder.ts";
import {
  copyTextToClipboard,
  debounce,
  formatAmount,
  getTokenAmount,
} from "./utils.ts";
import { bytesToHex, hexToBytes } from "@noble/curves/abstract/utils";
import { sha256 } from "@noble/hashes/sha256";
import { schnorr } from "@noble/curves/secp256k1";
import toastr from "toastr";

// Cashu-crypto-ts functions
const parseSecret = (secret) => {
  try {
    return JSON.parse(secret); // proof.secret is a string
  } catch {
    throw new Error("Invalid secret format");
  }
};

const signP2PKsecret = (secret, privateKey) => {
  const msghash = sha256(secret); // secret is a string
  const sig = schnorr.sign(msghash, privateKey);
  return sig;
};

const getP2PExpectedKWitnessPubkeys = (secret) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const { data, tags } = secret[1];
    const locktimeTag = tags && tags.find((tag) => tag[0] === "locktime");
    const locktime = locktimeTag ? parseInt(locktimeTag[1], 10) : Infinity;
    const refundTag = tags && tags.find((tag) => tag[0] === "refund");
    const refundKeys =
      refundTag && refundTag.length > 1 ? refundTag.slice(1) : [];
    const pubkeysTag = tags && tags.find((tag) => tag[0] === "pubkeys");
    const pubkeys =
      pubkeysTag && pubkeysTag.length > 1 ? pubkeysTag.slice(1) : [];
    const n_sigsTag = tags && tags.find((tag) => tag[0] === "n_sigs");
    const n_sigs = n_sigsTag ? parseInt(n_sigsTag[1], 10) : 1;
    if (locktime > now) {
      if (n_sigs && n_sigs >= 1) {
        return { pubkeys: [data, ...pubkeys], n_sigs };
      }
      return { pubkeys: [data], n_sigs: 1 };
    }
    if (refundKeys.length) {
      return { pubkeys: refundKeys, n_sigs: 1 };
    }
  } catch {}
  return { pubkeys: [], n_sigs: 0 }; // Unlocked or expired with no refund keys
};

const getSignedProof = (proof, privateKey) => {
  const signature = bytesToHex(signP2PKsecret(proof.secret, privateKey));
  console.log("getSignedProof proof.witness:>>", proof.witness);
  let signatures = proof.witness
    ? typeof proof.witness === "string"
      ? JSON.parse(proof.witness).signatures || []
      : proof.witness.signatures || []
    : [];
  if (!signatures.includes(signature)) {
    signatures.push(signature);
  }
  return { ...proof, witness: { signatures } };
};

const getSignedProofs = (proofs, privateKey) => {
  // Add '02' prefix to match SEC1 format in pubkeys
  const pubkey = "02" + bytesToHex(schnorr.getPublicKey(privateKey));
  console.log("getSignedProofs pubkey:>", pubkey);
  return proofs.map((proof) => {
    try {
      const parsed = parseSecret(proof.secret);
      if (parsed[0] !== "P2PK") return proof;
      const { pubkeys, n_sigs } = getP2PExpectedKWitnessPubkeys(parsed);
      console.log("pubkeys:>", pubkeys);
      console.log("n_sigs:>", n_sigs);
      if (!pubkeys.length || !pubkeys.includes(pubkey)) return proof;
      console.log("sig not witnessed yet:>", n_sigs);
      return getSignedProof(proof, privateKey);
    } catch (e) {
      console.error(e);
      return proof;
    }
  });
};

// DOM ready
jQuery(function ($) {
  // Init vars
  let wallet;
  let mintUrl = "";
  let proofs = [];
  let tokenAmount = 0;
  let privkey = "";
  let p2pkParams = { pubkeys: [], n_sigs: 0 };

  // DOM elements
  const $divForm = $("#cashu-witness-form");
  const $divSuccess = $("#cashu-witness-success");
  const $token = $("#token");
  const $privkey = $("#privkey");
  const $privkeyDiv = $privkey.parent();
  const $useNip07 = $("#use-nip07");
  const $witnessInfo = $("#witness-info");
  const $witnessedToken = $("#witnessed-token");
  const $copyToken = $("#witnessed-token-copy");
  const $copyEmoji = $("#witnessed-emoji-copy");
  const $historyDiv = $("#witness-history");
  const $clearHistory = $("#clear-history");

  // Initialize NIP-07 button visibility
  if (
    typeof window?.nostr?.signSchnorr !== "undefined" ||
    typeof window?.nostr?.signString !== "undefined"
  ) {
    $useNip07.removeClass("hidden");
  }

  // Page handlers
  function showForm() {
    $divForm.show();
    $divSuccess.hide();
  }
  function showSuccess() {
    $divForm.hide();
    $divSuccess.show();
  }

  // Input handlers
  $token.on("input", debounce(processToken, 200));
  $privkey.on("paste", (e) => {
    setTimeout(() => {
      privkey = $privkey.val();
      if (isPrivkeyValid(privkey)) {
        $privkey.attr("data-valid", "");
        signAndWitnessToken(false);
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

  // Process the input token
  async function processToken() {
    try {
      let tokenEncoded = $token.val();
      if (!tokenEncoded) {
        $token.attr("data-valid", "");
        proofs = [];
        tokenAmount = 0;
        mintUrl = "";
        p2pkParams = { pubkeys: [], n_sigs: 0 };
        $witnessInfo.addClass("hidden").empty();
        checkNip07ButtonState();
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
        throw "Invalid token format";
      }
      mintUrl = token.mint;
      const mint = new CashuMint(mintUrl);
      wallet = new CashuWallet(mint);
      await wallet.loadMint();
      proofs = token.proofs.filter((p) => p.secret.includes("P2PK"));
      if (!proofs.length) {
        throw "No P2PK proofs found in token";
      }
      tokenAmount = getTokenAmount(proofs);
      p2pkParams = getP2PExpectedKWitnessPubkeys(parseSecret(proofs[0].secret));
      displayWitnessInfo();
      console.log("token:>>", token);
      console.log("proofs:>>", proofs);
      toastr.success(
        `Valid token: ${formatAmount(tokenAmount)} from ${mintUrl}`,
      );
      $token.attr("data-valid", "");
    } catch (err) {
      toastr.error(err.message || "Invalid token");
      $token.attr("data-valid", "no");
      proofs = [];
      tokenAmount = 0;
      mintUrl = "";
      p2pkParams = { pubkeys: [], n_sigs: 0 };
      $witnessInfo.addClass("hidden").empty();
    }
    checkNip07ButtonState();
  }

  // Display witness requirements
  function displayWitnessInfo() {
    if (!p2pkParams.pubkeys.length) {
      const now = Math.floor(Date.now() / 1000);
      const parsed = parseSecret(proofs[0].secret);
      const { tags } = parsed[1];
      const locktimeTag = tags && tags.find((tag) => tag[0] === "locktime");
      const locktime = locktimeTag ? parseInt(locktimeTag[1], 10) : null;
      let html = "<strong>Witness Requirements:</strong><ul>";
      if (!locktime || locktime <= now) {
        html += `<li>Token is unlocked (no signatures required).</li>`;
      } else {
        html += `<li>No valid pubkeys found.</li>`;
      }
      html += `</ul>`;
      $witnessInfo.removeClass("hidden").html(html);
      return;
    }
    const { pubkeys, n_sigs } = p2pkParams;
    let signatures = proofs[0].witness;
    if (typeof signatures === "string") {
      try {
        signatures = JSON.parse(signatures).signatures || [];
      } catch (e) {
        console.error("Failed to parse witness string:", e);
        signatures = [];
      }
    } else {
      signatures = signatures?.signatures || [];
    }
    let signedPubkeys = [];
    signatures.forEach((sig) => {
      pubkeys.forEach((pub) => {
        try {
          const msghash = bytesToHex(sha256(proofs[0].secret));
          const pubkeyX = pub.slice(2);
          if (schnorr.verify(sig, msghash, hexToBytes(pubkeyX))) {
            signedPubkeys.push(pub);
          }
        } catch (e) {
          console.error("Verification error:", e);
        }
      });
    });
    signedPubkeys = [...new Set(signedPubkeys)];
    let html = "<strong>Witness Requirements:</strong><ul>";
    if (n_sigs > 1) {
      html += `<li>Multisig: ${n_sigs} of ${pubkeys.length} signatures required</li>`;
    } else {
      html += `<li>Single signature required</li>`;
    }
    html += `<li>Expected Public Keys:</li><ul>`;
    pubkeys.forEach((pub) => {
      const npub = convertHexkeyToNpub(pub);
      const shortNpub = `${npub.slice(0, 12)}...${npub.slice(-12)}`;
      const isSigned = signedPubkeys.includes(pub);
      html += `<li class="${isSigned ? "signed" : "pending"}"><span class="status-icon"></span>${shortNpub}: ${
        isSigned ? "Signed" : "Pending"
      }</li>`;
    });
    html += `</ul>`;
    const remainingSigs = n_sigs - signedPubkeys.length;
    if (remainingSigs > 0) {
      html += `<p class="summary">Need ${remainingSigs} more signature${
        remainingSigs > 1 ? "s" : ""
      }.</p>`;
    } else {
      html += `<p class="summary">All required signatures (${n_sigs}) collected!</p>`;
    }
    html += `</ul>`;
    $witnessInfo.removeClass("hidden").html(html);
  }

  // Validate private key
  function isPrivkeyValid(key) {
    if (!key) return false;
    if (key.startsWith("nsec1")) {
      try {
        const { type, data } = nip19.decode(key);
        return type === "nsec" && data.length === 32;
      } catch {
        return false;
      }
    }
    return /^[0-9a-fA-F]{64}$/.test(key);
  }

  // Convert private key to hex
  function convertToHexPrivkey(key) {
    if (key.startsWith("nsec1")) {
      let sk = nip19.decode(key).data; // `sk` is a Uint8Array
      return bytesToHex(sk);
    }
    return key;
  }

  // Convert hex pubkey to npub
  function convertHexkeyToNpub(key) {
    return nip19.npubEncode(key.slice(2));
  }

  // Check NIP-07 button state and handle unlocked tokens
  function checkNip07ButtonState() {
    const hasNip07 =
      typeof window?.nostr?.signSchnorr !== "undefined" ||
      typeof window?.nostr?.signString !== "undefined";
    console.log("hasNip07", hasNip07);
    console.log("tokenAmount", tokenAmount);
    console.log("proofs length", proofs.length);
    const isLocked = p2pkParams.pubkeys.length > 0;
    if (isLocked && tokenAmount > 0 && proofs.length) {
      $privkeyDiv.show();
      $privkey.prop("disabled", false);
      if (hasNip07) {
        $useNip07.prop("disabled", false);
      } else {
        $useNip07.prop("disabled", true);
      }
    } else {
      $privkeyDiv.hide();
      $useNip07.prop("disabled", true);
    }
  }

  // Sign and witness the token
  async function signAndWitnessToken(useNip07 = false) {
    try {
      toastr.info("Signing token...");
      let originalProofs = [...proofs]; // Store original state
      let signedProofs = [...proofs];
      console.log("signedProofs before:>>", signedProofs);

      if (useNip07) {
        signedProofs = await signWithNip07(signedProofs);
      } else {
        if (!privkey || !isPrivkeyValid(privkey)) {
          throw new Error("No valid private key provided");
        }
        signedProofs = getSignedProofs(
          signedProofs,
          convertToHexPrivkey(privkey),
        );
        console.log(
          "signedProofs after:>>",
          signedProofs.map((p) => p.witness),
        );
      }

      // Count proofs that had signatures added in this operation
      let signedCount = 0;
      for (let i = 0; i < originalProofs.length; i++) {
        const originalSigs = originalProofs[i].witness
          ? typeof originalProofs[i].witness === "string"
            ? JSON.parse(originalProofs[i].witness).signatures || []
            : originalProofs[i].witness.signatures || []
          : [];
        const newSigs = signedProofs[i].witness?.signatures || [];
        console.log("newSigs:>>", newSigs);
        console.log("originalSigs:>>", originalSigs);
        if (newSigs.length > originalSigs.length) {
          signedCount++;
        }
      }
      console.log("p2pkParams:>>", p2pkParams);
      console.log("signedCount:>>", signedCount);
      if (signedCount === 0) {
        throw new Error("No new signatures were added");
      }

      console.log("signedProofs after:>>", signedProofs);
      console.log("Encoding token...");
      const witnessedToken = getEncodedTokenV4({
        mint: mintUrl,
        proofs: signedProofs,
      });
      console.log("Token encoded:", witnessedToken);
      $witnessedToken.val(witnessedToken);
      console.log("Setting witnessed token...");
      storeWitnessHistory(witnessedToken, tokenAmount);
      console.log("Stored history...");
      showSuccess();
      console.log("Showing success...");
      toastr.success(
        `Added signatures to ${signedCount} proof${signedCount > 1 ? "s" : ""}!`,
      );
    } catch (e) {
      console.error("Error in signAndWitnessToken:", e);
      toastr.error(e.message || "Failed to sign token");
    }
  }

  // Sign proofs with NIP-07 (aligned with reference functions)
  async function signWithNip07(proofs) {
    const signedProofs = proofs.map((proof) => ({ ...proof }));
    for (const [index, proof] of signedProofs.entries()) {
      if (!proof.secret.includes("P2PK")) continue;
      const parsed = parseSecret(proof.secret);
      const { pubkeys, n_sigs } = getP2PExpectedKWitnessPubkeys(parsed);
      console.log("getP2PExpectedKWitnessPubkeys:>>", pubkeys);
      if (!pubkeys.length) continue;
      let signatures = proof.witness?.signatures || [];
      if (signatures.length >= n_sigs) continue;
      const hash = bytesToHex(sha256(proof.secret));
      let pubkey = "";
      let sig = "";
      let signedSig = "";
      let signedHash = "";
      try {
        if (typeof window?.nostr?.signSchnorr !== "undefined") {
          pubkey = await window.nostr.getPublicKey();
          signedSig = await window.nostr.signSchnorr(hash);
          signedHash = hash;
          console.log("signSchnorr pubkey:", pubkey);
          console.log("signSchnorr sig:", signedSig);
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
      if (sig && !signatures.includes(sig)) {
        signedProofs[index].witness = {
          signatures: [...signatures, sig],
        };
        console.log("added sig!", sig);
      }
    }
    return signedProofs;
  }

  // Store witness history
  function storeWitnessHistory(token, amount) {
    const history = getWitnessHistory();
    history.push({
      token,
      amount,
      date: new Date().toISOString(),
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
        const token =
          entry.token.length > 20
            ? entry.token.slice(0, 20) + "..."
            : entry.token;
        const $item = $(`
          <li class="history-item">
            <span class="copytkn">Copy Token</span> <span class="copyemj">Copy 🥜</span> ${date} - ${amount}
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

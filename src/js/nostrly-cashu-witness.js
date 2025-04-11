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
      if (n_sigs && n_sigs > 1) {
        return { pubkeys: [data, ...pubkeys], n_sigs };
      }
      return { pubkeys: [data], n_sigs: 1 };
    }
    if (refundKeys.length) {
      return { pubkeys: refundKeys, n_sigs: 1 };
    }
  } catch {}
  return { pubkeys: [], n_sigs: 0 };
};

const getSignedProof = (proof, privateKey) => {
  const signature = bytesToHex(signP2PKsecret(proof.secret, privateKey));
  if (!proof.witness) {
    proof.witness = { signatures: [signature] };
  } else if (!proof.witness.signatures.includes(signature)) {
    proof.witness.signatures = [...(proof.witness.signatures || []), signature];
  }
  return proof;
};

const getSignedProofs = (proofs, privateKey) => {
  const pubkey = bytesToHex(schnorr.getPublicKey(privateKey));
  return proofs.map((proof) => {
    try {
      const parsed = parseSecret(proof.secret);
      if (parsed[0] !== "P2PK") return proof;
      const { pubkeys, n_sigs } = getP2PExpectedKWitnessPubkeys(parsed);
      if (!pubkeys.length || !pubkeys.includes(pubkey)) return proof;
      let signedProof = { ...proof };
      let signatures = signedProof.witness?.signatures || [];
      if (signatures.length >= n_sigs) return signedProof;
      return getSignedProof(signedProof, privateKey);
    } catch {
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
  $privkey.on(
    "input",
    debounce(() => {
      privkey = $privkey.val();
      if (privkey && !isPrivkeyValid(privkey)) {
        $privkey.attr("data-valid", "no");
      } else {
        $privkey.attr("data-valid", "");
      }
      updateWitnessStatus();
      checkNip07ButtonState();
    }, 200),
  );
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
      updateWitnessStatus();
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
      $witnessInfo.addClass("hidden").empty();
      return;
    }
    const { pubkeys, n_sigs } = p2pkParams;
    const parsed = parseSecret(proofs[0].secret);
    const { tags } = parsed[1];
    const locktimeTag = tags && tags.find((tag) => tag[0] === "locktime");
    const locktime = locktimeTag ? parseInt(locktimeTag[1], 10) : null;
    const refundTag = tags && tags.find((tag) => tag[0] === "refund");
    const refundKeys =
      refundTag && refundTag.length > 1 ? refundTag.slice(1) : [];
    let html = "<strong>Witness Requirements:</strong><ul>";
    if (n_sigs > 1) {
      html += `<li>Multisig: ${n_sigs} of ${pubkeys.length} signatures required</li>`;
    } else {
      html += `<li>Single signature required</li>`;
    }
    html += `<li>Expected Public Keys:</li><ul>`;
    pubkeys.forEach((pub) => {
      const npub = nip19.npubEncode(pub.slice(2));
      html += `<li>${npub.slice(0, 12)}...${npub.slice(-12)}</li>`;
    });
    html += `</ul>`;
    if (locktime) {
      const now = Math.floor(Date.now() / 1000);
      if (locktime > now) {
        html += `<li>Locked until: ${new Date(locktime * 1000).toLocaleString()}</li>`;
      } else if (refundKeys.length) {
        html += `<li>Refund keys active:</li><ul>`;
        refundKeys.forEach((pub) => {
          const npub = nip19.npubEncode(pub.slice(2));
          html += `<li>${npub.slice(0, 12)}...${npub.slice(-12)}</li>`;
        });
        html += `</ul>`;
      }
    }
    html += `</ul>`;
    $witnessInfo.removeClass("hidden").html(html);
  }

  // Update witness signature status
  function updateWitnessStatus() {
    if (!p2pkParams.pubkeys.length) {
      $witnessInfo.find("#witness-status").remove();
      return;
    }
    const { pubkeys, n_sigs } = p2pkParams;
    let signatures = proofs[0].witness?.signatures || [];
    let signedPubkeys = [];
    signatures.forEach((sig) => {
      pubkeys.forEach((pub) => {
        try {
          const msghash = sha256(proofs[0].secret);
          if (schnorr.verify(sig, msghash, hexToBytes(pub))) {
            signedPubkeys.push(pub);
          }
        } catch {}
      });
    });
    signedPubkeys = [...new Set(signedPubkeys)];
    let html =
      '<div id="witness-status"><strong>Signature Status:</strong><ul>';
    pubkeys.forEach((pub) => {
      const npub = nip19.npubEncode(pub.slice(2));
      const shortNpub = `${npub.slice(0, 12)}...${npub.slice(-12)}`;
      const isSigned = signedPubkeys.includes(pub);
      html += `<li class="${isSigned ? "signed" : "pending"}"><span class="status-icon"></span>${shortNpub}: ${
        isSigned ? "Signed" : "Pending"
      }</li>`;
    });
    html += `</ul>`;
    if (signedPubkeys.length >= n_sigs) {
      html += `<p class="summary">All required signatures (${n_sigs}) collected!</p>`;
    } else {
      html += `<p class="summary">Need ${n_sigs - signedPubkeys.length} more signature${
        n_sigs - signedPubkeys.length > 1 ? "s" : ""
      }.</p>`;
    }
    html += `</div>`;
    $witnessInfo.find("#witness-status").remove();
    $witnessInfo.append(html);
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
      const { data } = nip19.decode(key);
      return bytesToHex(data);
    }
    return key;
  }

  // Check NIP-07 button state
  function checkNip07ButtonState() {
    const hasNip07 =
      typeof window?.nostr?.signSchnorr !== "undefined" ||
      typeof window?.nostr?.signString !== "undefined";
    if (hasNip07 && tokenAmount > 0 && proofs.length) {
      $useNip07.prop("disabled", false);
    } else {
      $useNip07.prop("disabled", true);
    }
  }

  // Sign and witness the token
  async function signAndWitnessToken(useNip07 = false) {
    try {
      toastr.info("Signing token...");
      let signedProofs = [...proofs];
      let signedCount = 0;
      console.log("signedProofs:>>", signedProofs);

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
      }

      signedCount = signedProofs.filter(
        (p) => p.witness?.signatures?.length >= p2pkParams.n_sigs,
      ).length;
      if (signedCount === 0) {
        throw new Error("No proofs were signed");
      }

      const witnessedToken = getEncodedTokenV4({
        mint: mintUrl,
        proofs: signedProofs,
      });
      $witnessedToken.val(witnessedToken);
      storeWitnessHistory(witnessedToken, tokenAmount);
      updateWitnessStatus();
      showSuccess();
      toastr.success(
        `Signed ${signedCount} proof${signedCount > 1 ? "s" : ""} successfully!`,
      );
    } catch (e) {
      toastr.error(e.message || "Failed to sign token");
      console.error(e);
    }
  }

  // Sign proofs with NIP-07 (aligned with reference functions)
  async function signWithNip07(proofs) {
    const signedProofs = proofs.map((proof) => ({ ...proof }));
    for (const [index, proof] of signedProofs.entries()) {
      if (!proof.secret.includes("P2PK")) continue;
      const parsed = parseSecret(proof.secret);
      const { pubkeys, n_sigs } = getP2PExpectedKWitnessPubkeys(parsed);
      if (!pubkeys.length) continue;
      let signatures = proof.witness?.signatures || [];
      if (signatures.length >= n_sigs) continue;
      const hash = bytesToHex(sha256(proof.secret));
      let sig = "";
      try {
        if (typeof window?.nostr?.signSchnorr !== "undefined") {
          sig = await window.nostr.signSchnorr(hash);
          console.log("signSchnorr sig:", sig);
        } else if (typeof window?.nostr?.signString !== "undefined") {
          const {
            hash: signedHash,
            sig: signedSig,
            pubkey,
          } = await window.nostr.signString(proof.secret);
          console.log("signString result:", {
            hash: signedHash,
            sig: signedSig,
            pubkey,
          });
          if (signedHash === hash && pubkeys.includes(pubkey)) {
            sig = signedSig;
          }
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

  // Load witness history
  function loadWitnessHistory() {
    const history = getWitnessHistory();
    $historyDiv.empty();
    if (history.length === 0) {
      $historyDiv.html("<p>No witnessed tokens found.</p>");
      return;
    }
    const $list = $("<ul></ul>");
    history.forEach((entry) => {
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

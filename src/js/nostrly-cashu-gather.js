import { SimplePool } from "nostr-tools";
import {
  getEncodedTokenV4,
  getDecodedToken,
  signP2PKProofs,
  hasP2PKSignedProof,
  getP2PKNSigs,
} from "@cashu/cashu-ts";
import {
  copyTextToClipboard,
  delay,
  getWalletWithUnit,
  getTokenAmount,
  formatAmount,
} from "./utils.ts";
import {
  pool,
  getUserRelays,
  getUnclaimedNutZaps,
  getWalletAndInfo,
} from "./nostr.ts";
import { encode as emojiEncode } from "./emoji-encoder.ts";
import toastr from "toastr";

const CheckStateEnum = {
  UNSPENT: "UNSPENT",
  SPENT: "SPENT",
  PENDING: "PENDING",
};

// DOM ready
jQuery(function ($) {
  // DOM elements
  const $fetchNutZaps = $("#fetch-nutzaps");
  const $tokenList = $("#token-list");
  const $tokenHistoryList = $("#token-history-list");
  const $fetchAllMints = $("#fetch-all-mints");
  const $clearInvalid = $("#mark-invalid-redeemed");
  const $gatheredTokens = $("#new-tokens");
  const $clearHistory = $("#clear-history");
  let pubkey = "";
  let relays = [];
  let privkeys = [];
  let nutzapRelays = [];
  let lockKey = "";

  /** Filters out spent proofs from the given proof entries. */
  async function filterUnspentProofs(mintUrl, unit, proofEntries) {
    const wallet = await getWalletWithUnit(mintUrl, unit);
    const proofs = proofEntries.map((entry) => entry.proof);
    const proofStates = await wallet.checkProofsStates(proofs);
    const spentEntries = [];
    const unspentEntries = [];
    proofEntries.forEach((entry, i) => {
      if (proofStates[i].state === CheckStateEnum.UNSPENT) {
        unspentEntries.push(entry);
      } else {
        spentEntries.push(entry);
      }
    });
    return { spentEntries, unspentEntries };
  }

  /** Signs proofs using private keys from the NIP-60 wallet. */
  async function signProofs(proofEntries) {
    let signedProofs = proofEntries.map((entry) => entry.proof);
    privkeys.forEach((privkey) => {
      signedProofs = signP2PKProofs(signedProofs, privkey);
    });
    return signedProofs;
  }

  /** Processes valid proofs and generates a new token. */
  async function processValidProofs(mintUrl, unit, validEntries) {
    const validSignedProofs = validEntries.map((entry) => entry.proof);
    const token = getEncodedTokenV4({
      mint: mintUrl,
      proofs: validSignedProofs,
      unit,
    });
    try {
      const wallet = await getWalletWithUnit(mintUrl, unit);
      const newProofs = await wallet.receive(token);
      return getEncodedTokenV4({
        mint: mintUrl,
        proofs: newProofs,
        unit,
      });
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  /** Publishes a kind 7376 Nostr event to redeem proofs. */
  async function publishRedeemEvent(eventIdsToRedeem) {
    const eventTags = eventIdsToRedeem.map((id) => ["e", id, "", "redeemed"]);
    const event = {
      kind: 7376,
      content: "",
      tags: eventTags,
      created_at: Math.floor(Date.now() / 1000),
    };
    toastr.info(`Signing receipt of your NutZaps`);
    await delay(2000);
    const signedEvent = await window.nostr.signEvent(event);
    await Promise.any(pool.publish(nutzapRelays, signedEvent));
  }

  /**
   * Receives and redeems proofs, returning a new token if successful.
   * NB: We are being very robust on checking proofs as one bad one
   * will invalidate a token
   */
  async function receiveAndRedeemProofs(
    mintUrl,
    unit,
    proofEntries,
    clearInvalid = false,
  ) {
    try {
      // Start by filtering for spent proofs
      const eventIdsToRedeem = new Set();
      const { spentEntries, unspentEntries } = await filterUnspentProofs(
        mintUrl,
        unit,
        proofEntries,
      );
      // Add spent proof event IDs to the redeem list
      spentEntries.forEach((entry) => eventIdsToRedeem.add(entry.eventId));
      if (!unspentEntries.length) {
        // All proofs spent, we are done... just clean up
        if (eventIdsToRedeem.size > 0) {
          toastr.info(
            "Only spent NutZaps were found. Marking them as redeemed...",
          );
          await publishRedeemEvent(Array.from(eventIdsToRedeem));
        }
        return null;
      }
      // Sign unspent proofs and categorize them
      const signedProofs = await signProofs(unspentEntries);
      const validEntries = [];
      const invalidEntries = [];
      for (const [i, proof] of signedProofs.entries()) {
        const entry = unspentEntries[i];
        if (!proof.secret.includes("P2PK")) {
          // Unspent and unlocked proof... rare!
          console.log("An unlocked NutZap proof!", proof);
          validEntries.push({ proof, eventId: entry.eventId });
          continue;
        }
        // P2PK proofs should be locked to NIP-61 lockKey with one signature
        const n_sigs = getP2PKNSigs(proof.secret);
        if (n_sigs < 2 && hasP2PKSignedProof(lockKey, proof)) {
          console.log("Signed NutZap proof", proof);
          validEntries.push({ proof, eventId: entry.eventId });
          continue;
        }
        console.log("Not a NutZap compliant proof", proof);
        invalidEntries.push({ proof: entry.proof, eventId: entry.eventId });
      }
      // Handle invalid proofs
      if (invalidEntries.length > 0) {
        toastr.warning(
          `${invalidEntries.length} proofs couldn’t be redeemed due to missing signatures. Check your NIP-60 wallet setup.`,
        );
        if (clearInvalid) {
          // Add invalid event IDs to redeem set if clearing
          invalidEntries.forEach((entry) =>
            eventIdsToRedeem.add(entry.eventId),
          );
        }
      }
      // Process valid proofs and collect their event IDs
      let newToken = null;
      if (validEntries.length > 0) {
        newToken = await processValidProofs(mintUrl, unit, validEntries);
        validEntries.forEach((entry) => eventIdsToRedeem.add(entry.eventId));
      }
      // Publish a single redeem event with all event IDs
      if (eventIdsToRedeem.size > 0) {
        await publishRedeemEvent(Array.from(eventIdsToRedeem));
      }
      return newToken;
    } catch (error) {
      console.error(
        `Failed to process proofs for mint ${mintUrl}, unit ${unit}:`,
        error,
      );
      toastr.error(
        `Failed to process proofs for mint ${mintUrl}, unit ${unit}`,
      );
      return null;
    }
  }

  /** Helper function to create a token list item with copy buttons. */
  function createTokenListItem({ mintUrl, unit, token, timestamp = null }) {
    const decodedToken = getDecodedToken(token);
    const amount = formatAmount(getTokenAmount(decodedToken.proofs), unit);
    const li = document.createElement("li");
    li.className = timestamp ? "history-item" : "";
    li.innerHTML = `
      <span class="copy-token">Copy Token</span>
      <span class="copy-emoji">Copy 🥜</span>
      ${timestamp ? `<span>${timestamp}</span>` : ""}
      <span class="token"> ${amount} from ${mintUrl}</span>
    `;
    li.querySelector(".copy-token").addEventListener("click", () => {
      copyTextToClipboard(token);
    });
    li.querySelector(".copy-emoji").addEventListener("click", () => {
      const emojiToken = emojiEncode("\uD83E\uDD5C", token);
      copyTextToClipboard(emojiToken);
    });
    return li;
  }

  /** Displays a list of tokens in the specified target element. */
  function displayTokenList($target, tokenDataArray, emptyMessage = null) {
    if (emptyMessage && tokenDataArray.length === 0) {
      $target.html(emptyMessage);
      return;
    }
    const fragment = document.createDocumentFragment();
    tokenDataArray.forEach((tokenData) => {
      const li = createTokenListItem(tokenData);
      fragment.appendChild(li);
    });
    $target.empty().append(fragment);
  }

  /** Displays new tokens and saves them to localStorage under a new-tokens key. */
  function displayAndSaveNewTokens(tokens) {
    // Save to localStorage under a separate key for new tokens
    const newTokensWithTimestamp = tokens.map(({ mintUrl, unit, token }) => ({
      mintUrl,
      unit,
      token,
      timestamp: new Date().toLocaleString().slice(0, -3),
    }));
    const existingNewTokens = JSON.parse(
      localStorage.getItem("cashu-gather-new-tokens") || "[]",
    );
    const updatedNewTokens = [...newTokensWithTimestamp, ...existingNewTokens];
    localStorage.setItem(
      "cashu-gather-new-tokens",
      JSON.stringify(updatedNewTokens),
    );

    // Display in the "Newly Collected Tokens" section
    displayTokenList($tokenList, updatedNewTokens);
    $gatheredTokens.removeClass("hidden");
  }

  /** Moves new tokens to history and clears the new tokens storage. */
  function moveNewTokensToHistory() {
    const newTokens = JSON.parse(
      localStorage.getItem("cashu-gather-new-tokens") || "[]",
    );
    if (newTokens.length === 0) return;

    const existingHistory = JSON.parse(
      localStorage.getItem("cashu-gather-tokens") || "[]",
    );
    const updatedHistory = [...newTokens, ...existingHistory];
    localStorage.setItem("cashu-gather-tokens", JSON.stringify(updatedHistory));

    // Clear the new tokens storage
    localStorage.removeItem("cashu-gather-new-tokens");
  }

  /** Loads and displays token history from localStorage. */
  function loadTokenHistory() {
    const history = JSON.parse(
      localStorage.getItem("cashu-gather-tokens") || "[]",
    );
    displayTokenList(
      $tokenHistoryList,
      history,
      "<p class='center'>No gathered tokens found.</p>",
    );
  }

  /** Loads and displays new tokens from localStorage. */
  function loadNewTokens() {
    const newTokens = JSON.parse(
      localStorage.getItem("cashu-gather-new-tokens") || "[]",
    );
    displayTokenList($tokenList, newTokens);
    if (newTokens.length > 0) {
      $gatheredTokens.removeClass("hidden");
    }
  }

  /** Processes a single mint-unit pair. */
  async function processMintUnit(mintUrl, unit, proofEntries, clearInvalid) {
    try {
      const newToken = await receiveAndRedeemProofs(
        mintUrl,
        unit,
        proofEntries,
        clearInvalid,
      );
      if (newToken) {
        toastr.success(`Collected token from ${mintUrl}, unit ${unit}`);
        return { mintUrl, unit, token: newToken };
      }
      return null;
    } catch (error) {
      console.error(`Error processing ${mintUrl}, ${unit}:`, error);
      toastr.error(`Failed to process ${mintUrl}, unit ${unit}`);
      return null;
    }
  }

  // Main fetch handler
  $fetchNutZaps.on("click", async () => {
    $fetchNutZaps.prop("disabled", true).text("Fetching...");
    try {
      toastr.info("Fetching your NIP-60 wallet...");
      pubkey = await window.nostr.getPublicKey();
      relays = await getUserRelays(pubkey);
      ({
        privkeys,
        pubkey: lockKey,
        relays: nutzapRelays,
      } = await getWalletAndInfo(pubkey, relays));

      // Read checkbox states
      const fetchAllMints = $fetchAllMints.is(":checked");
      const clearInvalid = $clearInvalid.is(":checked");

      let proofStore;
      try {
        // Pass !fetchAllMints as strictMints (true = NutZap mints only, false = all mints)
        toastr.info("Gathering NutZaps...");
        proofStore = await getUnclaimedNutZaps(pubkey, relays, !fetchAllMints);
      } catch (error) {
        console.error("Failed to gather unclaimed NutZaps:", error);
        toastr.error("Failed to gather unclaimed NutZaps");
        throw error;
      }
      const tokenPromises = [];
      for (const [mintUrl, units] of Object.entries(proofStore)) {
        for (const [unit, proofEntries] of Object.entries(units)) {
          tokenPromises.push(
            processMintUnit(mintUrl, unit, proofEntries, clearInvalid),
          );
        }
      }
      const tokens = (await Promise.all(tokenPromises)).filter(Boolean);
      if (tokens.length === 0) {
        toastr.info("No unclaimed NutZaps found.");
        return;
      }
      displayAndSaveNewTokens(tokens);
    } catch (error) {
      console.error("Error in fetch-nutzaps:", error);
      toastr.error("Failed to gather and process NutZaps");
    } finally {
      $fetchNutZaps.prop("disabled", false).text("Fetch Unclaimed NutZaps");
    }
  });

  // Clear History handler
  $clearHistory.on("click", () => {
    localStorage.removeItem("cashu-gather-tokens");
    loadTokenHistory();
    toastr.success("Token history cleared.");
  });

  // Persist checkbox states
  $fetchAllMints.prop(
    "checked",
    JSON.parse(localStorage.getItem("fetch-all-mints") || "true"),
  );
  $clearInvalid.prop(
    "checked",
    JSON.parse(localStorage.getItem("mark-invalid-redeemed") || "false"),
  );
  $fetchAllMints.on("change", () => {
    localStorage.setItem("fetch-all-mints", $fetchAllMints.is(":checked"));
  });
  $clearInvalid.on("change", () => {
    localStorage.setItem("mark-invalid-redeemed", $clearInvalid.is(":checked"));
  });

  // Initialize
  moveNewTokensToHistory(); // Move any existing new tokens to history on page load
  loadTokenHistory(); // Load the history
  loadNewTokens(); // Load any new tokens that were saved but not yet moved
});

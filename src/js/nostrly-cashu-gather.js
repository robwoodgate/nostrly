import { SimplePool } from "nostr-tools";
import {
  getEncodedTokenV4,
  getDecodedToken,
  signP2PKProofs,
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
import { handleCashuDonation } from "./cashu-donate.js";

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
  const $donateCashu = $("#donate_cashu");

  // Donation input
  $donateCashu.on("paste", () => {
    setTimeout(async () => {
      handleCashuDonation($donateCashu.val(), "Cashu Redeem Donation");
      $donateCashu.val("");
    }, 200);
    console.log("donation");
  });

  // Init vars
  let pubkey = "";
  let relays = [];
  let privkeys = [];
  let nutzapRelays = [];
  let mints = "";
  let lockKey = "";
  const eventIdsToRedeem = new Set();

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
  async function publishRedeemEvent() {
    const eventArr = Array.from(eventIdsToRedeem);
    const eventTags = eventArr.map((id) => ["e", id, "", "redeemed"]);
    const event = {
      kind: 7376,
      content: "",
      tags: eventTags,
      created_at: Math.floor(Date.now() / 1000),
    };
    toastr.info(`Marking NutZaps as redeemed`);
    await delay(2000);
    const signedEvent = await window.nostr.signEvent(event);
    await Promise.any(pool.publish(nutzapRelays, signedEvent));
  }

  /**
   * Receives proofs, returning a new token if successful.
   * NB: We are being very robust on checking proofs as one bad one
   * will invalidate a token
   */
  async function receiveProofs(
    mintUrl,
    unit,
    proofEntries,
    clearInvalid = false,
  ) {
    try {
      // Start by filtering for spent proofs
      const { spentEntries, unspentEntries } = await filterUnspentProofs(
        mintUrl,
        unit,
        proofEntries,
      );
      // Add spent proof event IDs to the redeem list
      spentEntries.forEach((entry) => eventIdsToRedeem.add(entry.eventId));
      if (!unspentEntries.length) {
        toastr.warning(`Found a spent ${unit} token from ${mintUrl}`);
        return null;
      }
      // Sign unspent proofs and categorize them
      const signedProofs = await signProofs(unspentEntries);
      const validEntries = []; // Format: [{proof, eventId}, ...]
      const invalidEventIds = [];
      for (const [i, proof] of signedProofs.entries()) {
        const eventId = unspentEntries[i].eventId;
        if (!proof.secret.includes("P2PK")) {
          // Unspent and unlocked proof... rare!
          console.log("An unlocked NutZap proof!", proof);
          validEntries.push({ proof, eventId });
          continue;
        }
        // P2PK proofs should be signed and require one signature + witness
        // or require zero signatures (locktime has expired, no refund keys)
        const n_sigs = getP2PKNSigs(proof.secret);
        if (!n_sigs || (n_sigs == 1 && proof.witness)) {
          console.log("Signed NutZap proof", proof);
          validEntries.push({ proof, eventId });
          continue;
        }
        console.log("Not a NutZap compliant proof", proof);
        invalidEventIds.push(eventId);
      }
      // Handle invalid proofs
      if (invalidEventIds.length > 0) {
        toastr.warning(
          `${invalidEventIds.length} proofs couldn’t be redeemed due to missing signatures. Check your NIP-60 wallet setup.`,
        );
        if (clearInvalid) {
          // Add invalid event IDs to redeem set if clearing
          invalidEventIds.forEach((eventId) => eventIdsToRedeem.add(eventId));
        }
      }
      // Process valid proofs and collect their event IDs
      let newToken = null;
      if (validEntries.length > 0) {
        newToken = await processValidProofs(mintUrl, unit, validEntries);
        validEntries.forEach((entry) => eventIdsToRedeem.add(entry.eventId));
      }
      return newToken;
    } catch (error) {
      console.error(
        `Failed to process ${unit} proofs for mint ${mintUrl}:`,
        error,
      );
      toastr.error(`Failed to process ${unit} proofs for mint ${mintUrl}`);
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
      const newToken = await receiveProofs(
        mintUrl,
        unit,
        proofEntries,
        clearInvalid,
      );
      if (newToken) {
        toastr.success(`Gathered a ${unit} token from ${mintUrl}`);
        return { mintUrl, unit, token: newToken };
      }
      return null;
    } catch (error) {
      console.error(`Error processing ${mintUrl}, ${unit}:`, error);
      toastr.error(`Failed to process ${unit} proofs from ${mintUrl}`);
      return null;
    }
  }

  // Main fetch handler
  $fetchNutZaps.on("click", async () => {
    $fetchNutZaps.prop("disabled", true).text("Fetching...");
    try {
      toastr.info("Fetching NIP-60 wallet...");
      pubkey = await window.nostr.getPublicKey();
      relays = await getUserRelays(pubkey);
      ({
        privkeys,
        mints,
        pubkey: lockKey,
        relays: nutzapRelays,
      } = await getWalletAndInfo(pubkey, relays));
      if (!privkeys.length || !lockKey || !nutzapRelays.length) {
        toastr.error("Wallet could not be loaded, or does not exist.");
        return;
      }

      // Read checkbox states
      const fetchAllMints = $fetchAllMints.is(":checked");
      const clearInvalid = $clearInvalid.is(":checked");

      let proofStore;
      try {
        // Pass !fetchAllMints as strictMints (true = NutZap mints only, false = all mints)
        toastr.info("Gathering NutZaps...");
        proofStore = await getUnclaimedNutZaps(
          pubkey,
          relays,
          nutzapRelays,
          !fetchAllMints ? mints : [],
          true,
        ); // inc toastr
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
      if (tokens.length > 0) {
        displayAndSaveNewTokens(tokens);
      } else {
        toastr.info("No new NutZaps found.");
      }

      // Publish a redeem event with all processed event IDs
      if (eventIdsToRedeem.size > 0) {
        await publishRedeemEvent();
        eventIdsToRedeem.clear(); // reset
      }
    } catch (error) {
      console.error("Error in fetch-nutzaps:", error);
      toastr.error("Failed to gather and process NutZaps");
    } finally {
      $fetchNutZaps.prop("disabled", false).text("Gather Unclaimed NutZaps");
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

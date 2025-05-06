import { SimplePool } from "nostr-tools";
import {
  getEncodedTokenV4,
  getDecodedToken,
  signP2PKProofs,
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
    return proofEntries.filter(
      (_, i) => proofStates[i].state === CheckStateEnum.UNSPENT,
    );
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
      return token;
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
    await pool.publish(nutzapRelays, signedEvent);
  }

  /** Receives and redeems proofs, returning a new token if successful. */
  async function receiveAndRedeemProofs(
    mintUrl,
    unit,
    proofEntries,
    clearInvalid = false,
  ) {
    try {
      const validEntries = [];
      const invalidEntries = [];
      const unspentEntries = await filterUnspentProofs(
        mintUrl,
        unit,
        proofEntries,
      );
      console.log("unspentEntries:>>", unspentEntries);
      // If no unspent entries, publish redeem event for all event IDs
      // This shouldn't happen, as NutZaps should be P2PK locked, but may
      // happen if the redeem happened but wasn't recorded properly before
      if (!unspentEntries.length) {
        const allEventIds = [
          ...new Set(proofEntries.map((entry) => entry.eventId)),
        ];
        if (allEventIds.length > 0) {
          await publishRedeemEvent(allEventIds);
        }
        return null;
      }
      // Sign all the proofs
      const signedProofs = await signProofs(unspentEntries);
      signedProofs.forEach((proof, i) => {
        const entry = unspentEntries[i];
        if (proof.secret.includes(lockKey) && !proof.witness) {
          invalidEntries.push({ proof: entry.proof, eventId: entry.eventId });
        } else {
          validEntries.push({ proof, eventId: entry.eventId });
        }
      });

      if (invalidEntries.length > 0 && !clearInvalid) {
        toastr.warning(
          `${invalidEntries.length} proofs couldn’t be redeemed due to missing signatures. Check your NIP-60 wallet setup.`,
        );
      }

      let newToken = null;
      if (validEntries.length > 0) {
        newToken = await processValidProofs(mintUrl, unit, validEntries);
      }

      const eventIdsToRedeem = new Set();
      validEntries.forEach((entry) => eventIdsToRedeem.add(entry.eventId));
      if (clearInvalid) {
        invalidEntries.forEach((entry) => eventIdsToRedeem.add(entry.eventId));
      }

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
      ${timestamp ? `<span>${timestamp} - </span>` : ""}
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

  /** Displays new tokens and saves them to localStorage. */
  function displayAndSaveTokens(tokens) {
    displayTokenList($tokenList, tokens);
    $tokenList.removeClass("hidden");

    const existingTokens = JSON.parse(
      localStorage.getItem("cashu-gather-tokens") || "[]",
    );
    const updatedTokens = [
      ...tokens.map(({ mintUrl, unit, token }) => ({
        mintUrl,
        unit,
        token,
        timestamp: new Date().toLocaleString().slice(0, -3),
      })),
      ...existingTokens,
    ];
    localStorage.setItem("cashu-gather-tokens", JSON.stringify(updatedTokens));

    loadTokenHistory();
  }

  /** Loads and displays token history from localStorage. */
  function loadTokenHistory() {
    const history = JSON.parse(
      localStorage.getItem("cashu-gather-tokens") || "[]",
    );
    displayTokenList(
      $tokenHistoryList,
      history,
      "<p>No collected tokens found.</p>",
    );
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
        return;
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
      displayAndSaveTokens(tokens);
    } catch (error) {
      console.error("Error in fetch-nutzaps:", error);
      toastr.error("Failed to gather and process NutZaps");
    }
  });

  // Initialize
  loadTokenHistory();
});

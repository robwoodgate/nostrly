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
  getNip60Wallet,
  getNip61Info,
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
  let pubkey = "";
  let relays = [];

  // Receive proofs, create new tokens, and mark as redeemed
  async function receiveAndRedeemProofs(
    mintUrl,
    unit,
    proofs,
    redeemedEventIds,
  ) {
    try {
      // Check proofs are unspent
      const wallet = await getWalletWithUnit(mintUrl, unit);
      const proofStates = await wallet.checkProofsStates(proofs);
      let unspentProofs = proofs.filter(
        (_, index) => proofStates[index].state === CheckStateEnum.UNSPENT,
      );
      if (!unspentProofs.length) {
        return null;
      }
      console.log("unspentProofs:>>", unspentProofs);
      // Witness the proofs
      const { privkeys } = await getNip60Wallet(pubkey, relays);
      privkeys.forEach((privkey) => {
        unspentProofs = signP2PKProofs(unspentProofs, privkey);
      });
      console.log("signed proofs:>>", unspentProofs);
      const token = getEncodedTokenV4({
        mint: mintUrl,
        proofs: unspentProofs,
        unit,
      });
      displayAndSaveTokens([{ mintUrl, unit, token }]);
      const newProofs = await wallet.receive(token);
      const newToken = getEncodedTokenV4({
        mint: mintUrl,
        proofs: newProofs,
        unit,
      });
      // Create and publish kind 7376 event
      const event = {
        kind: 7376,
        content: "", // Not receiving to NIP-60 wallet, so nothing to record
        tags: redeemedEventIds.map((id) => ["e", id, "", "redeemed"]),
        created_at: Math.floor(Date.now() / 1000),
      };
      toastr.info(`Signing receipt of your NutZaps`);
      await delay(2000); // Give them time to read the notice
      const signedEvent = await window.nostr.signEvent(event);
      console.log("signedEvent:>>", signedEvent);
      await pool.publish(relays, signedEvent);

      return newToken;
    } catch (error) {
      console.error(
        `Failed to process proofs for mint ${mintUrl}, unit: ${unit}:`,
        error,
      );
      toastr.error(
        `Failed to process proofs for mint ${mintUrl}, unit: ${unit}`,
      );
      return null;
    }
  }

  // Display new tokens and save to localStorage
  function displayAndSaveTokens(tokens) {
    $tokenList.empty().removeClass("hidden");
    tokens.forEach(({ mintUrl, unit, token }) => {
      const decodedToken = getDecodedToken(token);
      const amount = formatAmount(getTokenAmount(decodedToken.proofs), unit);
      const $item = $(`
        <li>
          <span class="token">${amount} from ${mintUrl}</span>
          <button class="copy-token button">Copy Token</button>
          <button class="copy-emoji button">Copy 🥜</button>
        </li>
      `);
      $item.find(".copy-token").on("click", () => {
        copyTextToClipboard(token);
        toastr.success("Token copied!");
      });
      $item.find(".copy-emoji").on("click", () => {
        const emojiToken = emojiEncode("\uD83E\uDD5C", token);
        copyTextToClipboard(emojiToken);
        toastr.success("Emoji token copied!");
      });
      $tokenList.append($item);
    });

    // Append to localStorage without overwriting existing tokens
    const existingTokens = JSON.parse(
      localStorage.getItem("cashu-gather-tokens") || "[]",
    );
    const updatedTokens = [
      ...existingTokens,
      ...tokens.map(({ mintUrl, unit, token }) => ({
        mintUrl,
        unit,
        token,
        timestamp: new Date().toLocaleString().slice(0, -3),
      })),
    ];
    localStorage.setItem("cashu-gather-tokens", JSON.stringify(updatedTokens));

    // Update history display
    loadTokenHistory();
  }

  // Load and display token history
  function loadTokenHistory() {
    const history = JSON.parse(
      localStorage.getItem("cashu-gather-tokens") || "[]",
    );
    $tokenHistoryList.empty();
    if (history.length === 0) {
      $tokenHistoryList.html("<p>No collected tokens found.</p>");
      return;
    }
    const $list = $("<ul></ul>");
    history.forEach(({ mintUrl, unit, token, timestamp }) => {
      const decodedToken = getDecodedToken(token);
      const amount = formatAmount(getTokenAmount(decodedToken.proofs), unit);
      const $item = $(`
        <li class="history-item">
          <span class="copytkn">Copy Token</span>
          <span class="copyemj">Copy 🥜</span>
          ${timestamp} - Token: ${amount} from ${mintUrl}
        </li>
      `);
      $item.find(".copytkn").on("click", () => {
        copyTextToClipboard(token);
        toastr.success("Token copied from history!");
      });
      $item.find(".copyemj").on("click", () => {
        const emojiToken = emojiEncode("\uD83E\uDD5C", token);
        copyTextToClipboard(emojiToken);
        toastr.success("Emoji token copied from history!");
      });
      $list.append($item);
    });
    $tokenHistoryList.append($list);
  }

  // Main fetch handler
  $fetchNutZaps.on("click", async () => {
    try {
      toastr.info("Fetching your unclaimed NutZaps...");
      pubkey = await window.nostr.getPublicKey();
      relays = await getUserRelays(pubkey);
      let proofStore;
      try {
        // Format: { [mintUrl: string]: { [unit: string]: { proofs: Proof[], eventIds: string[] } } }
        proofStore = await getUnclaimedNutZaps(pubkey, relays);
      } catch (error) {
        console.error("Failed to fetch unclaimed NutZaps:", error);
        toastr.error("Failed to fetch unclaimed NutZaps");
        return;
      }
      const tokens = [];
      for (const [mintUrl, units] of Object.entries(proofStore)) {
        for (const [unit, { proofs, eventIds }] of Object.entries(units)) {
          console.log(`Checking proofs from ${mintUrl}, unit ${unit}`);
          console.log("Proofs", proofs);
          const newToken = await receiveAndRedeemProofs(
            mintUrl,
            unit,
            proofs,
            eventIds,
          );
          if (newToken) {
            tokens.push({ mintUrl, unit, token: newToken });
            toastr.success(`Collected token from ${mintUrl}, unit ${unit}`);
          }
        }
      }
      if (tokens.length === 0) {
        toastr.info("No unclaimed NutZaps found.");
        return;
      }
      displayAndSaveTokens(tokens);
    } catch (error) {
      console.error("Error in fetch-nutzaps:", error);
      toastr.error("Failed to fetch and process NutZaps");
    }
  });

  // Initialize
  loadTokenHistory();
});

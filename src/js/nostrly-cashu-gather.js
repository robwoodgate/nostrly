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
    proofEntries,
    clearInvalid = false,
  ) {
    try {
      // Step 1: Get proofs and event IDs (indexes will be in sync)
      const proofs = proofEntries.map((entry) => entry.proof);
      const eventIds = proofEntries.map((entry) => entry.eventId);

      // Step 2: Filter unspent proofs
      const wallet = await getWalletWithUnit(mintUrl, unit);
      const proofStates = await wallet.checkProofsStates(proofs);
      const unspentEntries = proofEntries.filter(
        (_, i) => proofStates[i].state === CheckStateEnum.UNSPENT,
      );
      if (!unspentEntries.length) {
        console.log(
          `No unspent proofs found for mint ${mintUrl}, unit ${unit}`,
        );
        return null;
      }

      // Step 3: Sign the unspent proofs
      const { privkeys } = await getNip60Wallet(pubkey, relays);
      let signedProofs = unspentEntries.map((entry) => entry.proof);
      privkeys.forEach((privkey) => {
        signedProofs = signP2PKProofs(signedProofs, privkey);
      });

      // Step 4: Split into valid and invalid proofs
      const validEntries = [];
      const invalidEntries = [];
      signedProofs.forEach((proof, i) => {
        const entry = unspentEntries[i];
        if (proof.witness) {
          validEntries.push({ proof, eventId: entry.eventId });
        } else {
          invalidEntries.push({ proof: entry.proof, eventId: entry.eventId });
        }
      });

      // Step 5: Warn about invalid proofs if any
      if (invalidEntries.length > 0 && !clearInvalid) {
        toastr.warning(
          `${invalidEntries.length} proofs couldn’t be redeemed due to missing signatures. Check your NIP-60 wallet setup.`,
        );
      }

      // Step 6: Process valid proofs with wallet.receive
      let newToken = null;
      if (validEntries.length > 0) {
        const validSignedProofs = validEntries.map((entry) => entry.proof);
        const token = getEncodedTokenV4({
          mint: mintUrl,
          proofs: validSignedProofs,
          unit,
        });
        displayAndSaveTokens([{ mintUrl, unit, token }]);
        const newProofs = await wallet.receive(token);
        newToken = getEncodedTokenV4({
          mint: mintUrl,
          proofs: newProofs,
          unit,
        });
        console.log(
          `Processed ${validEntries.length} valid proofs for mint ${mintUrl}, unit ${unit}`,
        );
      }

      // Step 7: Create event tags for kind 7376
      const eventIdsToRedeem = new Set();
      validEntries.forEach((entry) => eventIdsToRedeem.add(entry.eventId));
      if (clearInvalid) {
        invalidEntries.forEach((entry) => eventIdsToRedeem.add(entry.eventId));
      }
      const eventTags = Array.from(eventIdsToRedeem).map((id) => [
        "e",
        id,
        "",
        "redeemed",
      ]);

      // Step 8: Publish kind 7376 event if needed
      if (eventTags.length > 0) {
        const event = {
          kind: 7376,
          content: "",
          tags: eventTags,
          created_at: Math.floor(Date.now() / 1000),
        };
        toastr.info(`Signing receipt of your NutZaps`);
        await delay(2000);
        const signedEvent = await window.nostr.signEvent(event);
        await pool.publish(relays, signedEvent);
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
      ...tokens.map(({ mintUrl, unit, token }) => ({
        mintUrl,
        unit,
        token,
        timestamp: new Date().toLocaleString().slice(0, -3),
      })),
      ...existingTokens,
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
        // Format: { [mintUrl: string]: { [unit: string]: { proof: Proof; eventId: string }[] } }
        proofStore = await getUnclaimedNutZaps(pubkey, relays);
      } catch (error) {
        console.error("Failed to fetch unclaimed NutZaps:", error);
        toastr.error("Failed to fetch unclaimed NutZaps");
        return;
      }
      const tokens = [];
      for (const [mintUrl, units] of Object.entries(proofStore)) {
        for (const [unit, proofEntries] of Object.entries(units)) {
          console.log(`Checking proofs from ${mintUrl}, unit ${unit}`);
          console.log(
            "Proofs",
            proofEntries.map((entry) => entry.proof),
          );
          const newToken = await receiveAndRedeemProofs(
            mintUrl,
            unit,
            proofEntries,
            false, // Do not mark unredeemable proofs as redeemed
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

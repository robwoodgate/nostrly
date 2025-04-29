import {
  SimplePool,
  generateSecretKey,
  getPublicKey,
  nip19,
  finalizeEvent,
} from "nostr-tools";
import { getNut11Mints } from "./nut11.ts";
import { copyTextToClipboard, debounce, delay } from "./utils.ts";
import { DEFAULT_RELAYS, pool, getUserRelays } from "./nostr.ts";
import { bytesToHex } from "@noble/hashes/utils";
import toastr from "toastr";

// DOM ready
jQuery(function ($) {
  // Init vars
  let mintUrls = [];
  let mints = [];
  let relays = [];

  // DOM elements
  const $form = $("#nip60-wallet-form");
  const $success = $("#nip60-wallet-success");
  const $mintSelect = $("#mint-select");
  const $mints = $("#mints");
  const $relays = $("#relays");
  const $getRelays = $("#get-relays");
  const $createWallet = $("#create-wallet");
  const $walletKey = $("#wallet-key");
  const $copyKey = $("#copy-key");

  // Page handlers
  function showForm() {
    $form.show();
    $success.hide();
  }

  function showSuccess() {
    $form.hide();
    $success.show();
  }

  // Initialize mint selector
  async function initMintSelector() {
    try {
      mintUrls = await getNut11Mints();
      $mintSelect.empty();
      $mintSelect.append(
        $("<option></option>")
          .attr("value", "")
          .prop("disabled", true)
          .prop("selected", true)
          .text("Select a mint..."),
      );
      mintUrls.forEach((url) =>
        $mintSelect.append($("<option></option>").attr("value", url).text(url)),
      );
    } catch (e) {
      toastr.error("Failed to load mints");
      console.error(e);
      $mintSelect.attr("data-valid", "no");
    }
  }

  // Handle mint selection
  $mintSelect.on("change", () => {
    const selectedMint = $mintSelect.val();
    if (selectedMint) {
      const currentMints = $mints.val().trim().split("\n").filter(Boolean);
      if (!currentMints.includes(selectedMint)) {
        currentMints.push(selectedMint);
        $mints.val(currentMints.join("\n"));
        toastr.success(`Added mint: ${selectedMint}`);
      } else {
        toastr.info("Mint already added");
      }
      $mintSelect.val(""); // Reset selector
      validateMints();
    }
  });

  // Validate mints
  const validateMints = debounce(() => {
    const mintList = $mints
      .val()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((url) => url.trim());
    mints = [...new Set(mintList)]; // Deduplicate
    $mints.val(mintList.join("\n") + "\n");
    // Check if all entered mints are in mintUrls
    const invalidMints = mints.filter((mint) => !mintUrls.includes(mint));
    if (invalidMints.length > 0) {
      $mints.attr("data-valid", "no");
      toastr.error(
        `Invalid mints detected: ${invalidMints.join(", ")}. Please use mints from the selector, as they support NUT-11 P2PK locking.`,
      );
      mints = []; // Clear mints to prevent proceeding with invalid ones
    } else if (mints.length === 0) {
      $mints.attr("data-valid", "no");
      toastr.error("At least one mint is required");
    } else {
      $mints.attr("data-valid", "");
    }
    checkIsReadyToCreate();
  }, 500);

  // Validate relays
  const validateRelays = debounce(() => {
    const relayList = $relays
      .val()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((url) => url.trim());
    relays = [...new Set(relayList)]; // Deduplicate
    $relays.val(relayList.join("\n") + "\n");
    if (relays.length === 0) {
      $relays.attr("data-valid", "no");
      toastr.error("At least one relay is required");
    } else {
      $relays.attr("data-valid", "");
    }
    checkIsReadyToCreate();
  }, 500);

  // Handle mints input
  $mints.on("input", validateMints);

  // Handle relays input
  $relays.on("input", validateRelays);

  // Fetch relays via NIP-07
  $getRelays.on("click", async () => {
    try {
      const pubkey = await window.nostr.getPublicKey();
      const relayUrls = await getUserRelays(pubkey);
      if (relayUrls.length > 0) {
        $relays.val(relayUrls.join("\n"));
        validateRelays();
        toastr.success("Relays fetched");
      } else {
        throw new Error("No relays found");
      }
    } catch (e) {
      toastr.error("Failed to fetch relays. Please enter manually.");
      console.error(e);
    }
  });

  // Check if ready to create wallet
  const checkIsReadyToCreate = debounce(() => {
    if (mints.length > 0 && relays.length > 0) {
      $createWallet.prop("disabled", false);
    } else {
      $createWallet.prop("disabled", true);
    }
  }, 200);

  // Create NIP-60 wallet
  $createWallet.on("click", async () => {
    try {
      // Generate new keypair
      const sk = generateSecretKey(); // Uint8Array
      const pk = getPublicKey(sk); // hex string
      const nsec = nip19.nsecEncode(sk); // nsec string

      // Create NIP-60 encrypted wallet
      toastr.info("Creating your NIP-60 encrypted wallet");
      await delay(2000); // give them time to read the notice
      const pubkey = await window.nostr.getPublicKey();
      const data = JSON.stringify([
        ["privkey", bytesToHex(sk)],
        ...mints.map((mint) => ["mint", mint]),
      ]);
      console.log(data);
      const enc_data = await window.nostr.nip44.encrypt(pubkey, data);

      // Create NIP-60 wallet metadata event (kind 17375)
      // @see https://github.com/nostr-protocol/nips/blob/master/60.md#wallet-event
      const walletMetadataEvent = {
        kind: 17375,
        tags: [],
        content: enc_data,
        created_at: Math.floor(Date.now() / 1000),
      };

      // Create NIP-60 wallet backup event (kind 375)
      // @see https://github.com/nostr-protocol/nips/pull/1834
      // Includes our suggested 'k' tag for REQ filtering
      const walletBackupEvent = {
        kind: 375,
        tags: [["k", pk]], // locking pk
        content: enc_data,
        created_at: Math.floor(Date.now() / 1000),
      };

      // Create NIP-61 P2PK metadata event (kind 10019)
      // @see https://github.com/nostr-protocol/nips/blob/master/61.md#nutzap-informational-event
      const p2pkMetadataEvent = {
        kind: 10019,
        tags: [
          ...relays.map((relay) => ["relay", relay]),
          ...mints.map((mint) => ["mint", mint]),
          ["pubkey", pk], // locking pk
          ["k", pk], // locking pk
        ],
        content: "",
        created_at: Math.floor(Date.now() / 1000),
      };

      // Sign and broadcast events
      toastr.info("Signing your NIP-60 encrypted wallet");
      await delay(2000); // give them time to read the notice
      const signedWalletMetadata = await window.nostr.signEvent(
        walletMetadataEvent,
        sk,
      );
      toastr.info("Signing a backup of your NIP-60 encrypted wallet");
      await delay(2000); // give them time to read the notice
      const signedWalletBackup = await window.nostr.signEvent(
        walletBackupEvent,
        sk,
      );
      toastr.info("Signing your NIP-61 Nutzap informational event");
      await delay(2000); // give them time to read the notice
      const signedP2PKMetadata = await window.nostr.signEvent(
        p2pkMetadataEvent,
        sk,
      );

      await Promise.all([
        pool.publish(relays, signedWalletMetadata),
        pool.publish(relays, signedWalletBackup),
        pool.publish(relays, signedP2PKMetadata),
      ]);

      // Display success
      $walletKey.val(nsec);
      showSuccess();
      $copyKey.on("click", () => {
        copyTextToClipboard(nsec);
        toastr.success("Wallet key copied");
      });

      toastr.success(
        "NIP-60 wallet created and broadcast with backup and P2PK metadata",
      );
    } catch (e) {
      toastr.error("Failed to create wallet");
      console.error(e);
      showForm();
    }
  });

  // Initialize
  initMintSelector();
  $relays.val(DEFAULT_RELAYS.join("\n"));
  validateRelays();
  showForm();
});

import {
  SimplePool,
  generateSecretKey,
  getPublicKey,
  nip19,
  finalizeEvent,
} from "nostr-tools";
import { getNut11Mints } from "./nut11.ts";
import { copyTextToClipboard, debounce } from "./utils.ts";
import toastr from "toastr";

// DOM ready
jQuery(function ($) {
  // Init constants
  const pool = new SimplePool();
  const DEFAULT_RELAYS = [
    "wss://relay.damus.io",
    "wss://nostr.mom",
    "wss://nos.lol",
  ];

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
      toastr.success("Mint list loaded");
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
        `Invalid mints detected: ${invalidMints.join(", ")}. Please use mints from the selector.`,
      );
      mints = []; // Clear mints to prevent proceeding with invalid ones
    } else if (mints.length === 0) {
      $mints.attr("data-valid", "no");
      toastr.error("At least one mint is required");
    } else {
      $mints.attr("data-valid", "");
      toastr.success("Mints validated");
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
      toastr.success("Relays validated");
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
      const relayObj = await window.nostr.getRelays();
      const relayUrls = Object.keys(relayObj).filter(
        (url) => relayObj[url].read || relayObj[url].write,
      );
      if (relayUrls.length > 0) {
        $relays.val(relayUrls.join("\n"));
        validateRelays();
        toastr.success("Relays fetched from NIP-07 extension");
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
      const sk = generateSecretKey();
      const pk = getPublicKey(sk);
      const nsec = nip19.nsecEncode(sk);

      // Create NIP-60 wallet metadata event (kind 17375)
      const walletMetadataEvent = {
        kind: 17375,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ...mints.map((mint) => ["mint", mint]),
          ...relays.map((relay) => ["relay", relay]),
        ],
        content: "",
        pubkey: pk,
      };

      // Create NIP-60 wallet backup event (kind 375)
      const walletBackupEvent = {
        kind: 375,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["k", "17375"], // Reference to NIP-60 wallet metadata kind
          ...mints.map((mint) => ["mint", mint]),
        ],
        content: "", // Content could include encrypted backup data in future implementations
        pubkey: pk,
      };

      // Create NIP-61 P2PK metadata event (kind 10019)
      const p2pkMetadataEvent = {
        kind: 10019,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["k", "17375"], // Reference to NIP-60 wallet kind
          ...mints.map((mint) => ["mint", mint]),
        ],
        content: JSON.stringify({
          pubkey: pk,
          mints: mints,
        }),
        pubkey: pk,
      };

      // Sign and broadcast events
      const signedWalletMetadata = finalizeEvent(walletMetadataEvent, sk);
      const signedWalletBackup = finalizeEvent(walletBackupEvent, sk);
      const signedP2PKMetadata = finalizeEvent(p2pkMetadataEvent, sk);

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

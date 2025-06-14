import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { getNut11Mints } from "./nut11.ts";
import { copyTextToClipboard, debounce, delay } from "./utils.ts";
import {
  DEFAULT_RELAYS,
  pool,
  getUserRelays,
  getWalletAndInfo,
} from "./nostr.ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import toastr from "toastr";
import { handleCashuDonation } from "./cashu-donate.js";

// DOM ready
jQuery(function ($) {
  // Init vars
  let userPubkey = "";
  let userRelays = "";
  let privkeys = [];
  let mintUrls = [];
  let mints = [];
  let relays = [];
  let kind = null;

  // DOM elements
  const $form = $("#nip60-wallet-form");
  const $preamble = $(".preamble");
  const $success = $("#nip60-wallet-success");
  const $getWallet = $("#open-wallet");
  const $mintSelect = $("#mint-select");
  const $mints = $("#mints");
  const $relays = $("#relays");
  const $getRelays = $("#get-relays");
  const $createWarning = $("#create-warning");
  const $createWallet = $("#create-wallet");
  const $liveKey = $("#live-key");
  const $oldKeys = $("#old-keys");
  const $copyNsec = $("#copy-nsec");
  const $copyHex = $("#copy-hex");
  const $donateCashu = $("#donate_cashu");
  const $rotateKeys = $("#rotate-keys");

  // Donation input
  $donateCashu.on("paste", () => {
    setTimeout(async () => {
      handleCashuDonation($donateCashu.val(), "Cashu Redeem Donation");
      $donateCashu.val("");
    }, 200);
    console.log("donation");
  });

  // Page handlers
  function showForm() {
    $form.show();
    $success.hide();
  }

  function showSuccess() {
    $form.hide();
    $success.show();
    $preamble.hide();
  }

  // Fetch existing wallet
  $getWallet.on("click", async () => {
    try {
      toastr.info("Fetching your NIP-60 Wallet");
      if (!userPubkey) {
        userPubkey = await window.nostr.getPublicKey();
      }
      if (!userRelays) {
        userRelays = await getUserRelays(userPubkey);
      }
      ({ mints, relays, privkeys, kind } = await getWalletAndInfo(
        userPubkey,
        userRelays,
      ));
      if (privkeys.length > 0) {
        toastr.success("Wallet loaded");
        $rotateKeys.prop("disabled", false);
        if (37375 == kind) {
          toastr.warning(
            "You have a legacy kind:37375 wallet. Saving will upgrade it!",
          );
        }
      } else {
        toastr.error("Wallet could not be loaded, or does not exist.");
      }
      if (mints.length > 0) {
        $mints.val(mints.join("\n") + "\n");
        validateMints();
      }
      if (relays.length > 0) {
        $relays.val(relays.join("\n") + "\n");
        validateRelays();
      }
      // Update button, remove warning
      $createWarning.hide();
      $createWallet.text("Update Wallet");
    } catch (e) {
      toastr.error(
        "Failed to fetch wallet. Ensure you have a NIP-07 signer extension active.",
      );
      console.error(e);
    }
  });

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
    $mints.val(mints.join("\n") + "\n");
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
    $relays.val(relays.join("\n") + "\n");
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
      if (!userPubkey) {
        userPubkey = await window.nostr.getPublicKey();
      }
      const relayUrls = await getUserRelays(userPubkey);
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
      let sk;
      let pk;
      try {
        if (privkeys.length && !$rotateKeys.is(":checked")) {
          sk = hexToBytes(privkeys[0]); // Use existing
          pk = getPublicKey(sk); // hex string
          console.log("Using existing private key");
        } else throw "New needed";
      } catch (e) {
        console.log("Generating new private key");
        sk = generateSecretKey();
        pk = getPublicKey(sk); // hex string
        privkeys = [bytesToHex(sk), ...privkeys];
      }

      // Get user Pubkey if needed
      if (!userPubkey) {
        userPubkey = await window.nostr.getPublicKey();
      }

      // Create NIP-60 encrypted wallet
      toastr.info("Creating your NIP-60 encrypted wallet");
      await delay(2000); // give them time to read the notice
      const data = JSON.stringify([
        // ["privkey", bytesToHex(sk)],
        // keep multiple keys for now...
        ...privkeys.map((key) => ["privkey", key]),
        ...mints.map((mint) => ["mint", mint]),
      ]);
      console.log(data);
      const enc_data = await window.nostr.nip44.encrypt(userPubkey, data);

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
      const signedWalletMetadata =
        await window.nostr.signEvent(walletMetadataEvent);
      toastr.info("Signing a backup of your NIP-60 encrypted wallet");
      await delay(2000); // give them time to read the notice
      const signedWalletBackup =
        await window.nostr.signEvent(walletBackupEvent);
      toastr.info("Signing your NIP-61 Nutzap informational event");
      await delay(2000); // give them time to read the notice
      const signedP2PKMetadata =
        await window.nostr.signEvent(p2pkMetadataEvent);

      toastr.info("Publishing your wallet");
      await Promise.all([
        pool.publish(relays, signedWalletMetadata),
        pool.publish(relays, signedWalletBackup),
        pool.publish(relays, signedP2PKMetadata),
      ]);

      // Display success
      const nsecs = privkeys
        .map((key) => nip19.nsecEncode(hexToBytes(key)))
        .filter(Boolean);
      $liveKey.val(nsecs[0]); // First key
      $oldKeys.val(nsecs.slice(1).join("\n")); // Remaining keys
      showSuccess();
      $copyNsec.on("click", () => {
        copyTextToClipboard(nsecs.join("\n")); // Copies all keys
      });
      $copyHex.on("click", () => {
        copyTextToClipboard(privkeys.join("\n")); // Copies all keys in hex
      });

      toastr.success(
        "Successfully published your NIP-60 wallet, backup wallet and NIP-61 Nutzap info",
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

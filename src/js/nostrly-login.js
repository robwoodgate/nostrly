import {
  nip19,
  nip98,
  finalizeEvent,
  getPublicKey,
  SimplePool,
  verifyEvent,
} from "nostr-tools";

// Create pool and set relays
const pool = new SimplePool();
const relays = nostrly_ajax.relays;

// Ready scope
jQuery(function ($) {
  // Login button click
  $("#use_nostr_extension").on("click", doNostrLogin);
  async function doNostrLogin(e) {
    e.preventDefault();
    try {
      // Check for extension
      if (typeof window.nostr === "undefined") {
        console.error("Nostr extension not found:", error);
        alert("Nostr extension not found. Please install a Nostr extension.");
      }

      // Create signed authtoken event
      let authToken; // scope outside try/catch
      try {
        authToken = await window.nostr.signEvent({
          kind: 27235,
          tags: [
            ["u", nostrly_ajax.ajax_url],
            ["method", "post"],
          ],
          created_at: Math.round(new Date().getTime() / 1e3),
          content: "",
        }); // Use Nostr API to sign
        if (!authToken) throw new Error("Signing failed or was cancelled.");
        console.log("authtoken:", authToken);
      } catch (error) {
        console.error("Failed to create authtoken:", error);
        alert("Failed to create authtoken.");
        return;
      }

      // Fetch profile for authtoken's pubkey
      $("#use_nostr_extension").text("Logging in...");
      let usermeta = await getProfileFromPubkey(authToken.pubkey); // JSON string
      console.log("User metadata:", JSON.parse(usermeta.content));

      // Send login request to WordPress
      $.ajax({
        url: nostrly_ajax.ajax_url,
        type: "POST",
        data: {
          action: "nostrly_login",
          authtoken: JSON.stringify(authToken),
          metadata: usermeta.content,
          nonce: nostrly_ajax.nonce,
        },
        success: function (response) {
          if (response.success) {
            window.location.href = response.data.redirect;
          } else {
            alert(response.data.message);
          }
        },
        error: function () {
          alert("An error occurred. Please try again.");
          $("#use_nostr_extension").text(
            $("#use_nostr_extension").attr("data-orig"),
          );
        },
      });
    } catch (error) {
      console.error("Nostr login error:", error);
      throw error;
    }
  }

  async function handleNostrSync(e) {
    e.preventDefault();
    const $feedback = $("#nostr-connect-feedback");
    const $button = $(e.target);
    const synctype = $button.attr("id");

    try {
      // Disable button and show loading state
      $button.prop("disabled", true);
      $feedback
        .removeClass("notice-error notice-success")
        .addClass("notice-info")
        .html("Connecting to Nostr...")
        .show();

      // Fetch profile for user's pubkey
      let pubkey = await window.nostr.getPublicKey();
      $feedback.html("Fetching Nostr profile...");

      // Fetch profile with explicit error handling
      let usermeta = await getProfileFromPubkey(pubkey);
      if (typeof usermeta?.content === "undefined") {
        console.warn("No profile data found, proceeding with public key only");
        usermeta = { content: JSON.stringify({ pubkey: pubkey }) };
        $feedback.html("No profile data found, updating public key only...");
      } else {
        $feedback.html("Updating profile...");
        console.log("User metadata:", JSON.parse(usermeta.content));
      }

      // Send to WordPress
      // NB: nostr_sync_profile is a privileged endpoint so no auth needed
      let metadata = JSON.parse(usermeta.content);
      console.log("Sending metadata to WordPress:", metadata);
      const response = await $.ajax({
        url: nostrly_ajax.ajax_url,
        type: "POST",
        data: {
          action: "nostr_sync_profile",
          metadata: usermeta.content,
          nonce: nostrly_ajax.nonce,
        },
      });

      if (response.success) {
        $feedback
          .removeClass("notice-info")
          .addClass("notice-success")
          .html("Successfully synced Nostr data!")
          .delay(3000)
          .fadeOut("slow");

        // Update displayed values
        $("#nostr_public_key").val(metadata.npub);
        $("#description").val(metadata.about || "");
        $("#nostr_nip05").val(metadata.nip05 || "");
        $("#_lnp_ln_address").val(metadata.lud16 || "");
        $(".user-profile-picture img").attr({
          src: metadata.picture,
          srcset: metadata.picture,
        });
        if ("nostr-connect-extension" == synctype) {
          // Reload page to update buttons
          setTimeout(() => location.reload(), 1500);
        }
      } else {
        throw new Error(response.data.message || "Failed to update profile");
      }
    } catch (error) {
      console.error("Sync error:", error);
      $feedback
        .removeClass("notice-info")
        .addClass("notice-error")
        .html(`Error: ${error.message}`)
        .delay(3000)
        .fadeOut("slow");
    } finally {
      $button.prop("disabled", false);
    }
  }

  async function handleUpdateNip05(e) {
    e.preventDefault();
    const $feedback = $("#nostr-connect-feedback");
    const $button = $(e.target);
    const nip05 = e.target.getAttribute("data-nip05") || "";
    try {
      // Disable button and show loading state
      $button.prop("disabled", true);
      $feedback
        .removeClass("notice-error notice-success")
        .addClass("notice-info")
        .html("Updating NIP-05 identifier...")
        .show();

      // Get user profile metadata
      $feedback.html("Fetching Nostr profile data...");
      let pubkey = await window.nostr.getPublicKey();
      let usermeta = await getProfileFromPubkey(pubkey);
      if (typeof usermeta?.content === "undefined") {
        throw new Error("Failed to get profile from relays.");
      }

      let metadata;
      try {
        // Update NIP-05
        metadata = JSON.parse(usermeta.content);
        metadata.nip05 = nip05;

        // Metadata update event (kind:0)
        const event = await window.nostr.signEvent({
          kind: 0,
          created_at: Math.round(new Date().getTime() / 1e3),
          content: JSON.stringify(metadata),
          tags: [],
        });
        console.log("event:>>", event);
        // Publish to at least one relay
        await Promise.any(pool.publish(relays, event));
      } catch (error) {
        console.error("Failed to set NIP-05 identifier:", error);
        throw new Error("Failed to set NIP-05 identifier!");
      }

      // Send to WordPress
      // NB: nostr_sync_profile is a privileged endpoint so no auth needed
      console.log("Sending metadata to WordPress:", metadata);
      $feedback.html("Resyncing Nostr profile...");
      const response = await $.ajax({
        url: nostrly_ajax.ajax_url,
        type: "POST",
        data: {
          action: "nostr_sync_profile",
          metadata: JSON.stringify(metadata),
          nonce: nostrly_ajax.nonce,
        },
      });

      if (response.success) {
        $feedback
          .removeClass("notice-info")
          .addClass("notice-success")
          .html("Successfully set NIP-05!")
          .delay(3000)
          .fadeOut("slow");

        // Update displayed values
        $("#nostr_public_key").val(metadata.npub);
        $("#description").val(metadata.about || "");
        $("#nostr_nip05").val(metadata.nip05 || "");
        $("#_lnp_ln_address").val(metadata.lud16 || "");
        $(".user-profile-picture img").attr({
          src: metadata.picture,
          srcset: metadata.picture,
        });
      } else {
        throw new Error(response.data.message || "Failed to update profile");
      }
    } catch (error) {
      console.error("Update NIP-05 error:", error);
      $feedback
        .removeClass("notice-info")
        .addClass("notice-error")
        .html(`Error: ${error.message}`)
        .delay(3000)
        .fadeOut("slow");
    } finally {
      $button.prop("disabled", false);
    }
  }

  async function handleNostrDisconnect(e) {
    e.preventDefault();
    const $feedback = $("#nostr-connect-feedback");
    const $button = $(e.target);
    const $user = e.target.getAttribute("data-user");

    try {
      // Disable button and show loading state
      $button.prop("disabled", true);
      $feedback
        .removeClass("notice-error notice-success")
        .addClass("notice-info")
        .html("Disconnecting Nostr")
        .show();

      // Send to WordPress
      const response = await $.ajax({
        url: nostrly_ajax.ajax_url,
        type: "POST",
        data: {
          action: "nostr_disconnect",
          nonce: nostrly_ajax.nonce,
          user: $user,
        },
      });

      if (response.success) {
        $feedback
          .removeClass("notice-info")
          .addClass("notice-success")
          .html("Successfully disconnected Nostr")
          .delay(3000)
          .fadeOut("slow");

        // Update displayed values
        $("#nostr_public_key").val("");
        $("#nostr_nip05").val("");

        // Reload page to update buttons
        setTimeout(() => location.reload(), 1500);
      } else {
        throw new Error(
          response.data.message ||
            "Failed to disconnect Nostr. Please try again.",
        );
      }
    } catch (error) {
      console.error("Disconnect error:", error);
      $feedback
        .removeClass("notice-info")
        .addClass("notice-error")
        .html(`Error: ${error.message}`)
        .delay(3000)
        .fadeOut("slow");
    } finally {
      $button.prop("disabled", false);
    }
  }

  // Query for the profile event (kind:0)
  async function getProfileFromPubkey(pubkey) {
    try {
      // Query for the profile event (kind:0)
      return await pool.get(relays, {
        kinds: [0],
        authors: [pubkey],
      });
    } catch (error) {
      console.error("Error fetching or parsing profile:", error);
      return null;
    }
  }

  // Add event listener
  $(document).ready(function () {
    console.log("Nostrly script loaded"); // Debug log

    const $connectButton = $("#nostr-connect-extension");
    const $resyncButton = $("#nostr-resync-extension");
    const $disconnectButton = $("#nostr-disconnect");

    if ($connectButton.length || $resyncButton.length) {
      console.log("Found Nostr connect/resync buttons"); // Debug log
    }

    $("#nostr-connect-extension, #nostr-resync-extension").on(
      "click",
      function (e) {
        console.log("Nostr sync button clicked"); // Debug log
        handleNostrSync(e);
      },
    );
    $("#nostr-disconnect").on("click", function (e) {
      console.log("Nostr disconnect button clicked"); // Debug log
      handleNostrDisconnect(e);
    });
    $("#nostr-set-nip05").on("click", function (e) {
      console.log("Nostr NIP-05 button clicked"); // Debug log
      handleUpdateNip05(e);
    });
  });
});

import NDK from "@nostr-dev-kit/ndk";
import { NDKEvent, NDKKind, NDKNip07Signer, NDKUser } from "@nostr-dev-kit/ndk";
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19, nip98 } from "nostr-tools";

(function ($) {
  $(document).ready(function () {

    const TIMEOUT_DURATION = 15000; // 15 seconds timeout
    const signer = new NDKNip07Signer();
    window.ndk = new NDK({
      explicitRelayUrls: [
        "wss://purplepag.es",
        "wss://relay.nostr.band",
        "wss://relay.primal.net",
        "wss://relay.damus.io",
        "wss://relay.snort.social",
        "wss://nostr.bitcoiner.social"

        // Add more relay URLs as needed
      ],
    });

    var $loginForm = $("#loginform");
    var $nostrToggle = $("#nostrly_toggle");
    var $nostrField = $(".nostrly-field");
    var $nostrButtons = $(".nostrly-buttons");
    var $submitButton = $("#nostr-wp-submit"); // Changed from "#wp-submit"
    var $useExtensionButton = $("#use_nostr_extension");
    var $originalSubmitButton = $("#wp-submit"); // Add this line to keep a reference to the original submit button
    var $originalFields = $loginForm
      .children()
      .not(".nostrly-container, .nostrly-field, .nostrly-buttons")
      .detach();

    // Apply initial styles
    applyToggleStyles();

    function applyToggleStyles() {
      var $toggleContainer = $nostrToggle.closest(".nostrly-container");
      $toggleContainer.css({
        "margin-bottom": "20px",
        position: "relative",
        display: "flex",
        "align-items": "center",
      });

      $nostrToggle.css({
        opacity: "0",
        width: "0",
        height: "0",
        position: "absolute",
      });

      var $slider = $('<span class="nostr-toggle-slider"></span>');
      $slider.css({
        position: "relative",
        cursor: "pointer",
        width: "60px",
        height: "34px",
        "background-color": "#ccc",
        transition: ".4s",
        "border-radius": "34px",
        display: "inline-block",
        "margin-right": "10px",
      });

      $slider.append(
        $("<span></span>").css({
          position: "absolute",
          content: '""',
          height: "26px",
          width: "26px",
          left: "4px",
          bottom: "4px",
          "background-color": "white",
          transition: ".4s",
          "border-radius": "50%",
        })
      );

      $nostrToggle.after($slider);

      $toggleContainer.find(".nostr-toggle-label span").css({
        "vertical-align": "middle",
      });
    }

    function updateToggleState() {
      var isChecked = $nostrToggle.prop("checked");
      $nostrToggle
        .next(".nostr-toggle-slider")
        .css("background-color", isChecked ? "#2196F3" : "#ccc");
      $nostrToggle
        .next(".nostr-toggle-slider")
        .find("span")
        .css("transform", isChecked ? "translateX(26px)" : "none");
    }

    function toggleNostrLogin() {
      var isNostrLogin = $nostrToggle.prop("checked");
      // console.log("Nostr login " + (isNostrLogin ? "enabled" : "disabled"));

      $loginForm
        .children()
        .not(".nostrly-container, .nostrly-field, .nostrly-buttons")
        .remove();

      if (isNostrLogin) {
        $nostrField.show();
        $nostrButtons.show();
        $loginForm.off("submit").on("submit", handleNostrSubmit);
      } else {
        $nostrField.hide();
        $nostrButtons.hide();
        $loginForm.append($originalFields.clone());
        $submitButton.val("Log In");
        $loginForm.off("submit");
      }

      updateToggleState();
    }

    $nostrToggle.on("change", toggleNostrLogin);
    $useExtensionButton.on("click", handleNostrExtension);

    // Initial setup
    toggleNostrLogin();

    function uint8ArrayToHex(uint8Array) {
      return Array.from(uint8Array)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    async function handleNostrSubmit(e) {
      e.preventDefault();
      let privateKey = $("#nostr_private_key").val();

      try {
        if (privateKey.startsWith("nsec")) {
          try {
            const { type, data } = nip19.decode(privateKey);
            if (type === "nsec") {
              privateKey = uint8ArrayToHex(data);
            } else {
              throw new Error("Invalid nsec key");
            }
          } catch (error) {
            // console.error("Error decoding nsec key:", error);
            alert(
              "Invalid nsec key format. Please check your private key and try again."
            );
            return;
          }
        }

        if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
          throw new Error("Invalid private key format");
        }

        await performNostrLogin(privateKey);
      } catch (error) {
        // console.error("Nostr login error:", error);
        alert(
          "Failed to log in with Nostr. Please check your private key and try again."
        );
      }
    }

    async function handleNostrExtension(e) {
      e.preventDefault();

      try {
        await performNostrLogin();
      } catch (error) {
        // console.error("Nostr extension error:", error);
        alert(
          "Failed to use Nostr extension. Please make sure you have a compatible extension installed and try again."
        );
      }
    }

    async function performNostrLogin(privateKey = null) {
      try {
        // Check for extension if privateKey not provided
        if (!privateKey && typeof window.nostr === 'undefined') {
            console.error("Nostr extension not found:", error);
            alert('Nostr extension not found. Please install a Nostr extension.');
        }

        // Get user public key from private key or NIP-07 user
        var publicKey;
        if (privateKey) {
          publicKey = getPublicKey(privateKey);
        } else {
          let user = await signer.user(); // NDKUser
          if (!user || !user.pubkey) {
              throw new Error('Failed to get public key from extension.');
          }
          publicKey = user.pubkey;
        }
        console.log("user pubkey:", publicKey);

        // Ensure NDK is connected
        try {
            await ndk.connect();
            console.log("connected to relays", ndk);
        } catch (error) {
            throw new Error('Failed to connect to relays. Please try again.');
        }

        // Fetch profile with explicit error handling
        let usermeta = await ndk.fetchEvent({ kinds: [0], authors: [publicKey]});
        if (typeof usermeta?.content === 'undefined') {
          console.warn('No profile data found, proceeding with public key only');
          usermeta = {content: JSON.stringify({pubkey: publicKey})};
        }

        // Get user metadata
        let metadata = JSON.parse(usermeta.content);
        console.log("stored user metadata:", metadata);

        // Create signed authtoken event
        try {
          const _sign = (privateKey) ? (e) => finalizeEvent(e, privateKey) : (e) => window.nostr.signEvent(e);
          var authToken = await nip98.getToken(nostrly_ajax.ajax_url, 'post', _sign);
          // console.log("authtoken:", authToken);
        } catch (error) {
          console.error("Failed to create authtoken:", error);
          alert("Failed to create authtoken.");
          return;
        }

        // Send login request to WordPress
        $.ajax({
          url: nostrly_ajax.ajax_url,
          type: "POST",
          data: {
            action: "nostrly_login",
            authtoken: authToken,
            metadata: JSON.stringify(metadata),
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
          },
        });
      } catch (error) {
        console.error("Nostr login error:", error);
        throw error;
      }
    }

    async function handleNostrSync(e) {
        e.preventDefault();
        const $feedback = $('#nostr-connect-feedback');
        const $button = $(e.target);
        const synctype = $button.attr('id');

        try {
            // Disable button and show loading state
            $button.prop('disabled', true);
            $feedback.removeClass('notice-error notice-success').addClass('notice-info')
                .html('Connecting to Nostr...').show();

            // Get NIP-07 user
            var user = await signer.user(); // NDKUser
            if (!user || !user.pubkey) {
                throw new Error('Failed to get public key from extension.');
            }

            // Update feedback
            $feedback.html('Connecting to relays...');

            // Ensure NDK is connected
            try {
                await ndk.connect();
                console.log("connected to relays", ndk);
            } catch (error) {
                throw new Error('Failed to connect to relays. Please try again.');
            }

            $feedback.html('Fetching Nostr profile...');

            // Fetch profile with explicit error handling
            let usermeta = await ndk.fetchEvent({ kinds: [0], authors: [user.pubkey]});
            if (typeof usermeta?.content === 'undefined') {
              console.warn('No profile data found, proceeding with public key only');
              usermeta = {content: JSON.stringify({pubkey: user.pubkey})};
              $feedback.html('No profile data found, updating public key only...');
            } else {
              $feedback.html('Updating profile...');
            }

            // Send to WordPress
            let metadata = JSON.parse(usermeta.content);
            console.log('Sending metadata to WordPress:', metadata);
            const response = await $.ajax({
                url: nostrly_ajax.ajax_url,
                type: 'POST',
                data: {
                    action: 'nostr_sync_profile',
                    metadata: usermeta.content,
                    nonce: nostrly_ajax.nonce
                }
            });

            if (response.success) {
              $feedback.removeClass('notice-info')
                .addClass('notice-success')
                .html('Successfully synced Nostr data!')
                .delay(3000).fadeOut('slow');

              // Update displayed values
              $('#nostr_public_key').val(user.npub);
              $('#nostr_nip05').val(metadata.nip05 || '');
              $('.user-profile-picture img').attr({"src":metadata.picture,"srcset":metadata.picture});
              if ('nostr-connect-extension' == synctype) {
                // Reload page to update buttons
                setTimeout(() => location.reload(), 1500);
              }
            } else {
                throw new Error(response.data.message || 'Failed to update profile');
            }
        } catch (error) {
            console.error('Sync error:', error);
            $feedback.removeClass('notice-info')
              .addClass('notice-error')
              .html(`Error: ${error.message}`)
              .delay(3000).fadeOut('slow');;
        } finally {
            $button.prop('disabled', false);
        }
    }

    async function handleUpdateNip05(e) {
      e.preventDefault();
      const $feedback = $('#nostr-connect-feedback');
      const $button = $(e.target);
      const nip05 = e.target.getAttribute("data-nip05") || '';
      try {
        // Disable button and show loading state
        $button.prop('disabled', true);
        $feedback.removeClass('notice-error notice-success').addClass('notice-info')
            .html('Updating NIP-05 identifier...').show();

        // Get NIP-07 user
        var user = await signer.user(); // NDKUser
        if (!user || !user.pubkey) {
            throw new Error('Failed to get public key from extension.');
        }

        // Update feedback
        $feedback.html('Connecting to Nostr relays...');

        // Ensure NDK is connected
        try {
            await ndk.connect();
            console.log("connected to relays", ndk);
        } catch (error) {
            throw new Error('Failed to connect to relays. Please try again.');
        }

        // Get user profile metadata
        $feedback.html('Fetching Nostr profile data...');
        let usermeta = await ndk.fetchEvent({ kinds: [0], authors: [user.pubkey]});
        if (typeof usermeta?.content === 'undefined') {
          throw new Error('Failed to get profile from relays.');
        }

        try {
          // Update NIP-05
          var metadata = JSON.parse(usermeta.content);
          metadata.nip05 = nip05;
          const update = new NDKEvent(ndk, {kind: NDKKind.Metadata});
          update.content = JSON.stringify(metadata);
          console.log("Unsigned update", update.rawEvent());
          $feedback.html('Updating Nostr Profile...');
          await update.sign(signer);
          await update.publish();
        } catch (error) {
          console.error("Failed to set NIP-05 identifier:", error);
          throw new Error('Failed to set NIP-05 identifier!');
        }

        // Send to WordPress
        console.log('Sending metadata to WordPress:', metadata);
        $feedback.html('Resyncing Nostr profile...');
        const response = await $.ajax({
            url: nostrly_ajax.ajax_url,
            type: 'POST',
            data: {
                action: 'nostr_sync_profile',
                metadata: JSON.stringify(metadata),
                nonce: nostrly_ajax.nonce
            }
        });

        if (response.success) {
          $feedback.removeClass('notice-info')
            .addClass('notice-success')
            .html('Successfully set NIP-05!')
            .delay(3000).fadeOut('slow');;

          // Update displayed values
          $('#nostr_public_key').val(user.npub);
          $('#nostr_nip05').val(metadata.nip05 || '');
          $('.user-profile-picture img').attr({"src":metadata.picture,"srcset":metadata.picture});
        } else {
            throw new Error(response.data.message || 'Failed to update profile');
        }

      } catch (error) {
          console.error('Update NIP-05 error:', error);
          $feedback.removeClass('notice-info')
            .addClass('notice-error')
            .html(`Error: ${error.message}`)
            .delay(3000).fadeOut('slow');;
      } finally {
          $button.prop('disabled', false);
      }
    }

    async function handleNostrDisconnect(e) {
        e.preventDefault();
        const $feedback = $('#nostr-connect-feedback');
        const $button = $(e.target);
        const $user = e.target.getAttribute("data-user");

        try {
            // Disable button and show loading state
            $button.prop('disabled', true);
            $feedback.removeClass('notice-error notice-success').addClass('notice-info')
                .html('Disconnecting Nostr').show();

            // Send to WordPress
            const response = await $.ajax({
                url: nostrly_ajax.ajax_url,
                type: 'POST',
                data: {
                    action: 'nostr_disconnect',
                    nonce: nostrly_ajax.nonce,
                    user: $user
                }
            });

            if (response.success) {
                $feedback.removeClass('notice-info')
                  .addClass('notice-success')
                  .html('Successfully disconnected Nostr')
                  .delay(3000).fadeOut('slow');

                // Update displayed values
                $('#nostr_public_key').val('');
                $('#nostr_nip05').val('');

                // Reload page to update buttons
                setTimeout(() => location.reload(), 1500);
            } else {
                throw new Error(response.data.message || 'Failed to disconnect Nostr. Please try again.');
            }
        } catch (error) {
            console.error('Disconnect error:', error);
            $feedback.removeClass('notice-info')
              .addClass('notice-error')
              .html(`Error: ${error.message}`)
              .delay(3000).fadeOut('slow');;
        } finally {
            $button.prop('disabled', false);
        }
    }

    // Add event listener
    $(document).ready(function() {
        console.log('Nostrly script loaded'); // Debug log

        const $connectButton = $('#nostr-connect-extension');
        const $resyncButton = $('#nostr-resync-extension');
        const $disconnectButton = $('#nostr-disconnect');

        if ($connectButton.length || $resyncButton.length) {
            console.log('Found Nostr connect/resync buttons'); // Debug log
        }

        $('#nostr-connect-extension, #nostr-resync-extension').on('click', function(e) {
            console.log('Nostr sync button clicked'); // Debug log
            handleNostrSync(e);
        });
        $('#nostr-disconnect').on('click', function(e) {
            console.log('Nostr disconnect button clicked'); // Debug log
            handleNostrDisconnect(e);
        });
        $('#nostr-set-nip05').on('click', function(e) {
            console.log('Nostr NIP-05 button clicked'); // Debug log
            handleUpdateNip05(e);
        });
    });
  });
})(jQuery);

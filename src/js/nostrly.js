import NDK from "@nostr-dev-kit/ndk";
import { finalizeEvent, verifyEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19, nip98 } from "nostr-tools";

(function ($) {
  $(document).ready(function () {
    // console.log("Nostr login script loaded");

    const TIMEOUT_DURATION = 15000; // 15 seconds timeout

    let ndk = new NDK({
      explicitRelayUrls: [
        "wss://purplepag.es",
        "wss://relay.nostr.band",
        "wss://relay.primal.net",
        "wss://relay.damus.io",
        "wss://nostr.wine",
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
            console.error("Nostr extension not found.:", error);
            alert('Nostr extension not found. Please install a Nostr extension.');
        }

        // Get user publicKey from private key or NOSTR extension
        let publicKey = (privateKey) ? getPublicKey(privateKey) : await window.nostr.getPublicKey();
        console.log("user pubkey:", publicKey);

        // Connect to relays with timeout
        const connectPromise = ndk.connect();
        const connectTimeout = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Connection to relays timed out")),
            TIMEOUT_DURATION
          )
        );

        try {
          await Promise.race([connectPromise, connectTimeout]);
          console.log("connected to relays", ndk);
        } catch (error) {
          console.error("Failed to connect to relays:", error);
          alert("Failed to connect to Nostr relays. Please try again later.");
          return;
        }

        // Create user object with the public key and signer if available
        let user = ndk.getUser({ pubkey: publicKey });
        console.log("set user:", user);

        // Fetch user profile with timeout
        const fetchProfilePromise = user.fetchProfile();
        const fetchProfileTimeout = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Fetching user profile timed out")),
            TIMEOUT_DURATION
          )
        );

        try {
          await Promise.race([fetchProfilePromise, fetchProfileTimeout]);
        } catch (error) {
          console.error("Failed to fetch user profile:", error);
          alert(
            "Failed to fetch user profile from Nostr. Proceeding with login using available information."
          );
        }

        // Get user metadata
        const metadata = user.profile || {};
        console.log("stored user metadata:", metadata);

        // Create signed authtoken event
        try {
          const _sign = (privateKey) ? (e) => finalizeEvent(e, privateKey) : (e) => window.nostr.signEvent(e);
          var authToken = await nip98.getToken(nostrly_ajax.ajax_url, 'post', _sign);
          console.log("authtoken:", authToken);
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

        try {
            // Disable button and show loading state
            $button.prop('disabled', true);
            $feedback.removeClass('notice-error notice-success').addClass('notice-info')
                .html('Connecting to Nostr...').show();

            // Check for extension
            if (typeof window.nostr === 'undefined') {
                throw new Error('Nostr extension not found. Please install a Nostr extension.');
            }

            // Get user publicKey from NOSTR extension
            let publicKey = await window.nostr.getPublicKey();
            console.log("user pubkey:", publicKey);
            if (!publicKey) {
                throw new Error('Failed to get public key from extension.');
            }

            // Update feedback
            $feedback.html('Connecting to relays...');

            // Ensure NDK is connected
            if (!ndk.connected) {
                try {
                    await ndk.connect();
                    console.log("connected to relays", ndk);
                } catch (error) {
                    throw new Error('Failed to connect to relays. Please try again.');
                }
            }

            $feedback.html('Fetching Nostr profile...');

            // Create NDK user and fetch profile with explicit error handling
            const ndkUser = ndk.getUser({ pubkey: publicKey });

            try {
                // Set a timeout for profile fetching
                const profilePromise = ndkUser.fetchProfile();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Profile fetch timeout')), 15000)
                );

                await Promise.race([profilePromise, timeoutPromise]);

                if (!ndkUser.profile) {
                    console.warn('No profile data found, proceeding with public key only');
                }
            } catch (error) {
                console.warn('Profile fetch failed:', error);
                // Continue with just the public key if profile fetch fails
            }

            // Prepare metadata with at least the public key
            const metadata = {
                public_key: publicKey,
                nip05: ndkUser.profile?.nip05 || '',
                image: ndkUser.profile?.image || ''
            };

            console.log('Sending metadata to WordPress:', metadata);

            $feedback.html('Updating profile...');

            // Send to WordPress
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
                $feedback.removeClass('notice-info').addClass('notice-success')
                    .html('Successfully synced Nostr data!');

                // Update displayed values
                $('#nostr-public-key').val(metadata.public_key);
                $('#nostr-nip05').val(metadata.nip05);

                // Refresh page if avatar updated
                if (metadata.image) {
                    setTimeout(() => location.reload(), 1500);
                }
            } else {
                throw new Error(response.data.message || 'Failed to update profile');
            }
        } catch (error) {
            console.error('Sync error:', error);
            $feedback.removeClass('notice-info').addClass('notice-error')
                .html(`Error: ${error.message}`);
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
                $feedback.removeClass('notice-info').addClass('notice-success')
                    .html('Successfully disconnected Nostr');

                // Update displayed values
                $('#nostr-public-key').val('');
                $('#nostr-nip05').val('');
                setTimeout(() => location.reload(), 1500);
            } else {
                throw new Error(response.data.message || 'Failed to disconnect Nostr. Please try again.');
            }
        } catch (error) {
            console.error('Disconnect error:', error);
            $feedback.removeClass('notice-info').addClass('notice-error')
                .html(`Error: ${error.message}`);
        } finally {
            $button.prop('disabled', false);
        }
    }

    // Add event listener
    $(document).ready(function() {
        console.log('Nostr login script loaded'); // Debug log

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
    });
  });
})(jQuery);

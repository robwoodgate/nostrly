
// Imports
// import NDK from "@nostr-dev-kit/ndk";
import { NDKNip07Signer } from "@nostr-dev-kit/ndk";
// import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19'

jQuery(function($) {

    let stage = 0;
    let firstNameEntry = true;
    let timeout;
    let price = 0;
    let valid = { name: false, pubkey: false };
    let currentAjax = null;

    const config = nostrly_ajax.domain;
    const $username = $("#reg-username");
    const $status = $("#reg-status");
    const $pubkey = $("#reg-pubkey");
    const $nextButton = $("#register-next");
    const $warning = $("#pubkey-warning");
    const $error = $("#reg-error");
    const $errorText = $("#reg-errortext");
    const $nip07Button = $("#use-nip07");

    function initStage0() {
        setupEventListeners();
        checkUrlParams();
    }

    function setupEventListeners() {
        $username.on("input", handleUsernameInput);
        $pubkey.on("input", validatePk);
        $nextButton.on("click", handleNextButtonClick);
        $nip07Button.on("click", useNip07);

        if ($username.val()) handleUsernameInput();
        if ($pubkey.val()) validatePk();
    }

    function checkUrlParams() {
        if (window.URLSearchParams) {
            const params = new URLSearchParams(location.search);
            if (params.has("n")) {
                $username.val(params.get("n"));
                updateNameStatus();
            }
        }
    }

    function handleUsernameInput() {
        if (stage !== 0) return;
        const sanitizedValue = $username.val().toLowerCase().replace(new RegExp("[^a-z0-9]", "g"), "");
        $username.val(sanitizedValue);
        updateNameStatus();
    }

    function validatePk() {
        if (stage !== 0) return;
        const sanitizedPk = $pubkey.val().trim().toLowerCase();

        let isValid = false;
        let hexWarn = false;
        try {
            // Convert hex key to npub
            if (/^[0-9a-f]{64}$/.test(sanitizedPk)) {
                $pubkey.val(nip19.npubEncode(sanitizedPk));
                hexWarn = true;
            }
            // Validate npub
            if (sanitizedPk.startsWith('npub1')) {
                const { type, data } = nip19.decode(sanitizedPk);
                if (type === 'npub' && data.length === 64) {
                    isValid = true;
                }
            }
        } catch (error) {
            console.error("Validation error:", error);
        }
        $pubkey.attr("data-valid", isValid ? "yes" : "no");
        valid.pubkey = isValid;
        $warning.css("display", hexWarn ? "inline-block" : "");
        updateValidity();
    }

    function updateNameStatus() {
        if (stage !== 0) return;
        $status.attr("data-available", "loading").text("loading...");
        valid.name = false;
        updateValidity();
        clearTimeout(timeout);
        if (!$username.val()) {
            $status.text("type in a name to see info...");
            return;
        }
        timeout = setTimeout(fetchAvailability, 200);
    }

    function fetchAvailability() {
        // Abort current request
        if (currentAjax) {
            currentAjax.abort();
        }

        // No need to lookup names that are too short
        if ($username.val().length < $username.attr("minLength")) {
            $status.attr("data-available", "no").text("✖ name is too short (min 2 chars)");
            return;
        }
        // Send availability request to WordPress
        currentAjax = $.ajax({
            url: nostrly_ajax.ajax_url,
            method: "POST",
            data: {
              action: "nostrly_regcheck",
              nonce: nostrly_ajax.nonce,
              name: $username.val()
            },
            success: handleAvailabilityResponse,
            error: function(xhr, status, error) {
                // Only handle errors if the request wasn't aborted
                if (status !== 'abort') {
                    handleAvailabilityError(error);
                }
            }
        });
    }

    function handleAvailabilityResponse(res) {
        console.log('Reg Check: ', res.data);
        if (res.data.available) {
            valid.name = true;
            updateValidity();
            $status.attr("data-available", "yes").text(`✔ name is available for ${shorten(res.data.price)} sats`);
            price = res.data.price;
            return;
        }
        $status.attr("data-available", "no").text(`✖ ${res.data.reason}`);
        firstNameEntry = false;
    }

    function handleAvailabilityError(e) {
        $status.attr("data-available", "no").text("✖ server error, try reloading");
        console.error(e.stack);
        firstNameEntry = false;
    }

    function handleNextButtonClick(e) {
        if ($nextButton.prop("disabled") || stage !== 0) return;
        disableUI();
        performCheckout();
    }

    function disableUI() {
        $nextButton.prop("disabled", true).text("loading...");
        $pubkey.prop("disabled", true);
        $username.prop("disabled", true);
    }

    function performCheckout() {
        let pk = $pubkey.val().trim();
        if (pk.startsWith('npub1')) {
            pk = nip19.decode(pk).data;
        }

        $.ajax({
            url: nostrly_ajax.ajax_url,
            method: "POST",
            data: {
              action: "nostrly_checkout",
              nonce: nostrly_ajax.nonce,
              name: $username.val(),
              pubkey: pk
            },
            success: handleCheckoutResponse,
            error: handleCheckoutError
        });
    }

    function handleCheckoutResponse(res) {
        if (res.error) {
            displayError(`error ${res.error}. please contact us`);
        } else {
            try {
                const data = [res.data, `${$username.val()}@${config.name}`, res.data.price, Date.now() + (8 * 60 * 60 * 1000)];
                localStorage.setItem("register-state", JSON.stringify(data));
            } catch {}
            initStage1(res.data, `${$username.val()}@${config.name}`, res.data.price);
        }
    }

    function handleCheckoutError(e) {
        displayError(`${e.toString()}\n please contact us`);
        console.log(e.stack);
    }

    function displayError(message) {
        $error.css("display", "");
        $errorText.text(message);
    }

    function shorten(amount) {
        return amount < 1000 ? amount.toString() : `${(amount / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}k`;
    }

    function updateValidity() {
        const isValid = Object.values(valid).every(Boolean);
        $nextButton.prop("disabled", !isValid);
    }

    async function useNip07() {
        try {
            const signer = new NDKNip07Signer();
            const user = await signer.user(); // NDKUser
            if (user && user.npub) {
                $pubkey.val(user.npub);
                validatePk();
            } else {
                throw new Error("Could not fetch public key from NIP-07 signer.");
            }
        } catch (error) {
            displayError(`NIP-07 Error: ${error.message}`);
            console.error(error);
        }
    }

    function initStage1(data, name, price) {
        const { token, invoice, paymentHash, img } = data;

        // Manage stages visibility
        $("#stage0").hide();
        $("#stage1").show();

        // Set up UI elements
        $("#invoice-link").attr("href", `lightning:${invoice}`);
        $("#registering-name, #registering-name-2").text(name);
        $("#phash").text(paymentHash);
        $("#invoice-img").attr("src", img);

        // Copy invoice to clipboard
        setupCopyButton("#invoice-copy", invoice);

        // Cancel registration
        $("#cancel-registration").on("click", () => {
            try { localStorage.removeItem("register-state"); } catch {}
            location.reload();
        });

        let done = false;
        const checkPayment = () => {
            $.ajax({
                url: nostrly_ajax.ajax_url,
                method: "POST",
                data: {
                  action: "nostrly_pmtcheck",
                  nonce: nostrly_ajax.nonce,
                  token: token
                },
                success: handlePaymentCheckResponse,
                error: (e) => console.error("Payment Check Error:", e.stack)
            });
        };

        const handlePaymentCheckResponse = (res) => {
            if (!res.available && !res.error && !done) {
                done = true;
                transitionToStage("stage3", interval);
            } else if (res.paid && !done) {
                done = true;
                handlePaymentSuccess(res);
            }
        };

        const handlePaymentSuccess = (res) => {
            try { localStorage.removeItem("register-state"); } catch {}
            transitionToStage("stage2", interval);
            $("#password").text(res.password);
            setupCopyButton("#password-copy", res.password);
            try { localStorage.setItem("login-password", res.password); } catch {}
        };

        // Helper to manage stage transitions
        const transitionToStage = (stage, intervalToClear) => {
            $("#stage1").hide();
            $(`#${stage}`).show();
            clearInterval(intervalToClear);
        };

        // Helper to set up copy buttons
        const setupCopyButton = (selector, text) => {
            $(selector).on("click", function() {
                copyTextToClipboard(text);
                const $button = $(this);
                $button.text("copied!");
                setTimeout(() => $button.text("copy"), 1000);
            });
        };

        // Set up periodic check
        const interval = setInterval(checkPayment, 5000);

        // Check payment status when window regains focus
        $(window).on("focus", () => !done && checkPayment());
    }

    function copyTextToClipboard(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).catch(e => console.error('Failed to copy: ', e));
        }
    }

    function start() {
        let rs
        try {
            rs = localStorage.getItem("register-state")
        } catch { }
        if (rs) {
            let item = JSON.parse(rs)
            if (item[3] < Date.now()) {
                initStage0()
            } else {
                initStage1(...item)
            }
        } else {
            initStage0()
        }
    }
    start();
});

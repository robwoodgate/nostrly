// Imports
import { NDKNip07Signer } from "@nostr-dev-kit/ndk";
import * as nip19 from 'nostr-tools/nip19';

jQuery(function($) {
    const domain = nostrly_ajax.domain;
    let stage = 0;
    let firstNameEntry = true;
    let timeout;
    let price = 0;
    let valid = { name: false, pubkey: false };
    let currentAjax = null;

    // DOM elements
    const $username = $("#reg-username");
    const $status = $("#reg-status");
    const $pubkey = $("#reg-pubkey");
    const $nextButton = $("#register-next");
    const $warning = $("#pubkey-warning");
    const $error = $("#reg-error");
    const $errorText = $("#reg-errortext");
    const $nip07Button = $("#use-nip07");

    // Initialization
    function initialize() {
        setupEventListeners();
        checkUrlParams();
        startRegistrationProcess();
    }

    // Event listeners setup
    function setupEventListeners() {
        $username.on("input", handleUsernameInput);
        $pubkey.on("input", validatePk);
        $nextButton.on("click", handleNextButtonClick);
        $nip07Button.on("click", useNip07);

        if ($username.val()) handleUsernameInput();
        if ($pubkey.val()) validatePk();
    }

    // Check for URL parameters
    function checkUrlParams() {
        if (window.URLSearchParams) {
            const params = new URLSearchParams(location.search);
            if (params.has("n")) {
                $username.val(params.get("n"));
                updateNameStatus();
            }
        }
    }

    // Start the registration process based on localStorage state
    function startRegistrationProcess() {
        let registerState;
        try {
            registerState = localStorage.getItem("nostrly-order");
        } catch {}

        if (registerState) {
            const item = JSON.parse(registerState);
            if (item[3] > Date.now()) {
                console.log('Continuing registration session');
                initPaymentProcessing(...item);
            } else {
                try { localStorage.removeItem("nostrly-order") } catch { }
                console.log('Registration session expired');
            }
        }
    }

    // Handle username input
    function handleUsernameInput() {
        if (stage !== 0) return;
        const sanitizedValue = $username.val().toLowerCase().replace(/[^a-z0-9]/g, '');
        $username.val(sanitizedValue);
        updateNameStatus();
    }

    // Validate public key
    function validatePk() {
        if (stage !== 0) return;
        const sanitizedPk = $pubkey.val().trim().toLowerCase();
        let isValid = false;
        let hexWarn = false;

        try {
            if (/^[0-9a-f]{64}$/.test(sanitizedPk)) {
                $pubkey.val(nip19.npubEncode(sanitizedPk));
                hexWarn = true;
            }
            if (sanitizedPk.startsWith('npub1')) {
                const { type, data } = nip19.decode(sanitizedPk);
                isValid = type === 'npub' && data.length === 32;
            }
        } catch (error) {
            console.error("Public Key Validation Error:", error);
        }

        valid.pubkey = isValid;
        $pubkey.attr("data-valid", isValid ? "yes" : "no");
        $warning.css("display", hexWarn ? "inline-block" : "");
        updateValidity();
    }

    // Update name status
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

    // Fetch name availability from server
    function fetchAvailability() {
        if (currentAjax) currentAjax.abort();
        if ($username.val().length < $username.attr("minLength")) {
            $status.attr("data-available", "no").text("✖ name is too short (min 2 chars)");
            return;
        }

        currentAjax = $.ajax({
            url: nostrly_ajax.ajax_url,
            method: "POST",
            data: {
                action: "nostrly_usrcheck",
                nonce: nostrly_ajax.nonce,
                name: $username.val()
            },
            success: handleAvailabilityResponse,
            error: function(xhr, status, error) {
                if (status !== 'abort') handleAvailabilityError(error);
            }
        });
    }

    // Handle server response for name availability
    function handleAvailabilityResponse(res) {
        console.log('Reg Check:', res.data);
        if (res.data.available) {
            valid.name = true;
            updateValidity();
            $status.attr("data-available", "yes").text(`✔ name is available for ${shorten(res.data.price)} sats`);
            price = res.data.price;
        } else {
            $status.attr("data-available", "no").text(`✖ ${res.data.reason}`);
            firstNameEntry = false;
        }
    }

    // Handle errors in name availability check
    function handleAvailabilityError(e) {
        $status.attr("data-available", "no").text("✖ server error, please try refreshing the page");
        console.error(e.stack);
        firstNameEntry = false;
    }

    // Handle button click for proceeding to checkout
    function handleNextButtonClick(e) {
        if ($nextButton.prop("disabled") || stage !== 0) return;
        disableUI();
        performCheckout();
    }

    // Disable UI elements
    function disableUI() {
        $nextButton.prop("disabled", true).text("loading...");
        $pubkey.prop("disabled", true);
        $username.prop("disabled", true);
    }

    // Perform checkout process
    function performCheckout() {
        let pk = $pubkey.val().trim();
        if (pk.startsWith('npub1')) pk = nip19.decode(pk).data;

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

    // Handle checkout response
    function handleCheckoutResponse(res) {
        if (!res.success) {
            displayError(`error: ${res.data.message}. please contact us`);
        } else {
            try {
                const data = [res.data, `${$username.val()}@${domain}`, res.data.amount, Date.now() + (10 * 60 * 1000)];
                localStorage.setItem("nostrly-order", JSON.stringify(data));
            } catch {}
            initPaymentProcessing(res.data, `${$username.val()}@${domain}`, res.data.amount);
        }
    }

    // Handle checkout errors
    function handleCheckoutError(e) {
        displayError(`${e.toString()}\n please contact us`);
        console.log(e.stack);
    }

    // Display error messages
    function displayError(message) {
        $error.css("display", "");
        $errorText.text(message);
    }

    // Shorten large numbers
    function shorten(amount) {
        return amount < 1000 ? amount.toString() : `${(amount / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}k`;
    }

    // Update UI validity
    function updateValidity() {
        const isValid = Object.values(valid).every(Boolean);
        $nextButton.prop("disabled", !isValid);
    }

    // Use NIP-07 to fetch public key
    async function useNip07() {
        try {
            const signer = new NDKNip07Signer();
            const user = await signer.user();
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

    // Initialize stage 1 for payment processing
    function initPaymentProcessing(data, name, price) {
        const img = 'https://quickchart.io/chart?cht=qr&chs=200x200&chl='+data.payment_request;
        console.log(data);
        $("#pick-name").hide();
        $("#pay-invoice").show();

        $("#invoice-link").attr("href", `lightning:${data.payment_request}`);
        $("#name-to-register").text(name);
        $("#amount-to-pay").text(shorten(data.amount)+' sats');
        $("#phash").text(data.token);
        $("#invoice-img").attr("src", img);

        setupCopyButton("#invoice-copy", data.payment_request);
        setupCancelButton();

        let done = false;
        const interval = setInterval(checkPaymentStatus, 10000);

        $(window).on("focus", () => !done && checkPaymentStatus());

        function checkPaymentStatus() {
            $.ajax({
                url: nostrly_ajax.ajax_url,
                method: "POST",
                data: {
                    action: "nostrly_pmtcheck",
                    nonce: nostrly_ajax.nonce,
                    token: token
                },
                success: handlePaymentResponse,
                error: (e) => console.error("Payment Check Error:", e.stack)
            });
        }

        function handlePaymentResponse(res) {
            clearInterval(interval);
            $("#pick-name").hide();
            if (!res.data.available && !res.success && !done) {
                done = true;
                $("#pay-invoice").hide();
                $("#payment-failed").show();
            } else if (res.data.paid && !done) {
                done = true;
                try { localStorage.removeItem("nostrly-order"); } catch {}
                $("#payment-failed").hide();
                $("#pay-invoice").show();
                $("#password").text(res.password);
                setupCopyButton("#password-copy", res.password);
                try { localStorage.setItem("login-password", res.password); } catch {}
            }
        }

        function setupCopyButton(selector, text) {
            $(selector).on("click", function() {
                navigator.clipboard.writeText(text).catch(e => console.error('Failed to copy:', e));
                $(this).text("copied!");
                setTimeout(() => $(this).text("copy"), 1000);
            });
        }

        function setupCancelButton() {
            $("#cancel-registration").on("click", () => {
                try { localStorage.removeItem("nostrly-order"); } catch {}
                location.reload();
            });
        }
    }

    // Initial call to start the application
    initialize();
});

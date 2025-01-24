
// Imports
// import NDK from "@nostr-dev-kit/ndk";
import { NDKEvent, NDKKind, NDKNip07Signer, NDKUser } from "@nostr-dev-kit/ndk";
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19'

jQuery(function($) {
    const nip05Config = {
        domains: [{
            name: "nostrly.com",
            regex: ["^[a-z0-9]+$", ""],
            regexChars: ["[^a-z0-9]", "g"],
            length: [2, 20],
            default: true
        }]
    };

    let stage = 0;
    let firstNameEntry = true;
    let timeout;
    let price = 0;
    let activeDomain;
    let valid = { name: false, pubkey: false };
    const whyMap = {
        TOO_SHORT: "name too short",
        TOO_LONG: "name too long",
        REGEX: "name has disallowed characters",
        REGISTERED: "name is registered",
        DISALLOWED_null: "name is blocked",
        DISALLOWED_later: "name may be available later",
    };

    const $username = $("#reg-username");
    const $status = $("#reg-status");
    const $pubkey = $("#reg-pubkey");
    const $nextButton = $("#register-next");
    const $warning = $("#pubkey-warning");
    const $error = $("#reg-error");
    const $errorText = $("#reg-errortext");
    const $nip07Button = $("#use-nip07");

    function initStage0() {
        applyConfig();
        setupEventListeners();
        checkUrlParams();
    }

    function applyConfig() {
        const config = nip05Config.domains.find(el => el.name === 'nostrly.com');
        $username.attr({ minLength: config.length[0], maxLength: config.length[1] });
        activeDomain = config;
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
        const sanitizedValue = $username.val().toLowerCase().replace(new RegExp(activeDomain.regexChars[0], activeDomain.regexChars[1]), "");
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

    function handleNextButtonClick(e) {
        if ($nextButton.prop("disabled") || stage !== 0) return;
        disableUI();
        performRegistration();
    }

    function disableUI() {
        $nextButton.prop("disabled", true).text("loading...");
        $pubkey.prop("disabled", true);
        $username.prop("disabled", true);
    }

    function performRegistration() {
        let pk = $pubkey.val().trim();
        if (pk.startsWith('npub1')) {
            pk = nip19.decode(pk).data;
        }

        $.ajax({
            url: "/api/v1/registration/register",
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ domain: activeDomain.name, name: $username.val(), pk: pk }),
            success: handleRegistrationResponse,
            error: handleRegistrationError
        });
    }

    function handleRegistrationResponse(res) {
        if (res.error) {
            displayError(`error ${res.error}. please contact @semisol.dev`);
        } else {
            try {
                const data = [res, `${$username.val()}@${activeDomain.name}`, res.quote.price, Date.now() + (8 * 60 * 60 * 1000)];
                localStorage.setItem("register-state", JSON.stringify(data));
            } catch {}
            initStage1(res, `${$username.val()}@${activeDomain.name}`, res.quote.price);
        }
    }

    function handleRegistrationError(e) {
        displayError(`${e.toString()}\n please contact @semisol.dev`);
        console.log(e.stack);
    }

    function displayError(message) {
        $error.css("display", "");
        $errorText.text(message);
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
        if ($username.val().length < $username.attr("minLength")) {
            $status.attr("data-available", "no").text("✖ name too short");
            return;
        }
        // Send availability request to WordPress
        $.ajax({
            url: nostrly_ajax.ajax_url,
            method: "POST",
            data: {
              action: "nostrly_regcheck",
              nonce: nostrly_ajax.nonce,
              domain: activeDomain.name,
              name: $username.val()
            },
            success: handleAvailabilityResponse,
            error: handleAvailabilityError
        });
    }

    function handleAvailabilityResponse(res) {
        if (!res.data.available) {
            $status.attr("data-available", "no").text(`✖ ${res.data.why}`);
            firstNameEntry = false;
        } else {
            valid.name = true;
            updateValidity();
            const status = $username.val().length < 4 ? "premium" : "yes";
            $status.attr("data-available", status).text(`✔ for ${shorten(res.data.price)} sats`);
            price = res.data.price;
        }
    }

    function handleAvailabilityError(e) {
        $status.attr("data-available", "no").text("✖ server error, try reloading");
        console.error(e.stack);
        firstNameEntry = false;
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

    initStage0();
});

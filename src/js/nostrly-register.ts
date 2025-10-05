// Imports
import { nip19 } from "nostr-tools";
import { copyTextToClipboard, doConfettiBomb, getErrorMessage } from "./utils";

declare const nostrly_ajax: {
  relays: string[];
  ajax_url: string;
  nonce: string;
  domain: string;
};

type WpAjaxResponse<T = any> = { success: boolean; data: T };

type AvailablityResponse = {
  available: boolean;
  name: string;
  length: number;
  price: string;
  reason?: string; // errors
};

type CheckoutResponse = {
  amount: number;
  token: string;
  payment_request: string;
  payment_hash: string;
  message?: string; // errors
};

type PaymentResponse = {
  paid: boolean;
  password: string;
  message?: string; // errors
};

type SavedOrder = {
  data: CheckoutResponse;
  name: string;
  date: number;
};

jQuery(function ($) {
  const domain = nostrly_ajax.domain;
  let stage = 0; // used to disable listener functions
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let valid = { name: false, pubkey: false };
  let currentAjax: JQuery.jqXHR | null = null;

  // DOM elements
  const $username = $("#reg-username");
  const $status = $("#reg-status");
  const $pubkey = $("#reg-pubkey");
  const $nextButton = $("#register-next");
  const $warning = $("#pubkey-warning");
  const $errorText = $("#reg-errortext");
  const $nip07Button = $("#use-nip07");

  // Initialization
  function initialize() {
    if (!window.nostrlyInitialized) {
      setupEventListeners();
      checkUrlParams();
      startRegistrationProcess();
      window.nostrlyInitialized = true;
    }
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
      const params: URLSearchParams = new URLSearchParams(location.search);
      if (params.has("n")) {
        $username.val(params.get("n") as string);
        updateNameStatus();
      }
    }
  }

  // Start the registration process based on localStorage state
  function startRegistrationProcess() {
    let savedOrder: string | null = null;
    try {
      savedOrder = localStorage.getItem("nostrly-order");
    } catch (e) {}

    if (savedOrder) {
      const item: SavedOrder = JSON.parse(savedOrder);
      if (item.date > Date.now()) {
        console.log("Continuing registration session");
        initPaymentProcessing(item.data, item.name);
      } else {
        try {
          localStorage.removeItem("nostrly-order");
        } catch (e) {}
        console.log("Registration session expired");
      }
    }
  }

  // Handle username input
  function handleUsernameInput() {
    if (stage !== 0) return;
    const sanitizedValue = ($username.val() as string)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    $username.val(sanitizedValue);
    updateNameStatus();
  }

  // Validate public key
  function validatePk() {
    if (stage !== 0) return;
    const sanitizedPk = ($pubkey.val() as string).trim().toLowerCase();
    let isValid = false;
    let hexWarn = false;

    try {
      if (/^[0-9a-f]{64}$/.test(sanitizedPk)) {
        $pubkey.val(nip19.npubEncode(sanitizedPk));
        hexWarn = true;
        isValid = true;
      }
      if (sanitizedPk.startsWith("npub1")) {
        const { type, data } = nip19.decode(sanitizedPk);
        isValid = type === "npub" && data.length === 64;
      }
    } catch (error) {
      console.error("Public Key Validation Error:", error);
    }

    valid.pubkey = isValid;
    if ($pubkey.val()) {
      $pubkey.attr("data-valid", isValid ? "yes" : "no");
    } else {
      $pubkey.attr("data-valid", "");
    }
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
      $status.text("type a name to see availability and pricing...");
      $username.attr("data-valid", "");
      return;
    }
    timeout = setTimeout(fetchAvailability, 200);
  }

  // Fetch name availability from server
  function fetchAvailability() {
    if (currentAjax) currentAjax.abort();
    const name = String($username.val() ?? "");
    const minLength = parseInt($username.attr("minLength") ?? "0", 10);
    if (name.length < minLength) {
      $username.attr("data-valid", "no");
      $status
        .attr("data-available", "no")
        .text("✖ name is too short (min 2 chars)");
      return;
    }

    currentAjax = $.ajax({
      url: nostrly_ajax.ajax_url,
      method: "POST",
      data: {
        action: "nostrly_usrcheck",
        nonce: nostrly_ajax.nonce,
        name: $username.val(),
      },
      success: handleAvailabilityResponse,
      error: function (_xhr, status, error) {
        if (status !== "abort") handleAvailabilityError(error);
      },
    });
  }

  // Handle server response for name availability
  function handleAvailabilityResponse(
    res: WpAjaxResponse<AvailablityResponse>,
  ) {
    console.log("Reg Check:", res.data);
    if (res.data.available) {
      valid.name = true;
      updateValidity();
      $username.attr("data-valid", "yes");
      $status
        .attr("data-available", "yes")
        .text(
          `✔ name is available for ${shorten(parseInt(res.data.price))} sats`,
        );
    } else {
      $username.attr("data-valid", "no");
      $status.attr("data-available", "no").text(`✖ ${res.data.reason}`);
    }
  }

  // Handle errors in name availability check
  function handleAvailabilityError(e: unknown) {
    $status
      .attr("data-available", "no")
      .text("✖ server error, please try refreshing the page");
    console.error(e);
  }

  // Handle button click for proceeding to checkout
  function handleNextButtonClick(_e: JQuery.ClickEvent) {
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
  async function performCheckout(): Promise<void> {
    let pk: string = ($pubkey.val() as string).trim();
    if (pk.startsWith("npub1")) {
      const decoded: nip19.DecodeResult = nip19.decode(pk);
      if (decoded.type === "npub") {
        pk = decoded.data;
      }
    } else {
      toastr.error("Could not decode pubkey.");
      throw new Error("Could not decode pubkey.");
    }

    try {
      const response = await $.ajax({
        url: nostrly_ajax.ajax_url,
        method: "POST",
        data: {
          action: "nostrly_checkout",
          nonce: nostrly_ajax.nonce,
          name: $username.val() ?? "",
          pubkey: pk,
        },
        dataType: "json", // Ensure JSON response
      });

      // Handle response inline or via separate functions
      handleCheckoutResponse(response);
    } catch (error) {
      handleCheckoutError(error);
    }
  }

  // Handle checkout response
  function handleCheckoutResponse(res: WpAjaxResponse<CheckoutResponse>): void {
    if (!res.success && res.data.message) {
      displayError(`Error: ${res.data.message}.`);
    } else {
      try {
        const data: SavedOrder = {
          data: res.data,
          name: String($username.val() ?? ""),
          date: Date.now() + 10 * 60 * 1000,
        };
        localStorage.setItem("nostrly-order", JSON.stringify(data));
      } catch {}
      initPaymentProcessing(res.data, String($username.val() ?? ""));
    }
  }

  // Handle checkout errors
  function handleCheckoutError(e: unknown): void {
    const msg = getErrorMessage(e);
    displayError(`${msg.toString()}\n Please contact us`);
    console.log(e);
  }

  // Display error messages
  function displayError(message: string) {
    $errorText.text(message).show();
    setTimeout(function () {
      $errorText.fadeOut("slow", function () {
        $errorText.text("");
      });
      $pubkey.prop("disabled", false);
      $username.prop("disabled", false);
      updateValidity();
    }, 7000);
  }

  // Shorten large numbers
  function shorten(amount: number) {
    return amount < 100000
      ? amount.toString()
      : `${(amount / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}k`;
  }

  // Update UI validity
  function updateValidity() {
    const isValid = Object.values(valid).every(Boolean);
    $nextButton.prop("disabled", !isValid);
    $nextButton.text($nextButton.attr("data-orig") as string);
  }

  // Use NIP-07 to fetch public key
  async function useNip07() {
    if (stage !== 0) return;
    // Check for extension
    if (typeof window?.nostr?.getPublicKey === "undefined") {
      toastr.error("NIP-07 Extension not found");
      throw new Error("NIP-07 Extension not found");
    }
    try {
      const pubkey = await window?.nostr?.getPublicKey();
      if (pubkey) {
        $pubkey.val(nip19.npubEncode(pubkey));
        validatePk();
      } else {
        throw new Error("Could not fetch public key from NIP-07 signer.");
      }
    } catch (e) {
      const msg = getErrorMessage(e);
      displayError(`Error: ${msg}`);
      console.error(e);
    }
  }

  // Initialize stage 1 for payment processing
  function initPaymentProcessing(data: CheckoutResponse, name: string) {
    stage = 1;
    const img =
      "https://quickchart.io/chart?cht=qr&chs=200x200&chl=" +
      data.payment_request;
    console.log(data);
    $(".preamble").hide();
    $("#pick-name").hide();
    $("#pay-invoice").show();

    $("#invoice-link").attr("href", `lightning:${data.payment_request}`);
    $("#cashu-link").attr(
      "href",
      `/cashu-redeem/?autopay=1&ln=${data.payment_request}`,
    );
    $("#name-to-register, #name-registered").text(`${name}@${domain}`);
    $("#amount-to-pay").text(shorten(data.amount as number) + " sats");
    $("#payment-hash").val(data.payment_hash);
    $("#invoice-img").attr("src", img);

    setupCopyButton("#invoice-copy", data.payment_request);
    setupCopyTextArea("#payment-hash");
    setupCancelButton();

    let done = false;
    function checkPaymentStatus() {
      if (done) return;
      $.ajax({
        url: nostrly_ajax.ajax_url,
        method: "POST",
        data: {
          action: "nostrly_pmtcheck",
          nonce: nostrly_ajax.nonce,
          token: data.token,
          name: name,
        },
        success: handlePaymentResponse,
        error: (e) => console.error("Payment Check Error:", e),
      }).always(() => {
        if (!done) {
          setTimeout(checkPaymentStatus, 5000); // poll every 5 seconds unless done
        }
      });
    }
    checkPaymentStatus(); // kick it off immediately

    function handlePaymentResponse(res: WpAjaxResponse<PaymentResponse>) {
      // $(".preamble").hide();
      // $("#pick-name").hide();
      console.log(res);
      if (!res.success && res.data.message) {
        done = true;
        $("#pick-name").show();
        $("#pay-invoice").hide();
        displayError(`Error: ${res.data.message}.`);
      }
      if (res.success && res.data.paid && !done) {
        done = true;
        try {
          localStorage.removeItem("nostrly-order");
        } catch (e) {}
        $("#payment-suceeded").show();
        $("#pay-invoice").hide();
        $("#nip05-password").val(res.data.password);
        doConfettiBomb();
        setupCopyButton("#password-button", res.data.password);
      }
    }

    function setupCopyButton(selector: string, text: string) {
      $(selector).on("click", function () {
        copyTextToClipboard(text);
      });
    }

    function setupCopyTextArea(selector: string): void {
      $(selector).on({
        click(this: HTMLInputElement | HTMLTextAreaElement) {
          this.select();
          copyTextToClipboard(this.value);
        },
      });
    }

    function setupCancelButton() {
      $("#cancel-registration").on("click", () => {
        try {
          localStorage.removeItem("nostrly-order");
        } catch (e) {}
        location.reload();
      });
    }
  }

  // Initial call to start the application
  initialize();
});

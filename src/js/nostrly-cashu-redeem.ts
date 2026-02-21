// Imports
import {
  getDecodedToken,
  getEncodedTokenV4,
  getP2PKLockState,
  getP2PKLocktime,
  getP2PKNSigs,
  getP2PKNSigsRefund,
  getP2PKWitnessPubkeys,
  getP2PKWitnessRefundkeys,
  hasP2PKSignedProof,
  verifyP2PKSpendingConditions,
  verifyP2PKSig,
  Wallet,
  Proof,
  signP2PKProofs,
} from "@cashu/cashu-ts";
import {
  debounce,
  doConfettiBomb,
  getWalletWithUnit,
  formatAmount,
  getSatsAmount,
  getTokenAmount,
  getErrorMessage,
} from "./utils";
import {
  convertP2PKToNpub,
  getContactDetails,
  signNip60Proofs,
  signWithNip07,
} from "./nostr";
import { nip19 } from "nostr-tools";
import bech32 from "bech32";
import { decode as emojiDecode } from "./emoji-encoder";
import { handleCashuDonation } from "./cashu-donate";
import { bytesToHex } from "@noble/hashes/utils";

declare const nostrly_ajax: {
  relays: string[];
};

// Cashu Redeem
jQuery(function ($) {
  // Init vars
  let wallet: Wallet | undefined;
  let mintUrl: string;
  let unit: string = "sat";
  let proofs: Proof[];
  let tokenAmount: number;
  let params = new URL(document.location.href).searchParams;
  let autopay = decodeURIComponent(params.get("autopay") ?? "");

  // DOM elements
  const $lnurl = $("#lnurl");
  const $token = $("#token");
  const $tokenStatus = $("#tokenStatus");
  const $lightningStatus = $("#lightningStatus");
  const $pkey = $("#pkey");
  const $pkeyWrapper = $("#pkeyWrapper");
  const $tokenRemover = $("#tokenRemover");
  const $lnurlRemover = $("#lnurlRemover");
  const $redeemButton = $("#redeem");
  const $donateCashu = $("#donate_cashu");

  // Donation input
  $donateCashu.on("paste", () => {
    setTimeout(async () => {
      handleCashuDonation(
        $donateCashu.val() as string,
        "Cashu Redeem Donation",
      );
      $donateCashu.val("");
    }, 200);
    console.log("donation");
  });

  // Reset vars
  const resetVars = function () {
    wallet = undefined;
    mintUrl = "";
    unit = "sat";
    proofs = [];
    tokenAmount = 0;
    $tokenStatus.text("");
    $lightningStatus.text("");
    $tokenRemover.addClass("hidden");
    $pkeyWrapper.hide();
    $pkey.val("");
    $redeemButton.prop("disabled", true);
  };

  // Helpers to get invoice from Lightning address | LN URL
  const isLnurl = (address: string) =>
    address.split("@").length === 2 ||
    address.toLowerCase().startsWith("lnurl1");
  const getInvoiceFromLnurl = async (address = "", amount = 0) => {
    try {
      if (!address) throw "Error: address is required!";
      if (!amount) throw "Error: amount is required!";
      if (!isLnurl(address)) throw "Error: invalid address";
      let data = {
        tag: "",
        minSendable: 0,
        maxSendable: 0,
        callback: "",
        pr: "",
      };
      if (address.split("@").length === 2) {
        const [user, host] = address.split("@");
        const response = await fetch(
          `https://${host}/.well-known/lnurlp/${user}`,
        );
        if (!response.ok) throw "Unable to reach host";
        const json = await response.json();
        data = json;
      } else {
        const dataPart = bech32.decode(address, 20000).words;
        const requestByteArray = bech32.fromWords(dataPart);
        const host = new TextDecoder().decode(new Uint8Array(requestByteArray));
        const response = await fetch(host);
        if (!response.ok) throw "Unable to reach host";
        const json = await response.json();
        data = json;
      }
      if (
        data.tag == "payRequest" &&
        data.minSendable <= amount * 1000 &&
        amount * 1000 <= data.maxSendable
      ) {
        const response = await fetch(
          `${data.callback}?amount=${amount * 1000}`,
        );
        if (!response.ok) throw "Unable to reach host";
        const json = await response.json();
        console.log("pr:>>", json.pr);
        return json.pr ?? new Error("Unable to get invoice");
      } else throw "Host unable to make a lightning invoice for this amount.";
    } catch (e) {
      console.error(e);
      return "";
    }
  };

  // Helper to process the Cashu Token
  const processToken = async (event?: JQuery.Event) => {
    if (event) event.preventDefault();
    resetVars();
    $tokenRemover.removeClass("hidden");
    $tokenStatus.text("Checking token, one moment please...");
    try {
      let tokenEncoded = $token.val() as string;
      if (!tokenEncoded) {
        return;
      }
      // Decode emoji if needed
      if (!tokenEncoded.startsWith("cashu")) {
        const decoded = emojiDecode(tokenEncoded);
        if (decoded) {
          tokenEncoded = decoded;
          $token.val(decoded);
        }
      }
      // Decode token
      const token = getDecodedToken(tokenEncoded);
      console.log("token :>> ", token);
      if (!token.proofs.length || !token.mint.length) {
        throw "Token format invalid";
      }
      // Extract token data, open wallet
      mintUrl = token.mint;
      unit = token.unit ?? "sat";
      wallet = await getWalletWithUnit(mintUrl, unit); // Load wallet
      proofs = token.proofs ?? [];
      console.log("proofs :>>", proofs);
      // Check proofs are not spent
      const { unspent } = await wallet.groupProofsByState(proofs);
      console.log("unspentProofs :>>", unspent);
      // All proofs spent?
      if (!unspent.length) {
        // Is this our saved token? If so, remove it
        const lstoken = localStorage.getItem("nostrly-cashu-token");
        if (lstoken == ($token.val() as string)) {
          localStorage.removeItem("nostrly-cashu-token");
        }
        throw "Token already spent";
      }
      // Token partially spent - so update token
      if (unspent.length != proofs.length) {
        $token.val(
          getEncodedTokenV4({
            mint: mintUrl,
            unit: unit,
            proofs: unspent,
          }),
        );
        proofs = unspent;
        $lightningStatus.text(
          "(Partially spent token detected - new token generated)",
        );
      }
      tokenAmount = getTokenAmount(proofs);
      // Check if proofs are P2PK locked
      const lockedProofs = proofs.filter(function (k) {
        return k.secret.includes("P2PK");
      });
      const hasP2BK = proofs.some((p) => p?.p2pk_e);
      if (lockedProofs.length) {
        // they are... so inspect all spending pathways
        console.log("P2PK locked proofs found:>>", lockedProofs);
        const proof = lockedProofs[0];
        const locktime = getP2PKLocktime(proof.secret);
        const lockState = getP2PKLockState(proof.secret);
        const mainPubkeys = getP2PKWitnessPubkeys(proof.secret);
        const refundPubkeys = getP2PKWitnessRefundkeys(proof.secret);
        const mainRequiredSigners = getP2PKNSigs(proof.secret);
        const refundRequiredSigners = getP2PKNSigsRefund(proof.secret);
        const verification = verifyP2PKSpendingConditions(proof);
        const refundPathActive =
          lockState === "EXPIRED" && refundPubkeys.length > 0;

        const getSignedKeys = (keys: string[]): string[] => {
          return keys.filter((pubkey) => hasP2PKSignedProof(pubkey, proof));
        };

        const mainSignedPubkeys = getSignedKeys(mainPubkeys);
        const refundSignedPubkeys = getSignedKeys(refundPubkeys);
        const mainRemaining = Math.max(
          mainRequiredSigners - mainSignedPubkeys.length,
          0,
        );
        const refundRemaining = Math.max(
          refundRequiredSigners - refundSignedPubkeys.length,
          0,
        );

        const updateContactName = (
          id: string,
          npub: string,
          p2pkey: string,
          relays: string[],
        ) => {
          getContactDetails(npub, relays).then(({ name, hexpub }) => {
            if (name) {
              const nip61 = hexpub != p2pkey.slice(2) ? "(NIP-61)" : "(NPUB)";
              $(`#${id}`).replaceWith(
                `<a href="https://njump.me/${npub}" target="_blank">${name}</a> ${nip61}`,
              );
            } else if (hasP2BK) {
              $(`#${id}`).append(" (P2BK)");
            }
          });
        };

        const mainKeyholders: string[] = [];
        for (const pub of mainPubkeys) {
          const npub = convertP2PKToNpub(pub);
          const keyId = `main-${npub}`;
          mainKeyholders.push(
            `<span id="${keyId}">${pub.slice(0, 12)}...${pub.slice(-12)}</span>`,
          );
          updateContactName(keyId, npub, pub, nostrly_ajax.relays);
        }

        const refundKeyholders: string[] = [];
        for (const pub of refundPubkeys) {
          const npub = convertP2PKToNpub(pub);
          const keyId = `refund-${npub}`;
          refundKeyholders.push(
            `<span id="${keyId}">${pub.slice(0, 12)}...${pub.slice(-12)}</span>`,
          );
          updateContactName(keyId, npub, pub, nostrly_ajax.relays);
        }

        const lines: string[] = [];
        lines.push(`Token is P2PK locked`);
        lines.push(
          `Locktime MultiSig: ${mainSignedPubkeys.length}/${mainRequiredSigners} signatures (${mainPubkeys.length} eligible)`,
        );

        if (lockState === "PERMANENT") {
          lines.push("Locktime: permanently locked (no expiry)");
        } else if (lockState === "ACTIVE") {
          lines.push(
            `Locktime: active until ${new Date(locktime * 1000).toLocaleString().slice(0, -3)}`,
          );
        } else {
          lines.push("Locktime: expired");
        }

        if (mainKeyholders.length) {
          lines.push(`Locktime Pubkeys: ${mainKeyholders.join(", ")}`);
        }

        if (refundPubkeys.length) {
          if (refundPathActive) {
            lines.push(
              `Refund MultiSig: active (${refundSignedPubkeys.length}/${refundRequiredSigners} signatures, ${refundPubkeys.length} eligible)`,
            );
          } else {
            lines.push(
              "Refund MultiSig: configured, becomes active after locktime expiry",
            );
          }
          lines.push(`Refund Pubkeys: ${refundKeyholders.join(", ")}`);
        } else if (lockState === "EXPIRED" && mainRequiredSigners === 0) {
          lines.push(
            "Unlocked: locktime expired and no refund keys (anyone can spend)",
          );
        }

        if (verification.success) {
          if (refundPathActive && mainRemaining === 0) {
            lines.push(
              "Spendable now. Locktime MultiSig is valid, and Refund MultiSig is also available.",
            );
          } else {
            lines.push(
              `Spendable now via ${verification.path.toLowerCase()} pathway.`,
            );
          }
        } else {
          const reminders = [
            mainRemaining > 0 ? `${mainRemaining} more for main` : null,
            refundPathActive && refundRemaining > 0
              ? `${refundRemaining} more for refund`
              : null,
          ].filter(Boolean);
          if (reminders.length) {
            lines.push(`Need ${reminders.join("; ")}.`);
          }
        }

        $lightningStatus.html(lines.join("<br>"));

        const activePathThresholds = [mainRequiredSigners];
        if (refundPathActive) {
          activePathThresholds.push(refundRequiredSigners);
        }
        const minActiveThreshold = Math.min(...activePathThresholds);
        if (!verification.success && minActiveThreshold > 1) {
          if (lockState === "ACTIVE" && Number.isFinite(locktime)) {
            throw `This token needs multisig until ${new Date(locktime * 1000).toLocaleString().slice(0, -3)}. Please use Cashu Witness to unlock, or wait for lock expiry.`;
          }
          throw "This token needs multisig signatures. Please use Cashu Witness to unlock.";
        }

        // If no compatible extension detected, we'll have to ask for an nsec/private key :(
        if (
          hasP2BK ||
          (typeof window?.nostr?.signSchnorr === "undefined" &&
            typeof window?.nostr?.signString === "undefined" &&
            typeof window?.nostr?.nip60?.signSecret === "undefined")
        ) {
          $pkeyWrapper.show();
          if (hasP2BK) {
            $tokenStatus.html(
              "Enter your private key to unlock P2BK proofs</a>.",
            );
          } else {
            $tokenStatus.html(
              "Enter your private key or enable a <em>nip60</em> compatible Nostr Extension</a>.",
            );
          }
          if (!$pkey.val() as boolean) {
            return;
          }
        }
      }
      let mintHost = new URL(mintUrl).hostname;
      $tokenStatus.text(
        `Token value ${formatAmount(tokenAmount, unit)} from the mint: ${mintHost}`,
      );
      // Enable redeem button if lnurl is already set
      if ($lnurl.val() as string) {
        $redeemButton.prop("disabled", false);
      }
      // Autopay?
      if (autopay && ($lnurl.val() as string).length) {
        // Clear URL params if this is a repeat (eg: page refresh)
        let lastpay = localStorage.getItem("nostrly-cashu-last-autopay");
        if (lastpay == ($lnurl.val() as string)) {
          window.location.href =
            window.location.origin + window.location.pathname;
          return; // belt+braces
        }
        await makePayment();
      }
    } catch (e) {
      let errMsg = getErrorMessage(e);
      console.error(e);
      if (
        errMsg.startsWith("InvalidCharacterError") ||
        errMsg.startsWith("SyntaxError:")
      ) {
        errMsg = "Invalid Token!";
      }
      $tokenStatus.text(errMsg);
    }
  };

  // Sign proofs if any are locked
  const signProofs = async (proofs: Proof[]) => {
    const lockedProofs = proofs.some((p) => p.secret.includes("P2PK"));
    if (!lockedProofs) return proofs; // nothing to do
    $lightningStatus.text(`Signing locked proofs...`);
    // Sign P2PK proofs using NIP-60 wallet keys
    proofs = await signNip60Proofs(proofs);
    // Sign P2PK proofs using NIP-07
    proofs = await signWithNip07(proofs);
    console.log("signed proofs :>>", proofs);
    // Sign P2PK proofs using private key
    let privkey = $pkey.val() as string;
    if (privkey && privkey.startsWith("nsec1")) {
      const { type, data } = nip19.decode(privkey);
      // NB: nostr-tools doesn't hex string nsec automatically
      if (type === "nsec" && data.length === 32) {
        privkey = bytesToHex(data);
      }
    }
    if (privkey) {
      proofs = signP2PKProofs(proofs, privkey);
    }
    // console.log("privkey:>>", privkey);
    // Double check the signatures to make sure proofs are fully signed
    for (const proof of proofs) {
      try {
        if (!verifyP2PKSig(proof)) {
          console.warn("Proof is not signed properly!", proof);
        }
      } catch (e) {
        const msg = getErrorMessage(e);
        console.warn("Proof is not signed properly!", proof);
        console.warn(msg);
      }
    }
    return proofs;
  };

  // Melt the token and send the payment
  const makePayment = async (event?: JQuery.Event) => {
    if (event) event.preventDefault();
    if (!wallet) {
      throw new Error("Wallet was not initialized");
    }
    $lightningStatus.text("Attempting payment...");
    try {
      // Prepare to fetch an LN invoice and melt the token
      let invoice = "";
      let address = ($lnurl.val() as string) ?? "";
      let meltQuote = null;
      if (isLnurl(address)) {
        try {
          // Set LN invoice/fee estimates to NutShell defaults: 2%, 2 sat min
          // @see: https://github.com/cashubtc/nutshell/blob/main/.env.example#L114
          let estFeeSats = Math.ceil(Math.max(2, tokenAmount * 0.02));
          let estInvSats: number = tokenAmount - estFeeSats;

          // LN invoices are in sats, so if our token is not, we need to find
          // out roughly how many sats the token is worth... we can estimate
          // this by asking the mint to give us a mint quote for tokenAmount
          if ("sat" != unit) {
            console.log(
              `Token is in ${unit}. Estimating melt invoice value...`,
            );
            const mintQuote = await wallet.createMintQuoteBolt11(tokenAmount);
            console.log("Mint Quote :>>", mintQuote);
            const sats = getSatsAmount(mintQuote.request);
            estFeeSats = Math.ceil(Math.max(2, sats * 0.02)); // NutShell default
            estInvSats = sats - estFeeSats;
            console.log("Mint estInvSats :>>", estInvSats);
          }

          // Reduce token amount by Mint fees
          estInvSats -= wallet.getFeesForProofs(proofs);

          // Check fees haven't eaten token
          if (estInvSats <= 0) {
            throw new Error("Token amount too low to cover estimated fees");
          }

          // Get invoice and melt quote
          invoice = await getInvoiceFromLnurl(address, estInvSats);
          meltQuote = await wallet.createMeltQuoteBolt11(invoice);
          console.log("meltQuote :>> ", meltQuote);

          // If we overestimated invoice value, lets adjust it to fit. MeltQuote is in
          // token's base unit, so scale estInvSats by same ratio (- 1 sat for safety)
          const neededAmount = meltQuote.amount + meltQuote.fee_reserve;
          if (neededAmount > tokenAmount) {
            console.log(
              `Melt invoice too high... token: ${tokenAmount}, quote: ${neededAmount}`,
            );
            estInvSats = Math.round(
              estInvSats * (tokenAmount / neededAmount) - 1,
            );
            if (estInvSats <= 0) {
              throw new Error("Token amount too low to cover fee reserve");
            }
            invoice = await getInvoiceFromLnurl(address, estInvSats);
            meltQuote = await wallet.createMeltQuoteBolt11(invoice);
            console.log("Adjusted meltQuote :>> ", meltQuote);
          }

          console.log("Final estInvSats :>> ", estInvSats);
        } catch (e) {
          let msg = getErrorMessage(e);
          console.error("Error generating invoice:", msg);
          throw e;
        }
      } else {
        invoice = address;
        meltQuote = await wallet.createMeltQuoteBolt11(invoice);
        console.log("invoice :>> ", invoice);
        console.log("meltQuote :>> ", meltQuote);
      }
      // wallet and tokenAmount let us know processToken succeeded
      // If so, check invoice can be covered by the tokenAmount
      if (!wallet || !invoice || !tokenAmount) throw "OOPS!";
      const amountToSend = meltQuote.amount + meltQuote.fee_reserve;
      if (!amountToSend) {
        throw "Invoice amount is too small to send";
      }
      if (amountToSend > tokenAmount) {
        throw `Not enough to pay the invoice: needs ${formatAmount(meltQuote.amount, unit)} + ${formatAmount(meltQuote.fee_reserve, unit)}`;
      }
      // Sign P2PK proofs if needed
      proofs = await signProofs(proofs);

      $lightningStatus.text(
        `Sending ${formatAmount(meltQuote.amount, unit)} (plus ${formatAmount(meltQuote.fee_reserve, unit)} network fees) via Lightning`,
      );

      // Melt the token using the quote. We can send all proofs, as the balance
      // will be returned to us as change. This also saves a swap fee.
      const meltResponse = await wallet.meltProofsBolt11(meltQuote, proofs);
      console.log("meltResponse :>> ", meltResponse);
      if (meltResponse.quote) {
        $lightningStatus.text("Payment successful!");
        doConfettiBomb();
        // Tokenize our change (overpayment)
        if (meltResponse.change.length > 0) {
          $lightningStatus.text("Success! Preparing your change token...");
          let newToken = getEncodedTokenV4({
            mint: mintUrl,
            unit: unit,
            proofs: meltResponse.change,
          });
          console.log("change token :>> ", newToken);
          localStorage.setItem("nostrly-cashu-token", newToken);
          setTimeout(() => {
            $token.val(newToken);
            $token.trigger("input");
          }, 5000);
        }
        // Update last autopay destination
        if (autopay) {
          localStorage.setItem("nostrly-cashu-last-autopay", invoice);
        }
        // Reset form
        $token.val("");
        $redeemButton.prop("disabled", true);
        $lnurlRemover.addClass("hidden");
        $lnurl.val("");
      } else {
        $lightningStatus.text("Payment failed");
      }
    } catch (e) {
      const msg = getErrorMessage(e);
      console.error(e);
      $lightningStatus.text("Payment failed: " + msg);
    }
  };

  // Event Listeners
  $tokenRemover.on("click", (e) => {
    e.preventDefault();
    $token.val("");
    resetVars();
  });
  $lnurlRemover.on("click", (e) => {
    e.preventDefault();
    $lnurl.val("");
    $lnurlRemover.addClass("hidden");
    $redeemButton.prop("disabled", true);
  });
  $token.on("input", processToken);
  $lnurl.on("input", () => {
    if ($lnurl.val() as string) {
      $lnurlRemover.removeClass("hidden");
      $redeemButton.prop("disabled", false);
    } else {
      $lnurlRemover.addClass("hidden");
      $redeemButton.prop("disabled", true);
    }
  });
  $pkey.on(
    "input",
    debounce(() => {
      $lnurl.trigger("input");
    }, 200),
  );
  $redeemButton.on("click", async (event) => {
    makePayment(event);
    $redeemButton.prop("disabled", true);
  });

  // Allow auto populate fields
  const token = decodeURIComponent(params.get("token") ?? "");
  const lstoken = localStorage.getItem("nostrly-cashu-token");
  const to = decodeURIComponent(
    params.get("ln") || params.get("lightning") || params.get("to") || "",
  );
  if (token) {
    // Try URL token first...
    $(".preamble").hide();
    $token.val(token);
    processToken();
  } else if (lstoken) {
    // ... Saved change second
    $(".preamble").hide();
    $token.val(lstoken);
    processToken();
  }
  if (to) {
    $(".preamble").hide();
    $lnurl.val(to);
    $lnurl.trigger("input");
  }
});

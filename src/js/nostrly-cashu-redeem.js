// Imports
import {
  getDecodedToken,
  CheckStateEnum,
  getEncodedTokenV4,
} from "@cashu/cashu-ts";
import {
  getP2PKExpectedKWitnessPubkeys,
  getP2PKLocktime,
  getP2PKNSigs,
  signP2PKProofs,
  hasP2PKSignedProof,
  getP2PKWitnessSignatures,
  verifyP2PKsecretSignature,
} from "@cashu/cashu-ts/crypto/client/NUT11";
import { verifyP2PKSig } from "@cashu/cashu-ts/crypto/mint/NUT11";
import {
  debounce,
  doConfettiBomb,
  getWalletWithUnit,
  formatAmount,
  getSatsAmount,
  getTokenAmount,
} from "./utils.ts";
import {
  convertP2PKToNpub,
  getContactDetails,
  getNip60Wallet,
} from "./nostr.ts";
import { nip19 } from "nostr-tools";
import bech32 from "bech32";
import { decode as emojiDecode } from "./emoji-encoder.ts";
import { handleCashuDonation } from "./cashu-donate.js";
import { sha256Hex } from "./nut11.ts";
import { bytesToHex } from "@noble/hashes/utils";

// Cashu Redeem
jQuery(function ($) {
  // Init vars
  let wallet;
  let mintUrl = "";
  let unit = "sat";
  let proofs = [];
  let tokenAmount = 0;
  let pubkeys = [];
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
      handleCashuDonation($donateCashu.val(), "Cashu Redeem Donation");
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
    pubkeys = [];
    $tokenStatus.text("");
    $lightningStatus.text("");
    $tokenRemover.addClass("hidden");
    $pkeyWrapper.hide();
    $pkey.val("");
    $redeemButton.prop("disabled", true);
  };

  // Helpers to get invoice from Lightning address | LN URL
  const isLnurl = (address) =>
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
      console.error(e instanceof Error ? e.message : e);
      return "";
    }
  };

  // Helper to process the Cashu Token
  const processToken = async (event) => {
    if (event) event.preventDefault();
    resetVars();
    $tokenRemover.removeClass("hidden");
    $tokenStatus.text("Checking token, one moment please...");
    try {
      let tokenEncoded = $token.val();
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
      unit = token.unit;
      wallet = await getWalletWithUnit(mintUrl, unit); // Load wallet
      proofs = token.proofs ?? [];
      console.log("proofs :>>", proofs);
      // Check proofs are not spent
      const proofStates = await wallet.checkProofsStates(proofs);
      console.log("proofStates :>>", proofStates);
      let unspentProofs = [];
      proofStates.forEach((state, index) => {
        if (state.state == CheckStateEnum.UNSPENT) {
          unspentProofs.push(proofs[index]);
        }
      });
      console.log("unspentProofs :>>", unspentProofs);
      // All proofs spent?
      if (!unspentProofs.length) {
        // Is this our saved token? If so, remove it
        const lstoken = localStorage.getItem("nostrly-cashu-token");
        if (lstoken == $token.val()) {
          localStorage.removeItem("nostrly-cashu-token");
        }
        throw "Token already spent";
      }
      // Token partially spent - so update token
      if (unspentProofs.length != proofs.length) {
        $token.val(
          getEncodedTokenV4({
            mint: mintUrl,
            unit: unit,
            proofs: unspentProofs,
          }),
        );
        proofs = unspentProofs;
        $lightningStatus.text(
          "(Partially spent token detected - new token generated)",
        );
      }
      tokenAmount = getTokenAmount(proofs);
      // Check if proofs are P2PK locked
      const lockedProofs = proofs.filter(function (k) {
        return k.secret.includes("P2PK");
      });
      let n_sigs = 0;
      let locktime;
      if (lockedProofs.length) {
        // they are... so lookup the npubs currently able to unlock
        // This can vary dependingo on the P2PK locktime
        console.log("P2PK locked proofs found:>>", lockedProofs);
        pubkeys = getP2PKExpectedKWitnessPubkeys(lockedProofs[0].secret);
        n_sigs = getP2PKNSigs(lockedProofs[0].secret);
        locktime = getP2PKLocktime(lockedProofs[0].secret); // unix timestamp
        console.log("P2PK Pubkeys, NSigs:>>", pubkeys, n_sigs);
        if (n_sigs > 1) {
          if (locktime > Math.floor(new Date().getTime() / 1000)) {
            throw `This is a MultiSig token until ${new Date(locktime * 1000).toLocaleString().slice(0, -3)}. Please use Cashu Witness to unlock, or wait until the lock expires`;
          } else {
            throw "This is a MultiSig token. Please use Cashu Witness to unlock";
          }
        }
        console.log("locktime:>>", locktime);
      }
      // Fetch Nostr names for locking pubkeys if possible
      if (pubkeys.length > 0) {
        const updateContactName = (npub, relays) => {
          getContactDetails(npub, relays).then(({ name }) => {
            if (name) {
              $(`#${npub}`).replaceWith(
                `<a href="https://njump.me/${npub}" target="_blank">${name}</a>`,
              );
            }
          });
        };
        // Token is currently locked to these npubs...
        let keyholders = [];
        for (const pub of pubkeys) {
          const npub = convertP2PKToNpub(pub);
          keyholders.push(
            `<span id="${npub}">${pub.slice(0, 12)}...${pub.slice(-12)}</span>`,
          );
          updateContactName(npub, nostrly_ajax.relays);
        }
        let msg = `Token is P2PK locked to ${keyholders.join(", ")}`;
        const now = Math.floor(new Date().getTime() / 1000);
        if (locktime > now) {
          msg +=
            locktime == Infinity
              ? " permanently"
              : " until " +
                new Date(locktime * 1000).toLocaleString().slice(0, -3);
        }
        $lightningStatus.html(msg);

        // If no compatible extension detected, we'll have to ask for an nsec/private key :(
        if (
          typeof window?.nostr?.signSchnorr === "undefined" &&
          typeof window?.nostr?.signString === "undefined" &&
          typeof window?.nostr?.nip60?.signSecret === "undefined"
        ) {
          $pkeyWrapper.show();
          if (!$pkey.val()) {
            $tokenStatus.html(
              "Enter your private key or enable a <em>nip60</em> compatible Nostr Extension</a>.",
            );
            return;
          }
        }
      }
      let mintHost = new URL(mintUrl).hostname;
      $tokenStatus.text(
        `Token value ${formatAmount(tokenAmount, unit)} from the mint: ${mintHost}`,
      );
      // Enable redeem button if lnurl is already set
      if ($lnurl.val()) {
        $redeemButton.prop("disabled", false);
      }
      // Autopay?
      if (autopay && $lnurl.val().length) {
        // Clear URL params if this is a repeat (eg: page refresh)
        let lastpay = localStorage.getItem("nostrly-cashu-last-autopay");
        if (lastpay == $lnurl.val()) {
          window.location.href =
            window.location.origin + window.location.pathname;
          return; // belt+braces
        }
        await makePayment();
      }
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      let errMsg = e instanceof Error ? e.message : e;
      if (
        errMsg.startsWith("InvalidCharacterError") ||
        errMsg.startsWith("SyntaxError:")
      ) {
        errMsg = "Invalid Token!";
      }
      $tokenStatus.text(errMsg);
    }
  };

  // Melt the token and send the payment
  const makePayment = async (event) => {
    if (event) event.preventDefault();
    $lightningStatus.text("Attempting payment...");
    try {
      // Sign P2PK proofs using NIP-60 wallet keys
      if (typeof window?.nostr?.nip44?.decrypt !== "undefined") {
        console.log("we can decrypt nip44!");
        proofs = await signNip60Proofs(proofs); // sign main proofs array
      }

      // Sign P2PK proofs using proposed NIP-60 secret signer
      // @see: https://github.com/nostr-protocol/nips/pull/1890
      if (typeof window?.nostr?.nip60?.signSecret !== "undefined") {
        console.log("we can signSecret!");
        proofs = await signSecretProofs(proofs); // sign main proofs array
      }
      // Support for proposed NIP-07 schnorr signer
      // @see: https://github.com/nostr-protocol/nips/pull/1842
      else if (typeof window?.nostr?.signString !== "undefined") {
        console.log("we can signString!");
        proofs = await signStringProofs(proofs); // sign main proofs array
      }
      // The Alby extension can sign schnorr signatures directly - woohoo!
      else if (typeof window?.nostr?.signSchnorr !== "undefined") {
        console.log("we can signSchnorr!");
        proofs = await signSchnorrProofs(proofs); // sign main proofs array
      }
      console.log("signed proofs :>>", proofs);

      // Double check the signatures to make sure proofs are fully signed
      for (const proof of proofs) {
        try {
          if (!verifyP2PKSig(proof)) {
            console.warn("Proof is not signed properly!", proof);
          }
        } catch (e) {
          console.warn("Proof is not signed properly!", proof);
          console.warn(e.message);
        }
      }

      // Prepare to fetch an LN invoice and melt the token
      let invoice = "";
      let address = $lnurl.val() ?? "";
      let meltQuote = null;
      if (isLnurl(address)) {
        try {
          // Set LN invoice/fee estimates to NutShell defaults: 1%, 2 sat min
          // @see: https://github.com/cashubtc/nutshell/blob/main/.env.example#L114
          let estFeeSats = Math.ceil(Math.max(2, tokenAmount * 0.01));
          let estInvSats = tokenAmount - estFeeSats;

          // LN invoices are in sats, so if our token is not, we need to find
          // out roughly how many sats the token is worth... we can estimate
          // this by asking the mint to give us a mint quote for tokenAmount
          if ("sat" != unit) {
            console.log(
              `Token is in ${unit}. Estimating melt invoice value...`,
            );
            const mintQuote = await wallet.createMintQuote(tokenAmount);
            console.log("Mint Quote :>>", mintQuote);
            const sats = getSatsAmount(mintQuote.request);
            estFeeSats = Math.ceil(Math.max(2, sats * 0.01)); // NutShell default
            estInvSats = sats - estFeeSats;
            console.log("Mint estInvSats :>>", estInvSats);
          }

          // Check fees haven't eaten token
          if (estInvSats <= 0) {
            throw new Error("Token amount too low to cover estimated fee");
          }

          // Get invoice and melt quote
          invoice = await getInvoiceFromLnurl(address, estInvSats);
          meltQuote = await wallet.createMeltQuote(invoice);
          console.log("meltQuote :>> ", meltQuote);

          // If we overestimated invoice value, lets adjust it to fit. MeltQuote is in
          // token's base unit, so scale estInvSats by same ratio (- 1 sat for safety)
          const neededAmount = meltQuote.amount + meltQuote.fee_reserve;
          if (neededAmount > tokenAmount) {
            console.log(
              `Melt invoice too high... token: ${tokenAmount}, quote: ${neededAmount}`,
            );
            estInvSats = parseInt(
              estInvSats * (tokenAmount / neededAmount) - 1,
              10,
            );
            if (estInvSats <= 0) {
              throw new Error("Token amount too low to cover fee reserve");
            }
            invoice = await getInvoiceFromLnurl(address, estInvSats);
            meltQuote = await wallet.createMeltQuote(invoice);
            console.log("Adjusted meltQuote :>> ", meltQuote);
          }

          console.log("Final estInvSats :>> ", estInvSats);
        } catch (error) {
          console.error("Error generating invoice:", error.message);
          throw error;
        }
      } else {
        invoice = address;
        meltQuote = await wallet.createMeltQuote(invoice);
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
      $lightningStatus.text(
        `Sending ${formatAmount(meltQuote.amount, unit)} (plus ${formatAmount(meltQuote.fee_reserve, unit)} network fees) via Lightning`,
      );

      // Convert nsec to hex if needed
      let privkey = $pkey.val();
      if (privkey && privkey.startsWith("nsec1")) {
        const { type, data } = nip19.decode(privkey);
        // NB: nostr-tools doesn't hex string nsec automatically
        if (type === "nsec" && data.length === 32) {
          privkey = bytesToHex(data);
        }
      }
      // console.log("privkey:>>", privkey);

      // CashuWallet.send performs coin selection and swaps the proofs with the mint
      // if no appropriate amount can be selected offline. We must include potential
      // ecash fees that the mint might require to melt the resulting proofsToSend later.
      const { keep: proofsToKeep, send: proofsToSend } = await wallet.send(
        amountToSend,
        proofs,
        {
          includeFees: true,
          privkey: privkey,
        },
      );
      console.log("proofsToKeep :>> ", proofsToKeep);
      console.log("proofsToSend :>> ", proofsToSend);
      const meltResponse = await wallet.meltProofs(meltQuote, proofsToSend);
      console.log("meltResponse :>> ", meltResponse);
      if (meltResponse.quote) {
        $lightningStatus.text("Payment successful!");
        doConfettiBomb();
        // Tokenize any unspent proofs
        if (proofsToKeep.length > 0 || meltResponse.change.length > 0) {
          $lightningStatus.text("Success! Preparing your change token...");
          const change = proofsToKeep.concat(meltResponse.change);
          let newToken = getEncodedTokenV4({
            mint: mintUrl,
            unit: unit,
            proofs: change,
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
      console.error(e instanceof Error ? e.message : e);
      $lightningStatus.text("Payment failed: " + e);
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
    if ($lnurl.val()) {
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
      $lnurl.trigger("input"), 200;
    }),
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

  // Sign P2PK proofs using NIP-60 wallet keys
  async function signNip60Proofs(proofs) {
    if (typeof window?.nostr?.nip44?.decrypt === "undefined") return proofs;
    if (!pubkeys.length) return proofs;
    const pubkey = await window.nostr.getPublicKey();
    const { privkeys } = await getNip60Wallet(pubkey);
    if (privkeys.length > 0) {
      console.log("signing using nip60...");
      privkeys.forEach((privkey) => {
        proofs = signP2PKProofs(proofs, privkey);
      });
    }
    console.log("proofs after NIP-60:>>", proofs);
    return proofs;
  }

  // Sign P2PK proofs using Alby Nostr Extension
  async function signSchnorrProofs(proofs) {
    if (typeof window?.nostr?.signSchnorr === "undefined") return proofs;
    if (!pubkeys.length) return proofs;
    for (const [index, proof] of proofs.entries()) {
      if (!proof.secret.includes("P2PK")) continue;
      const hash = sha256Hex(proof.secret);
      const pubkey = await window.nostr.getPublicKey();
      const sig = await window.nostr.signSchnorr(hash);
      // Check we got a signature from expected pubkey on expected hash
      if (sig.length && proof.secret.includes(pubkey)) {
        if (!hasP2PKSignedProof(pubkey, proof)) {
          const signatures = getP2PKWitnessSignatures(proof.witness);
          proofs[index].witness = {
            signatures: [...signatures, sig],
          };
          console.log("added sig!", sig);
        }
      }
    }
    return proofs;
  }

  // Sign P2PK proofs using proposed NIP-07 method
  // @see: https://github.com/nostr-protocol/nips/pull/1842
  async function signStringProofs(proofs) {
    if (typeof window?.nostr?.signString === "undefined") return proofs;
    if (!pubkeys.length) return proofs;
    for (const [index, proof] of proofs.entries()) {
      if (!proof.secret.includes("P2PK")) continue;
      const expHash = sha256Hex(proof.secret);
      const { hash, sig, pubkey } = await window.nostr.signString(proof.secret);
      // Check we got a signature from expected pubkey on expected hash
      if (sig.length && proof.secret.includes(pubkey) && expHash === hash) {
        if (!hasP2PKSignedProof(pubkey, proof)) {
          const signatures = getP2PKWitnessSignatures(proof.witness);
          proofs[index].witness = {
            signatures: [...signatures, sig],
          };
          console.log("added sig!", sig);
        }
      }
    }
    return proofs;
  }

  // Sign P2PK proofs using proposed NIP-60 secret signer
  // @see: https://github.com/nostr-protocol/nips/pull/1890
  async function signSecretProofs(proofs) {
    if (typeof window?.nostr?.nip60?.signSecret === "undefined") return proofs;
    if (!pubkeys.length) return proofs;
    for (const [index, proof] of proofs.entries()) {
      if (!proof.secret.includes("P2PK")) continue;
      const expHash = sha256Hex(proof.secret);
      const { hash, sig, pubkey } = await window.nostr.nip60.signSecret(
        proof.secret,
      );
      // Check we got a signature from expected pubkey on expected hash
      if (sig.length && proof.secret.includes(pubkey) && expHash === hash) {
        if (!hasP2PKSignedProof(pubkey, proof)) {
          const signatures = getP2PKWitnessSignatures(proof.witness);
          proofs[index].witness = {
            signatures: [...signatures, sig],
          };
          console.log("added sig!", sig);
        }
      }
    }
    return proofs;
  }
});

// Imports
import {
  LockBuilder,
  NUTROOT_NUMS_KEY,
  PaymentRequest,
  Wallet,
  bytesToHex,
  decodePaymentRequest,
  getEncodedToken,
  getTokenMetadata,
  hexToBytes,
  parseNutrootLeafHex,
  PaymentRequestTransportType,
  type NutrootLeaf,
  type PaymentRequestPayload,
} from "@cashu/cashu-ts";
import { nip19 } from "nostr-tools";
import { decode as emojiDecode } from "./emoji-encoder";
import {
  convertP2PKToNpub,
  fetchNip17Dms,
  getContactDetails,
  maybeConvertNpubToHexPub,
  maybeConvertNpubToP2PK,
  sendNip17Dm,
} from "./nostr";
import { isPublicKeyValidP2PK } from "./nut11";
import {
  copyTextToClipboard,
  debounce,
  describeNutrootLeaf,
  formatAmount,
  getErrorMessage,
  getTokenAmount,
  getWalletWithUnit,
} from "./utils";
import { handleCashuDonation } from "./cashu-donate";
import toastr from "toastr";

declare const nostrly_ajax: {
  relays: string[];
};

// DOM ready
jQuery(function ($) {
  // DOM elements
  const $amount = $("#req-amount");
  const $unit = $("#req-unit");
  const $mints = $("#req-mints");
  const $description = $("#req-description");
  const $payto = $("#req-payto");
  const $backup = $("#req-backup");
  const $backupAfter = $("#req-backup-after");
  const $blind = $("#req-blind");
  const $legacy = $("#req-legacy");
  const $disclose = $("#req-disclose");
  const $single = $("#req-single");
  const $output = $("#req-output");
  const $outputWrap = $("#req-output-wrap");
  const $copy = $("#req-copy");
  const $summary = $("#req-summary");
  const $inspect = $("#inspect-input");
  const $inspectOut = $("#inspect-output");
  const $nostr = $("#req-nostr");
  const $inbox = $("#inbox-key");
  const $inboxCashu = $("#inbox-cashu-key");
  const $inboxRequest = $("#inbox-request");
  const $inboxButton = $("#inbox-check");
  const $inboxOut = $("#inbox-output");
  const $payWrap = $("#pay-wrap");
  const $payToken = $("#pay-token");
  const $payAmount = $("#pay-amount");
  const $payAmountWrap = $("#pay-amount-wrap");
  const $payButton = $("#pay-button");
  const $payHint = $("#pay-hint");
  const $payOut = $("#pay-output");
  const $payDelivered = $("#pay-delivered");
  const $payment = $("#pay-payment");
  const $paymentCopy = $("#pay-payment-copy");
  const $change = $("#pay-change");
  const $changeWrap = $("#pay-change-wrap");
  const $changeCopy = $("#pay-change-copy");
  const $donateCashu = $("#donate_cashu");

  // Mint- and payer-supplied strings reach the summary, so escape everything
  const esc = (s: string) => $("<i>").text(s).html();
  const mono = (s: string) =>
    `<span style="font-family:monospace">${esc(s)}</span>`;
  const shortKey = (k: string) => mono(`${k.slice(0, 12)}...${k.slice(-8)}`);

  // Donation input
  $donateCashu.on("paste", () => {
    setTimeout(() => {
      handleCashuDonation(
        $donateCashu.val() as string,
        "Cashu Request Donation",
      );
      $donateCashu.val("");
    }, 200);
  });

  // A key field takes an npub or a hex key; empty is not an error, just absent
  function readKey($el: JQuery<HTMLElement>): string | undefined {
    const raw = ($el.val() as string)?.trim();
    if (!raw) {
      $el.attr("data-valid", "");
      return undefined;
    }
    try {
      const key = maybeConvertNpubToP2PK(raw);
      if (!isPublicKeyValidP2PK(key)) throw new Error("bad key");
      $el.attr("data-valid", "");
      return key;
    } catch {
      $el.attr("data-valid", "no");
      return undefined;
    }
  }

  // Builds the request from the form. Returns undefined while the form is
  // incomplete, so typing does not spray errors.
  function buildRequest():
    { pr: PaymentRequest; omittedNut10?: string } | undefined {
    const unit = (($unit.val() as string) || "sat").trim().toLowerCase();
    const amountRaw = ($amount.val() as string)?.trim();
    const amount = amountRaw ? Number(amountRaw) : 0;
    if (amountRaw && (!Number.isFinite(amount) || amount < 0)) {
      $amount.attr("data-valid", "no");
      return undefined;
    }
    $amount.attr("data-valid", "");

    const builder = PaymentRequest.builder();
    if (amount > 0) {
      builder.amount(amount, unit);
    } else {
      builder.unit(unit);
    }

    const mints = (($mints.val() as string) || "")
      .split(/[\s,]+/)
      .map((m) => m.trim())
      .filter(Boolean);
    if (mints.length) builder.addMint(mints);

    const description = (($description.val() as string) || "").trim();
    if (description) builder.description(description);
    if ($single.is(":checked")) builder.singleUse(true);

    const payTo = readKey($payto);
    if (!payTo) return undefined; // the lock is the point of this tool

    const lock = new LockBuilder().addMainPubkey(payTo);
    if ($blind.is(":checked")) lock.blindKeys();
    if ($disclose.is(":checked")) lock.disclose();

    // A backup leaf is the payee's own second key, claimable after a date: the
    // simplest honest reason for a request to carry a tree at all.
    const backupKey = readKey($backup);
    const afterRaw = ($backupAfter.val() as string)?.trim();
    if (backupKey && afterRaw) {
      const after = Math.floor(new Date(afterRaw).getTime() / 1000);
      if (!Number.isFinite(after)) {
        $backupAfter.attr("data-valid", "no");
        return undefined;
      }
      $backupAfter.attr("data-valid", "");
      lock.addLeaf({ type: "after", n: 1, keys: [backupKey], time: after });
    } else if (backupKey || afterRaw) {
      return undefined; // half a backup leaf is not a request yet
    }

    // A transport is how the payment gets back: without one the payer has to
    // return the token by hand, which for a derived secret nobody else can find
    const nprofile = readNprofile();
    if (nprofile === null) return undefined; // typed, but not valid yet
    if (nprofile) builder.addNostrTransport(nprofile, ["17"]);

    // legacy: nut10 rides alongside for payers that predate v3 keysets
    builder.lock(lock, { legacy: $legacy.is(":checked") });
    return { pr: builder.build(), omittedNut10: builder.omitted.nut10 };
  }

  // The delivery field takes an npub or a full nprofile. An npub carries no
  // relays, so pair it with the ones this site uses.
  // Returns undefined when empty, null when present but unusable.
  function readNprofile(): string | undefined | null {
    const raw = ($nostr.val() as string)?.trim();
    if (!raw) {
      $nostr.attr("data-valid", "");
      return undefined;
    }
    try {
      if (raw.startsWith("nprofile")) {
        nip19.decode(raw); // throws if malformed
        $nostr.attr("data-valid", "");
        return raw;
      }
      const pubkey = maybeConvertNpubToHexPub(raw);
      if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new Error("bad key");
      $nostr.attr("data-valid", "");
      return nip19.nprofileEncode({ pubkey, relays: nostrly_ajax.relays });
    } catch {
      $nostr.attr("data-valid", "no");
      return null;
    }
  }

  // Where a payment for this request should be delivered, if anywhere
  function nostrTarget(
    pr: PaymentRequest,
  ): { pubkey: string; relays: string[] } | undefined {
    const transport = pr.getTransport(PaymentRequestTransportType.NOSTR);
    if (!transport?.target) return undefined;
    try {
      const decoded = nip19.decode(transport.target);
      if (decoded.type === "nprofile") {
        return {
          pubkey: decoded.data.pubkey,
          relays: decoded.data.relays?.length
            ? decoded.data.relays
            : nostrly_ajax.relays,
        };
      }
      if (decoded.type === "npub") {
        return { pubkey: decoded.data, relays: nostrly_ajax.relays };
      }
    } catch {
      // an unreadable target is the same as none: the payer returns it by hand
    }
    return undefined;
  }

  // One renderer for both panels: what this request asks of a payer
  function renderSummary(
    pr: PaymentRequest,
    opts?: { omittedNut10?: string },
  ): string {
    const unit = pr.unit ?? "sat";
    let html = "<ul>";
    html += `<li>Amount: ${pr.amount ? esc(formatAmount(pr.amount, unit)) : `any amount, in ${esc(unit)}`}</li>`;
    if (pr.description) html += `<li>Description: ${esc(pr.description)}</li>`;
    if (pr.mints?.length) {
      html += `<li>Mints: ${pr.mints.map((m) => esc(m)).join(", ")}${pr.isMintListStrict ? " (required)" : " (preferred)"}</li>`;
    } else {
      html += `<li>Mints: any</li>`;
    }
    if (pr.singleUse) html += `<li>Single use: pay once</li>`;

    const nutroot = pr.toNutrootOptions();
    if (nutroot) {
      if (nutroot.receiverKey === NUTROOT_NUMS_KEY) {
        html += `<li class="signed"><span class="status-icon"></span><span>Nutroot (v3): script-only. There is no key path, so a payment can only be claimed through the conditions below.</span></li>`;
      } else {
        const npub = convertP2PKToNpub(nutroot.receiverKey);
        const keyId = `req-recv-${Math.random().toString(36).slice(2, 8)}`;
        html += `<li class="signed"><span class="status-icon"></span><span>Nutroot (v3): outputs derived from <span id="${keyId}">${shortKey(nutroot.receiverKey)}</span>, never locked to it verbatim.</span></li>`;
        getContactDetails(npub, nostrly_ajax.relays).then(({ name }) => {
          if (name) {
            $(`#${keyId}`).replaceWith(
              `<a href="https://njump.me/${esc(npub)}" target="_blank">${esc(name)}</a>`,
            );
          }
        });
      }
      const leaves: NutrootLeaf[] = (nutroot.leaves ?? []).map((l) =>
        typeof l === "string" ? parseNutrootLeafHex(l) : l,
      );
      if (leaves.length) {
        html += `<li>Requested conditions, which the payer must reproduce exactly:<ul>`;
        for (const leaf of leaves) {
          html += `<li>${esc(describeNutrootLeaf(leaf))}</li>`;
        }
        html += `</ul></li>`;
      }
      html += `<li>Every payment derives its own secret${nutroot.receiverKey === NUTROOT_NUMS_KEY ? "" : " from that key"}, so two payments to this request cannot be linked.</li>`;
      if (leaves.length) {
        const blind = nutroot.blindKeys?.length ?? 0;
        html += `<li>${blind ? `${blind} of the tree's keys are tagged to be blinded too` : "The tree's keys are used verbatim, so they are recognisable on receipt"}.</li>`;
      }
    }
    const target = nostrTarget(pr);
    if (target) {
      const npub = nip19.npubEncode(target.pubkey);
      const dmId = `req-dm-${Math.random().toString(36).slice(2, 8)}`;
      html += `<li class="signed"><span class="status-icon"></span><span>Delivery: the payment is sent over nostr to <span id="${dmId}">${shortKey(target.pubkey)}</span> as a NIP-17 message.</span></li>`;
      getContactDetails(npub, nostrly_ajax.relays).then(({ name }) => {
        if (name) {
          $(`#${dmId}`).replaceWith(
            `<a href="https://njump.me/${esc(npub)}" target="_blank">${esc(name)}</a>`,
          );
        }
      });
    } else {
      html += `<li>No delivery transport: the payer has to return the token by hand. A derived secret cannot be found by scanning the mint, so the payee needs the token itself.</li>`;
    }
    if (pr.nut10) {
      html += `<li>Legacy fallback (NUT-10) included, so wallets that predate v3 keysets can still pay.</li>`;
    }
    if (!nutroot && !pr.nut10) {
      html += `<li>No lock: any wallet can pay, and the proofs arrive unlocked.</li>`;
    }
    if (opts?.omittedNut10) {
      // The builder says why it left the pre-v3 encoding out (eg blinding removes the verbatim key)
      html += `<li>No legacy fallback: ${esc(opts.omittedNut10)}.</li>`;
    }
    html += "</ul>";
    return html;
  }

  // Compose panel
  function refresh() {
    let built: ReturnType<typeof buildRequest>;
    try {
      built = buildRequest();
    } catch (e) {
      $outputWrap.hide();
      $summary.html(
        `<p class="error">${esc(getErrorMessage(e, "Could not build this request"))}</p>`,
      );
      return;
    }
    if (!built) {
      $outputWrap.hide();
      $summary.empty();
      return;
    }
    $output.val(built.pr.toEncodedRequest());
    $outputWrap.show();
    $summary.html(
      `<strong>This request asks a payer for:</strong>${renderSummary(built.pr, built)}`,
    );
  }

  // Inspect panel. A decoded request is also the one the pay panel fulfils.
  let inspected: PaymentRequest | undefined;
  function inspect() {
    const raw = ($inspect.val() as string)?.trim();
    inspected = undefined;
    $payWrap.hide();
    $payOut.hide();
    if (!raw) {
      $inspect.attr("data-valid", "");
      $inspectOut.hide().empty();
      return;
    }
    try {
      const pr = decodePaymentRequest(raw);
      $inspect.attr("data-valid", "");
      $inspectOut
        .show()
        .html(
          `<strong>This request asks you for:</strong>${renderSummary(pr)}`,
        );
      inspected = pr;
      $payAmountWrap.toggle(!pr.amount);
      $payHint.text(
        nostrTarget(pr)
          ? "Your wallet reproduces the requested conditions exactly, derives a fresh secret for the payee, and delivers the payment to them over nostr."
          : "Your wallet reproduces the requested conditions exactly and derives a fresh secret for the payee. This request carries no transport, so hand the payment token back yourself.",
      );
      $payWrap.show();
    } catch (e) {
      $inspect.attr("data-valid", "no");
      $inspectOut
        .show()
        .html(
          `<p class="error">${esc(getErrorMessage(e, "Not a payment request"))}</p>`,
        );
    }
  }

  // Pay panel: swap a token into the outputs the request asked for. The payer
  // reproduces the requested tree exactly, or the payee cannot spend what arrives.
  async function payRequest() {
    const pr = inspected;
    if (!pr) return;
    $payButton.prop("disabled", true);
    $payDelivered.hide();
    try {
      let encoded = ($payToken.val() as string)?.trim();
      if (!encoded) throw new Error("Paste a token to pay with");
      if (!encoded.startsWith("cashu")) {
        encoded = emojiDecode(encoded) || encoded;
      }
      const meta = getTokenMetadata(encoded);
      if (!meta.mint) throw new Error("Invalid token");
      if (pr.unit && pr.unit !== meta.unit) {
        throw new Error(
          `This request wants ${pr.unit}, and that token is ${meta.unit}`,
        );
      }
      if (pr.isMintListStrict && !pr.includesMint(meta.mint)) {
        throw new Error("That token's mint is not one this request accepts");
      }
      const wallet = await getWalletWithUnit(meta.mint, meta.unit);
      const token = wallet.decodeToken(encoded);
      const chosen = ($payAmount.val() as string)?.trim();
      if (!pr.amount && !chosen) throw new Error("Choose an amount to pay");
      const amount = pr.amount ? undefined : Number(chosen);
      toastr.info("Paying the request...");
      const { send, keep } = await wallet.ops
        .sendToRequest(pr, token.proofs, amount)
        .run();
      $payment.val(
        getEncodedToken({ mint: meta.mint, unit: meta.unit, proofs: send }),
      );
      if (keep.length) {
        $change.val(
          getEncodedToken({ mint: meta.mint, unit: meta.unit, proofs: keep }),
        );
        $changeWrap.show();
      } else {
        $changeWrap.hide();
      }
      $payOut.show();
      const paid = formatAmount(getTokenAmount(send), meta.unit);
      const target = nostrTarget(pr);
      if (!target) {
        toastr.success(`Paid ${paid}: send the payment token to the payee`);
        return;
      }
      toastr.info("Delivering the payment over nostr...");
      const payload = pr.encodePayload(meta.mint, send, { unit: meta.unit });
      try {
        const relays = await sendNip17Dm(payload, target.pubkey, target.relays);
        $payDelivered
          .show()
          .text(
            `Delivered to the payee over nostr, on ${relays.join(", ")}. They collect it from the Collect tab.`,
          );
        toastr.success(`Paid ${paid} and delivered to the payee over nostr`);
      } catch (e) {
        // The payment stands and its token is already on screen: only the
        // delivery failed, so this must not read as a failed payment
        console.error("payment delivery error:", e);
        toastr.warning(
          `Paid ${paid}, but not delivered over nostr: ${getErrorMessage(e, "send the payment token to the payee")}`,
        );
      }
    } catch (e) {
      console.error("payRequest error:", e);
      toastr.error(getErrorMessage(e, "Could not pay this request"));
    } finally {
      $payButton.prop("disabled", false);
    }
  }

  // Can the collector actually spend what arrived? A payment delivered over nostr
  // cannot be handed back, and in the case that matters nothing was handed over:
  // proofs derived to the payer's own key look like a payment until you try to
  // spend them. So this gates the belief, not the custody. Offline: spendOptions
  // reads the proofs and the keys held, never the mint.
  async function assessPayment(
    payload: PaymentRequestPayload,
    privkeys: string[],
  ): Promise<{ spendable: boolean; reason?: string }> {
    const wallet = new Wallet(payload.mint, { unit: payload.unit });
    for (const proof of payload.proofs) {
      const spend = wallet.spendOptions(proof, { privkeys });
      if (spend.spendable) continue;
      const when = spend.availableAt
        ? new Date(spend.availableAt * 1000).toLocaleString()
        : "later";
      const reasons = {
        "not-keyed-to-you":
          "it is locked to a key you did not give, so only its owner can spend it",
        locktime: `one of its conditions does not unlock until ${when}`,
        threshold: "it needs more signing keys than you gave",
        preimage: "it needs a preimage you do not hold",
      };
      return {
        spendable: false,
        reason: reasons[spend.blockedBy ?? "not-keyed-to-you"],
      };
    }
    return { spendable: true };
  }

  // The settlement half: does this payment net what the request asked, under the
  // lock it asked for? Unlike the spendability check this one needs the mint's
  // fee schedule, so it dials the mint the payer named.
  async function checkAgainstRequest(
    payload: PaymentRequestPayload,
    pr: PaymentRequest,
    privkey: string,
  ): Promise<string | undefined> {
    if (payload.id && pr.id && payload.id !== pr.id) {
      return "sent for a different request";
    }
    if (!pr.amount) return undefined; // amountless: only you know what was due
    if (pr.isMintListStrict && !pr.includesMint(payload.mint)) {
      return "paid from a mint your request does not accept";
    }
    try {
      const wallet = await getWalletWithUnit(payload.mint, payload.unit);
      return wallet.isPaymentRequestSatisfied(pr, payload.proofs, undefined, {
        privkeys: privkey,
      })
        ? undefined
        : "short of the amount you asked for, once input fees are counted";
    } catch (e) {
      return getErrorMessage(e, "does not match what you asked for");
    }
  }

  // Inbox: NIP-17 messages carrying a payment for this key. The wraps are
  // public but sealed, so the key never leaves the browser and only unwraps.
  async function checkInbox() {
    const raw = ($inbox.val() as string)?.trim();
    if (!raw) {
      toastr.error("Paste the private key of the account you requested to");
      return;
    }
    let privkey: Uint8Array;
    try {
      privkey = raw.startsWith("nsec")
        ? (nip19.decode(raw).data as Uint8Array)
        : hexToBytes(raw);
      if (privkey.length !== 32) throw new Error("bad key");
      $inbox.attr("data-valid", "");
      // Emptied once read, as in Cashu Gift: a secret key left sitting in an
      // input is one screen-share or shoulder away from being someone else's.
      // A key that failed to parse stays put, so it can be corrected.
      $inbox.val("");
    } catch {
      $inbox.attr("data-valid", "no");
      toastr.error("That is not a valid nsec or hex private key");
      return;
    }
    // The nostr key unwraps the message; the cashu key is what the proofs were
    // derived to. The request form takes them separately, so they need not match.
    const cashuRaw = ($inboxCashu.val() as string)?.trim();
    let cashuKey: string;
    try {
      cashuKey = cashuRaw
        ? bytesToHex(
            cashuRaw.startsWith("nsec")
              ? (nip19.decode(cashuRaw).data as Uint8Array)
              : hexToBytes(cashuRaw),
          )
        : bytesToHex(privkey);
      if (cashuKey.length !== 64) throw new Error("bad key");
      $inboxCashu.attr("data-valid", "");
      $inboxCashu.val("");
    } catch {
      $inboxCashu.attr("data-valid", "no");
      toastr.error("That is not a valid nsec or hex private key");
      return;
    }
    // Optional: the request these payments answer. Without it the panel can still
    // say whether proofs are spendable, but not whether they are the right amount.
    const requestRaw = ($inboxRequest.val() as string)?.trim();
    let request: PaymentRequest | undefined;
    if (requestRaw) {
      try {
        request = decodePaymentRequest(requestRaw);
        $inboxRequest.attr("data-valid", "");
      } catch {
        $inboxRequest.attr("data-valid", "no");
        toastr.error("That is not a payment request");
        return;
      }
    }
    $inboxButton.prop("disabled", true);
    $inboxOut.hide().empty();
    try {
      toastr.info("Checking relays for payments...");
      const messages = await fetchNip17Dms(privkey, nostrly_ajax.relays);
      const payments = messages.flatMap((m) => {
        try {
          const payload = PaymentRequest.decodePayload(m.content);
          return payload?.proofs?.length ? [{ ...m, payload }] : [];
        } catch {
          return []; // an ordinary message, not a payment
        }
      });
      if (!payments.length) {
        $inboxOut
          .show()
          .html(
            `<p>No payments found. Relays keep messages for a while, not forever, so a payment sent long ago may have aged out.</p>`,
          );
        return;
      }
      let html = `<strong>Messages carrying proofs, delivered to you:</strong><ul>`;
      let spendableCount = 0;
      for (const { payload, created_at } of payments) {
        const amount = getTokenAmount(payload.proofs);
        const when = new Date(created_at * 1000).toLocaleString();
        // The memo is payer text of any length, so it gets its own line under the summary.
        const memo = payload.memo
          ? `<br>Memo: <em>${esc(payload.memo)}</em>`
          : "";
        const line = `${esc(formatAmount(amount, payload.unit))} from ${esc(payload.mint)}, ${esc(when)}`;
        const verdict = await assessPayment(payload, [cashuKey]);
        if (!verdict.spendable) {
          // Not a payment: nothing was transferred, so there is nothing to hand
          // back and nothing to credit. Saying so is the whole job of this panel.
          html += `<li class="unsigned"><span class="status-icon"></span><span>${line}${memo}<br><strong>Not a payment you can spend</strong>: ${esc(verdict.reason ?? "")}. Do not treat this as paid.</span></li>`;
          continue;
        }
        const mismatch = request
          ? await checkAgainstRequest(payload, request, cashuKey)
          : undefined;
        if (mismatch) {
          html += `<li class="unsigned"><span class="status-icon"></span><span>${line}${memo}<br><strong>Spendable, but not settlement</strong>: ${esc(mismatch)}.</span></li>`;
          continue;
        }
        spendableCount++;
        const token = getEncodedToken({
          mint: payload.mint,
          unit: payload.unit,
          proofs: payload.proofs,
        });
        const id = `inbox-${Math.random().toString(36).slice(2, 8)}`;
        html += `<li class="signed"><span class="status-icon"></span><span>${line} <button type="button" class="button copy-token" id="${id}">Copy token</button>${memo}</span></li>`;
        // The token only ever lives in this closure; the button hands it over
        setTimeout(() => {
          $(`#${id}`).on("click", () => {
            copyTextToClipboard(token);
            toastr.success("Token copied: sweep it in Cashu Witness");
          });
        }, 0);
      }
      html += `</ul>`;
      const rejected = payments.length - spendableCount;
      if (rejected) {
        html += `<p>A payer chooses which key the proofs are derived to, and only your key can tell its own derivation from someone else's. That is why ${rejected === 1 ? "one entry above is" : `${rejected} entries above are`} not counted as payment. Such proofs can be live and unspent at the mint and still not be yours: nothing was transferred, so there is nothing to hand back and nothing to credit.</p>`;
      }
      if (!request) {
        html += `<p>Paste the request you created to also check each payment is the amount you asked for. Without it this panel only reports what you can spend.</p>`;
      }
      $inboxOut.show().html(html);
      if (!spendableCount) {
        toastr.warning("No spendable payments found");
      } else {
        toastr.success(
          `Found ${spendableCount} payment${spendableCount > 1 ? "s" : ""} you can spend`,
        );
      }
    } catch (e) {
      console.error("checkInbox error:", e);
      toastr.error(getErrorMessage(e, "Could not check for payments"));
    } finally {
      $inboxButton.prop("disabled", false);
    }
  }

  // Tabs: composing, paying and collecting are three different visits
  function showTab(name: string): void {
    const tab = ["create", "pay", "collect"].includes(name) ? name : "create";
    $("#cashu-request .tab-panel").hide();
    $(`#cashu-request .tab-panel[data-tab="${tab}"]`).show();
    $("#cashu-request .tab-button").removeClass("active");
    $(`#cashu-request .tab-button[data-tab="${tab}"]`).addClass("active");
  }
  $("#cashu-request .tab-button").on("click", function () {
    const tab = $(this).data("tab") as string;
    showTab(tab);
    history.replaceState(null, "", `#${tab}`);
  });
  showTab(location.hash.replace("#", ""));

  // Click a read-only output to select and copy it
  $("#req-output, #pay-payment, #pay-change").on(
    "click",
    function (this: HTMLTextAreaElement) {
      if (!this.value) return;
      this.select();
      copyTextToClipboard(this.value);
    },
  );

  // Handlers
  $(
    "#req-amount, #req-unit, #req-mints, #req-description, #req-payto, #req-backup, #req-backup-after, #req-nostr",
  ).on("input", debounce(refresh, 250));
  $("#req-blind, #req-legacy, #req-disclose, #req-single").on(
    "change",
    refresh,
  );
  $inspect.on("input", debounce(inspect, 250));
  $copy.on("click", () => {
    copyTextToClipboard($output.val() as string);
    toastr.success("Payment request copied");
  });
  $payButton.on("click", payRequest);
  $inboxButton.on("click", checkInbox);
  $paymentCopy.on("click", () => copyTextToClipboard($payment.val() as string));
  $changeCopy.on("click", () => copyTextToClipboard($change.val() as string));

  // Initialize
  refresh();
});

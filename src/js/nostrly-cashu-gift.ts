// Imports
import {
  MintQuoteState,
  Proof,
  Wallet,
  bytesToHex,
  getEncodedToken,
  hexToBytes,
  isUnknownQuote,
  normalizeXOnlySecretKey,
  type MintQuoteBolt11Response,
} from "@cashu/cashu-ts";
import { nip19 } from "nostr-tools";
import { encode as emojiEncode } from "./emoji-encoder";
import {
  convertP2PKToNpub,
  fetchNip17Dms,
  getContactDetails,
  maybeConvertNpubToHexPub,
  maybeConvertNpubToP2PK,
  sendNip17Dm,
} from "./nostr";
import { getNut11Mints, isPublicKeyValidP2PK } from "./nut11";
import {
  copyTextToClipboard,
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

/**
 * A gift is a paid mint quote locked to the recipient's key. It is not bearer
 * data: whoever holds it still cannot mint without the key it names, which is
 * the point of v3 quote locks.
 */
type Gift = {
  nostrly_gift: 1;
  mint: string;
  quote: string;
  amount: number;
  unit: string;
  memo?: string;
};

const MINT_KEY = "nostrly-gift-mint";
const HISTORY_KEY = "nostrly-gift-history";

type ClaimedGift = {
  date: string;
  token: string;
  amount: number;
  unit: string;
  mint: string;
  memo?: string;
};

// DOM ready
jQuery(function ($) {
  let wallet: Wallet | undefined;
  let polling = false;
  // Held for this page only, so the field can be emptied once it has been read
  let sessionKey: Uint8Array | undefined;

  // DOM elements
  const $mint = $("#gift-mint");
  const $amount = $("#gift-amount");
  const $to = $("#gift-to");
  const $memo = $("#gift-memo");
  const $deliver = $("#gift-deliver");
  const $create = $("#gift-create");
  const $invoiceWrap = $("#gift-invoice-wrap");
  const $invoiceImg = $("#gift-invoice-img");
  const $invoice = $("#gift-invoice");
  const $invoiceCopy = $("#gift-invoice-copy");
  const $status = $("#gift-status");
  const $outWrap = $("#gift-out-wrap");
  const $out = $("#gift-out");
  const $outCopy = $("#gift-out-copy");
  const $claim = $("#claim-input");
  const $claimKey = $("#claim-key");
  const $claimButton = $("#claim-button");
  const $inboxButton = $("#claim-inbox");
  const $inboxOut = $("#claim-inbox-output");
  const $claimOutWrap = $("#claim-out-wrap");
  const $claimOut = $("#claim-out");
  const $claimCopy = $("#claim-out-copy");
  const $claimEmoji = $("#claim-out-emoji");
  const $claimInfo = $("#claim-info");
  const $history = $("#gift-history");
  const $clearHistory = $("#gift-clear-history");
  const $donateCashu = $("#donate_cashu");

  const esc = (s: string) => $("<i>").text(s).html();

  // Donation input
  $donateCashu.on("paste", () => {
    setTimeout(() => {
      handleCashuDonation($donateCashu.val() as string, "Cashu Gift Donation");
      $donateCashu.val("");
    }, 200);
  });

  // Remember the mint between visits: it is the one field nobody wants to retype
  const savedMint = localStorage.getItem(MINT_KEY);
  if (savedMint && $mint.find(`option[value="${savedMint}"]`).length) {
    $mint.val(savedMint);
  }

  // Same mint list as NutLock, refreshed from the auditor on demand
  $mint.on("change", async () => {
    if ($mint.val() !== "discover") return;
    $mint.prop("disabled", true);
    toastr.info("Updating mint list...");
    try {
      const mints = await getNut11Mints();
      $mint.children("option:not(:first)").remove();
      $.each(mints, (_i, url) => {
        $mint.append($("<option></option>").attr("value", url).text(url));
      });
      $mint.append(
        $("<option></option>")
          .attr("value", "discover")
          .text("Discover more mints..."),
      );
      toastr.clear();
      toastr.success("Mint list updated");
    } catch {
      toastr.clear();
      toastr.error("Mint discovery failed");
    }
    $mint.val("").prop("disabled", false);
  });

  // Creates the quote and shows its invoice. The quote is locked to the
  // recipient from the moment it exists, so the invoice is safe to hand around.
  async function createGift() {
    $create.prop("disabled", true);
    try {
      const mintUrl = ($mint.val() as string)?.trim().replace(/\/+$/, "");
      if (!mintUrl) throw new Error("Which mint should the gift come from?");
      const amount = Number(($amount.val() as string)?.trim());
      if (!Number.isFinite(amount) || amount < 1) {
        throw new Error("Enter an amount of at least 1 sat");
      }
      const raw = ($to.val() as string)?.trim();
      if (!raw) throw new Error("Who is the gift for?");
      const toKey = maybeConvertNpubToP2PK(raw);
      if (!isPublicKeyValidP2PK(toKey)) {
        throw new Error("That is not a valid npub or public key");
      }
      localStorage.setItem(MINT_KEY, mintUrl);

      toastr.info("Asking the mint for a locked quote...");
      wallet = await getWalletWithUnit(mintUrl, "sat");
      const quote = await wallet.createMintQuoteBolt11(amount, toKey);
      $invoice.val(quote.request);
      $invoiceImg.attr(
        "src",
        `https://quickchart.io/chart?cht=qr&chs=240x240&chl=${encodeURIComponent(quote.request)}`,
      );
      $invoiceWrap.show();
      $status.text("Waiting for the invoice to be paid...");
      $outWrap.hide();
      polling = true;
      pollQuote(quote.quote, mintUrl, amount, raw);
    } catch (e) {
      console.error("createGift error:", e);
      toastr.error(getErrorMessage(e, "Could not create the gift"));
    } finally {
      $create.prop("disabled", false);
    }
  }

  // Poll rather than subscribe: one invoice, and the wait is usually short
  async function pollQuote(
    quoteId: string,
    mintUrl: string,
    amount: number,
    toRaw: string,
    attempt = 0,
  ) {
    if (!polling || !wallet) return;
    if (attempt > 200) {
      $status.text("Gave up waiting. Reload and try again if it was paid.");
      return;
    }
    try {
      const quote = await wallet.checkMintQuoteBolt11(quoteId);
      if (quote.state === MintQuoteState.PAID) {
        polling = false;
        await giftReady(quote, mintUrl, amount, toRaw);
        return;
      }
      if (quote.state === MintQuoteState.ISSUED) {
        polling = false;
        $status.text("This quote has already been claimed.");
        return;
      }
    } catch (e) {
      console.error("pollQuote error:", e);
    }
    setTimeout(
      () => pollQuote(quoteId, mintUrl, amount, toRaw, attempt + 1),
      3000,
    );
  }

  // The invoice is paid, so the gift exists: hand it over
  async function giftReady(
    quote: MintQuoteBolt11Response,
    mintUrl: string,
    amount: number,
    toRaw: string,
  ) {
    const memo = ($memo.val() as string)?.trim();
    const gift: Gift = {
      nostrly_gift: 1,
      mint: mintUrl,
      quote: quote.quote,
      amount,
      unit: "sat",
      ...(memo ? { memo } : {}),
    };
    $out.val(JSON.stringify(gift));
    $outWrap.show();
    $status.text("Paid. The gift is ready.");

    if (!$deliver.is(":checked")) {
      toastr.success("Gift ready: send it to the recipient");
      return;
    }
    try {
      const hexpub = maybeConvertNpubToHexPub(toRaw);
      if (!/^[0-9a-f]{64}$/.test(hexpub)) {
        throw new Error("needs an npub to deliver over nostr");
      }
      const relays = await sendNip17Dm(
        JSON.stringify(gift),
        hexpub,
        nostrly_ajax.relays,
      );
      $status.text(
        `Paid, and the gift was delivered over nostr to ${relays.join(", ")}`,
      );
      toastr.success("Gift delivered over nostr");
    } catch (e) {
      console.error("gift delivery error:", e);
      toastr.warning(
        "Gift created, but could not deliver it over nostr. Send it by hand.",
      );
    }
  }

  // Reads the key once, then empties the field: a secret key sitting in an
  // input is one screen-share or shoulder away from being someone else's
  function claimPrivkey(): Uint8Array {
    const raw = ($claimKey.val() as string)?.trim();
    if (!raw) {
      if (sessionKey) return sessionKey;
      throw new Error("Paste the private key the gift is locked to");
    }
    const key = raw.startsWith("nsec")
      ? (nip19.decode(raw).data as Uint8Array)
      : hexToBytes(raw);
    if (key.length !== 32) throw new Error("That is not a valid private key");
    sessionKey = key;
    $claimKey.val("");
    return key;
  }

  function parseGift(text: string): Gift {
    const gift = JSON.parse(text) as Gift;
    if (!gift?.mint || !gift?.quote || !gift?.amount) {
      throw new Error("That does not look like a gift");
    }
    return gift;
  }

  // One claim path, shared by a pasted gift and an inbox row. The quote is the
  // input, and the recipient's key signs for it.
  async function claimToToken(gift: Gift, privkey: Uint8Array) {
    const unit = gift.unit || "sat";
    const w = await getWalletWithUnit(gift.mint, unit);
    const quote = await w.checkMintQuoteBolt11(gift.quote);
    if (quote.state === MintQuoteState.ISSUED) {
      throw new Error("This gift has already been claimed");
    }
    if (quote.state !== MintQuoteState.PAID) {
      throw new Error("This gift is not paid yet, so there is nothing to mint");
    }
    // A nostr key is x-only, and a gift locks to it as `02 || x`. Half of all
    // secret keys derive the odd-y twin instead, which signs for the same
    // x-only key but does not match it, so normalize before signing.
    const proofs = await w.mintProofsBolt11(gift.amount, quote, {
      privkey: bytesToHex(normalizeXOnlySecretKey(privkey)),
    });
    return {
      proofs,
      token: getEncodedToken({ mint: gift.mint, unit, proofs }),
    };
  }

  function claimError(e: unknown): string {
    const msg = getErrorMessage(e, "Could not claim this gift");
    return msg.includes("No private key matches")
      ? "That key does not match the one this gift is locked to"
      : msg;
  }

  // Claims the gift pasted into the box
  async function claimGift() {
    $claimButton.prop("disabled", true);
    try {
      const gift = parseGift(($claim.val() as string)?.trim());
      const privkey = claimPrivkey();
      toastr.info("Checking the gift with the mint...");
      const { proofs, token } = await claimToToken(gift, privkey);
      recordClaim(gift, proofs, token);
      $claimOut.val(token);
      $claimOutWrap.show();
      $claimInfo.html(
        `<ul><li class="signed"><span class="status-icon"></span><span>Minted ${esc(formatAmount(getTokenAmount(proofs), gift.unit || "sat"))} from ${esc(gift.mint)}${gift.memo ? `, with the message: ${esc(gift.memo)}` : ""}</span></li></ul>`,
      );
      toastr.success("Gift claimed");
    } catch (e) {
      console.error("claimGift error:", e);
      toastr.error(claimError(e));
    } finally {
      $claimButton.prop("disabled", false);
    }
  }

  // Gifts arrive as ordinary NIP-17 messages, so the inbox filters for them and
  // asks each mint whether the gift is still there to claim.
  async function checkInbox() {
    $inboxButton.prop("disabled", true);
    $inboxOut.hide().empty();
    try {
      const privkey = claimPrivkey();
      toastr.info("Checking relays for gifts...");
      // Relay work gets one overall bound: a slow or silent relay must not leave
      // the button spinning with no way back
      const messages = await Promise.race([
        fetchNip17Dms(privkey, nostrly_ajax.relays),
        new Promise<Awaited<ReturnType<typeof fetchNip17Dms>>>((resolve) =>
          setTimeout(() => resolve([]), 15000),
        ),
      ]);
      // One gift may reach several relays, and a giver may resend it
      const seen = new Set<string>();
      const gifts = messages.flatMap((m) => {
        try {
          const gift = parseGift(m.content);
          if (seen.has(gift.quote)) return [];
          seen.add(gift.quote);
          return [{ gift, created_at: m.created_at }];
        } catch {
          return []; // an ordinary message, not a gift
        }
      });
      if (!gifts.length) {
        toastr.warning("No gifts found on the relays for that key");
        return;
      }
      // One wallet and one batched lookup per mint (NUT-29), not a request per
      // gift: a per-quote round trip runs into the mint's rate limit as gifts
      // accumulate, and loading a v3 keyset repeatedly is wasted work
      const byMint = new Map<string, typeof gifts>();
      for (const entry of gifts) {
        const key = `${entry.gift.mint}|${entry.gift.unit || "sat"}`;
        byMint.set(key, [...(byMint.get(key) ?? []), entry]);
      }
      const rows: Array<{ gift: Gift; created_at: number; state: string }> = [];
      for (const [key, entries] of byMint) {
        const [mint, unit] = key.split("|");
        try {
          const w = await getWalletWithUnit(mint, unit);
          const quotes = await w.checkMintQuoteBatch<MintQuoteBolt11Response>(
            "bolt11",
            entries.map((e) => e.gift.quote),
          );
          entries.forEach((entry, i) => {
            const quote = quotes[i];
            rows.push({
              ...entry,
              state: !quote || isUnknownQuote(quote) ? "unknown" : quote.state,
            });
          });
        } catch (e) {
          console.error("gift state check failed:", e);
          entries.forEach((entry) =>
            rows.push({ ...entry, state: "unreachable" }),
          );
        }
      }
      // Already-claimed gifts stay on the relays forever, so they would pile up
      // in this list for good. They live in the history below instead.
      const claimed = rows.filter((r) => r.state === MintQuoteState.ISSUED);
      const open = rows.filter((r) => r.state !== MintQuoteState.ISSUED);
      renderInbox(open, claimed.length, privkey);
      const claimable = open.filter(
        (r) => r.state === MintQuoteState.PAID,
      ).length;
      toastr.success(
        `Found ${rows.length} gift${rows.length > 1 ? "s" : ""}, ${claimable} ready to claim`,
      );
    } catch (e) {
      console.error("checkInbox error:", e);
      toastr.error(getErrorMessage(e, "Could not check for gifts"));
    } finally {
      $inboxButton.prop("disabled", false);
    }
  }

  // Each gift keeps its own row, so a claimed token stays put rather than being
  // overwritten by the next claim
  function renderInbox(
    rows: Array<{ gift: Gift; created_at: number; state: string }>,
    claimedCount: number,
    privkey: Uint8Array,
  ) {
    const $list = $("<ul></ul>");
    for (const { gift, created_at, state } of rows) {
      const unit = gift.unit || "sat";
      const when = new Date(created_at * 1000).toLocaleString();
      const claimable = state === MintQuoteState.PAID;
      const $row = $("<li></li>").addClass(claimable ? "signed" : "pending");
      const $body = $('<div class="row-body"></div>').append(
        $("<span></span>").text(
          `${formatAmount(gift.amount, unit)} from ${gift.mint}, ${when}${gift.memo ? `: ${gift.memo}` : ""}`,
        ),
      );
      $row.append($('<span class="status-icon"></span>'), $body);
      if (claimable) {
        const $claimIt = $("<button></button>")
          .attr("type", "button")
          .addClass("button")
          .text("Claim")
          .on("click", async () => {
            $claimIt.prop("disabled", true).text("Claiming...");
            try {
              const { proofs, token } = await claimToToken(gift, privkey);
              recordClaim(gift, proofs, token);
              $claimIt.remove();
              $body.append(
                $("<span></span>").text(
                  ` claimed ${formatAmount(getTokenAmount(proofs), unit)}: `,
                ),
                $("<button></button>")
                  .attr("type", "button")
                  .addClass("button")
                  .text("Copy Token")
                  .on("click", () => copyTextToClipboard(token)),
                $("<button></button>")
                  .attr("type", "button")
                  .addClass("button")
                  .text("Copy 🥜")
                  .on("click", () =>
                    copyTextToClipboard(emojiEncode("🥜", token)),
                  ),
              );
              $claimOut.val(token);
              $claimOutWrap.show();
              toastr.success("Gift claimed");
            } catch (e) {
              console.error("claim row error:", e);
              toastr.error(claimError(e));
              $claimIt.prop("disabled", false).text("Claim");
            }
          });
        $body.append(" ", $claimIt);
      } else {
        $body.append(
          $("<span></span>").text(
            state === "unreachable"
              ? " (mint unreachable)"
              : state === "unknown"
                ? " (the mint does not know this quote)"
                : " (not funded yet)",
          ),
        );
      }
      $list.append($row);
    }
    $inboxOut
      .show()
      .empty()
      .append($("<strong></strong>").text("Gifts sent to you:"));
    if (rows.length) {
      $inboxOut.append($list);
    } else {
      $inboxOut.append($("<p></p>").text("Nothing left to claim."));
    }
    if (claimedCount) {
      $inboxOut.append(
        $("<p></p>").text(
          `${claimedCount} already claimed, and kept in your history below.`,
        ),
      );
    }
  }

  function recordClaim(gift: Gift, proofs: Proof[], token: string): void {
    storeClaimed({
      date: new Date().toISOString(),
      token,
      amount: Number(getTokenAmount(proofs).toJSON()),
      unit: gift.unit || "sat",
      mint: gift.mint,
      ...(gift.memo ? { memo: gift.memo } : {}),
    });
    loadHistory();
  }

  // A claimed token exists only in this page until it is swept, so keep it
  function storeClaimed(entry: ClaimedGift): void {
    const history = getClaimed();
    localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...history]));
  }

  function getClaimed(): ClaimedGift[] {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      return stored ? (JSON.parse(stored) as ClaimedGift[]) : [];
    } catch {
      return [];
    }
  }

  function loadHistory(): void {
    const history = getClaimed();
    $history.empty();
    if (!history.length) {
      $history.append($("<p></p>").text("No claimed gifts yet."));
      $clearHistory.hide();
      return;
    }
    $clearHistory.show();
    const $list = $("<ul></ul>");
    for (const entry of history) {
      const $row = $("<li></li>").append(
        $("<span></span>").text(
          `${new Date(entry.date).toLocaleString()} - ${formatAmount(entry.amount, entry.unit)}${entry.memo ? `: ${entry.memo}` : ""} `,
        ),
        $("<button></button>")
          .attr("type", "button")
          .addClass("button")
          .text("Copy Token")
          .on("click", () => copyTextToClipboard(entry.token)),
        $("<button></button>")
          .attr("type", "button")
          .addClass("button")
          .text("Copy 🥜")
          .on("click", () =>
            copyTextToClipboard(emojiEncode("🥜", entry.token)),
          ),
      );
      $list.append($row);
    }
    $history.append($list);
  }

  // Show who a gift is for as soon as the field looks like a key
  $to.on("change", async () => {
    const raw = ($to.val() as string)?.trim();
    if (!raw) return;
    try {
      const npub = raw.startsWith("npub")
        ? raw
        : convertP2PKToNpub(maybeConvertNpubToP2PK(raw));
      const { name } = await getContactDetails(npub, nostrly_ajax.relays);
      if (name) toastr.info(`Gift is for ${name}`);
    } catch {
      // not resolvable, which is fine: the key is what matters
    }
  });

  // Click a read-only output to select and copy it
  $("#gift-invoice, #gift-out, #claim-out").on(
    "click",
    function (this: HTMLTextAreaElement) {
      if (!this.value) return;
      this.select();
      copyTextToClipboard(this.value);
    },
  );

  // Handlers
  $clearHistory.on("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    loadHistory();
  });
  loadHistory();
  $create.on("click", createGift);
  $invoiceCopy.on("click", () => copyTextToClipboard($invoice.val() as string));
  $outCopy.on("click", () => copyTextToClipboard($out.val() as string));
  $claimButton.on("click", claimGift);
  $inboxButton.on("click", checkInbox);
  $claimCopy.on("click", () => copyTextToClipboard($claimOut.val() as string));
  $claimEmoji.on("click", () =>
    copyTextToClipboard(emojiEncode("🥜", $claimOut.val() as string)),
  );
});

// Imports
import {
  MintQuoteState,
  Proof,
  Wallet,
  bytesToHex,
  getEncodedToken,
  hexToBytes,
  isUnknownQuote,
  CashuNip07,
  normalizeXOnlySecretKey,
  type MintProofsConfig,
  type MintQuoteBolt11Response,
} from "@cashu/cashu-ts";
import { getPublicKey, nip19 } from "nostr-tools";
import { encode as emojiEncode } from "./emoji-encoder";
import {
  convertP2PKToNpub,
  fetchNip17Dms,
  getContactDetails,
  getNip61Info,
  getNostrExtensionKeys,
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
// A gift names a quote only its recipient can mint, so it is safe to put in a
// link. It rides the fragment, never a query string, to keep the mint, amount
// and message out of server logs and referrers.
const GIFT_PREFIX = "nostrlygift1";

const b64url = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const unb64url = (encoded: string): string =>
  new TextDecoder().decode(
    Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    ),
  );
const HISTORY_KEY = "nostrly-gift-history";
const SENT_KEY = "nostrly-gift-sent";

type SentGift = {
  date: string;
  link: string;
  amount: number;
  unit: string;
  to: string;
  memo?: string;
};

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
  // Held for this page only, so the field can be emptied once it has been read.
  // Minting accepts candidates (cashu-ts picks the one that matches the quote);
  // unwrapping DMs needs the one key they were sealed to.
  let claimKeys: string[] = [];
  let inboxKey: Uint8Array | undefined;

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
  const $nip07Button = $("#claim-nip07");
  const $nip61 = $("#gift-nip61");
  const $inboxOut = $("#claim-inbox-output");
  const $claimOutWrap = $("#claim-out-wrap");
  const $claimOut = $("#claim-out");
  const $claimCopy = $("#claim-out-copy");
  const $claimEmoji = $("#claim-out-emoji");
  const $claimInfo = $("#claim-info");
  const $history = $("#gift-history");
  const $clearHistory = $("#gift-clear-history");
  const $sent = $("#gift-sent");
  const $clearSent = $("#gift-clear-sent");
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
      let toKey = maybeConvertNpubToP2PK(raw);
      if (!isPublicKeyValidP2PK(toKey)) {
        throw new Error("That is not a valid npub or public key");
      }
      // A nutzap key is the one their wallet holds, and an extension can hand
      // it over: locking there means they never type a secret to claim. Their
      // identity key signs their posts and should not double as a money key.
      if ($nip61.is(":checked") && raw.startsWith("npub")) {
        const { pubkey } = await getNip61Info(raw, nostrly_ajax.relays);
        if (pubkey) {
          toKey = pubkey;
          toastr.info("Locking to their NIP-61 nutzap key");
        } else {
          toastr.warning(
            "No NIP-61 nutzap key published, so locking to their nostr key: they will need it to claim",
          );
        }
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
    $out.val(giftLink(gift));
    $outWrap.show();
    $status.text("Paid. The gift is ready.");
    // The link is the only way back to an unsent gift, and it lives nowhere
    // else: the invoice is paid, so losing the tab must not lose the gift
    storeSent({
      date: new Date().toISOString(),
      link: giftLink(gift),
      amount: gift.amount,
      unit: gift.unit || "sat",
      to: toRaw,
      ...(gift.memo ? { memo: gift.memo } : {}),
    });
    loadSent();

    if (!$deliver.is(":checked")) {
      toastr.success("Gift ready: send it to the recipient");
      return;
    }
    try {
      const hexpub = maybeConvertNpubToHexPub(toRaw);
      if (!/^[0-9a-f]{64}$/.test(hexpub)) {
        throw new Error("needs an npub to deliver over nostr");
      }
      // A readable line, not a blob: this lands in an ordinary DM client
      const message = `You have been sent ${formatAmount(gift.amount, gift.unit || "sat")} in ecash${gift.memo ? `: ${gift.memo}` : ""}\n\nClaim it here: ${giftLink(gift)}`;
      const relays = await sendNip17Dm(message, hexpub, nostrly_ajax.relays);
      $status.text(
        `Paid, and the gift was delivered over nostr to ${relays.join(", ")}`,
      );
      toastr.success("Gift delivered over nostr");
    } catch (e) {
      console.error("gift delivery error:", e);
      // The gift is safe either way, so say why nostr could not carry it
      toastr.warning(
        `Gift created, but not delivered over nostr: ${getErrorMessage(e, "send it by hand")}`,
      );
      $status.text("Paid. The gift is ready, but send the link by hand.");
    }
  }

  // A key from an x-only context names a point without its parity: the gift may
  // be locked to `02 || x` while the secret derives its odd-y twin. Offer both
  // and let the mint's own pubkey decide, rather than guessing which is meant.
  function addClaimKeys(keys: Uint8Array[]): void {
    claimKeys = [
      ...new Set([
        ...keys.flatMap((key) => [
          bytesToHex(key),
          bytesToHex(normalizeXOnlySecretKey(key)),
        ]),
        ...claimKeys,
      ]),
    ];
    syncKeyButtons();
  }

  // Neither action can do anything without a key, so they wait for one rather
  // than offering themselves and then failing. An extension counts as a key for
  // claiming: it can sign for a gift locked to its own nostr key.
  function syncKeyButtons(): void {
    const typed = !!($claimKey.val() as string)?.trim();
    $claimButton.prop(
      "disabled",
      !typed && !claimKeys.length && !hasExtensionSigner(),
    );
    // Only the recipient's own nostr key unwraps their messages, so the
    // extension's wallet keys do not enable this one
    $inboxButton.prop("disabled", !typed && !inboxKey);
  }

  // Reads the key once, then empties the field: a secret key sitting in an
  // input is one screen-share or shoulder away from being someone else's
  function readKeyField(): boolean {
    const raw = ($claimKey.val() as string)?.trim();
    if (!raw) return false;
    const key = raw.startsWith("nsec")
      ? (nip19.decode(raw).data as Uint8Array)
      : hexToBytes(raw);
    if (key.length !== 32) throw new Error("That is not a valid private key");
    inboxKey = key;
    $claimKey.val("");
    addClaimKeys([key]);
    return true;
  }

  // Keys for minting: whatever was typed, plus anything the extension unlocked.
  // Empty is allowed when an extension can sign instead (see extensionSignerFor).
  function keysForClaim(): string[] {
    readKeyField();
    if (!claimKeys.length && !hasExtensionSigner()) {
      throw new Error(
        "Add the key this gift is locked to, or unlock your nostr wallet",
      );
    }
    return claimKeys;
  }

  function hasExtensionSigner(): boolean {
    return !!window.nostr && CashuNip07.canSign(window.nostr);
  }

  // A gift locked to the extension's own nostr key is claimed by asking the
  // extension to sign the quote, so the identity key never enters the page.
  // Held keys win when one of them matches; the extension covers the rest.
  async function extensionSignerFor(
    quotePubkey: string | undefined,
    privkeys: string[],
  ): Promise<MintProofsConfig["sign"] | undefined> {
    if (!quotePubkey || !window.nostr || !hasExtensionSigner())
      return undefined;
    const x = quotePubkey.slice(-64).toLowerCase();
    const held = privkeys.some(
      (k) => getPublicKey(hexToBytes(k)).toLowerCase() === x,
    );
    if (held) return undefined;
    const extension = await CashuNip07.pubkey(window.nostr);
    if (extension.slice(-64).toLowerCase() !== x) return undefined;
    return CashuNip07.signQuote(window.nostr);
  }

  // The extension will not hand over its identity key, but it will decrypt the
  // NIP-60 wallet keys a NIP-61 gift is locked to, so nobody types a secret
  async function unlockWalletKeys() {
    $nip07Button.prop("disabled", true);
    try {
      const { pubkey, privkeys } = await getNostrExtensionKeys(
        nostrly_ajax.relays,
      );
      // Naming the account is the whole diagnosis when a gift will not open:
      // an extension signed in as somebody else unlocks the wrong wallet
      const npub = pubkey ? nip19.npubEncode(pubkey.slice(-64)) : "";
      const whose = npub ? ` for ${npub.slice(0, 12)}...${npub.slice(-4)}` : "";
      if (!privkeys.length) {
        toastr.warning(
          `No nostr wallet keys found${whose}. A gift locked to your nostr key still needs that key pasted.`,
        );
        return;
      }
      // A nutzap key is published x-only, so these need both parities too
      addClaimKeys(privkeys.map(hexToBytes));
      // The public halves, so a gift that will not open can be checked against
      // the nutzap key its giver locked to
      console.log(
        "unlocked wallet pubkeys:",
        privkeys.map((k) => getPublicKey(hexToBytes(k))),
      );
      toastr.success(
        `Unlocked ${privkeys.length} wallet key${privkeys.length > 1 ? "s" : ""}${whose}: you can claim without pasting anything`,
      );
    } catch (e) {
      console.error("unlockWalletKeys error:", e);
      toastr.error(getErrorMessage(e, "Could not unlock your nostr wallet"));
    } finally {
      $nip07Button.prop("disabled", false);
    }
  }

  // Takes whatever the recipient was sent: a claim link, the encoded gift, or
  // the raw JSON it wraps
  function parseGift(text: string): Gift {
    const raw = text.trim();
    if (!raw) {
      throw new Error(
        "Paste a claim link or gift here, or fetch one from nostr",
      );
    }
    let gift: Gift | undefined;
    try {
      const fromLink = raw.match(/#gift=([A-Za-z0-9_-]+)/);
      let payload = fromLink ? fromLink[1] : raw;
      if (payload.startsWith(GIFT_PREFIX)) {
        payload = unb64url(payload.slice(GIFT_PREFIX.length));
      } else if (!payload.startsWith("{")) {
        payload = unb64url(payload); // bare encoding, no prefix
      }
      gift = JSON.parse(payload) as Gift;
    } catch {
      // Undecodable text is not a gift, and says so below rather than
      // surfacing a decoder error
    }
    if (!gift?.mint || !gift?.quote || !gift?.amount) {
      throw new Error("That does not look like a gift");
    }
    return gift;
  }

  const encodeGift = (gift: Gift): string =>
    GIFT_PREFIX + b64url(JSON.stringify(gift));

  // The page the giver is on is the page the recipient needs
  const giftLink = (gift: Gift): string =>
    `${location.origin}${location.pathname}#gift=${encodeGift(gift)}`;

  // One claim path, shared by a pasted gift and an inbox row. The quote is the
  // input, and the recipient's key signs for it.
  async function claimToToken(gift: Gift, privkeys: string[]) {
    const unit = gift.unit || "sat";
    const w = await getWalletWithUnit(gift.mint, unit);
    const quote = await w.checkMintQuoteBolt11(gift.quote);
    if (quote.state === MintQuoteState.ISSUED) {
      throw new Error("This gift has already been claimed");
    }
    if (quote.state !== MintQuoteState.PAID) {
      throw new Error("This gift is not paid yet, so there is nothing to mint");
    }
    const sign = await extensionSignerFor(quote.pubkey, privkeys);
    if (sign) toastr.info("Asking your extension to sign for the gift...");
    const proofs = await w.mintProofsBolt11(
      gift.amount,
      quote,
      sign ? { sign } : { privkey: privkeys },
    );
    return {
      proofs,
      token: getEncodedToken({ mint: gift.mint, unit, proofs }),
    };
  }

  function claimError(e: unknown): string {
    const msg = getErrorMessage(e, "Could not claim this gift");
    return msg.includes("No private key matches")
      ? "No key here matches this gift. Check which account your extension is signed in as, or paste the key it is locked to"
      : msg;
  }

  // Claims the gift pasted into the box
  async function claimGift() {
    $claimButton.prop("disabled", true);
    try {
      const gift = parseGift(($claim.val() as string)?.trim());
      const keys = keysForClaim();
      toastr.info("Checking the gift with the mint...");
      const { proofs, token } = await claimToToken(gift, keys);
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
      syncKeyButtons();
    }
  }

  // Gifts arrive as ordinary NIP-17 messages, so the inbox filters for them and
  // asks each mint whether the gift is still there to claim.
  async function checkInbox() {
    $inboxButton.prop("disabled", true);
    $inboxOut.hide().empty();
    try {
      readKeyField();
      if (!inboxKey) {
        throw new Error(
          "Fetching needs your own nsec in the field beside it, as the extension cannot read your messages",
        );
      }
      const privkey = inboxKey;
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
      renderInbox(open, claimed.length);
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
      syncKeyButtons();
    }
  }

  // Each gift keeps its own row, so a claimed token stays put rather than being
  // overwritten by the next claim
  function renderInbox(
    rows: Array<{ gift: Gift; created_at: number; state: string }>,
    claimedCount: number,
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
              const { proofs, token } = await claimToToken(
                gift,
                keysForClaim(),
              );
              recordClaim(gift, proofs, token);
              $claimIt.remove();
              $body.append(
                $("<span></span>").text(
                  ` claimed ${formatAmount(getTokenAmount(proofs), unit)}: `,
                ),
                $("<button></button>")
                  .attr("type", "button")
                  .addClass("button copy-token")
                  .text("Copy Token")
                  .on("click", () => copyTextToClipboard(token)),
                $("<button></button>")
                  .attr("type", "button")
                  .addClass("button copy-emoji")
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

  function storeSent(entry: SentGift): void {
    try {
      const stored = localStorage.getItem(SENT_KEY);
      const history = stored ? (JSON.parse(stored) as SentGift[]) : [];
      localStorage.setItem(SENT_KEY, JSON.stringify([entry, ...history]));
    } catch (e) {
      console.error("storeSent failed:", e);
    }
  }

  function loadSent(): void {
    let history: SentGift[];
    try {
      const stored = localStorage.getItem(SENT_KEY);
      history = stored ? (JSON.parse(stored) as SentGift[]) : [];
    } catch {
      history = [];
    }
    $sent.empty();
    if (!history.length) {
      $sent.append($("<p></p>").text("No gifts sent yet."));
      $clearSent.hide();
      return;
    }
    $clearSent.show();
    const $list = $("<ul></ul>");
    for (const entry of history) {
      $list.append(
        $("<li></li>").append(
          $("<span></span>").text(
            `${new Date(entry.date).toLocaleString()} - ${formatAmount(entry.amount, entry.unit)} to ${entry.to.slice(0, 12)}...${entry.to.slice(-6)}${entry.memo ? `: ${entry.memo}` : ""} `,
          ),
          $("<button></button>")
            .attr("type", "button")
            .addClass("button")
            .text("Copy Claim Link")
            .on("click", () => copyTextToClipboard(entry.link)),
        ),
      );
    }
    $sent.append($list);
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
          .addClass("button copy-token")
          .text("Copy Token")
          .on("click", () => copyTextToClipboard(entry.token)),
        $("<button></button>")
          .attr("type", "button")
          .addClass("button copy-emoji")
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

  // Tabs: giver and recipient never need each other's half, and a recipient
  // arriving from a link should land on the claim side, not scroll past a form
  function showTab(name: string): void {
    const tab = name === "claim" ? "claim" : "create";
    $("#cashu-gift .tab-panel").hide();
    $(`#cashu-gift .tab-panel[data-tab="${tab}"]`).show();
    $("#cashu-gift .tab-button").removeClass("active");
    $(`#cashu-gift .tab-button[data-tab="${tab}"]`).addClass("active");
  }
  $("#cashu-gift .tab-button").on("click", function () {
    const tab = $(this).data("tab") as string;
    showTab(tab);
    history.replaceState(null, "", `#${tab}`);
  });

  // A claim link carries the gift itself, so open it ready to claim
  const hash = location.hash;
  const linked = hash.match(/#gift=([A-Za-z0-9_-]+)/);
  if (linked) {
    try {
      const gift = parseGift(hash);
      $claim.val(encodeGift(gift));
      showTab("claim");
      toastr.info(
        `A gift of ${formatAmount(gift.amount, gift.unit || "sat")} is ready to claim: add your key below`,
      );
    } catch {
      showTab("claim");
      toastr.error("That claim link is not readable");
    }
  } else {
    showTab(hash === "#claim" ? "claim" : "create");
  }

  // Handlers
  $clearHistory.on("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    loadHistory();
  });
  $clearSent.on("click", () => {
    localStorage.removeItem(SENT_KEY);
    loadSent();
  });
  loadHistory();
  loadSent();
  $create.on("click", createGift);
  $invoiceCopy.on("click", () => copyTextToClipboard($invoice.val() as string));
  $outCopy.on("click", () => copyTextToClipboard($out.val() as string));
  $claimButton.on("click", claimGift);
  $inboxButton.on("click", checkInbox);
  $nip07Button.on("click", unlockWalletKeys);
  $claimKey.on("input", syncKeyButtons);
  syncKeyButtons();
  $claimCopy.on("click", () => copyTextToClipboard($claimOut.val() as string));
  $claimEmoji.on("click", () =>
    copyTextToClipboard(emojiEncode("🥜", $claimOut.val() as string)),
  );
});

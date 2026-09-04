import {
  Wallet,
  isBlsKeyset,
  ConsoleLogger,
  Amount,
  serializeProofs,
  deserializeProofs,
  classifyNutrootSpendInfo,
  parseNutrootLeafHex,
  StaleKeysetError,
  type AmountLike,
  type GetInfoResponse,
  type KeyChainCache,
  type NutrootLeaf,
  type Proof,
} from "@cashu/cashu-ts";
import toastr from "toastr";
import confetti from "canvas-confetti";
import { decode } from "@gandlaf21/bolt11-decode";

type CurrencyUnit = "btc" | "sat" | "msat" | string;
const TOKEN_HISTORY_KEY = "cashu.lockedTokens";

interface MintData {
  keyChainCache: KeyChainCache;
  mintInfo: GetInfoResponse;
  unit: string;
  mintUrl: string;
  lastUpdated: number;
}

const getMintCacheKey = (mintUrl: string, unit: CurrencyUnit): string => {
  return `cashu.mint.${mintUrl}.${String(unit).toLowerCase()}`;
};

const isMintData = (value: unknown): value is MintData => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<MintData>;
  return (
    typeof data.mintUrl === "string" &&
    typeof data.unit === "string" &&
    typeof data.lastUpdated === "number" &&
    !!data.mintInfo &&
    !!data.keyChainCache &&
    Array.isArray(data.keyChainCache.keysets)
  );
};

interface NutLockEntry {
  date: string;
  name: string;
  token: string;
  amount: number | string; // Amount.toJSON() returns number | string
}

// Keyset dispatch every v3-aware tool needs; re-exported so tools import it
// from one place alongside the helpers below
export { isBlsProof } from "@cashu/cashu-ts";

/**
 * What a v3 proof's spend info says about who can spend it, for the holder.
 * @remarks Classification comes from cashu-ts; only the UI text lives here.
 */
export function describeV3KeyPath(proof: Proof): {
  kind: ReturnType<typeof classifyNutrootSpendInfo>;
  text: string;
} {
  const kind = classifyNutrootSpendInfo(proof);
  switch (kind) {
    case "bearer":
      return {
        kind,
        text: "Unlocked: the spending key travels with the token, so anyone holding it can spend or sweep it.",
      };
    case "script-only":
      return {
        kind,
        text: "No key path: provably unspendable (NUMS), so only a script leaf can spend it.",
      };
    case "receiver-keyed":
      return {
        kind,
        text: "A blinded recipient key: paste a private key to check if it unlocks.",
      };
    case "disclosed":
      return {
        kind,
        text: "Key held by someone else: only a script leaf can spend it here.",
      };
    default:
      return {
        kind,
        text: "No spending info travels with this token: it cannot be spent from here (it may be the owner's own wallet proof).",
      };
  }
}

/**
 * Parses the disclosed nutroot leaves riding a v3 proof's spend_info.
 */
export function getNutrootLeaves(proof: Proof): NutrootLeaf[] {
  return (proof.spend_info?.tree ?? []).map(parseNutrootLeafHex);
}

/**
 * One-line human description of a nutroot leaf's spending condition.
 */
export function describeNutrootLeaf(leaf: NutrootLeaf): string {
  const m = leaf.keys.length;
  const sigs = `${leaf.n} of ${m} signature${m > 1 ? "s" : ""}`;
  const disclosed = leaf.disclosure
    ? ", publicly verifiable (the mint publishes the witness)"
    : "";
  switch (leaf.type) {
    case "after":
      return `Timelock: ${sigs} after ${new Date((leaf.time ?? 0) * 1000).toLocaleString().slice(0, -3)}${disclosed}`;
    case "hashlock":
      return `Hashlock: secret preimage (${leaf.hash?.slice(0, 8)}…) plus ${sigs}${disclosed}`;
    default:
      return `Multisig: ${sigs}${disclosed}`;
  }
}

/**
 * Gets the token amount by summing its proof amounts
 * @param proofs Array of proofs to sum
 * @return The token amount
 */
export const getTokenAmount = (proofs: Array<Proof>): Amount => {
  return Amount.sum(proofs.map((p) => p.amount));
};

/**
 * Formats an amount into a locale-specific string based on the specified unit.
 * NB: Amount is expected to be in the minor unit of the currency
 * eg sats for Bitcoin, cents for USD etc
 *
 * @param {number} amount - The amount to format
 * @param {CurrencyUnit} unit - The currency unit of the amount. Defaults to sat.
 * @param {string} locale - The locale for formatting (eg: 'en-US', 'fr-FR'). Defaults to 'en-US'.
 * @returns {string} A formatted string (eg: '₿ 1.23456789 BTC', '$123.45').
 * @throws Logs a warning and returns a fallback string for invalid units or locales.
 */
export const formatAmount = (
  amount: AmountLike,
  unit: CurrencyUnit = "sat",
  locale: string = "en-US",
): string => {
  const a = Amount.from(amount);
  const upperUnit = unit.toUpperCase();
  const bitcoinUnits: Record<
    string,
    { minorUnit: number; prefix: string; suffix: string }
  > = {
    BTC: { minorUnit: 8, prefix: "₿ ", suffix: " BTC" },
    SAT: { minorUnit: 0, prefix: "₿ ", suffix: " sat" },
    MSAT: { minorUnit: 3, prefix: "₿ ", suffix: " sat" },
  };
  let minorUnit: number;
  let prefix = "";
  let suffix = "";
  let options: Intl.NumberFormatOptions = {};
  if (upperUnit in bitcoinUnits) {
    // Handle Bitcoin units
    ({ minorUnit, prefix, suffix } = bitcoinUnits[upperUnit]);
  } else {
    // Handle Fiat currencies
    // prettier-ignore
    const specialMinorUnits: Record<string, number> = {
      BHD: 3, BIF: 0, CLF: 4, CLP: 0, DJF: 0, GNF: 0,
      IQD: 3, ISK: 0, JOD: 3, JPY: 0, KMF: 0, KRW: 0,
      KWD: 3, LYD: 3, OMR: 3, PYG: 0, RWF: 0, TND: 3,
      UGX: 0, UYI: 0, UYW: 4, VND: 0, VUV: 0, XAF: 0,
      XOF: 0, XPF: 0
    };
    // Apply correct minor unit adjustment (default: 2)
    minorUnit = specialMinorUnits[upperUnit] ?? 2;
    options = { style: "currency", currency: upperUnit };
  }
  options.minimumFractionDigits = minorUnit;
  options.maximumFractionDigits = minorUnit;
  try {
    const formatter = new Intl.NumberFormat(locale, options);
    if (minorUnit === 0) {
      // Integer unit (sat, JPY, etc.) — pass bigint directly; Intl supports it natively
      return prefix + formatter.format(a.toBigInt()) + suffix;
    }
    // Decimal unit (fiat, BTC) — these amounts won't realistically exceed safe integer range
    const adjustedAmount = a.toNumber() / 10 ** minorUnit;
    return prefix + formatter.format(adjustedAmount) + suffix;
  } catch (error) {
    console.warn(`Invalid unit or locale: ${unit}, ${locale}`, error);
    return `${a.toString()} ${unit}`;
  }
};

/**
 * Store mint proofs to localStorage, ensuring uniqueness by secret
 * @param {string}       mintUrl The mint url
 * @param {Array<Proof>} proofs  Array of proofs to store
 * @param {boolean}      replace Overwrites proofs in store if true (default: false)
 */
export function storeMintProofs(
  mintUrl: string,
  proofs: Array<Proof>,
  replace: boolean = false,
): void {
  // Remove duplicate proofs
  const uniqueNewProofs = Array.from(
    new Map(proofs.map((proof) => [proof.secret, proof])).values(),
  );
  let finalProofs: Array<Proof>;
  if (replace) {
    finalProofs = uniqueNewProofs;
  } else {
    const stored: Array<Proof> = getMintProofs(mintUrl);
    const combinedProofs = [...uniqueNewProofs, ...stored];
    // Ensure all proofs are unique
    finalProofs = Array.from(
      new Map(combinedProofs.map((proof) => [proof.secret, proof])).values(),
    );
  }
  localStorage.setItem(
    `cashu.proofs.${mintUrl}`,
    JSON.stringify(serializeProofs(finalProofs)),
  );
}

/**
 * Get mint proofs from localStorage
 * @param  {string}       mintUrl The Mint URL
 * @return {Array<Proof>}         Array of stored proofs
 */
export function getMintProofs(mintUrl: string): Array<Proof> {
  const stored: string | null = localStorage.getItem(`cashu.proofs.${mintUrl}`);
  if (!stored) return [];
  return deserializeProofs(JSON.parse(stored));
}

/**
 * Stores a new locked token with metadata in localStorage
 * @param {string} token  token to store
 * @param {number} amount amound of token
 * @param {string} name   label for locked token
 */
export function storeLockedToken(
  token: string,
  amount: AmountLike,
  name: string,
): void {
  const stored = getLockedTokens();
  const newEntry: NutLockEntry = {
    date: new Date().toISOString(),
    name,
    token,
    amount: Amount.from(amount).toJSON(),
  };
  const updated = [newEntry, ...stored];
  localStorage.setItem(TOKEN_HISTORY_KEY, JSON.stringify(updated));
}

/**
 * Gets the locked token history from localStorage
 * @return {NutLockEntry[]} [description]
 */
export function getLockedTokens(): NutLockEntry[] {
  const stored = localStorage.getItem(TOKEN_HISTORY_KEY);
  if (!stored) {
    return [];
  }
  try {
    const parsed = JSON.parse(stored);
    return parsed as NutLockEntry[];
  } catch (e) {
    // Clear the invalid data and return an empty array
    localStorage.removeItem(TOKEN_HISTORY_KEY);
    return [];
  }
}

/**
 * Clears locked token history from localStorage
 */
export function clearLockedTokens(): void {
  localStorage.removeItem(TOKEN_HISTORY_KEY);
}

/**
 * Instantiates a Cashu wallet for a specified mint and unit
 * @param  {string} mintUrl The mint URL
 * @param  {CurrencyUnit} unit    The wallet unit (default: sat)
 * @return {Promise<Wallet>} A promise to return the wallet
 */
export const getWalletWithUnit = async (
  mintUrl: string,
  unit: CurrencyUnit = "sat",
  opts?: { legacy?: boolean },
): Promise<Wallet> => {
  const wallet = await loadWalletWithUnit(mintUrl, unit);
  if (!opts?.legacy) return wallet;
  // Testing aid: bind to an active pre-v3 keyset so the same mint exercises
  // the NUT-11 path; the wallet otherwise binds to the cheapest keyset
  const legacy = wallet.keyChain
    .getKeysets()
    .find((k) => k.isActive && !isBlsKeyset(k.id));
  if (!legacy) return wallet;
  const bound = new Wallet(mintUrl, {
    unit,
    keysetId: legacy.id,
    logger: new ConsoleLogger("debug"),
  });
  bound.loadMintFromCache(wallet.getMintInfo().cache, wallet.keyChain.cache);
  return bound;
};

const loadWalletWithUnit = async (
  mintUrl: string,
  unit: CurrencyUnit,
): Promise<Wallet> => {
  const cacheKey = getMintCacheKey(mintUrl, unit);

  // Load cached data
  const stored: string | null = localStorage.getItem(cacheKey);
  const parsed: unknown = stored ? JSON.parse(stored) : null;
  const cache: MintData | null = isMintData(parsed) ? parsed : null;
  const logger = new ConsoleLogger("debug");
  console.log("getWalletWithUnit:>> cache", cache);

  // Cache expired (> 12 hours) - load fresh and save data
  if (!cache || cache.lastUpdated < Date.now() - 12 * 3600 * 1000) {
    const wallet = new Wallet(mintUrl, { unit, logger });
    await wallet.loadMint();
    // Cache the data
    const keyChainCache = wallet.keyChain.cache;
    const freshData: MintData = {
      mintUrl: wallet.mint.mintUrl,
      unit: wallet.unit,
      mintInfo: wallet.getMintInfo().cache,
      keyChainCache,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(cacheKey, JSON.stringify(freshData));
    console.log("getWalletWithUnit:>> using fresh data", freshData);
    return wallet;
  }

  // Use cached data
  const wallet = new Wallet(cache.mintUrl, { unit: cache.unit, logger });
  wallet.loadMintFromCache(cache.mintInfo, cache.keyChainCache);
  console.log("getWalletWithUnit:>> using cached data", cache);
  return wallet;
};

/**
 * Runs a wallet operation, retrying once after a repaired keyset snapshot
 * @remarks Wallet ops throw StaleKeysetError (with the snapshot already
 * refreshed) when the mint rotates keysets; builders are single use, so
 * fn must build a fresh operation on each call.
 */
export async function withStaleRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StaleKeysetError && e.repaired) {
      return await fn();
    }
    throw e;
  }
}

/**
 * Copies text to clipboard, with fallback for localhost operation
 * @param {string} text Text to copy
 */
export function copyTextToClipboard(text: string) {
  if (!navigator.clipboard) {
    fallbackCopyTextToClipboard(text);
    return;
  }
  navigator.clipboard.writeText(text).then(
    function () {
      toastr.info("copied!");
    },
    function (err) {
      console.error("Async: Could not copy text: ", err);
    },
  );
}

function fallbackCopyTextToClipboard(text: string) {
  var textArea = document.createElement("textarea");
  textArea.value = text;

  // Avoid scrolling to bottom
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    var successful = document.execCommand("copy");
    if (successful) {
      toastr.info("copied!");
    }
  } catch (err) {
    console.error("Fallback: Oops, unable to copy", err);
  }

  document.body.removeChild(textArea);
}

/**
 * Activates the confetti bomb effect
 */
export function doConfettiBomb() {
  // Do the confetti bomb
  var duration = 0.25 * 1000; //secs
  var end = Date.now() + duration;

  (function frame() {
    // launch a few confetti from the left edge
    confetti({
      particleCount: 7,
      angle: 60,
      spread: 55,
      origin: {
        x: 0,
      },
    });
    // and launch a few from the right edge
    confetti({
      particleCount: 7,
      angle: 120,
      spread: 55,
      origin: {
        x: 1,
      },
    });

    // keep going until we are out of time
    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();
  confetti.reset();
}

/**
 * Returns apromise to create a delay
 * @param delay time in ms
 * @example await delay(1000); // waits 1 second
 */
export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Debounces a function for delay milliseconds to prevent excessive calls.
 *
 * @param func - Function to debounce.
 * @param delay - Delay in milliseconds.
 * @returns Debounced function with the same parameters as `func`.
 */
export const debounce = <T extends (...args: any[]) => void>(
  func: T,
  delay: number,
): ((...args: Parameters<T>) => void) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

/**
 * Gets the invoice amount in sats for a lightning invoice
 * @param {string} lnInvoice The LN Invoice
 */
export const getSatsAmount = (lnInvoice: string) => {
  try {
    const decoded = decode(lnInvoice);
    const amountSection = decoded.sections.find(
      (section) => section.name === "amount",
    );
    if (!amountSection || !amountSection.value) {
      throw new Error("Amount not found in Lightning invoice!");
    }
    // Extract millisats (value is a string, so parse it)
    const millisats = parseInt(amountSection.value, 10);
    return Math.floor(millisats / 1000); // sats
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Error extracting amount:", msg);
    throw e;
  }
};

export function getErrorMessage(
  error: unknown,
  defaultMsg: string = "Unknown error",
): string {
  if (error instanceof Error) {
    return error.message;
  }
  // Handle non-Error throws gracefully
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return defaultMsg;
}

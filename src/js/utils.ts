import {
  CashuMint,
  CashuWallet,
  type MintKeys,
  type MintKeyset,
  type GetInfoResponse,
  type Proof,
  type MintActiveKeys,
  type MintAllKeysets,
} from "@cashu/cashu-ts";
import toastr from "toastr";
import confetti from "canvas-confetti";
import { decode } from "@gandlaf21/bolt11-decode";

type CurrencyUnit = "btc" | "sat" | "msat" | string;
const TOKEN_HISTORY_KEY = "cashu.lockedTokens";

interface MintData {
  keys: MintKeys[];
  keysets: MintKeyset[];
  info: GetInfoResponse;
  lastUpdated: number;
}

interface NutLockEntry {
  date: string;
  name: string;
  token: string;
  amount: number;
}

/**
 * Gets the token amount by summing its proof amounts
 * @param {Array<Proof>} Array of proofs to sum
 * @return {number} The token amount
 */
export const getTokenAmount = (proofs: Array<Proof>): number => {
  return proofs.reduce((acc, proof) => {
    return acc + proof.amount;
  }, 0);
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
  amount: number,
  unit: CurrencyUnit = "sat",
  locale: string = "en-US",
): string => {
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
  // Adjust to major unit for display
  const adjustedAmount = amount / 10 ** minorUnit;
  options.minimumFractionDigits = minorUnit;
  options.maximumFractionDigits = minorUnit;
  try {
    const formatter = new Intl.NumberFormat(locale, options);
    return prefix + formatter.format(adjustedAmount) + suffix;
  } catch (error) {
    console.warn(`Invalid unit or locale: ${unit}, ${locale}`, error);
    return `${amount} ${unit}`;
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
  localStorage.setItem(`cashu.proofs.${mintUrl}`, JSON.stringify(finalProofs));
}

/**
 * Get mint proofs from localStorage
 * @param  {string}       mintUrl The Mint URL
 * @return {Array<Proof>}         Array of stored proofs
 */
export function getMintProofs(mintUrl: string): Array<Proof> {
  const stored: string | null = localStorage.getItem(`cashu.proofs.${mintUrl}`);
  return stored ? JSON.parse(stored) : [];
}

/**
 * Stores a new locked token with metadata in localStorage
 * @param {string} token  token to store
 * @param {number} amount amound of token
 * @param {string} name   label for locked token
 */
export function storeLockedToken(
  token: string,
  amount: number,
  name: string,
): void {
  const stored = getLockedTokens();
  const newEntry: NutLockEntry = {
    date: new Date().toISOString(),
    name,
    token,
    amount,
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
 * @return {Promise<CashuWallet>} A promise to return the wallet
 */
export const getWalletWithUnit = async (
  mintUrl: string,
  unit: CurrencyUnit = "sat",
): Promise<CashuWallet> => {
  const mintData = await loadMint(mintUrl);
  const mint = new CashuMint(mintUrl);
  const keys = mintData.keys.filter((ks) => ks.unit === unit);
  const keysets = mintData.keysets.filter((ks) => ks.unit === unit);
  // console.log("keys:>>", keys);
  // console.log("keysets:>>", keysets);
  const wallet = new CashuWallet(mint, {
    keys,
    keysets,
    mintInfo: mintData.info,
    unit,
  });
  return wallet;
};

function storeMintData(mintUrl: string, mintData: MintData): void {
  localStorage.setItem(`cashu.mint.${mintUrl}`, JSON.stringify(mintData));
}

async function loadMint(mintUrl: string): Promise<MintData> {
  const stored: string | null = localStorage.getItem(`cashu.mint.${mintUrl}`);
  const cachedData: MintData | null = stored ? JSON.parse(stored) : null;
  try {
    // Always fetch info and keysets
    const cashuMint = new CashuMint(mintUrl);
    const mintInfo = await cashuMint.getInfo();
    const mintAllKeysets: MintAllKeysets = await cashuMint.getKeySets();
    // Check we have keys cached for all active keyset IDs
    const cachedKeysetIds = cachedData?.keys?.map((keyset) => keyset.id) || [];
    const activeKeysetIds = mintAllKeysets.keysets
      .filter((keyset) => keyset.active)
      .map((keyset) => keyset.id);
    const hasAllActiveKeys = activeKeysetIds.every((id) =>
      cachedKeysetIds.includes(id),
    );
    let mintActiveKeys: MintActiveKeys; // scope
    if (cachedData && hasAllActiveKeys) {
      // Use cached keys if they cover all active keyset IDs
      console.log("loadMint:>> using cached keys", cachedData.keys);
      mintActiveKeys = { keysets: cachedData.keys };
    } else {
      // Fetch fresh keys if any active keyset ID is missing
      mintActiveKeys = await cashuMint.getKeys();
      console.log("loadMint:>> fetched fresh keys", mintActiveKeys);
    }
    // Cache the data
    const freshData: MintData = {
      info: mintInfo,
      keys: mintActiveKeys.keysets,
      keysets: mintAllKeysets.keysets,
      lastUpdated: Date.now(),
    };
    storeMintData(mintUrl, freshData);
    console.log("loadMint:>> using fresh data", freshData);
    return freshData;
  } catch (error) {
    if (cachedData) {
      console.log(
        "loadMint:>> fetch failed, returning cached data",
        cachedData,
      );
      return cachedData;
    }
    throw new Error(`Could not load mint: ${mintUrl}`, { cause: error });
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
 * @param {number} Delay time in ms
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

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

export const getTokenAmount = (proofs: Array<Proof>): number => {
  return proofs.reduce((acc, proof) => {
    return acc + proof.amount;
  }, 0);
};

export const formatAmount = (amount: number, unit?: string): string => {
  if (!unit) {
    unit = "sat";
  }
  if (unit === "sat") {
    return formatSats(amount);
  }
  if (unit === "msat") {
    return formatMSats(amount);
  } else {
    return formatFiat(amount, unit);
  }
};

const formatSats = (amount: number): string => {
  return "₿ " + new Intl.NumberFormat("en-US").format(amount) + " sat";
};

const formatMSats = (amount: number): string => {
  return (
    "₿ " +
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(amount / 1000) +
    " sat"
  );
};

export const getUnitSymbol = (unit: string, isLong = true): string => {
  switch (unit) {
    case "sat":
      return "₿" + (isLong ? " (sat)" : "");
    case "msat":
      return "₿" + (isLong ? " (msat)" : "");
    case "btc":
      return "₿" + (isLong ? " (btc)" : "");
    case "usd":
      return "$" + (isLong ? " (usd)" : "");
    case "eur":
      return "€" + (isLong ? " (eur)" : "");
    case "gbp":
      return "£" + (isLong ? " (gbp)" : "");
    case "jpy":
      return "¥" + (isLong ? " (jpy)" : "");
    case "krw":
      return "₩" + (isLong ? " (krw)" : "");
    default:
      return unit;
  }
};
const formatFiat = (amount: number, unit?: string): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    currency: unit?.toUpperCase(),
  }).format(amount / 100);
};

// Define the stored/returned mint data shape
interface MintData {
  keys: MintKeys[];
  keysets: MintKeyset[];
  info: GetInfoResponse;
  lastUpdated: number;
}

// Store mint data in localStorage
function storeMintData(mintUrl: string, mintData: MintData): void {
  localStorage.setItem(`cashu.mint.${mintUrl}`, JSON.stringify(mintData));
}

// Store mint proofs to localStorage, ensuring uniqueness by secret
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

// Get mint proofs from localStorage
export function getMintProofs(mintUrl: string): Array<Proof> {
  const stored: string | null = localStorage.getItem(`cashu.proofs.${mintUrl}`);
  return stored ? JSON.parse(stored) : [];
}

// Define the NutLock history entry
interface NutLockEntry {
  date: string;
  name: string;
  token: string;
  amount: number;
}
const TOKEN_HISTORY_KEY = "cashu.lockedTokens";

// Store a new locked token with metadata in localStorage
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

// Get the history of locked tokens from localStorage
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

// Get the history of locked tokens from localStorage
export function clearLockedTokens(): void {
  localStorage.removeItem(TOKEN_HISTORY_KEY);
}

export async function loadMint(mintUrl: string): Promise<MintData> {
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

export const getWalletWithUnit = async (
  mintUrl: string,
  unit = "sat",
): Promise<CashuWallet> => {
  const mintData = await loadMint(mintUrl);
  const mint = new CashuMint(mintUrl);
  const keys = mintData.keys.filter((ks) => ks.unit === unit);
  const keysets = mintData.keysets.filter((ks) => ks.unit === unit);
  console.log("keys:>>", keys);
  console.log("keysets:>>", keysets);
  const wallet = new CashuWallet(mint, {
    keys,
    keysets,
    mintInfo: mintData.info,
    unit,
  });
  return wallet;
};

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

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Debounce utility function
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
 * Gets the invoice amount in sats
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

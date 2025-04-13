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
import { type Event, type Filter } from "nostr-tools";
import { DEFAULT_RELAYS, pool } from "./nostr";
import toastr from "toastr";
import confetti from "canvas-confetti";

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

export const discoverMints = async (nut: string, relays: string[]) => {
  let discoveredMints: Array<string> = [];
  try {
    if (!relays) {
      relays = DEFAULT_RELAYS; // Fallback
    }
    // Look for recommended mints
    // @see https://github.com/nostr-protocol/nips/pull/1110
    const filter: Filter = { kinds: [38000], limit: 2000 };
    await new Promise<void>((resolve) => {
      pool.subscribeManyEose(relays, [filter], {
        // autocloses on eose
        onevent: (event: Event) => {
          // console.log(event);
          const uTag = event.tags.find((t) => t[0] === "u");
          const kTag = event.tags.find((t) => t[0] === "k");
          if (!kTag || !uTag) {
            return;
          }
          // Cashu mints only
          if (kTag[1] != "38172") {
            return;
          }
          // Add to array if not already seen
          const mintUrl = uTag[1];
          if (discoveredMints.indexOf(mintUrl) === -1) {
            discoveredMints.push(mintUrl);
          }
        },
        onclose: resolve as any,
      });
    });
  } catch (e) {
    console.error(e);
  }
  console.log("discoveredMints:>>", discoveredMints);
  return discoveredMints;
};

interface MintRead {
  id: number;
  url: string;
  info?: string;
  name?: string;
  balance: number;
  sum_donations?: number;
  updated_at: string;
  next_update?: string;
  state: string;
  n_errors: number;
  n_mints: number;
  n_melts: number;
}

export const getNut11Mints = async (
  auditorApiUrl: string = "https://api.audit.8333.space",
): Promise<string[]> => {
  let discoveredMints: Array<string> = [];
  try {
    const response = await fetch(`${auditorApiUrl}/mints/`);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    const mintList = (await response.json()) as Array<MintRead>;
    console.log("MintList:>>", mintList);
    mintList.forEach((mint: MintRead) => {
      if ("OK" != mint.state) {
        console.log("Mint not OK:>>", mint);
        return;
      }
      const info = JSON.parse(mint.info || "{}");
      console.log("MintInfo", info);
      if (!info?.nuts[11]?.supported === true) {
        console.log("Nut11 not supported:>", mint.url, info);
        return;
      }
      if (discoveredMints.indexOf(mint.url) === -1) {
        discoveredMints.push(mint.url);
      }
    });
  } catch (err) {
    console.error("Error fetching mint info:", err);
    throw err;
  }
  console.log("discoveredMints:>>", discoveredMints);
  return discoveredMints;
};

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

// Load mint data (from cache or network)
export async function loadMint(mintUrl: string): Promise<MintData> {
  const stored: string | null = localStorage.getItem(`cashu.mint.${mintUrl}`);
  const cachedData: MintData | null = stored ? JSON.parse(stored) : null;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  if (cachedData && Date.now() - cachedData.lastUpdated < ONE_DAY_MS) {
    // Use cached data if < 24 hours old
    console.log("loadMint:>> using cached");
    return cachedData;
  }
  // Fetch fresh data from the mint
  try {
    const cashuMint = new CashuMint(mintUrl);
    const mintInfo = await cashuMint.getInfo();
    const mintAllKeysets: MintAllKeysets = await cashuMint.getKeySets();
    const mintActiveKeys: MintActiveKeys = await cashuMint.getKeys();
    const freshData: MintData = {
      info: mintInfo,
      keys: mintActiveKeys.keysets,
      keysets: mintAllKeysets.keysets,
      lastUpdated: Date.now(),
    };
    storeMintData(mintUrl, freshData);
    console.log("loadMint:>> using fresh");
    return freshData;
  } catch (error) {
    throw new Error(`Could not load mint: ${mintUrl}`, { cause: error });
  }
}

export const getWalletWithUnit = async (
  mintUrl: string,
  unit = "sat",
): Promise<CashuWallet> => {
  const mintData = await loadMint(mintUrl);
  const mint = new CashuMint(mintUrl);
  const wallet = new CashuWallet(mint, {
    keys: mintData.keys,
    keysets: mintData.keysets,
    mintInfo: mintData.info,
    unit: unit,
  });
  return wallet;
};

// Define the structure of a NUT-11 P2PK secret
type P2PKSecret = [
  string, // "P2PK"
  {
    nonce: string;
    data: string;
    tags: Array<string[]>;
  },
];

/**
 * Parse a string secret into a P2PKSecret
 * @type {[type]}
 */
export const parseSecret = (secret: string): P2PKSecret => {
  try {
    return JSON.parse(secret); // proof.secret is a string
  } catch {
    throw new Error("Invalid secret format");
  }
};

/**
 * Returns the expected witness public keys from a NUT-11 P2PK secret
 * @param secret - The NUT-11 P2PK secret.
 * @returns Array with the public keys or empty array
 */
export function getP2PExpectedKWitnessPubkeys(secret: P2PKSecret): string[] {
  try {
    const now = Math.floor(Date.now() / 1000);
    const { data, tags } = secret[1];
    const locktime = getP2PKLocktime(secret);
    const refundTag = tags && tags.find((tag) => tag[0] === "refund");
    const refundKeys =
      refundTag && refundTag.length > 1 ? refundTag.slice(1) : [];
    const pubkeysTag = tags && tags.find((tag) => tag[0] === "pubkeys");
    const pubkeys =
      pubkeysTag && pubkeysTag.length > 1 ? pubkeysTag.slice(1) : [];
    const n_sigsTag = tags && tags.find((tag) => tag[0] === "n_sigs");
    const n_sigs = n_sigsTag ? parseInt(n_sigsTag[1], 10) : null;
    if (locktime > now) {
      if (n_sigs && n_sigs >= 1) {
        return [data, ...pubkeys];
      }
      return [data];
    }
    if (refundKeys) {
      return refundKeys;
    }
  } catch {}
  return []; // Unlocked or expired with no refund keys
}

/**
 * Returns the locktime from a NUT-11 P2PK secret or Infinity if no locktime
 * @param secret - The NUT-11 P2PK secret.
 * @returns The locktime unix timestamp or Infinity (permanent lock)
 */
export function getP2PKLocktime(secret: P2PKSecret): number {
  // Validate secret format
  if (secret[0] !== "P2PK") {
    throw new Error('Invalid P2PK secret: must start with "P2PK"');
  }
  const { tags } = secret[1];
  const locktimeTag = tags.find((tag) => tag[0] === "locktime");
  return locktimeTag ? parseInt(locktimeTag[1], 10) : Infinity; // Permanent lock if not set
}

/**
 * Returns the locktime from a NUT-11 P2PK secret or null if no locktime
 * @param secret - The NUT-11 P2PK secret.
 * @returns The locktime unix timestamp or null
 */
export function getP2PKNSigs(secret: P2PKSecret): number {
  // Validate secret format
  if (secret[0] !== "P2PK") {
    throw new Error('Invalid P2PK secret: must start with "P2PK"');
  }
  const witness = getP2PExpectedKWitnessPubkeys(secret);
  const { tags } = secret[1];
  const n_sigsTag = tags && tags.find((tag) => tag[0] === "n_sigs");
  const n_sigs = n_sigsTag ? parseInt(n_sigsTag[1], 10) : 1;
  if (witness.length > 0) {
    return n_sigs; // locked
  }
  return 0; // unlocked
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

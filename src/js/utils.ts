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

// Load mint data (from cache or network)
export async function loadMint(mintUrl: string): Promise<MintData> {
  const stored: string | null = localStorage.getItem(`cashu.mint.${mintUrl}`);
  const cachedData: MintData | null = stored ? JSON.parse(stored) : null;

  const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  if (cachedData && Date.now() - cachedData.lastUpdated < ONE_DAY_MS) {
    // Use cached data if < 24 hours old
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

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

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

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

const MINT_LIST_KEY = "nostrly.nut11Mints";
// Same defaults as the PHP mint selects
const DEFAULT_MINTS = [
  "https://mint.minibits.cash/Bitcoin",
  "https://mint.103100.xyz",
  "https://mint.coinos.io",
];

// NIP-61 wants NUT-11 (P2PK) and NUT-12 (DLEQ) support
const supportsNip61 = (info: any): boolean =>
  info?.nuts?.[11]?.supported === true && info?.nuts?.[12]?.supported === true;

/**
 * Get the list of NUT11 mint URLs
 * @remarks Never throws: if the auditor is down or slow, returns the last list
 * it served, else DEFAULT_MINTS.
 * @param  {string} auditorApiUrl Mint auditor to use
 * @return {Promise<string[]>} Promise to return array of mint urls
 */
export const getNut11Mints = async (
  auditorApiUrl: string = "https://api.audit.8333.space",
): Promise<string[]> => {
  const discoveredMints: Array<string> = [];
  try {
    const response = await fetch(`${auditorApiUrl}/mints/`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    const mintList = (await response.json()) as Array<MintRead>;
    mintList.forEach((mint: MintRead) => {
      let info;
      try {
        info = JSON.parse(mint.info || "{}");
      } catch {
        return;
      }
      if (!supportsNip61(info)) return;
      if (discoveredMints.indexOf(mint.url) === -1) {
        discoveredMints.push(mint.url);
      }
    });
    if (!discoveredMints.length) throw new Error("No NUT-11 mints listed");
    localStorage.setItem(MINT_LIST_KEY, JSON.stringify(discoveredMints));
    return discoveredMints;
  } catch (e) {
    console.error("Mint auditor unavailable, using fallback list:", e);
    try {
      const cached = JSON.parse(localStorage.getItem(MINT_LIST_KEY) || "[]");
      if (Array.isArray(cached) && cached.length) return cached;
    } catch {
      // Corrupt cache: use the defaults
    }
    return [...DEFAULT_MINTS];
  }
};

/**
 * Checks the mint's own info for NUT-11 and NUT-12 support
 * @remarks Unreachable or malformed info counts as unsupported.
 */
export const isNut11Mint = async (mintUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${mintUrl.replace(/\/+$/, "")}/v1/info`, {
      signal: AbortSignal.timeout(10000),
    });
    return response.ok && supportsNip61(await response.json());
  } catch {
    return false;
  }
};

/**
 * Checks a public key is a valid P2PK ECC hex key
 */
export const isPublicKeyValidP2PK = (key: string): boolean => {
  const regex = /^(02|03)[0-9a-fA-F]{64}$/; // P2PK ECC Key
  if (key && regex.test(key)) {
    return true;
  }
  return false;
};

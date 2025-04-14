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
    const n_sigs =
      n_sigsTag && n_sigsTag.length > 1 ? parseInt(n_sigsTag[1], 10) : null;
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
  return locktimeTag && locktimeTag.length > 1
    ? parseInt(locktimeTag[1], 10)
    : Infinity; // Permanent lock if not set
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
  const n_sigs =
    n_sigsTag && n_sigsTag.length > 1 ? parseInt(n_sigsTag[1], 10) : 1; // Default: 1
  if (witness.length > 0) {
    return n_sigs; // locked
  }
  return 0; // unlocked
}

/**
 * Returns the sigflag from a NUT-11 P2PK secret
 * @param secret - The NUT-11 P2PK secret.
 * @returns The sigflag or 'SIG_INPUTS' default
 */
export function getP2PKSigFlag(secret: P2PKSecret): string {
  // Validate secret format
  if (secret[0] !== "P2PK") {
    throw new Error('Invalid P2PK secret: must start with "P2PK"');
  }
  const { tags } = secret[1];
  const sigFlagTag = tags.find((tag) => tag[0] === "sigflag");
  return sigFlagTag && sigFlagTag.length > 1 ? sigFlagTag[1] : "SIG_INPUTS";
}

/**
 * Get the list of NUT11 mint URLs
 * @param  string - auditorApiUrl Mint auditor to use
 * @return Promise<string[]> Promise to return array of mint urls
 */
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

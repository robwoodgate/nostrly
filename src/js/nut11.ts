import { type Proof, type P2PKWitness } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes } from "@noble/curves/abstract/utils";
import { sha256 } from "@noble/hashes/sha256";
import { schnorr } from "@noble/curves/secp256k1";

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
 * Returns the number of signatures required from a NUT-11 P2PK secret
 * @param secret - The NUT-11 P2PK secret.
 * @returns The number if signatures (n_sigs) or 0 if secret is unlocked
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
 * @returns The sigflag or 'SIG_INPUTS' (default)
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
  } catch (e) {
    console.error("Error fetching mint info:", e);
    throw e;
  }
  console.log("discoveredMints:>>", discoveredMints);
  return discoveredMints;
};

/**
 * Checks a public key is a valid P2PK ECC hex key
 * @type Boolean
 */
export const isPublicKeyValidP2PK = (key: string): boolean => {
  const regex = /^(02|03)[0-9a-fA-F]{64}$/; // P2PK ECC Key
  if (key && regex.test(key)) {
    return true;
  }
  return false;
};

/**
 * Gets witness signatures as an array
 * @type array of signatures
 */
export const getSignatures = (
  witness: string | P2PKWitness | undefined,
): string[] => {
  if (!witness) return [];
  if (typeof witness === "string") {
    try {
      return JSON.parse(witness).signatures || [];
    } catch (e) {
      console.error("Failed to parse witness string:", e);
      return [];
    }
  }
  return witness.signatures || [];
};

/**
 * Computes the SHA-256 hash of a string and returns it as a hex string.
 * @param input - The input string to hash.
 * @returns {string} The hex-encoded SHA-256 hash.
 */
export const sha256Hex = (input: string): string => {
  return bytesToHex(sha256(input));
};

/**
 * Signs a P2PK secret using a Schnorr signature.
 * @param secret - The secret message to sign.
 * @param privateKey - The private key (hex-encoded) used for signing.
 * @returns {string} The Schnorr signature (hex-encoded).
 */
export const signP2PKsecret = (secret: string, privateKey: string): string => {
  const msghash = sha256(secret); // Uint8Array
  const sig = schnorr.sign(msghash, privateKey);
  return bytesToHex(sig);
};

/**
 * Verifies a Schnorr signature on a P2PK secret.
 * @param signature - The Schnorr signature (hex-encoded).
 * @param secret - The secret message to verify.
 * @param pubkey - The compressed public key (hex-encoded, starting with 02 or 03).
 * @returns {boolean} True if the signature is valid, false otherwise.
 */
export const verifyP2PKsecretSignature = (
  signature: string,
  secret: string,
  pubkey: string,
): boolean => {
  try {
    const msghash = sha256(secret); // Uint8Array
    const pubkeyX = pubkey.slice(2);
    if (schnorr.verify(signature, msghash, hexToBytes(pubkeyX))) {
      return true;
    }
  } catch (e) {
    console.error("verifyP2PKsecret error:", e);
  }
  return false; // no bueno
};

export const getSignedProof = (proof: Proof, privateKey: string) => {
  const rawkey = schnorr.getPublicKey(privateKey); // for schnorr
  const pubkey = "02" + bytesToHex(rawkey); // for Cashu
  const parsed: P2PKSecret = parseSecret(proof.secret);
  if (parsed[0] !== "P2PK") return proof; // not p2pk
  // Check if this pubkey is required to sign
  const pubkeys = getP2PExpectedKWitnessPubkeys(parsed);
  console.log("expected pubkeys:>", pubkeys);
  if (!pubkeys.length || !pubkeys.includes(pubkey)) return proof; // nothing to sign
  // Check if this pubkey has already signed
  let signatures = getSignatures(proof.witness);
  const alreadySigned = signatures.some((sig) => {
    try {
      return verifyP2PKsecretSignature(sig, proof.secret, pubkey);
    } catch {
      return false; // Invalid signature, treat as not signed
    }
  });
  if (alreadySigned) {
    console.log("pubkey already signed this proof:", pubkey);
    return proof; // Skip signing if pubkey has a valid signature
  }
  console.log("pubkey has not signed yet:", pubkey);
  // Add new signature
  const signature = signP2PKsecret(proof.secret, privateKey);
  signatures.push(signature);
  return { ...proof, witness: { signatures } };
};

export const getSignedProofs = (proofs: Array<Proof>, privateKey: string) => {
  return proofs.map((proof) => {
    try {
      return getSignedProof(proof, privateKey);
    } catch (e) {
      console.error("Error signing proof:", e);
      return proof;
    }
  });
};

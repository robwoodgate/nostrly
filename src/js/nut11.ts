import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import {
  getP2PKWitnessPubkeys,
  getP2PKWitnessRefundkeys,
  parseP2PKSecret,
  Proof,
  unblindPubkey,
} from "@cashu/cashu-ts";

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

/**
 * Get the list of NUT11 mint URLs
 * @param  {string} auditorApiUrl Mint auditor to use
 * @return {Promise<string[]>} Promise to return array of mint urls
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
    // console.log("MintList:>>", mintList);
    mintList.forEach((mint: MintRead) => {
      // if ("OK" != mint.state) {
      // console.log("Mint not OK:>>", mint);
      // return;
      // }
      const info = JSON.parse(mint.info || "{}");
      // console.log("MintInfo", info);
      if (!info?.nuts[11]?.supported === true) {
        // console.log("Nut11 not supported:>", mint.url, info);
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
  // console.log("discoveredMints:>>", discoveredMints);
  return discoveredMints;
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

/**
 * Computes the SHA-256 hash of a string and returns it as a hex string.
 * @param input - The input string to hash.
 * @returns {string} The hex-encoded SHA-256 hash.
 */
export const sha256Hex = (input: string): string => {
  return bytesToHex(sha256(input));
};

/**
 * Build a lookup of blinded -> unblinded pubkeys for a P2PK proof
 */
export function unblindedLookupForProof(proof: Proof): Map<string, string> {
  const rs: string[] = proof?.p2pk_r ?? [];
  const secret = parseP2PKSecret(proof.secret);
  const pubs: string[] = [
    ...getP2PKWitnessPubkeys(secret),
    ...getP2PKWitnessRefundkeys(secret),
  ];
  if (rs.length && rs.length !== pubs.length) {
    throw new Error(
      `p2pk_r length ${rs.length} does not match expected pubkey count ${pubs.length}`,
    );
  }
  const map = new Map<string, string>();
  if (!rs.length) {
    // No blinding factors, treat as identity
    pubs.forEach((pub) => map.set(pub, pub));
    return map;
  }
  pubs.forEach((pub, i) => {
    map.set(pub, unblindPubkey(pub, rs[i]));
  });
  return map;
}

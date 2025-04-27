import {
  type Event,
  type Filter,
  type UnsignedEvent,
  SimplePool,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip04,
  nip19,
} from "nostr-tools";
import { bytesToHex } from "@noble/curves/abstract/utils";
import { EncryptedDirectMessage } from "nostr-tools/kinds";

// Export constants
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
];
export const NOSTRLY_PUBKEY =
  "cec0f44d0d64d6d9d7a1c84c330f5467e752cc8b065f720e874a0bed1c5416d2";
export const pool = new SimplePool();

/**
 * Sends a message anonymously via Nostr
 * @param string   toPub   Hex pubkey to send to
 * @param string   message to send
 * @param string[] relays  array of relays to use
 */
export const sendViaNostr = async (
  message: string,
  toPub: string,
  relays: string[],
) => {
  if (!toPub) {
    toPub = NOSTRLY_PUBKEY; // Fallback
  }
  if (!relays) {
    relays = DEFAULT_RELAYS; // Fallback
  }
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const event: UnsignedEvent = {
    kind: EncryptedDirectMessage,
    //@ts-ignore
    tags: [["p", toPub]],
    content: await nip04.encrypt(sk, toPub, message),
    created_at: Math.floor(Date.now() / 1000),
    pubkey: pk,
  };
  const signedEvent = finalizeEvent(event, sk);
  // localStorage.setItem("nostrly-donation", JSON.stringify(signedEvent));
  pool.publish(relays, signedEvent);
};

/**
 * Gets the name and image for an Nostr npub
 * @param string   hexOrNpub   npub/hexpub to fetch details for
 * @param string[] relays relays to query
 */
export const getContactDetails = async (
  hexOrNpub: string,
  relays: string[],
): Promise<{ name: string | null; img: string | null }> => {
  try {
    if (!relays) {
      relays = DEFAULT_RELAYS; // Fallback
    }
    let hexpub = hexOrNpub;
    if (hexOrNpub.startsWith("npub1")) {
      hexpub = nip19.decode(hexOrNpub).data as string;
    }

    // Look up kind:0 for contact details
    let filter: Filter = { kinds: [0], authors: [hexpub], limit: 1 };
    let event = await pool.get(relays, filter);
    if (event) {
      const content = JSON.parse(event.content || "{}");
      return { name: content.name, img: content.picture };
    }

    // kind:0 failed, try a kind:10019 lookup (NIP-61)
    filter = { kinds: [10019], "#k": [hexpub], limit: 1 };
    event = await pool.get(relays, filter);
    if (!event) {
      throw new Error("Could not find Nostr user or NIP-61 key for: " + hexpub);
    }

    // Prevent loop: Ensure event.pubkey is different from hexpub
    if (event.pubkey === hexpub) {
      throw new Error(
        "Loop detected: kind:10019 event points to same key: " + hexpub,
      );
    }

    // Found a kind:10019 event, try getting contact details for its pubkey
    return await getContactDetails(event.pubkey, relays);
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.log(errorMessage);
    return { name: null, img: null };
  }
};

/**
 * Gets the NIP-60 Cashu wallet for an Nostr npub
 * @param {string}   hexOrNpub npub/hexpub to fetch details for
 * @param {string[]} relays Optional. relays to query
 */
export const getNip60Wallet = async (hexOrNpub: string, relays: string[]) => {
  try {
    if (!relays) {
      relays = DEFAULT_RELAYS; // Fallback
    }
    let hexpub = hexOrNpub;
    if (hexOrNpub.startsWith("npub1")) {
      hexpub = nip19.decode(hexOrNpub).data as string;
    }
    const filter: Filter = { kinds: [17375], authors: [hexpub] };
    const event = await pool.get(relays, filter);
    if (!event) return null;
    console.log("getNip60Wallet", event);
    return event.content;
  } catch (e) {
    console.error(e);
    return null;
  }
};

/**
 * Gets the mints and P2PK pubkey for an Nostr npub
 * @param {string}   hexOrNpub npub/hexpub to fetch details for
 * @param {string[]} relays Optional. relays to query
 */
export const getNip61Info = async (hexOrNpub: string, relays: string[]) => {
  try {
    if (!relays) {
      relays = DEFAULT_RELAYS; // Fallback
    }
    let hexpub = hexOrNpub;
    if (hexOrNpub.startsWith("npub1")) {
      hexpub = nip19.decode(hexOrNpub).data as string;
    }
    const filter: Filter = { kinds: [10019], authors: [hexpub] };
    const event = await pool.get(relays, filter);
    if (!event) return { pubkey: null, mints: null, relays: null };
    console.log("getNip61Info", event);
    let mints: string[] = [];
    let nrelays: string[] = [];
    let pubkey: string = "";
    for (const tag of event.tags) {
      if (tag[0] === "mint") {
        mints.push(tag[1]);
      } else if (tag[0] === "relay") {
        nrelays.push(tag[1]);
      } else if (tag[0] === "pubkey") {
        pubkey = tag[1];
      }
    }
    return { pubkey: pubkey, mints: mints, relays: nrelays };
  } catch (e) {
    return { pubkey: null, mints: null, relays: null };
  }
};

/**
 * Converts an npub into P2PK hex format (02...)
 * @type string converted npub or original string
 */
export const maybeConvertNpubToP2PK = (key: string) => {
  // Check and convert npub to P2PK
  if (key && key.startsWith("npub1")) {
    try {
      const { type, data } = nip19.decode(key);
      if (type === "npub" && data.length === 64) {
        key = "02" + data;
      }
    } catch (e) {
      console.error(e);
    }
  }
  return key;
};

/**
 * Converts a P2PK hex format (02...) to npub
 * @type string converted npub or original string
 */
export const convertP2PKToNpub = (key: string): string | null => {
  // Check and convert P2PK to npub
  try {
    return nip19.npubEncode(key.slice(2));
  } catch (e) {
    console.error(e);
  }

  return key;
};

/**
 * Validate private key
 * @param  {string}  key The private key to validate (nsec1 or P2PK)
 * @return {boolean}     True if valid. false otherwise
 */
export function isPrivkeyValid(key: string): boolean {
  if (!key) return false;
  key = maybeConvertNsecToP2PK(key);
  return /^[0-9a-fA-F]{64}$/.test(key);
}

/**
 * Converts an nsec1-encoded private key to a hex string, or returns the input unchanged if not nsec1.
 * @param key - The input key, either nsec1-encoded or a hex string.
 * @returns {string} The hex-encoded private key, or the original key if conversion fails or is not needed.
 */
export function maybeConvertNsecToP2PK(key: string): string {
  if (key && key.startsWith("nsec1")) {
    try {
      const sk = nip19.decode(key).data as Uint8Array; // `sk` is a Uint8Array
      return bytesToHex(sk);
    } catch (e) {
      console.error(e);
    }
  }
  return key;
}

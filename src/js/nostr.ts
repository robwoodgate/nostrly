import {
  type Event,
  type EventTemplate,
  type Filter,
  type UnsignedEvent,
  SimplePool,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip04,
  nip19,
} from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils";
import { EncryptedDirectMessage } from "nostr-tools/kinds";
import toastr from "toastr";
import { Proof } from "@cashu/cashu-ts";

// Define window.nostr interface
interface Nostr {
  nip44?: {
    decrypt: (pubkey: string, content: string) => Promise<string>;
  };
}
declare global {
  interface Window {
    nostr?: Nostr;
  }
}

// Export constants
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://nostr.mom",
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
  toPub = toPub || NOSTRLY_PUBKEY; // Fallback
  relays = relays || DEFAULT_RELAYS; // Fallback
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
  await Promise.any(pool.publish(relays, signedEvent));
};

/**
 * Sends a NutZap via Nostr
 * @param Proof[]  proofs  Token proofs to send
 * @param string   mintUrl Mint URL for the proofs
 * @param string   unit Unit of the proofs (default: "sat")
 * @param string   message to send
 * @param string   toPub   Hex pubkey to send to
 * @param string[] relays  array of relays to use
 */
export const sendNutZap = async (
  proofs: Proof[],
  mintUrl: string,
  unit: string = "sat",
  message: string,
  toPub: string,
  relays: string[],
) => {
  toPub = toPub || NOSTRLY_PUBKEY; // Fallback
  relays = relays || DEFAULT_RELAYS; // Fallback
  const proofTags = proofs.map((p) => ["proof", JSON.stringify(p)]);
  const eventTemplate: EventTemplate = {
    kind: 9321,
    content: message || "NutZap via Nostrly",
    created_at: Math.floor(Date.now() / 1000),
    tags: [...proofTags, ["p", toPub], ["u", mintUrl], ["unit", unit]],
  };
  const sk = generateSecretKey();
  const event = finalizeEvent(eventTemplate, sk);
  console.log(event);
  await Promise.any(pool.publish(relays, event));
};

/**
 * Gets the name and image for an Nostr npub
 * @param string   hexOrNpub   npub/hexpub to fetch details for
 * @param string[] relays relays to query
 */
export const getContactDetails = async (
  hexOrNpub: string,
  relays: string[],
): Promise<{
  name: string | null;
  img: string | null;
  hexpub: string | null;
}> => {
  try {
    relays = relays || DEFAULT_RELAYS; // Fallback
    let hexpub = hexOrNpub;
    if (hexOrNpub.startsWith("npub1")) {
      hexpub = nip19.decode(hexOrNpub).data as string;
    }

    // Look up kind:0 for contact details
    let filter: Filter = { kinds: [0], authors: [hexpub], limit: 1 };
    let event = await pool.get(relays, filter);
    if (event) {
      const content = JSON.parse(event.content || "{}");
      return { name: content.name, img: content.picture, hexpub: event.pubkey };
    }

    // kind:0 failed, so the hexpub may be a NIP-61 pubkey. Let's try a
    // kind:10019 lookup (NIP-61) using the 'k' filter to find the user
    filter = { kinds: [10019], "#k": [hexpub], limit: 1 };
    event = await pool.get(relays, filter);
    if (!event) {
      throw new Error("Could not find Nostr user or NIP-61 key for: " + hexpub);
    }

    // Prevent loop: Ensure kind:10019 pubkey is different to hexpub
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
    return { name: null, img: null, hexpub: null };
  }
};

/**
 * Gets the kind: 10002 relays for an Nostr npub
 * @param {string}   hexOrNpub npub/hexpub to fetch details for
 * @param {string[]} relays Optional. relays to query
 */
export const getUserRelays = async (
  hexOrNpub: string,
  relays: string[],
): Promise<string[]> => {
  try {
    relays = relays || DEFAULT_RELAYS; // Fallback
    let hexpub = hexOrNpub;
    if (hexOrNpub.startsWith("npub1")) {
      hexpub = nip19.decode(hexOrNpub).data as string;
    }
    const filter: Filter = { kinds: [10002], authors: [hexpub] };
    const event = await pool.get(relays, filter);
    if (!event || !event.tags) return []; // none found
    console.log("getUserRelays", event);
    return event.tags
      .filter(
        (tag) =>
          tag[0] === "r" && typeof tag[1] === "string" && tag[1].trim() !== "",
      )
      .map((tag) => tag[1].trim());
  } catch (e) {
    console.error(e);
    return [];
  }
};

/**
 * Gets the NIP-60 Cashu wallet for an Nostr npub
 * @param {string}   hexOrNpub npub/hexpub to fetch details for
 * @param {string[]} relays Optional. relays to query
 */
type Nip60Tag = [string, string];
export const getNip60Wallet = async (
  hexOrNpub: string,
  relays: string[],
): Promise<{
  privkeys: string[];
  mints: string[];
  kind: number | null;
}> => {
  try {
    relays = relays || DEFAULT_RELAYS; // Fallback
    let hexpub = hexOrNpub;
    if (hexOrNpub.startsWith("npub1")) {
      hexpub = nip19.decode(hexOrNpub).data as string;
    }
    let privkeys: string[] = [];
    let mints: string[] = [];
    let filter: Filter = { kinds: [17375], authors: [hexpub] };
    let event = await pool.get(relays, filter);
    if (!event) {
      console.warn(
        "kind:17375 wallet not found... checking for a legacy kind:37375 wallet",
      );
      toastr.warning("NIP-60 wallet not found... checking for a legacy wallet");
      filter = { kinds: [37375], authors: [hexpub] };
      event = await pool.get(relays, filter);
    }
    if (!event) return { privkeys: [], mints: [], kind: null };
    console.log("getNip60Wallet", event);
    if (window.nostr?.nip44) {
      const nip60 = await window.nostr.nip44.decrypt(hexpub, event.content);
      if (nip60 && typeof nip60 === "string") {
        try {
          const nip60Array: Nip60Tag[] = JSON.parse(nip60);
          privkeys = nip60Array
            .filter((tag) => tag[0] === "privkey")
            .map((tag) => tag[1]);
          mints = nip60Array
            .filter((tag) => tag[0] === "mint")
            .map((tag) => tag[1]);
        } catch (e) {
          console.error("Failed to parse NIP-60 content:", e);
        }
      }
    } else {
      toastr.warning("Nostr extension not available or does not support nip44");
      console.warn("Nostr extension not available or does not support nip44");
    }
    return { privkeys, mints, kind: event.kind };
  } catch (e) {
    console.error(e);
    return { privkeys: [], mints: [], kind: null };
  }
};

/**
 * Gets the mints and P2PK pubkey for an Nostr npub
 * @param {string}   hexOrNpub npub/hexpub to fetch details for
 * @param {string[]} relays Optional. relays to query
 */
export const getNip61Info = async (
  hexOrNpub: string,
  relays: string[],
): Promise<{ pubkey: string | null; mints: string[]; relays: string[] }> => {
  try {
    relays = relays || DEFAULT_RELAYS; // Fallback
    let hexpub = hexOrNpub;
    if (hexOrNpub.startsWith("npub1")) {
      hexpub = nip19.decode(hexOrNpub).data as string;
    }
    const filter: Filter = { kinds: [10019], authors: [hexpub] };
    const event = await pool.get(relays, filter);
    if (!event) return { pubkey: null, mints: [], relays: [] };
    console.log("getNip61Info", event);
    let mints: string[] = [];
    let nrelays: string[] = [];
    let pubkey: string | null = null;
    for (const tag of event.tags) {
      if (tag[0] === "mint") {
        mints.push(tag[1]);
      } else if (tag[0] === "relay") {
        nrelays.push(tag[1]);
      } else if (tag[0] === "pubkey") {
        pubkey = tag[1];
      }
    }
    return { pubkey, mints, relays: nrelays };
  } catch (e) {
    console.error(e);
    return { pubkey: null, mints: [], relays: [] };
  }
};

/**
 * Fetches NIP-60 wallet and NIP-61 info simultaneously for an Nostr npub
 * @param {string}   hexOrNpub npub/hexpub to fetch details for
 * @param {string[]} relays Optional. relays to query
 * @returns {Promise<{ privkeys: string[], mints: string[], relays: string[], pubkey: string | null, kind: string | null }>}
 */
export const getWalletAndInfo = async (
  hexOrNpub: string,
  relays: string[],
): Promise<{
  privkeys: string[];
  mints: string[];
  relays: string[];
  pubkey: string | null;
  kind: number | null;
}> => {
  try {
    relays = relays || DEFAULT_RELAYS; // Fallback
    let hexpub = hexOrNpub;
    if (hexOrNpub.startsWith("npub1")) {
      hexpub = nip19.decode(hexOrNpub).data as string;
    }
    const [{ privkeys, mints, kind }, { relays: nip61Relays, pubkey }] =
      await Promise.all([
        getNip60Wallet(hexpub, relays),
        getNip61Info(hexpub, relays),
      ]);

    return { privkeys, mints, relays: nip61Relays, pubkey, kind };
  } catch (error) {
    console.error("Error getting NIP-60 wallet and NIP-61 info:", error);
    return {
      privkeys: [],
      mints: [],
      relays: [],
      pubkey: null,
      kind: null,
    };
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

/**
 * Extracts all proofs, mint URL, and unit from a kind 9321 event
 * @param event Nostr event (kind 9321)
 * @returns { proofs: Proof[], mintUrl: string | null, unit: string }
 */
function getNutZapInfo(event: Event): {
  proofs: Proof[];
  mintUrl: string | null;
  unit: string;
} {
  const result: {
    proofs: Proof[];
    mintUrl: string | null;
    unit: string;
  } = {
    proofs: [],
    mintUrl: null,
    unit: "sat",
  };
  if (
    !event ||
    event.kind !== 9321 ||
    !event.tags ||
    !Array.isArray(event.tags)
  ) {
    return result;
  }
  event.tags.forEach((tag) => {
    if (tag[0] === "proof" && tag[1]) {
      try {
        const proof = JSON.parse(tag[1]) as Proof;
        result.proofs.push(proof);
      } catch (e) {
        console.error("Failed to parse proof tag:", e);
      }
    } else if (tag[0] === "u" && tag[1]) {
      result.mintUrl = tag[1];
    } else if (tag[0] === "unit" && tag[1]) {
      const unit = tag[1].startsWith("msat") ? "sat" : tag[1];
      result.unit = unit;
    }
  });
  return result;
}

/**
 * Fetches unredeemed NutZap proofs for a user, grouped by mint URL and unit,
 * with each proof linked to its NutZap event ID
 * @param hexOrNpub npub or hex pubkey of the user
 * @param relays Relays to query, defaults to DEFAULT_RELAYS
 * @param strictMints True: only fetch NutZaps from users mints, False: All NutZaps
 * @returns Promise<{
 *   [mintUrl: string]: {
 *     [unit: string]: { proof: Proof; eventId: string }[];
 *   }
 * }>
 * Object mapping mint URLs and units to arrays of proof-event ID pairs
 */
export async function getUnclaimedNutZaps(
  hexOrNpub: string,
  relays: string[] = DEFAULT_RELAYS,
  nutZapRelays: string[] = [],
  mints: string[] = [],
  toastrInfo: boolean = false,
): Promise<{
  [mintUrl: string]: {
    [unit: string]: { proof: Proof; eventId: string }[];
  };
}> {
  try {
    relays = relays || DEFAULT_RELAYS; // Fallback
    let hexpub = hexOrNpub;
    if (hexOrNpub.startsWith("npub1")) {
      hexpub = nip19.decode(hexOrNpub).data as string;
    }
    // Combine relays with user's NutZap relays, ensuring no duplicates
    const combinedRelays = [
      ...new Set([...nutZapRelays, ...relays].filter(Boolean)),
    ];
    console.log("Using relays:", combinedRelays);
    // Step 1: Collect redeemed NutZap event IDs from kind 7376 events
    // Note: we use all user relays for this request
    const redeemedNutZapIds = new Set<string>();
    const kind7376Filter: Filter = { kinds: [7376], authors: [hexpub] };
    if (toastrInfo) {
      toastr.info("Checking redemptions...");
    }
    await new Promise<void>((resolve) => {
      pool.subscribeManyEose(combinedRelays, [kind7376Filter], {
        onevent(event: Event) {
          const redeemedTags = event.tags.filter(
            (tag) => tag[0] === "e" && tag[3] === "redeemed",
          );
          redeemedTags.forEach((tag) => {
            if (tag[1]) {
              redeemedNutZapIds.add(tag[1]); // Add <9321-event-id> to set
            }
          });
        },
        onclose: resolve as any,
      });
    });
    // console.log("Redeemed NutZap IDs:", Array.from(redeemedNutZapIds));
    // Step 2: Fetch kind 9321 events (NutZaps) and filter out redeemed ones
    // Note: we use the user's NutZap relays for this request
    const proofStore: {
      [mintUrl: string]: {
        [unit: string]: { proof: Proof; eventId: string }[];
      };
    } = {};
    const kind9321Filter: Filter = {
      kinds: [9321],
      "#p": [hexpub],
      ...(mints.length > 0 ? { "#u": mints } : {}),
    };
    console.log("kind9321Filter:>>", kind9321Filter);
    if (toastrInfo) {
      toastr.info(`Processing NutZap(s)...`);
    }
    await new Promise<void>((resolve) => {
      pool.subscribeManyEose(nutZapRelays, [kind9321Filter], {
        onevent(event: Event) {
          // Skip if event is redeemed
          if (redeemedNutZapIds.has(event.id)) {
            // console.log(`Skipping redeemed NutZap event: ${event.id}`);
            return;
          }
          console.log("NutZap:>>", event);
          const { proofs, mintUrl, unit } = getNutZapInfo(event);
          if (!proofs.length || !mintUrl) {
            return; // bogus
          }
          // Initialize the mint entry if it doesn’t exist
          if (!proofStore[mintUrl]) {
            proofStore[mintUrl] = {};
          }
          // Initialize the unit entry if it doesn’t exist
          if (!proofStore[mintUrl][unit]) {
            proofStore[mintUrl][unit] = [];
          }
          // Add each proof with its event ID, deduplicating by proof secret
          const existingSecrets = new Set(
            proofStore[mintUrl][unit].map((item) => item.proof.secret),
          );
          const newProofs = proofs.filter(
            (proof) => !existingSecrets.has(proof.secret),
          );
          proofStore[mintUrl][unit].push(
            ...newProofs.map((proof) => ({ proof, eventId: event.id })),
          );
          console.log(
            `Added ${newProofs.length} proofs for event ${event.id} to mint: ${mintUrl}, unit: ${unit}`,
          );
        },
        onclose: resolve as any,
      });
    });
    // Remove empty mint or unit entries
    Object.keys(proofStore).forEach((mintUrl) => {
      Object.keys(proofStore[mintUrl]).forEach((unit) => {
        if (proofStore[mintUrl][unit].length === 0) {
          delete proofStore[mintUrl][unit];
        }
      });
      if (Object.keys(proofStore[mintUrl]).length === 0) {
        delete proofStore[mintUrl];
      }
    });
    console.log("getUnclaimedNutZaps:>>", proofStore);
    return proofStore;
  } catch (error) {
    console.error("Error fetching NutZaps:", error);
    toastr.error(
      "Failed to fetch NutZaps: " +
        (error instanceof Error ? error.message : String(error)),
    );
    return {};
  }
}

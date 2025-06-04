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

type Nip60Tag = [string, string];
type NutZapInfo = {
  proofs: Proof[];
  mintUrl: string | null;
  unit: string;
};
interface ProofWithEventId {
  proof: Proof;
  eventId: string;
}
interface ProofStore {
  [mintUrl: string]: {
    [unit: string]: ProofWithEventId[];
  };
}

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
 * @param {string}   toPub   Hex pubkey to send to
 * @param {string}   message to send
 * @param {string[]} relays  array of relays to use
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
 * Sends a NutZap anonymously via Nostr
 * @param {Proof[]}  proofs  Token proofs to send
 * @param {string}   mintUrl Mint URL for the proofs
 * @param {string}   unit Unit of the proofs (default: "sat")
 * @param {string}   message to send
 * @param {string}   toPub   Hex pubkey to send to
 * @param {string[]} relays  array of relays to use
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
 * @param {string}   hexOrNpub   npub/hexpub to fetch details for
 * @param {string[]} relays relays to query
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
    let hexpub = maybeConvertNpubToHexPub(hexOrNpub);

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
    let hexpub = maybeConvertNpubToHexPub(hexOrNpub);
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
    let hexpub = maybeConvertNpubToHexPub(hexOrNpub);
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
    let hexpub = maybeConvertNpubToHexPub(hexOrNpub);
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
    let hexpub = maybeConvertNpubToHexPub(hexOrNpub);
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
 * Converts an npub into hex format
 * @param {string} hexOrNpub public key in npub or hex format
 * @return {string} converted npub or original string
 */
export function maybeConvertNpubToHexPub(hexOrNpub: string): string {
  if (hexOrNpub.startsWith("npub1")) {
    try {
      return nip19.decode(hexOrNpub).data as string;
    } catch (e) {
      console.error(e);
    }
  }
  return hexOrNpub;
}

/**
 * Converts an npub into P2PK hex format (02...)
 * @param {string} key public key
 * @return {string} converted npub or original string
 */
export const maybeConvertNpubToP2PK = (key: string): string => {
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
 * @param {string} key P2PK hex public key
 * @return {string} converted npub or original string
 */
export const convertP2PKToNpub = (key: string): string => {
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
 * @param {string} key The input key, either nsec1-encoded or a hex string.
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

function getNutZapInfo(event: Event): NutZapInfo {
  const result: NutZapInfo = { proofs: [], mintUrl: null, unit: "sat" };
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

async function getRedeemedNutZaps(
  hexpub: string,
  relays: string[],
): Promise<Set<string>> {
  const redeemedNutZapIds = new Set<string>();
  const filter: Filter = { kinds: [7376], authors: [hexpub] };
  await new Promise<void>((resolve) => {
    pool.subscribeManyEose(relays, [filter], {
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
  return redeemedNutZapIds;
}

async function fetchNutZapEvents(
  hexpub: string,
  relays: string[],
  mints: string[],
): Promise<Event[]> {
  const filter: Filter = {
    kinds: [9321],
    "#p": [hexpub],
    ...(mints.length > 0 ? { "#u": mints } : {}),
  };
  return new Promise((resolve) => {
    const events: Event[] = [];
    pool.subscribeManyEose(relays, [filter], {
      onevent: (event: Event) => events.push(event),
      onclose: () => resolve(events),
    });
  });
}

function processNutZapEvents(
  events: Event[],
  redeemedIds: Set<string>,
): ProofStore {
  const proofStore: ProofStore = {};
  const seenSecrets = new Set<string>();

  for (const event of events) {
    if (redeemedIds.has(event.id)) continue;
    const { proofs, mintUrl, unit } = getNutZapInfo(event);
    if (!proofs.length || !mintUrl) continue;

    proofStore[mintUrl] ??= {};
    proofStore[mintUrl][unit] ??= [];

    for (const proof of proofs) {
      if (!seenSecrets.has(proof.secret)) {
        proofStore[mintUrl][unit].push({ proof, eventId: event.id });
        seenSecrets.add(proof.secret);
      }
    }
  }

  return proofStore;
}

/**
 * Fetches unredeemed NutZap proofs for a user, grouped by mint URL and unit.
 * @param hexOrNpub User's pubkey (npub or hex).
 * @param relays Relays to query (defaults to DEFAULT_RELAYS).
 * @param nutZapRelays Relays for NutZap events.
 * @param mints Optional mint URLs to filter NutZaps.
 * @param toastrInfo Flag to enable toastr notifications.
 * @returns Object mapping mint URLs and units to proof-event ID pairs.
 */
export async function getUnclaimedNutZaps(
  hexOrNpub: string,
  relays: string[],
  nutZapRelays: string[] = [],
  mints: string[] = [],
  toastrInfo: boolean = false,
): Promise<ProofStore> {
  relays = relays || DEFAULT_RELAYS; // Fallback
  const hexpub = maybeConvertNpubToHexPub(hexOrNpub);
  const combinedRelays = [
    ...new Set([...nutZapRelays, ...relays].filter(Boolean)),
  ];
  console.log("Using relays for redemptions:", combinedRelays);
  console.log("Using relays for NutZaps:", nutZapRelays);

  try {
    if (toastrInfo) toastr.info("Gathering NutZaps...");
    // Do nutzap and redemption lookups simultaneously
    const [redeemedIds, nutZapEvents] = await Promise.all([
      getRedeemedNutZaps(hexpub, combinedRelays),
      fetchNutZapEvents(hexpub, nutZapRelays, mints),
    ]);
    const proofStore = processNutZapEvents(nutZapEvents, redeemedIds);
    console.log("Unclaimed NutZaps:", proofStore);
    return proofStore;
  } catch (error) {
    console.error("Error fetching NutZaps:", error);
    if (toastrInfo) {
      toastr.error(
        `Failed to fetch NutZaps: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {};
  }
}

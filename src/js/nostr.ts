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
import { EncryptedDirectMessage } from "nostr-tools/kinds";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
];
export const NOSTRLY_PUBKEY =
  "cec0f44d0d64d6d9d7a1c84c330f5467e752cc8b065f720e874a0bed1c5416d2";
export const pool = new SimplePool();

export const sendViaNostr = async (
  toPub: string,
  message: string,
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

export const getContactDetails = async (npub: string, relays: string[]) => {
  try {
    if (!relays) {
      relays = DEFAULT_RELAYS; // Fallback
    }
    const hexpub = nip19.decode(npub).data as string;
    const filter: Filter = { kinds: [0], authors: [hexpub] };
    const event = await pool.get(relays, filter);
    if (!event) return { name: null, img: null };
    const content = JSON.parse(event.content || "{}");
    return { name: content.name, img: content.picture };
  } catch (e) {
    return { name: null, img: null };
  }
};

export const maybeConvertNpub = (key: string) => {
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

export const p2pkeyToNpub = (key: string): string | null => {
  // Check and convert P2PK to npub
  try {
    return nip19.npubEncode(key.slice(2));
  } catch (e) {
    console.error(e);
  }

  return key;
};

// Checks public key is valid
export const isPublicKeyValid = (key: string): boolean => {
  key = maybeConvertNpub(key); // converts if in npub format
  const regex = /^(02|03)[0-9a-fA-F]{64}$/; // P2PK ECC Key
  if (key && regex.test(key)) {
    return true;
  }
  return false;
};

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

import { SimplePool, type UnsignedEvent, finalizeEvent, generateSecretKey, getPublicKey, nip04 } from "nostr-tools";
import { EncryptedDirectMessage } from "nostr-tools/kinds";
export const sendViaNostr = async (toPub: string, message: string) => {
	const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const event: UnsignedEvent = {
		kind: EncryptedDirectMessage,
		//@ts-ignore
		tags: [['p', toPub]],
		content: await nip04.encrypt(sk, toPub, message),
		created_at: Math.floor(Date.now() / 1000),
		pubkey: pk
	};
    const signedEvent = finalizeEvent(event, sk)
    pool.publish(DEFAULT_RELAYS, signedEvent)
};

export const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://relay.primal.net"];
export const ROBW_PUBKEY = 'cec0f44d0d64d6d9d7a1c84c330f5467e752cc8b065f720e874a0bed1c5416d2';
export const pool = new SimplePool();

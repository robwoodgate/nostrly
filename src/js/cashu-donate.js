import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  getEncodedTokenV4,
} from "@cashu/cashu-ts";
import toastr from "toastr";
import { sendViaNostr } from "./nostr.ts";
import {
  encode as emojiEncode,
  decode as emojiDecode,
} from "./emoji-encoder.ts";

/**
 * Cashu Donation
 * @param  string token Cashu token (or emoji)
 * @param  array $relays array of Nostr relays
 * @param  string toPub Nostr pubkey (hex)
 */
export const handleCashuDonation = async (token, relays, toPub) => {
  try {
    if (!token.startsWith("cashu")) {
      token = emojiDecode(token);
    }
    const decoded = getDecodedToken(token);
    if (!decoded) {
      throw new Error("Could not process token");
    }
    // Create a wallet connected to same mint as token
    const mintUrl = decoded.mint;
    const mint = new CashuMint(mintUrl);
    const wallet = new CashuWallet(mint);
    await wallet.loadMint();
    // Receive the token to the wallet (creates new proofs)
    const proofs = await wallet.receive(token);
    const newToken = getEncodedTokenV4({ mint: mintUrl, proofs: proofs });
    const emoji = emojiEncode("\uD83E\uDD5C", newToken); // nut emoji
    sendViaNostr("Cashu Donation: " + emoji, toPub, relays); // async fire-forget
    toastr.success("Donation received! Thanks for your support 🧡");
    return true;
  } catch (error) {
    console.error(error);
    toastr.error(error.message);
    return false;
  }
};

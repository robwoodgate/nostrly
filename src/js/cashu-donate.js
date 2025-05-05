import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  getEncodedTokenV4,
} from "@cashu/cashu-ts";
import toastr from "toastr";
import { NOSTRLY_PUBKEY, sendNutZap } from "./nostr.ts";
import { getWalletWithUnit } from "./utils.ts";
import {
  encode as emojiEncode,
  decode as emojiDecode,
} from "./emoji-encoder.ts";

/**
 * Cashu Donation
 * @param  {string} token Cashu token (or emoji)
 * @param  {string} message Cashu token (or emoji)
 * @param  {array}  relays array of Nostr relays
 * @param  {string} toPub Nostr pubkey (hex)
 */
export const handleCashuDonation = async (token, message, relays, toPub) => {
  try {
    // Ensure public key
    toPub = toPub || NOSTRLY_PUBKEY; // Fallback
    if (!token.startsWith("cashu")) {
      token = emojiDecode(token);
    }
    const decoded = getDecodedToken(token);
    if (!decoded) {
      throw new Error("Could not process token");
    }
    // Create a wallet connected to same mint as token
    const mintUrl = decoded.mint;
    const wallet = await getWalletWithUnit(mintUrl, decoded.unit); // Load wallet
    // Receive the token to the wallet (creates new proofs)
    const proofs = await wallet.receive(token, { p2pk: { pubkey: '02'+toPub } }); // 02 prefix!
    await sendNutZap(proofs, mintUrl, message, toPub);
    toastr.success("Donation received! Thanks for your support 🧡");
    return true;
  } catch (error) {
    console.error(error);
    toastr.error(error.message);
    return false;
  }
};

import {
  CashuMint,
  CashuWallet,
  getDecodedToken,
  getEncodedTokenV4,
} from "@cashu/cashu-ts";
import toastr from "toastr";
import {
  NOSTRLY_PUBKEY,
  sendViaNostr,
  sendNutZap,
  getNip61Info,
} from "./nostr.ts";
import { getWalletWithUnit, getTokenAmount, formatAmount } from "./utils.ts";
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
    // Try get Nip-61 locking p2pkey
    toPub = toPub || NOSTRLY_PUBKEY; // Fallback
    const { pubkey, mints, relays: nutzapRelays } = await getNip61Info(toPub);
    // Decode token / emoji
    if (!token.startsWith("cashu")) {
      token = emojiDecode(token);
    }
    const decoded = getDecodedToken(token);
    if (!decoded) {
      throw new Error("Could not process token");
    }
    // Create a wallet connected to same mint as token
    const mintUrl = decoded.mint;
    const unit = decoded.unit;
    const wallet = await getWalletWithUnit(mintUrl, unit); // Load wallet
    let proofs; // scope
    if (pubkey && mints.includes(mintUrl)) {
      // We have a NIP-61 pubkey and the mint is one of the approved ones
      // Receive the token to the wallet (creates new proofs)
      // locked to our p2pk pubkey, and send as NutZap to the NIP-61 relays
      proofs = await wallet.receive(token, { p2pk: { pubkey: "02" + pubkey } });
      await sendNutZap(proofs, mintUrl, message, toPub, nutzapRelays);
    } else {
      // Receive the token to the wallet (creates new proofs) and send as Nostr DM
      proofs = await wallet.receive(token);
      const newToken = getEncodedTokenV4({
        mint: mintUrl,
        proofs: proofs,
        unit: unit,
      });
      const emoji = emojiEncode("\uD83E\uDD5C", newToken); // nut emoji
      sendViaNostr("Cashu Donation: " + emoji, toPub, relays); // async fire-forget
    }
    const amount = formatAmount(getTokenAmount(proofs), unit);
    toastr.success(`${amount} donation received! Thanks for your support 🧡`);
    return true;
  } catch (error) {
    console.error(error);
    toastr.error(error.message);
    return false;
  }
};

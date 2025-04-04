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
 * @param  jQuery input jQuery text input eg: $("#donate_cashu")
 * @param  array $relays array of Nostr relays
 * @param  string toPub Nostr pubkey (hex)
 */
export function initCashuDonate(input, relays, toPub) {
  const process = () => {
    // Wait for paste to finish
    setTimeout(async () => {
      try {
        let token = input.val();
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
        const emoji = emojiEncode("\uD83E\uDD5C", newToken);
        sendViaNostr(toPub, "Cashu Donation: " + emoji, relays); // async fire-forget
        toastr.success("Donation received! Thanks for your support 🧡");
      } catch (error) {
        console.error(error);
        toastr.error(error.message);
      } finally {
        input.val("");
      }
    }, 200);
  };
  input.on("paste", process);
}

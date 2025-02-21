import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip04 } from "nostr-tools";
import { CashuMint, CashuWallet, getDecodedToken, getEncodedTokenV4 } from '@cashu/cashu-ts';
import { EncryptedDirectMessage } from "nostr-tools/kinds";

jQuery(function($) {

	// Get our custom relays and create pool
    const relays = nostrly_ajax.relays;
    const pool = new SimplePool();

    // Handle Donation element
    const $inputCashu = $("#donate_cashu");
	const process = () => {
		// Wait for paste to finish
		setTimeout(async () => {
		  try {
		  	const token = $inputCashu.val();
		    if (token.indexOf("cashu") != 0) {
		      throw new Error("Not a cashu token");
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
		    sendViaNostr(nostrly_ajax.pubkey, newToken); // async fire-forget
		    toastr.success('Donation received! Thanks for your support 🧡');
		  } catch (error) {
		    console.error(error);
		    toastr.error(error.message);
		  }
		  finally {
		    $inputCashu.val('');
		  }
		}, 200);
	};
	$inputCashu.on('paste', process);

    // Sends encrypted message anonymously via Nostr
	async function sendViaNostr(toPub, message) {
		const sk = generateSecretKey();
	    const pk = getPublicKey(sk);
	    const event = {
			kind: EncryptedDirectMessage,
			tags: [['p', toPub]],
			content: await nip04.encrypt(sk, toPub, message),
			created_at: Math.floor(Date.now() / 1000),
			pubkey: pk
		};
	    const signedEvent = finalizeEvent(event, sk);
	    pool.publish(relays, signedEvent);
	}
});

// Imports
import { CashuMint, CashuWallet, getDecodedToken, CheckStateEnum, getEncodedTokenV4 } from '@cashu/cashu-ts';
import { decode } from "@gandlaf21/bolt11-decode";
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip04 } from "nostr-tools";
import { EncryptedDirectMessage } from "nostr-tools/kinds";
import bech32 from 'bech32';

// Cashu Donation
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
		    // Check we have a pubkey set!
		    if (!nostrly_ajax.pubkey) {
		    	throw new Error("Thanks, but donations are disabled at the moment");
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

// Cashu Redeem
jQuery(function($) {
	let wallet;
	let mintUrl = '';
	let proofs = [];
	let tokenAmount = 0;

	// DOM elements
	const $lnurl = $("#lnurl");
	const $token = $("#token");
	const $tokenStatus = $("#tokenStatus");
	const $lightningStatus = $("#lightningStatus");
	const $lightningSection = $("#lightningSection");
	const $tokenRemover = $('#tokenRemover');
	const $lnurlRemover = $('#lnurlRemover');
	const $redeemButton = $('#redeem');

	// Helpers to get invoice from Lightning address | LN URL
	const isLnurl = (address) =>
		address.split('@').length === 2 || address.toLowerCase().startsWith('lnurl1');
	const getInvoiceFromLnurl = async (
		address = '',
		amount = 0
	) => {
		try {
			if (!address) throw 'Error: address is required!';
			if (!amount) throw 'Error: amount is required!';
			if (!isLnurl(address)) throw 'Error: invalid address';
			let data = {
				tag: '',
				minSendable: 0,
				maxSendable: 0,
				callback: '',
				pr: '',
			};
			if (address.split('@').length === 2) {
				const [user, host] = address.split('@');
				const response = await fetch(
					`https://${host}/.well-known/lnurlp/${user}`
				);
				if (!response.ok) throw 'Unable to reach host';
				const json = await response.json();
				data = json;
			} else {
				const dataPart = bech32.decode(address, 20000).words;
				const requestByteArray = bech32.fromWords(dataPart);
				const host = new TextDecoder().decode(new Uint8Array(requestByteArray));
				const response = await fetch(host);
				if (!response.ok) throw 'Unable to reach host';
				const json = await response.json();
				data = json;
			}
			if (
				data.tag == 'payRequest' &&
				data.minSendable <= amount * 1000 &&
				amount * 1000 <= data.maxSendable
			) {
				const response = await fetch(`${data.callback}?amount=${amount * 1000}`);
				if (!response.ok) throw 'Unable to reach host';
				const json = await response.json();
				return json.pr ?? new Error('Unable to get invoice');
			} else throw 'Host unable to make a lightning invoice for this amount.';
		} catch (err) {
			console.error(err);
			return '';
		}
	};

	// Helper to process the Cashu Token
	const processToken = async (event) => {
		if (event) event.preventDefault();
		$tokenRemover.removeClass('hidden');
		$lightningSection.addClass('hidden');
		$tokenStatus.text('Checking token, one moment please...');
		$lightningStatus.text('');
		try {
			const tokenEncoded = $token.val();
			if (!tokenEncoded) {
				$tokenStatus.text('');
				$tokenRemover.addClass('hidden');
				$redeemButton.prop("disabled", true);
				return;
			}
			const token = getDecodedToken(tokenEncoded);
			console.log('token :>> ', token);
			if (!token.proofs.length || !token.mint.length) {
				throw 'Token format invalid';
			}
			mintUrl = token.mint;
			const mint = new CashuMint(mintUrl);
			wallet = new CashuWallet(mint);
			await wallet.loadMint();
			proofs = token.proofs ?? [];
			console.log('proofs :>>', proofs);
			const spentProofs = await wallet.checkProofsStates(proofs);
			console.log('spentProofs :>>', spentProofs);
			let unspentProofs = [];
			spentProofs.forEach((state, index) => {
				if (state.state == CheckStateEnum.UNSPENT) {
					console.log('UNSPENT :>>', proofs[index]);
					unspentProofs.push(proofs[index]);
				}
			});
			console.log('unspentProofs :>>', unspentProofs);
			if (!unspentProofs.length) {
				// Is this our saved token? If so, remove it
				const lstoken = localStorage.getItem("nostrly-cashu-token");
				if (lstoken == $token.val()) {
					localStorage.removeItem("nostrly-cashu-token");
				}
		     	throw 'Token already spent';
		    }
			proofs = unspentProofs;
			tokenAmount = proofs.reduce(
				(accumulator, currentValue) =>
					accumulator + currentValue.amount,
				0
			);
			let mintHost = (new URL(mintUrl)).hostname;
			$tokenStatus.text(
				`Token value ${tokenAmount} sats from the mint: ${mintHost}`
			);
			$lightningSection.removeClass('hidden');
			$lightningStatus.text('Redeem to address / pay invoice...');
			// Autopay?
			let params = new URL(document.location.href).searchParams;
			let autopay = decodeURIComponent(params.get('autopay') ?? '');
			if (autopay && $lnurl.val().length) {
				// Clear URL params if this is a repeat (eg: page refresh)
				let lastpay = localStorage.getItem("nostrly-cashu-last-autopay");
				if (lastpay == $lnurl.val()) {
					window.location.href = window.location.origin + window.location.pathname;
				}
				// Update last autopay destination
				localStorage.setItem("nostrly-cashu-last-autopay", $lnurl.val());
				await makePayment();
			}
		} catch (err) {
			console.error(err);
			let errMsg = `${err}`;
			if (
				errMsg.startsWith('InvalidCharacterError') ||
				errMsg.startsWith('SyntaxError:')
			) {
				errMsg = 'Invalid Token!';
			}
			$tokenStatus.text(errMsg);
		}
	};

	// Melt the token and send the payment
	const makePayment = async (event) => {
		if (event) event.preventDefault();
		$lightningStatus.text('Attempting payment...');
		try {
			if (tokenAmount < 4) {
				throw 'Minimum token amount is 4 sats';
			}
			let invoice = '';
			let address = $lnurl.val() ?? '';
			let iterateFee = null;
			let meltQuote = null;
			if (isLnurl(address)) {
				let iterateAmount = tokenAmount - Math.ceil(Math.max(3, tokenAmount * 0.02));
				let iterateFee = 0;
				while (iterateAmount + iterateFee != tokenAmount) {
					iterateAmount = tokenAmount - iterateFee;
					invoice = await getInvoiceFromLnurl(address, iterateAmount);
					meltQuote = await wallet.createMeltQuote(invoice);
					iterateFee = meltQuote.fee_reserve;
					console.log('invoice :>> ', invoice);
					console.log('iterateAmount :>> ', iterateAmount);
					console.log('iterateFee :>> ', iterateFee);
				}
			} else {
					invoice = address;
					meltQuote = await wallet.createMeltQuote(invoice);
			}
			// wallet and tokenAmount let us know processToken succeeded
			// If so, check invoice can be covered by the tokenAmount
			if (!wallet || !invoice || !tokenAmount) throw 'OOPS!';
			const decodedInvoice = await decode(invoice);
			const amountToSend = meltQuote.amount + meltQuote.fee_reserve;
			if (amountToSend > tokenAmount) {
					throw 'Not enough to pay the invoice: needs ' + meltQuote.amount + ' + ' + meltQuote.fee_reserve + ' sats';
			}
			$lightningStatus.text(
				`Sending ${meltQuote.amount} sats (plus ${meltQuote.fee_reserve} sats network fees) via Lightning`
			);

			// CashuWallet.send performs coin selection and swaps the proofs with the mint
			// if no appropriate amount can be selected offline. We must include potential
			// ecash fees that the mint might require to melt the resulting proofsToSend later.
			const { keep: proofsToKeep, send: proofsToSend } = await wallet.send(amountToSend, proofs, {
					includeFees: true
			});
			console.log('proofsToKeep :>> ', proofsToKeep);
			console.log('proofsToSend :>> ', proofsToSend);
			const meltResponse = await wallet.meltProofs(meltQuote, proofsToSend);
			console.log('meltResponse :>> ', meltResponse);
			if (meltResponse.quote) {
				$lightningStatus.text('Payment successful!');
				doConfettiBomb();
				// Tokenize any unspent proofs
				if (proofsToKeep.length > 0 || meltResponse.change.length > 0) {
					$lightningStatus.text("Success! Preparing your change token...");
					const change = proofsToKeep.concat(meltResponse.change);
					let newToken = getEncodedTokenV4({ mint: mintUrl, proofs: change });
					console.log('change token :>> ', newToken);
					localStorage.setItem("nostrly-cashu-token", newToken);
					setTimeout(() => {
						$redeemButton.prop("disabled", true);
						$lnurlRemover.addClass('hidden');
						$lnurl.val('');
						$token.val(newToken);
						$token.trigger('input');
					}, 5000);
				}
			} else {
				$lightningStatus.text('Payment failed');
			}
		} catch (err) {
			console.error(err);
			$lightningStatus.text('Payment failed: ' + err);
		}
	};

	// Event Listeners
	$tokenRemover.on("click", (e) => {
		e.preventDefault();
		$token.val('');
		$tokenStatus.text('');
		$lightningStatus.text('');
		$tokenRemover.addClass('hidden');
		$lightningSection.addClass('hidden');
		$redeemButton.prop("disabled", true);
	});
	$lnurlRemover.on("click", (e) => {
		e.preventDefault();
		$lnurl.val('');
		$lnurlRemover.addClass('hidden');
		$redeemButton.prop("disabled", true);
	});
	$token.on("input", processToken);
	$lnurl.on("input", () => {
		if ($lnurl.val()) {
			$lnurlRemover.removeClass('hidden');
			$redeemButton.prop("disabled", false);
		} else {
			$lnurlRemover.addClass('hidden');
			$redeemButton.prop("disabled", true);
		}
	});
	$redeemButton.on("click", async (event) => {
		makePayment(event);
		$redeemButton.prop("disabled", true);
	});

	// Allow auto populate fields
	let params = new URL(document.location.href).searchParams;
	const token = decodeURIComponent(params.get('token') ?? '');
	const lstoken = localStorage.getItem("nostrly-cashu-token");
	const to = decodeURIComponent(params.get('ln') || params.get('lightning') || params.get('to') || '');
	if (token) { // Try URL token first...
		$token.val(token);
		processToken();
	} else if (lstoken) { // ... Saved change second
		$token.val(lstoken);
		processToken();
	}
	if (to) {
		$lnurl.val(to);
		$lnurl.trigger('input');
	}

	// Confetti bomb
	function doConfettiBomb() {
        // Do the confetti bomb
        var duration = 0.25 * 1000; //secs
        var end = Date.now() + duration;

        (function frame() {
            // launch a few confetti from the left edge
            confetti({
                particleCount: 7,
                angle: 60,
                spread: 55,
                origin: {
                    x: 0
                }
            });
            // and launch a few from the right edge
            confetti({
                particleCount: 7,
                angle: 120,
                spread: 55,
                origin: {
                    x: 1
                }
            });

            // keep going until we are out of time
            if (Date.now() < end) {
                requestAnimationFrame(frame);
            }
        }());
        confetti.reset();
    }
});

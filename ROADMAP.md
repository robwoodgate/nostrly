# Roadmap

Nutroot (v3 keyset) capabilities worth showcasing in Nostrly, roughly in the
order they earn their keep. Nostrly is where the lock formats get seen, so the
bar for each entry is "does a person understand nutroot better after using it".

Status key: **shipped**, **next**, **later**, **not yet**.

## Shipped

- **Auditable locks.** NutLock builds the canonical public single-key lock: a
  NUMS internal key with one unblinded 1-of-1 leaf, so anyone can verify who
  can spend without holding a key.
- **Condition trees.** NutLock stacks leaves (threshold plus refund-after), and
  Witness x-rays every leaf with a per-leaf "can your key satisfy this" verdict.
- **P2BK receiver-keyed sends.** Unique secret per output derived from a static
  recipient key, so the recipient's key never appears on the wire.
- **Spend evidence (NUT-07).** Witness verifies a disclosure spend end to end
  in the browser: commitment opens, signatures verify against the input digest,
  preimage matches its hashlock, and the exercised leaf matches the token's own
  disclosed tree.
- **Auditable locks are named, not just parsed.** Witness recognises the
  canonical shape and says who can claim it, verified from the proof alone.
- **Payment requests (NUT-18 / NUT-26).** Cashu Request composes a request that
  asks for receiver-keyed outputs under an optional condition, reads one back
  in plain English, and pays one: the payer reproduces the requested tree and
  derives a fresh secret for the payee.
- **Delivery over nostr.** A request can name an npub, and paying one seals the
  payload into a NIP-17 message the payee collects in their browser. This is
  load-bearing rather than convenient: a derived secret cannot be found by
  scanning the mint, so the payee needs the token itself.
- **Gifting a locked mint quote.** Cashu Gift pays an invoice for a quote
  locked to someone else's key, which only they can mint. The cardless ATM
  without the bearer quote id that made it a theft vector.

## Next

- **Knowing whether a gift was claimed.** The giver keeps the claim links they
  have sent, but not what became of them. A batched quote check (the same one
  the claim inbox uses) would let the list say claimed or still waiting, which
  is the question a giver actually has.

- **Reclaimable gifts.** A quote lock can carry a tree like any secret, so an
  unclaimed gift could return to the giver after a locktime via the script
  path. Cashu Gift locks to a bare key today, and cashu-ts would need to accept
  a nutroot quote lock and sign one by script path.

- **NIP-07 for claims.** Claiming a gift and reading the inbox both want a
  private key in the page. A gift locked to someone's nostr key could instead
  be claimed through their extension, which is the safer habit to teach.

- **Richer requested trees.** Compose currently offers one backup-after leaf.
  Co-signers (a 2-of-2 escrow) and hashlocks are the same machinery with more
  form fields, once there is a use case worth the UI.

- **Disclosure as an option, not just a lock type.** `disclosure` currently
  rides along with auditable locks only. Any leaf can carry it, so expose it as
  a choice: "make the claim publicly verifiable". Blocked on a small cashu-ts
  addition first: `LockBuilder` sets the flag only on leaves passed whole to
  `addLeaf`, so the main and refund leaves it generates internally need a
  `disclose()` affordance before Nostrly can offer the checkbox.

- **Requests in Redeem.** Paying a request lives in the Request tool for now,
  next to the request it fulfils. If it earns its keep, Redeem is the natural
  second home, since that is where people arrive holding a token.

## Later

- **Atomic ecash swaps (hashlock plus disclosure).** Two strangers swap ecash
  across mints with no trusted party: both sides lock to the same hash, and the
  first claim publishes its preimage through NUT-07, which the counterparty
  reads to claim their side. The flashiest thing nutroot can do, and the reason
  disclosure exists beyond public tips. Needs a hashlock lock type, a preimage
  watch mode in Witness, and careful timeout handling.

- **Batched and mixed transactions.** One transaction can carry several quote
  inputs, proofs from different senders, and a melt quote, all atomic. Gather
  is the natural home: sweep several tokens and pay an invoice in one request.

## Not yet

Doors the spec deliberately leaves open but has not walked through. Building on
them would advertise something that is not settled:

- **Covenants** (`melt_to` and friends): illustration only in NUT-10, no
  allocated leaf type.
- **MuSig2 / FROST**: no interop NUT yet, and nonce handling is the part that
  loses funds when rushed.
- **Scripted leaves** (leaf version `0x01`): the extension point exists, the
  language does not.

## Upstream: what cashu-ts could make easier

Everything below was worked around here rather than fixed at source. Each is a
small addition, and each removes something awkward from every wallet, not just
this one.

- **A signer callback for minting.** Done on cashu-ts 1005 (pending the next
  experimental build): `MintProofsConfig.sign` (and `.sign(fn)` on the mint
  builder) takes the quote digest, and for a v3 quote the tagged message and
  container, and returns the signature; `CashuNip07.signQuote(nostr)` is the
  extension-backed one. Cashu Gift claims a gift locked to the extension's own
  nostr key that way, with NIP-60 wallet keys still covering nutzap locks.

- **Parity-tolerant quote key matching.** Fixed at source: `findSigningKey`
  matches on x and returns the scalar for the published parity (PR to cashu-ts
  main). The gift tool's own both-parities workaround can go once that ships.

- **`LockBuilder.disclose()`.** The `disclosure` flag can only be set on leaves
  passed whole to `addLeaf`; the main and refund leaves the builder generates
  cannot carry it. Until they can, "make this claim publicly verifiable" cannot
  be offered as an option on an ordinary lock.

- **Spend receipts.** A spender cannot open their own NUT-07 spend commitment,
  because nothing surfaces the `(Y, input_digest, witness)` a swap or melt
  produced. Returning them per input would make "prove I paid this" possible
  client-side, which is the whole point of the commitment.

- **Why a legacy encoding was dropped.** `PaymentRequestBuilder.lock()` quietly
  omits `nut10` when the lock blinds its keys, which is correct but invisible:
  the caller cannot tell a deliberate omission from a bug. A reason on the
  result would save guessing.

- **One spendability check across both lock families.** Done on cashu-ts 950
  (pending the next experimental build): `Wallet.spendOptions` now accepts any
  proof and answers `spendable` plus a machine-readable `blockedBy`
  (`not-keyed-to-you`, `locktime`, `threshold`, `preimage`), wording left to the
  caller. A NUT-11 lock reads as the same leaf shape as a nutroot tree, matched
  across key parity and through `p2pk_e`, so the decision tree in the Cashu
  Request collect tab (`isBlsKeyset` gate, `getP2PKExpectedWitnessPubkeys`
  fallback, hand-rolled parity flip) can collapse to one call once the pin moves.
  `isPaymentRequestSatisfied` keeps its own legacy comparison on purpose: it
  checks lock identity (exactly the condition requested), which is stronger than
  spendability and is what settlement needs.

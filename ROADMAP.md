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

## Next

- **Request transports.** Requests carry no transport yet, so the payer hands
  the token back by other means. NUT-18 allows a nostr transport, and Nostrly
  already sends nutzaps, so a request could name an nprofile and have the payer
  deliver the payment automatically.

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

- **Gift a locked mint quote (the cardless ATM).** Under v3 every mint quote is
  locked and can carry a tree, so you can pay an invoice for someone else,
  lock the quote to their npub-derived key, and add an `after` refund leaf so
  it returns to you if never redeemed. Uniquely v3, natively nostr-shaped, and
  nobody else is demoing it. Needs quote lock derivation and invoice polling.

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

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
- **NIP-07 for claims.** A gift locked to the extension's own nostr key is
  claimed through the extension, no private key in the page: the safer habit
  to teach.
- **Disclosure as an option, not just a lock type.** Cashu Request offers
  "publicly verifiable claims" on any request: every generated leaf carries
  `disclosure`, and a lone key gives up its key path so no spend can dodge it.
- **NutLock mirrors the lock model.** Hashlocks (paste a hash or make a
  secret, kept in history), "publicly verifiable claims" as a switch, extra
  spending paths as leaf rows, and a live "what this lock says" summary in the
  words Witness uses. Auditable is a preset of the same form. On a legacy mint
  the v3-only controls hide and the rest encodes as NUT-11/14. One half of an
  atomic swap comes out of this form as it stands.
- **Spend receipts.** NutLock hands the payer a receipt for a v3 spend: the
  spent proofs plus what opens the mint's NUT-07 commitment for each. Witness
  verifies one end to end and matches it against the mint's own commitment,
  so "I paid this" is provable without the mint's cooperation.

## Next

- **Knowing whether a gift was claimed.** The giver keeps the claim links they
  have sent, but not what became of them. A batched quote check (the same one
  the claim inbox uses) would let the list say claimed or still waiting, which
  is the question a giver actually has.

- **Reclaimable gifts.** A quote lock can carry a tree like any secret, so an
  unclaimed gift could return to the giver after a locktime via the script
  path. Cashu Gift locks to a bare key today, and cashu-ts would need to accept
  a nutroot quote lock and sign one by script path.

- **Richer requested trees.** Compose currently offers one backup-after leaf.
  Co-signers (a 2-of-2 escrow) and hashlocks are the same machinery with more
  form fields, once there is a use case worth the UI. NutLock's spending-path
  rows are the pattern to copy.

- **Requests in Redeem.** Paying a request lives in the Request tool for now,
  next to the request it fulfils. If it earns its keep, Redeem is the natural
  second home, since that is where people arrive holding a token.

## Later

- **Atomic ecash swaps (hashlock plus disclosure).** Two strangers swap ecash
  across mints with no trusted party: both sides lock to the same hash, and the
  first claim publishes its preimage through NUT-07, which the counterparty
  reads to claim their side. The flashiest thing nutroot can do, and the reason
  disclosure exists beyond public tips. NutLock now builds each half (secret,
  refund after expiry, publicly verifiable); still needed: a preimage watch
  mode in Witness, and careful timeout handling.

## Not yet

Doors the spec deliberately leaves open but has not walked through. Building on
them would advertise something that is not settled:

- **Covenants** (`melt_to` and friends): illustration only in NUT-10, no
  allocated leaf type.
- **MuSig2 / FROST**: no interop NUT yet, and nonce handling is the part that
  loses funds when rushed.
- **Scripted leaves** (leaf version `0x01`): the extension point exists, the
  language does not.
- **Batched and mixed transactions.** One transaction can carry several quote
  inputs, proofs from different senders, and a melt quote, all atomic. Gather
  is the natural home: sweep several tokens and pay an invoice in one request.

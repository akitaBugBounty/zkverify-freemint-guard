# RikyFreeMintGuard — ZKVerify Agent Games (Wildcard)

A read-only agent that verifies a claimed **free mint** on-chain **before**
anyone signs. Built for the Wildcard track, theme **Agentic Commerce**:
it helps someone **earn** (free mints) without getting drained by a fake
"free" mint.

## What it does

`POST /verify` with `{ chain, contract, wallet? }` and it checks, all
read-only against public RPCs:

1. **Contract exists** — `eth_getCode` (an EOA or dead address = AVOID)
2. **Token standard** — ERC165 `supportsInterface` for ERC721 / ERC1155
3. **Name / symbol** — best effort
4. **Supply** — `totalSupply()` vs `maxSupply()` / `MAX_SUPPLY()` (sold out = AVOID)
5. **Mint price** — `price()` / `mintPrice()` / `cost()`; a non-zero price on a
   "free" claim is a red flag (CAUTION); an unreadable price is reported
   honestly as "cannot be read, confirm manually"
6. **Paused** — `paused()` (paused = AVOID)
7. **Mint entry points** — scans runtime bytecode for `mint(uint256)`,
   `claim()`, `freeMint()`, `mint(address,uint256)`
8. **Wallet holdings** — `balanceOf(wallet)` when a wallet is given

Verdict: **GO** / **CAUTION** / **AVOID**, each with human-readable reasons
and full on-chain evidence (values + block number) so a judge can re-check
every claim independently.

`GET /` returns health + usage.

## Live endpoint

`https://zkverify-freemint-guard.akita70229.workers.dev/`

```bash
curl -X POST https://zkverify-freemint-guard.akita70229.workers.dev/verify \
  -H 'content-type: application/json' \
  -d '{"chain":"bsc","contract":"0x1c759C4e075103b5B250DB5114B832b17B99C456","wallet":"0x0c930c1fB7F739957d8D7358BC8AD2a76bcC4418"}'
```

Chains: `bsc`, `ethereum`, `base`, `sepolia`, `base-sepolia`.

## Verified live (2026-11-15, BSC)

| Contract | Verdict | Notes |
|---|---|---|
| Claf Eye `0x1c75…C456` | CAUTION | supply left 10,888/18,000; price unreadable; wallet holds 1 |
| Pokechain `0x4EF9…e32` | CAUTION | price unreadable; maxSupply 15,555 |
| EOA `0x0c93…4418` | AVOID | no contract code at this address |

The agent is conservative on purpose: a mint it cannot prove is free is
CAUTION, never GO. A guard that says "yes" to everything is useless.

## How it relates to zkVerify

The agent's claims are checkable in the same spirit as the Gatekeeper
track: every verdict cites on-chain evidence (values + block number) that
anyone can re-verify. A zkVerify proof reference is optional for Wildcard
and not included in this entry — the verdicts are reproducible from public
RPC data alone.

## Files

- `worker.js` — the Cloudflare Worker (single file, no dependencies)
- `test-local.mjs` — local smoke test against live BSC RPC (Node 18+)

## Deploy

Cloudflare Worker, dashboard deploy (paste `worker.js`). No secrets, no
environment variables, no signing keys — the agent is fully read-only.

## License

MIT

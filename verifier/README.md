# SafeStreak verifier

Node.js service (ethers v6 + Express) for Render. Verifies that a user
revoked an ERC-20 approval, then signs an EIP-712 attestation the
SafeStreak contract can verify on-chain.

## Endpoints

- `GET /health` — liveness + config summary (accepted token symbols,
  snapshot block, whether signer/RPC are ready). Never exposes the key.
- `POST /attest` — body:
  `{ user, token, spender, approvalBlock, revokeTxHash, nonce? }`
  Checks, in order:
  1. `token` is in the accepted list (USDT, USDC, WBNB, BTCB, ETH, CAKE —
     addresses from env `ACCEPTED_TOKENS`, never hardcoded).
  2. `approvalBlock < SNAPSHOT_BLOCK` (final snapshot 09/12/2026 08:00 UTC).
  3. An `Approval` event with value > 0 exists for `(user, token, spender)`
     at `approvalBlock` (via `RPC_URL`).
  4. Current `allowance(user, spender) == 0` (the approval was revoked).
  5. Signs EIP-712 `Attestation(user, token, spender, approvalBlock,
     revokeTxHash, nonce, deadline)` with `deadline = now + 15 min`.
     Nonce is read from `nonces(user)` on the SafeStreak contract when
     `SAFESTREAK_ADDRESS` is set; otherwise the request-supplied `nonce` is
     accepted (pre-deployment fallback only — document it in the request).
  Returns `{ signature, nonce, deadline }`.

## Deploy on Render

1. Create a new Web Service from this repo (root directory `verifier/`).
2. Build command: `npm install` — Start command: `npm start`
   (Node 20+; Render sets `PORT` itself).
3. Set env vars (Render dashboard → Environment, never commit them):
   - `VERIFIER_PRIVATE_KEY` — dedicated verifier key only. Generate a fresh
     key for this service; never reuse a deployer key; never log it.
   - `RPC_URL` — public BNB Chain RPC endpoint.
   - `SAFESTREAK_ADDRESS` — empty until the contract is deployed.
   - `SNAPSHOT_BLOCK` — block number of 09/12/2026 08:00 UTC (set once known).
   - `ACCEPTED_TOKENS` — JSON map symbol → address, e.g.
     `{"USDT":"0x...","USDC":"0x...","WBNB":"0x...","BTCB":"0x...","ETH":"0x...","CAKE":"0x..."}`.
     Use verified BNB Chain mainnet addresses only. The `.env.example`
     contains clearly-marked placeholders — do not deploy with them.

## Security notes

- The private key lives only in env, is never in code, and is never logged
  (error paths log only the error message).
- The service never sends transactions and never holds user funds.
- The EIP-712 domain (`SafeStreak`, v1, chainId from RPC, verifyingContract
  = SafeStreak address) must match the deployed contract, or signatures
  will not verify on-chain — confirm against the contract before go-live.
- Rotate the verifier key if it is ever exposed; redeploy with the new key
  and update the contract's trusted signer if applicable.

## Run locally

```bash
cp .env.example .env   # fill in real values; never commit .env
npm install
npm start
curl localhost:3000/health
```

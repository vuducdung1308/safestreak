# SafeStreak frontend

Vite + React static app. Connects ONLY via an injected EIP-1193 provider
(`window.ethereum`) in the Binance App dApp browser. No WalletConnect, no QR
pairing library.

## Rules baked in

- Educational content only — not financial advice, no financial reward.
- Never use the words earn / airdrop / profit / income in UI copy.
- The SafeStreak contract is NOT deployed yet. `VITE_SAFESTREAK_ADDRESS` is
  empty until deployment — never invent a deployed address or app link.
- Final leaderboard snapshot: 09/12/2026 08:00 UTC. Top 3 receive Binance
  merch (no cash, no token), shipped off-chain.
- Accepted attestation tokens: USDT, USDC, WBNB, BTCB, ETH, CAKE.
- Reveal window 36h, signature deadline 15 min, max 3 attestations/day,
  badges at 3/7/14, points = total correct answers.

## Pages (state-based routing, in `src/App.jsx`)

- Home — FR-13 warning banner + how it works.
- Challenge — today's question from `src/questions.json`, countdown to
  00:00 UTC, commit (random salt generated locally, commit hash) then reveal
  with answer + salt within 36h of publisher reveal.
- Profile — connected wallet ONLY: `.ai` name via `handleOf` on the Agent ID contract (SafeStreak itself has no `handleOf`), streaks,
  points, badges, history. No lookup of other wallets, no search box.
- Leaderboard — name + stats only, no balances/assets, ranked by points
  then best correct streak.
- Approval Health Check — connected wallet ONLY. Reads ERC-20 allowances,
  flags unlimited / unverified spender / old approvals. Revoke creates an
  `approve(spender, 0)` transaction for the USER to sign in their wallet —
  the app never sends it itself, and never creates an approval above 0.
  Token addresses are NOT hardcoded in the frontend: check a token by
  pasting its address, or wire the accepted-token address list from the
  verifier's `ACCEPTED_TOKENS` env (see `verifier/`).
- Stats — unique Agent ID addresses and tx counts by type/day, read from
  on-chain events, with a note that data comes from on-chain events.

Language toggle VI–EN is a local dictionary in `src/i18n.js` (no external
service).

## Run

```bash
cp .env.example .env   # fill in VITE_SAFESTREAK_ADDRESS after deployment
npm install
npm run dev
npm run build          # outputs static files to dist/
```

## Deploy to GitHub Pages

1. `npm run build`
2. Publish the `dist/` folder (e.g. via the `gh-pages` branch or a GitHub
   Action that runs `npm ci && npm run build` and uploads `dist/`).
3. `vite.config.js` uses `base: './'` so the build works as a project site
   under any sub-path.

## Env vars (see `.env.example`)

- `VITE_SAFESTREAK_ADDRESS` — empty until the contract is deployed.
- `VITE_AGENT_ID_ADDRESS` — `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`
- `VITE_RPC_URL` — public BNB Chain RPC endpoint.
- `VITE_VERIFIER_URL` — verifier service base URL (Render).

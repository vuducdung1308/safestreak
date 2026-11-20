# SafeStreak

Daily 1-minute wallet-security challenge for Agent ID holders on BNB Chain.
Each day one scenario, on-chain streaks, and cleaning up your own risky token
approvals. Built for the Agent ID Hackathon (Binance Wallet × BNB Chain),
submission window 18/11/2026 08:00 UTC – 09/12/2026 08:00 UTC.

Agent ID contract (BNB Chain, ERC-721, non-transferable):
`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`

> Educational content only. Not financial advice. No financial reward.
> SafeStreak has no token. The Top 3 final-leaderboard gifts are Binance
> merch, no cash, shipped off-chain to the winners.

## Repo layout

| Folder | What it is |
| --- | --- |
| `contracts/` | Foundry project: `SafeStreak.sol` + soulbound `Badge.sol`, tests (T1–T12, A1–A8), deploy script |
| `questions/` | 13 bilingual (VI–EN) questions as JSON + `hash.mjs` (contentHash / answerCommit) |
| `frontend/` | Vite + React static app (GitHub Pages). Injected EIP-1193 provider only — no WalletConnect, no QR/pairing |
| `verifier/` | Node.js service (Render): checks an Approval event, then signs EIP-712 attestations |
| `scripts/` | Off-chain final-leaderboard snapshot + Agent ID address counter (reproducible from events) |

Locked decisions (BRD v0.6, 20/11/2026): Foundry, Solidity 0.8.24,
Vite + React, GitHub Pages, verifier Node.js on Render, questions as JSON
in the public repo + hash on-chain. Reveal window 36h, verifier signature
deadline 15 min, max 3 attestations/user/day, badge milestones 3/7/14,
`SNAPSHOT_BLOCK` = deploy block. `points` = total correct answers
(1 correct = 1 point). Daily leaderboard by points then streak; final
leaderboard only by `bestCorrectStreak` (FR-16), points as tie-break.
Accepted attestation tokens: USDT, USDC, WBNB, BTCB, ETH, CAKE.
Run: 10 main challenge days, 27/11–06/12/2026, + 3 spare questions.
Final snapshot: 09/12/2026 08:00 UTC.

## Quick start

```bash
# Contract — test
cd contracts && forge test          # 31 tests, all passing (verified 20/11/2026)

# Frontend — build
cd frontend && npm install && npm run build

# Questions — hashes
cd questions && node hash.mjs

# Verifier — syntax check
cd verifier && node --check server.js

# Scripts — usage
cd scripts && node finalLeaderboard.mjs --help
```

## Deploy (mainnet, BNB Chain)

1. Create the three key roles first — **never generate or store real
   private keys/seeds in this repo, in chat, or in any AI tool.**
   - Owner: Safe 2-of-3 multisig on BNB Chain (hardware wallet, phone
     MetaMask, offline backup wallet). The Safe address is passed to the
     constructor as `OWNER`; the deployer is a temporary wallet funded
     with just enough gas.
   - Publisher: separate wallet, gas for ~1 week.
   - Verifier: key in Render secret / env only (`VERIFIER_PRIVATE_KEY`),
     never in code. It only signs, never sends transactions.
2. Deploy with Foundry (see `contracts/README.md`):
   `AGENT_ID / OWNER / PUBLISHER / VERIFIER` as env vars, then verify
   the source on BscScan. Record the deployed address and
   `SNAPSHOT_BLOCK` (= deploy block) here and in `.env` files.
3. Deploy the frontend to GitHub Pages (`frontend/README.md`) and the
   verifier to Render (`verifier/README.md`). Fill in the accepted-token
   addresses in the verifier env (`ACCEPTED_TOKENS`) with verified
   BNB Chain mainnet addresses.
4. Publish the first challenge (day 27/11/2026) before 00:00 UTC that
   day, from the publisher wallet, using `questions/hash.mjs` for the
   content hash and answer commitment (fresh random salt per day, kept
   secret — never committed to the repo).

## Go-live checklist (27/11–06/12/2026)

- [ ] Safe 2-of-3 owner, publisher, verifier addresses created
- [ ] Contract deployed + verified on BscScan; address + `SNAPSHOT_BLOCK` recorded
- [ ] 1 real commit tested in the Binance App dApp browser with an Agentic Wallet — record whether Developer Mode is needed
- [ ] Frontend live on GitHub Pages, verifier live on Render, accepted-token list filled in
- [ ] 13 questions reviewed (10 main + 3 spares); salts generated per day, stored in a password manager
- [ ] X posting plan ready (`SafeStreak_X_Posting_Plan_3x_Day.md`, 3 posts/day at 07:30 / 13:00 / 20:00 VN) — only when Dũng says go-live

## Still TBD before mainnet

- Specific merch items + quantities for ranks 1, 2, 3 (only the type is
  locked: Binance merch, no cash). Each item must be reviewed against
  the hackathon rules (no promised profit / financial reward) before
  public announcement.
- Claim deadline for winners + official contact channel.
- Real deployed SafeStreak address, `SNAPSHOT_BLOCK`, accepted-token
  contract addresses, live app URL.
- Developer Mode test result (see checklist above).

## Source of truth

`~/workspace/user/files/BRD___SafeStreak__Agent_ID_Hackathon.md` (v0.6).
If this README and the BRD disagree, the BRD wins — fix this README.

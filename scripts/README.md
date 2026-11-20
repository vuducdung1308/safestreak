# SafeStreak off-chain scripts

Dependency-free Node.js scripts (plain `fetch` JSON-RPC, no `npm install`
needed). Both fail with a clear message if required env vars are missing —
the SafeStreak contract is NOT deployed yet.

## Scripts

### `finalLeaderboard.mjs`

Final leaderboard at the snapshot 09/12/2026 08:00 UTC.

```bash
RPC_URL=https://bsc-dataseed.binance.org/ SAFESTREAK_ADDRESS=0x... node finalLeaderboard.mjs --out leaderboard.json
```

- Reads `Revealed` events from the SafeStreak contract, keeps reveals with
  block timestamp <= 2026-12-09T08:00:00Z.
- Ranks by bestCorrectStreak desc, then totalCorrect desc, then earliest
  time bestCorrectStreak was achieved, then tx index / log index.
- Output JSON: `{ snapshot, snapshotBlock, generatedAt, contract, top3, table }`.
  Each row: `rank, handle (.ai name via handleOf on the Agent ID contract, else address), address,
  bestCorrectStreak, totalCorrect, bestAchievedAt`. No balances published.
- Reproducible from BscScan: export the contract's `Revealed` events up to
  the snapshot block and apply the same ranking.

### `countAgentIds.mjs`

KPI count of unique Agent ID holders (target >= 30).

```bash
RPC_URL=https://bsc-dataseed.binance.org/ SAFESTREAK_ADDRESS=0x... node countAgentIds.mjs --out count.json
```

- Window: 2026-11-18T08:00:00Z to 2026-12-09T08:00:00Z.
- Collects distinct `user` addresses from `Committed` / `Revealed` /
  `StreakUpdated` / `Attested` events in the window (the `user` field is the
  acting address, i.e. msg.sender for those calls), then keeps only
  addresses with Agent ID `balanceOf > 0` at the end of the window.
- Output JSON: `{ windowStart, windowEnd, startBlock, endBlock,
  uniqueAddressesInEvents, uniqueAgentIds, kpiTarget, kpiMet, addresses }`.

## Env vars

| Var | Required | Notes |
| --- | --- | --- |
| `RPC_URL` | yes | BNB Chain JSON-RPC endpoint |
| `SAFESTREAK_ADDRESS` | yes | Deployed SafeStreak contract address |
| `AGENT_ID_ADDRESS` | no | Default `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` |
| `FROM_BLOCK` | no | First block to scan (default 0) |
| `SNAPSHOT_BLOCK` | no | `finalLeaderboard.mjs` only; otherwise found by binary search on block timestamps |
| `OUT` | no | Same as `--out <file>` |

Both scripts accept `--help`. Event topic hashes are keccak256 of the
canonical event signatures (see `frontend/src/abi.json`); they were computed
with ethers v6 and are documented in each script header.

# SafeStreak — Testnet deploy (BSC testnet, chain 97)

Deployed: 2026-11-20, funded with 0.7 tBNB sent by Dũng to the test deployer wallet.
All roles (owner / publisher / verifier) are the test deployer address for this trial only.
On mainnet, owner must be a Safe 2-of-3 and the three roles must be separate.

## Addresses (BSC testnet)

- Deployer / Owner / Publisher / Verifier (test only): `0xBf8B6D020C7f74F3B4bFeE3cBD84649ee936b9Ab`
- MockAgentID (testnet only): `0x889C550F93a6Ba68371116bfCC7659cDda352B68`
  - Deployer balance: 1, handle: `safestreak.test`
- SafeStreak: `0x6Ff1B1C89559E04D031aEFB5a3855d6284340375`
- Badge: `0xf993c049cE17560EC07AD1fc138C929693065357`
- SNAPSHOT_BLOCK: `143794561`

BscScan testnet:
- https://testnet.bscscan.com/address/0x6Ff1B1C89559E04D031aEFB5a3855d6284340375
- https://testnet.bscscan.com/address/0x889C550F93a6Ba68371116bfCC7659cDda352B68

## First challenge published (test)

- Day: 20778 = 2026-11-21 UTC, question Q01 (correct answer B)
- publishChallenge tx: `0x68898c1d9a1c248666a1f6ba7ef40b7c8ec58b21dcbde42ec630ea9c8f239636`
- Block: 143794672, status: success
- contentHash verified on-chain via getChallenge(20778): matches Q01
- Salt for day 20778 is stored in `hidden_files/testnet-day-20778.json` on Muse only — never commit it to the repo.

## Next test steps

1. 2026-11-21 (day 20778): commit with the deployer wallet using the salt in the hidden file, answer B.
2. 2026-11-22: publisher calls revealAnswer(20778, "B"), then user calls reveal(20778, "B", salt) within 36h.
3. Check profile: joinStreak 1, correctStreak 1, points 1; claim badge branch 0/1 milestone 3 only after 3 days — for a full badge test, use forge tests (already 31 passing).
4. Do NOT use these testnet addresses / MockAgentID on mainnet. Mainnet Agent ID is `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`.

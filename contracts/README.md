# SafeStreak Contracts

Foundry project for SafeStreak — daily quiz streaks for Agent ID holders on
BNB Chain. Solidity 0.8.24, optimizer on (200 runs).

## Contracts

| File | What it is |
|---|---|
| `src/SafeStreak.sol` | Main contract: challenges, commit/reveal, streaks, badges, attestations |
| `src/Badge.sol` | Minimal soulbound ERC-721 badge; only `SafeStreak` can mint, transfers/approvals always revert |

### Key parameters (locked)

- Agent ID contract: `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` (BNB Chain, ERC-721, non-transferable). Only `balanceOf` / `handleOf` are used; `ownerOfHandle` is never called.
- Answer reveal window: **36 hours** from the publisher's answer reveal.
- Verifier EIP-712 signature deadline: **15 minutes** from signing.
- Max **3 attestations / user / day**.
- Badge milestones: **3 / 7 / 14** (join branch and correct-answer branch).
- `SNAPSHOT_BLOCK` = block number at deploy (immutable). Attested approvals must predate it.
- Points = total correct answers (1 correct answer = 1 point).
- Owner is a Safe address passed to the constructor. Only-owner functions are
  `setPublisher`, `setVerifier`, `pausePublishing` — nothing else.
- No payable / receive / fallback (the contract never accepts BNB), no
  transfer functions, no proxy / selfdestruct / delegatecall, no WalletConnect.
- No token is issued by this contract.

### How it works

1. **Publish** — `publisher` calls `publishChallenge(dayId, contentHash, answerCommit)`
   before 00:00 UTC of `dayId`. A day can only be published once.
   `prevPublishedDay[dayId]` records the previous published day, so a skipped
   publisher day does not break streaks.
2. **Commit** — during `dayId`, an Agent ID holder calls
   `commit(dayId, keccak256(abi.encodePacked(dayId, answer, salt, msg.sender)))`.
   One commit per day. The join streak increments when the previous *published*
   day is the user's last join day, otherwise it restarts at 1.
3. **Reveal** — once the day has passed, the publisher calls
   `revealAnswer(dayId, answer)`. The user then calls
   `reveal(dayId, answer, salt)` within 36 hours, in increasing day order.
   A correct answer adds 1 point and extends the correct streak; a wrong
   answer resets the correct streak to 0 and leaves the join streak alone.
   `bestCorrectAt` only moves when the best correct streak increases.
4. **Views** — `currentJoinStreak` / `currentCorrectStreak` return 0 when the
   user's last recorded day is older than the latest published day that has
   ended (stale streak). Also: `profile(user)`, `getChallenge(dayId)`,
   `getEntry(user, dayId)`, `points(user)`, `bestCorrectStreak(user)`.
5. **Badges** — `claimBadge(branch, milestone)` where branch 0 = join,
   1 = correct; milestone 3 / 7 / 14. Based on the *best* streak for that
   branch, so a badge can still be claimed after the streak breaks. One claim
   per (user, branch, milestone). Mints a soulbound `Badge` token.
6. **Attestations** — `attest(user, token, spender, approvalBlock, revokeTxHash, nonce, deadline, signature)`
   proves the user approved `token -> spender` before `SNAPSHOT_BLOCK` and has
   since revoked it. The caller must be `user`; the EIP-712 signature must come
   from `verifier`; `deadline` must be unexpired and within 15 minutes; the
   current on-chain `allowance(user, spender)` must be 0 (checked via staticcall;
   a token without `allowance()` reverts the call). Max 3 per user per day, and
   each (user, token, spender) pair can be attested once.
   EIP-712 domain: name `SafeStreak`, version `1`, chainId, verifying contract.
   Struct: `Attestation(address user,address token,address spender,uint64 approvalBlock,bytes32 revokeTxHash,uint256 nonce,uint64 deadline)`.
7. **Pause** — `pausePublishing()` (owner only, toggles) pauses
   `publishChallenge` / `revealAnswer` only. Users can still commit / reveal
   for already-published days while paused.

### Notes / known limits

- **A1 / never-approved pairs:** a standard ERC-20 returns 0 from
  `allowance()` for both never-approved and revoked pairs, so the contract
  cannot distinguish them on-chain. The **verifier service must reject
  never-approved pairs off-chain** using approval history (`approvalBlock` +
  `revokeTxHash`). The test mock's `allowance()` reverts for never-approved
  pairs to exercise the contract's "allowance call fails → revert" path.
- **A7 / token list:** the contract accepts any token contract. The
  allowed-token list is enforced off-chain by the verifier service (it only
  signs attestations for listed tokens).
- **Out-of-order publishing:** `publishChallenge` assumes days are published
  in increasing order; a same-day catch-up publish scans downward for the
  nearest published day, which costs gas proportional to the gap.
- `pausePublishing` is a toggle (pause / unpause), so a mistaken pause can be
  undone by the owner Safe.

## Test

```shell
forge test
```

31 tests in `test/SafeStreak.t.sol`, covering T1–T12 (streaks, commit/reveal
rules, badges) and A1–A8 (attestations), plus access control, the publishing
pause, the soulbound badge, stale-streak views, and the no-BNB rule.
Mocks (`MockAgentID`, `MockERC20`) live in the test file.

## Deploy (BNB Chain)

Never put a private key in code or in a committed file. The deployer key is
passed to Forge on the command line (hardware wallet / `--account` recommended).

```shell
export AGENT_ID=0x60b9262456de011f7d15a54cdd8c48baaa8b022f
export OWNER=<Safe address>        # contract owner (onlyOwner role)
export PUBLISHER=<publisher address>
export VERIFIER=<verifier address> # EIP-712 attestation signer

forge script script/Deploy.s.sol \
  --rpc-url $BNB_RPC_URL \
  --broadcast
```

Dry-run first without `--broadcast`. The script prints the `SafeStreak`
address, the `Badge` address, and `SNAPSHOT_BLOCK`.

## Verify (BscScan)

```shell
forge verify-contract <SafeStreak address> src/SafeStreak.sol:SafeStreak \
  --chain bnb --etherscan-api-key $BSCSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address)" \
      $AGENT_ID $OWNER $PUBLISHER $VERIFIER)
```

Also verify the `Badge` contract (`src/Badge.sol:Badge`, constructor arg:
the `SafeStreak` address). The deployer wallet must be funded with a small
amount of BNB for gas.

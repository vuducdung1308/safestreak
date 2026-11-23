# SAFESTREAK_SKILL.md — Skill cho AI Agent (1 prompt duy nhất)

> **PROMPT NGẮN — chỉ cần dán câu này vào chat AI, không cần dán cả skill:**
> ```text
> Đọc skill SafeStreak ở https://raw.githubusercontent.com/vuducdung1308/safestreak/main/skill/SAFESTREAK_SKILL.md và làm đúng theo skill đó. Ví Agentic của tôi giữ Agent ID vududu.ai. Chạy briefing hôm nay: Câu hỏi SafeStreak hôm nay là gì?
> ```
> AI sẽ tự tải skill từ link trên rồi chạy theo đúng skill.
>
> Dán toàn bộ prompt trong khung dưới đây vào Binance AI agent chat hoặc
> Claude Code / Codex đã đăng nhập Agentic Wallet (xem
> `../Agentic_Wallet_Connect_Prompt.md` cho phần đăng nhập: skill
> Binance Agentic Wallet + `baw` CLI, QR pairing trong app Binance,
> Developer Mode bật). Prompt này là bản đầy đủ của luồng chơi SafeStreak
> kiểu "game sống trong chat AI" — web chỉ còn là nơi xem bảng xếp hạng
> và hồ sơ, không phải nơi chơi.
>
> Địa chỉ contract mainnet (deploy 20/11/2026): SafeStreak
> `0xA1D5E01B04B6c8d398219bc84F5b2f28e295b28F`, Badge
> `0xF1bC1504Dc3fF3A8039226961B4915890bcDBB4A`. **Chạy thử từ 23/11/2026,
> chơi thật 27/11–06/12/2026**, ngày 20784 (Q01) đến 20793 (Q10).
>
> Giới hạn thật: AI không tự nhắn tin chủ động được trừ khi nền tảng
> host hỗ trợ tin nhắn theo lịch. Luồng dưới đây bắt đầu khi người dùng
> mở chat và hỏi briefing hôm nay — câu lệnh gợi ý: "Câu hỏi SafeStreak
> hôm nay là gì?".

```text
TASK: Be my daily SafeStreak briefing agent in this chat. Every morning,
give me a 1-minute briefing, take my answer, and play SafeStreak on-chain
for me with my Binance Agentic Wallet.

You are helping me play SafeStreak, a daily wallet-security quiz for
Agent ID holders on BNB Smart Chain (chain ID 56). My wallet holds an
Agent ID (.ai name). Only ever act on MY wallet — never look up or act
on anyone else's wallet. The game lives in THIS chat: I answer here, you
do every on-chain call yourself from my wallet. The web app
(https://vuducdung1308.github.io/safestreak/) is only for viewing the
leaderboard and my profile — never send me there to commit, reveal, or
attest with the Agentic Wallet.

TRIGGER: this flow starts when I open the chat and ask for today's
briefing. The trigger phrase is: "Câu hỏi SafeStreak hôm nay là gì?"
(or "câu hỏi SafeStreak hôm nay"). Do not invent a schedule
I did not ask for.

MODE — rehearsal from 23/11/2026, live from 27/11/2026:
- From 23/11 to 26/11 (dayIds 20780–20783) the game is in REHEARSAL
  mode: there is no on-chain challenge yet, so do NOT send any
  commit/reveal transaction. Instead run a practice round: pick a
  practice question from the spare questions in questions.json
  (Q11–Q13, rotate one per day), take my answer, compute the
  commitHash with the exact formula from step 5, SIMULATE
  commit(dayId, commitHash) with eth_call FROM my wallet and show me
  the simulation result, then tell me the real game opens 27/11.
  Steps 1, 3, 4, 7, 8 still run for real every day (identify, scan,
  briefing, cleanup, leaderboard).
- From 27/11 (dayId 20784) the game is LIVE: run every step for real,
  including on-chain commit and reveal.

1. IDENTIFY — confirm who I am before doing anything:
   - Show me my Agentic Wallet address and my Agent ID (.ai name).
   - Verify on-chain: AGENT_ID.balanceOf(my wallet) > 0 (Agent ID
     contract 0x60b9262456de011f7d15a54cdd8c48baaa8b022f) and resolve
     handleOf(my wallet). If balanceOf = 0, STOP and tell me this
     wallet has no Agent ID — SafeStreak is Agent ID-gated and
     commit / reveal / attest all revert with NotAgentId.
   - Check my BNB balance for gas. If it is too low for one commit
     (about 0.001 BNB is ample), tell me before going further.

2. TODAY'S QUESTION — get the challenge for today:
   - Today is dayId = floor(current Unix timestamp / 86400). The run
     is 27/11/2026–06/12/2026, dayIds 20784 (Q01) to 20793 (Q10). If
     today is outside that range, there is no question to play — tell
     me, then still do steps 6–8 for any earlier day that needs a
     reveal, cleanup, or leaderboard check.
   - Fetch the question bank from:
     https://raw.githubusercontent.com/vuducdung1308/safestreak/main/questions/questions.json
     Pick the question for today (Q01 = day 20784, Q02 = 20785, ...
     Q10 = 20793).
   - Verify it against the contract before showing it: call
     getChallenge(dayId) on SafeStreak
     0xA1D5E01B04B6c8d398219bc84F5b2f28e295b28F and confirm the
     contentHash matches the question (hash method in the repo's
     questions/hash.mjs). If it does not match, or the challenge does
     not exist yet, STOP and tell me — do not show an unverified
     question.

3. SCAN — check my wallet's token approvals for the 6 accepted tokens:
   USDT 0x55d398326f99059fF775485246999027B3197955,
   USDC 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d,
   WBNB 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c,
   BTCB 0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c,
   ETH 0x2170Ed0880ac9A755fd29B2688956BD959F933F8,
   CAKE 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82.
   - For each token + spender pair, read the current allowance with
     allowance(owner, spender) and check whether it is unlimited
     (allowance == 2^256 - 1).
   - Check whether the spender contract is source-verified on BscScan
     (getsourcecode). A spender with no code (EOA) counts as NOT
     verified.
   - Find the last use of each approval from the most recent Approval
     event for that (token, spender) pair. An approval unused for more
     than 90 days is STALE. Note the block number of the original
     Approval event with value > 0 — that is the approvalBlock the
     verifier needs later (it must be before the snapshot block
     134663434).
   - Rank the risks and pick the ONE most important: unlimited approval
     to an unverified spender first, then unlimited to a verified
     spender, then limited to an unverified spender, then stale.

4. BRIEFING — deliver the briefing in chat, then take my answer:
   - In my language (Vietnamese by default, English if I ask): today's
     question with its 4 options A/B/C/D, the ONE most important risk
     from step 3 (token, spender, Unlimited or the exact amount,
     verified or not, last use), and what to do about it.
   - Then ask me to pick ONE answer letter. Do NOT pick an answer for
     me. Wait for my reply before committing.

5. COMMIT — lock my answer on-chain for today:
   - First check getEntry(my wallet, dayId): if I already committed
     today, tell me and skip — one commit per day, never two.
   - Generate a fresh random 32-byte salt. Save it in a local file
     named safestreak-salt-<dayId>.json — never share it, never send
     it anywhere, never put it in a public place. Losing the salt
     means that day can never be revealed.
   - Compute commitHash = keccak256(abi.encodePacked(dayId, answer,
     salt, myWalletAddress)) where dayId is uint256, answer is the
     ASCII letter ("A"/"B"/"C"/"D"), salt is bytes32, and the address
     is my wallet address.
   - Show me the exact transaction first (contract, function,
     dayId, commitHash), get my explicit approval, then simulate AND
     send commit(uint256 dayId, bytes32 commitHash) on the SafeStreak
     contract (selector 0xf2f03877) FROM my wallet address.
   - Report to me: the day, my answer (just the letter), and the
     commit transaction hash.

6. REVEAL — the next day, after the publisher reveals the answer:
   - Only reveal if the publisher has revealed it: call
     getChallenge(dayId) and check answerRevealedAt is not 0. If it
     is still 0, wait — do not reveal early.
   - Reveal within 36 hours of the publisher's reveal
     (answerRevealedAt + 36h), or the reveal expires. Reveals must
     happen in increasing day order.
   - Show me the exact transaction first, get my explicit approval,
     then simulate AND send reveal(uint256 dayId, string answer,
     bytes32 salt) (selector 0xae416c4b) FROM my wallet, using the
     SAME answer letter and the SAME salt from the local file as the
     commit.
   - Report to me: the day, whether my answer was correct, my points
     and streaks from profile(my wallet) — points = total correct
     answers (1 correct answer = 1 point) — and the reveal
     transaction hash.
   - If a best streak just reached a badge milestone (3, 7, or 14
     days, on either the join streak or the correct-answer streak)
     and the badge is not claimed yet, offer to call
     claimBadge(uint8 branch, uint256 milestone) (selector
     0xc8b78506; branch 0 = join, 1 = correct) after my approval,
     and report the token ID.

7. CLEANUP — revoke risky approvals and attest them on-chain:
   - For each flagged approval, ASK ME BEFORE revoking it. Only after
     I explicitly say yes for that specific approval, call
     approve(spender, 0) on the token contract from my wallet.
   - After each revoke, attest it on-chain: POST
     https://safestreak-verifier.onrender.com/attest with JSON body
     {"user": "<my wallet address>", "token": "<token>",
     "spender": "<spender>", "approvalBlock": <block number of the
     original Approval event with value > 0>, "revokeTxHash":
     "<revoke tx hash>"}. approvalBlock must be before the snapshot
     block 134663434. The verifier returns an EIP-712 signature
     (valid for 15 minutes — get a fresh one for each retry) plus
     nonce and deadline.
   - Show me the score and the exact transaction first, get my
     explicit approval, then call attest(address user, address token,
     address spender, uint64 approvalBlock, bytes32 revokeTxHash,
     uint256 nonce, uint64 deadline, bytes signature) on the
     SafeStreak contract (selector 0xd8c733ba) FROM my wallet,
     passing exactly the fields returned by the verifier. Max 3
     attestations per day. Report the transaction hash.
   - IMPORTANT: simulate AND send every transaction FROM my wallet
     address (from = my wallet address). commit, reveal and attest
     all require the sender to hold an Agent ID — simulating from
     any other address reverts with NotAgentId.
   - If your simulation reverts, do NOT stop there — check the
     simulation itself first: (a) confirm it really used from = my
     wallet address (some tools silently ignore `from` and simulate
     from their own address, which reverts with NotAgentId); (b) for
     attest, confirm the signature is the FULL 65 bytes exactly as
     the verifier returned it — never truncated or retyped from a
     shortened display; (c) confirm the calldata: commit selector
     0xf2f03877 then dayId, commitHash; reveal selector 0xae416c4b
     then dayId, answer, salt; attest selector 0xd8c733ba then user,
     token, spender, approvalBlock, revokeTxHash, nonce, deadline,
     signature, in that order; (d) confirm on-chain: Agent ID
     balanceOf(my wallet) = 1, and for commit dayId == today and I
     have not committed already; for reveal the publisher has
     revealed the answer and the 36-hour window has not expired; for
     attest nonces(my wallet) equals the signature nonce,
     block.timestamp <= deadline, deadline <= now + 15 minutes,
     approvalBlock < 134663434, and the signature recovers to
     verifier 0x1Fc6e7764059B3206eD9D146d3F923233D6e3Be1. A revert
     WITH a 4-byte error (e.g. 0xdfc3592e NotAgentId, 0x5cd5d233
     BadSignature) is meaningful — decode it and fix the cause. A
     revert with EMPTY data (0x) while all checks above pass is a
     known simulation-tool issue, not proof the contract rejects
     the call: show me the full calldata and the checks, and ask me
     whether to proceed.
   - Do NOT send me to the web app to commit, reveal, or attest with
     the Agentic Wallet: the Binance App's dApp browser only exposes
     the keyless wallet, the Agentic Wallet cannot log in to the web
     app. For the Agentic Wallet, you must complete every on-chain
     call yourself.

8. LEADERBOARD — after the reveal, report where I stand:
   - Call GET https://safestreak-verifier.onrender.com/leaderboard
     and report my rank and the top 3 wallets. If the verifier is
     unreachable, read the leaderboard from the chain instead
     (Committed / Revealed events + profile() per user, ranked by
     points then best correct streak).
   - Optionally call GET
     https://safestreak-verifier.onrender.com/stats for the daily
     totals (unique Agent IDs, Committed / Revealed / Attested
     counts).

SAFETY RULES — never break these:
- Never ask me for a seed phrase, private key, or password. Never ask
  for a pairing code or any login code for my wallet.
- Never send, approve, or sign any transaction without showing me the
  exact details first (contract, function, arguments, and what the
  call does) and getting my explicit approval for that transaction.
- Never create a new approval with a value greater than 0. The only
  approval this skill ever sends is approve(spender, 0) to revoke.
- Never move funds. Never call transfer or transferFrom. Never send
  BNB to any contract. The SafeStreak contract has no payable
  functions.
- If you are unsure about a spender, an answer, or a transaction,
  stop and ask me instead of guessing. Never pick an answer for me.

CONTRACTS (BNB Smart Chain, chain ID 56 — mainnet):
- SafeStreak: 0xA1D5E01B04B6c8d398219bc84F5b2f28e295b28F
- Badge: 0xF1bC1504Dc3fF3A8039226961B4915890bcDBB4A
- Agent ID (ERC-721): 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
- Publisher: 0x74033AA6bc21A137a8545A04170AB977A729Dc49
- Verifier: 0x1Fc6e7764059B3206eD9D146d3F923233D6e3Be1
- Verifier service: https://safestreak-verifier.onrender.com
- Web app (leaderboard / profile only):
  https://vuducdung1308.github.io/safestreak/
- Questions:
  https://raw.githubusercontent.com/vuducdung1308/safestreak/main/questions/questions.json
- Source: the contract source is verified on BscScan (getsourcecode
  returns the full source). Do not conclude it is unverified from a
  Sourcify 404 — Sourcify removed its v1 API.
```

## Ghi chú vận hành

- Chạy skill 1 lần/ngày trong kỳ 27/11–06/12/2026. Mỗi ngày UTC bắt đầu
  00:00 UTC (07:00 giờ Việt Nam). Nếu lỡ 1 ngày thì không commit bù —
  chỉ chơi tiếp ngày hôm sau; commit muộn hơn ngày của thử thách sẽ bị
  contract từ chối (NotToday).
- Reveal phải theo đúng thứ tự ngày tăng dần (OutOfOrderReveal) và trong
  36 giờ kể từ lúc publisher reveal đáp án (RevealWindowExpired).
  Đáp án sai reset chuỗi đáp án đúng về 0, nhưng không động tới chuỗi
  tham gia.
- Salt của mỗi ngày lưu ở file local `safestreak-salt-<dayId>.json` —
  mất salt là ngày đó không reveal được nữa. Không bao giờ đưa salt
  lên chỗ công khai.
- Số liệu cuối kỳ chốt lúc 09/12/2026 08:00 UTC. Top 3 nhận merch
  Binance, không tiền mặt; tie-break theo chuỗi đúng dài nhất rồi tới
  điểm, rồi tới thời điểm trả lời sớm nhất.
- Badge: claim khi best streak (join hoặc correct) đạt mốc 3 / 7 / 14.
  Badge soulbound, không chuyển nhượng.
- Tối đa 3 attestations/ngày. Attest chỉ tính cho approval có
  approvalBlock trước snapshot block 134663434.

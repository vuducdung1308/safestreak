# SafeStreak — Question Bank

13 bilingual (Vietnamese + English) wallet-security questions for the
SafeStreak daily quiz: 10 main questions for 27/11–06/12/2026 (days 1–10)
plus 3 spares (`"day": "spare"`), used only if a main question has to be
replaced.

## Files

| File | Purpose |
| --- | --- |
| `questions.json` | The 13 questions (source of truth). |
| `hash.mjs` | Computes `contentHash` and `answerCommit` for each question. No dependencies — keccak256 is implemented in pure JS inside the script. Run with `node hash.mjs`. |
| `README.md` | This file. |

## Schema (`questions.json`)

Array of 13 objects:

```json
{
  "id": "Q01",
  "day": 1,
  "topic": "unlimited-approval",
  "question": { "vi": "...", "en": "..." },
  "options": {
    "A": { "vi": "...", "en": "..." },
    "B": { "vi": "...", "en": "..." },
    "C": { "vi": "...", "en": "..." },
    "D": { "vi": "...", "en": "..." }
  },
  "correct": "B",
  "explanation": { "vi": "...", "en": "..." }
}
```

- `id`: `Q01`–`Q13`.
- `day`: `1`–`10` for the main questions, `"spare"` for Q11–Q13.
- `topic`: one main topic per question, no repeats.
- `question`: a short realistic scenario (2–4 sentences), Vietnamese + English.
- `options`: four plausible actions (A–D), Vietnamese + English. Exactly one
  is correct.
- `correct`: the letter `A`, `B`, `C` or `D` of the correct option. The
  correct letter varies across questions.
- `explanation`: why the correct answer is correct (2–3 sentences),
  Vietnamese + English.

## Topics in order

| ID | Day | Topic |
| --- | --- | --- |
| Q01 | 1 | unlimited-approval |
| Q02 | 2 | phishing-fake-link |
| Q03 | 3 | blind-signing |
| Q04 | 4 | revoke-correctly |
| Q05 | 5 | seed-phrase-private-key |
| Q06 | 6 | fake-airdrop |
| Q07 | 7 | unverified-spender |
| Q08 | 8 | old-forgotten-approvals |
| Q09 | 9 | mystery-token |
| Q10 | 10 | approval-before-content |
| Q11 | spare | urgent-wallet-locked-message |
| Q12 | spare | device-change-safe-recovery |
| Q13 | spare | excessive-approval-amount |

Content rules: educational wallet-security content only. No merch items, no
app link, no contract addresses. Nothing in the bank promises earnings,
profit or income; "fake airdrop" (Q06) appears only as a scam scenario.

## How `contentHash` is computed

```
contentHash = keccak256(canonical JSON of {id, question, options})
```

- Canonical JSON = `JSON.stringify` of the object with **object keys sorted
  recursively** (see `canonical()` in `hash.mjs`).
- The hash is over the UTF-8 bytes of that string, using keccak256
  (the same hash Solidity's `keccak256` computes).
- `contentHash` covers the question text and all four options, but **not**
  the correct answer or the explanation — so the content can be verified
  on-chain without revealing the answer.

## How `answerCommit` is computed

The contract commitment for a day's answer is:

```
answerCommit = keccak256(abi.encodePacked(dayId, answer, salt, msg.sender))
```

Preimage layout (exact byte order, no separators):

| Field | Encoding |
| --- | --- |
| `dayId` | `uint256` — 32-byte big-endian. The **epoch day** (days since 1970-01-01 UTC) of the publish date: Q01 (27/11/2026) = **20784**, Q02 = 20785, …, Q10 (06/12/2026) = **20793**. For a spare published as a day question, use the epoch day of that publish date; `0` is used only as a placeholder in the sample output. |
| `answer` | The correct-answer letter as a string, e.g. `"B"` — raw ASCII bytes (1 byte). |
| `salt` | `bytes32` — 32 random bytes, generated fresh per day, **kept secret** by the publisher until reveal. |
| `msg.sender` | The publisher's address — 20 bytes. |

`hash.mjs` reproduces exactly this preimage in JS (`encodeUint256` +
raw ASCII + 32-byte salt + 20-byte address) and hashes it with the same
pure-JS keccak256.

## How the publisher generates a salt per day

1. For each day, generate 32 fresh random bytes, e.g.:
   `node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"`
   (or `openssl rand -hex 32` prefixed with `0x`).
2. Never reuse a salt across days, and never share a salt before the
   reveal for that day — anyone who knows `dayId`, the answer letter and
   the salt can recompute the commitment, but without the salt the answer
   cannot be derived from `answerCommit`.
3. **Never commit real salts to the repo.** Keep them in the publisher's
   private store (password manager / secure vault) until reveal.
4. Compute the real `answerCommit` with the real salt and the real
   publisher address, then publish `contentHash` and `answerCommit`
   on-chain for that day.

The `answerCommit` values printed by `node hash.mjs` use a **SAMPLE salt**
(`0x0123…cdef`) and the **placeholder publisher address**
`0x0000000000000000000000000000000000000000`. They are samples only —
do not publish them as real commitments.

## Validation

```bash
node --check hash.mjs
node hash.mjs            # prints the id/day/correct/contentHash/answerCommit table
python3 -m json.tool questions.json > /dev/null   # valid JSON
```

Checks to run on any edit: 13 entries; every entry has all fields;
`correct` is a single letter A–D; options A–D are all present, each with
non-empty `vi` and `en`; correct letters are varied across A–D; topics are
unique; days 1–10 map to Q01–Q10 in topic order and Q11–Q13 are `"spare"`.

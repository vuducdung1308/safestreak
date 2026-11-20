// hash.mjs — SafeStreak question bank hashing (no dependencies).
//
// Computes, for each question in questions.json:
//   contentHash  = keccak256(canonical JSON of {id, question, options})
//   answerCommit = keccak256(abi.encodePacked(dayId, answer, salt, publisher))
//                  where answer is the letter string e.g. "B", salt is a
//                  per-day random bytes32 the publisher keeps secret, and
//                  publisher is the publisher's address (msg.sender).
//   dayId is the EPOCH DAY (days since 1970-01-01 UTC) of the publish date:
//   Q01 (27/11/2026) = 20784 ... Q10 (06/12/2026) = 20793. A spare uses the
//   epoch day of the date it is actually published for (0 is only a
//   placeholder in the sample output below).
//
// keccak256 is implemented here in pure JS (Keccak-f[1600], rate 1088,
// pad10*1) — no npm install needed. A self-test against the known vector
// keccak256("") = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
// runs on every invocation and throws if it fails.
//
// The answerCommit values printed below use a SAMPLE salt and the placeholder
// publisher address 0x0000000000000000000000000000000000000000. They are NOT
// the real on-chain commitments. The publisher must generate a fresh random
// 32-byte salt per day, keep it secret, never commit real salts to the repo,
// and publish the real answerCommit computed with the real salt + real
// publisher address. See README.md.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = join(__dirname, "questions.json");

// Placeholder values — replace at publish time (see README.md).
const SAMPLE_SALT_HEX =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PUBLISHER_PLACEHOLDER = "0x0000000000000000000000000000000000000000";

// ---------------------------------------------------------------------------
// Pure-JS keccak256 (Keccak-f[1600])
// ---------------------------------------------------------------------------

const MASK64 = (1n << 64n) - 1n;

function rotl64(x, n) {
  if (n === 0) return x & MASK64;
  const b = BigInt(n);
  return ((x << b) | (x >> (64n - b))) & MASK64;
}

// Round constants RC[0..23] for Keccak-f[1600].
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets R[x][y].
const R = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function keccakF1600(state) {
  const A = state.slice();
  const B = new Array(25).fill(0n);
  const C = new Array(5).fill(0n);
  const D = new Array(5).fill(0n);

  for (let round = 0; round < 24; round++) {
    // Theta
    for (let x = 0; x < 5; x++) {
      C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        A[x + 5 * y] ^= D[x];
      }
    }
    // Rho + Pi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(A[x + 5 * y], R[x][y]);
      }
    }
    // Chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        A[x + 5 * y] =
          B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & B[((x + 2) % 5) + 5 * y]);
      }
    }
    // Iota
    A[0] ^= RC[round];
  }
  return A;
}

function bytesToHex(bytes) {
  return "0x" + Buffer.from(bytes).toString("hex");
}

function hexToBytes(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  return Uint8Array.from(Buffer.from(h, "hex"));
}

// keccak256(input: Uint8Array | string) -> "0x..." hex string.
export function keccak256(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const RATE = 136; // bytes (1088 bits) for keccak-256
  const state = new Array(25).fill(0n);

  const absorbBlock = (block, len) => {
    for (let i = 0; i < len; i++) {
      const lane = Math.floor(i / 8);
      const shift = BigInt((i % 8) * 8);
      state[lane] ^= BigInt(block[i]) << shift;
    }
  };

  let offset = 0;
  while (offset + RATE <= data.length) {
    absorbBlock(data.subarray(offset, offset + RATE), RATE);
    const next = keccakF1600(state);
    for (let i = 0; i < 25; i++) state[i] = next[i];
    offset += RATE;
  }

  // Final block with pad10*1: append 0x01, pad with 0x00, set last byte |= 0x80.
  const remaining = data.length - offset;
  const block = new Uint8Array(RATE);
  block.set(data.subarray(offset));
  block[remaining] = 0x01;
  block[RATE - 1] |= 0x80;
  absorbBlock(block, RATE);
  const finalState = keccakF1600(state);

  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const lane = Math.floor(i / 8);
    const shift = BigInt((i % 8) * 8);
    out[i] = Number((finalState[lane] >> shift) & 0xffn);
  }
  return bytesToHex(out);
}

// Self-test: known keccak-256 test vector.
const SELF_TEST = keccak256(new Uint8Array(0));
const SELF_TEST_EXPECTED =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
if (SELF_TEST !== SELF_TEST_EXPECTED) {
  throw new Error(
    `keccak256 self-test FAILED: got ${SELF_TEST}, expected ${SELF_TEST_EXPECTED}`
  );
}

// ---------------------------------------------------------------------------
// Canonical JSON: recursively sort object keys, then JSON.stringify.
// This is the exact byte string hashed for contentHash.
// ---------------------------------------------------------------------------

function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
  return out;
}

function contentHashOf(q) {
  const payload = canonical({ id: q.id, question: q.question, options: q.options });
  return keccak256(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// answerCommit = keccak256(abi.encodePacked(dayId, answer, salt, publisher))
//   dayId     : uint256, 32-byte big-endian. The EPOCH DAY of the publish
//               date: Q01 (27/11/2026) = 20784 ... Q10 (06/12/2026) = 20793.
//               0 for spares (placeholder — a spare published as a day
//               question uses the epoch day of that publish date).
//   answer    : the letter string, e.g. "B", as raw ASCII bytes.
//   salt      : bytes32 (32 bytes), fresh random per day, kept secret.
//   publisher : address, 20 bytes (msg.sender at publish time).
// ---------------------------------------------------------------------------

function encodeUint256(n) {
  const out = new Uint8Array(32);
  let v = BigInt(n);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function answerCommitOf({ dayId, answer, saltHex, publisher }) {
  const salt = hexToBytes(saltHex);
  if (salt.length !== 32) throw new Error(`salt must be 32 bytes, got ${salt.length}`);
  const pub = hexToBytes(publisher);
  if (pub.length !== 20) throw new Error(`publisher must be 20 bytes, got ${pub.length}`);
  const preimage = Buffer.concat([
    Buffer.from(encodeUint256(dayId)),
    Buffer.from(answer, "ascii"),
    Buffer.from(salt),
    Buffer.from(pub),
  ]);
  return keccak256(preimage);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const questions = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8"));

console.log("SafeStreak question bank — hashes");
console.log(`keccak256 self-test: OK (${SELF_TEST.slice(0, 18)}...)`);
console.log(
  `contentHash = keccak256(canonical JSON of {id, question, options})`
);
console.log(
  `answerCommit = keccak256(abi.encodePacked(dayId, answer, salt, publisher))`
);
console.log(
  `SAMPLE salt: ${SAMPLE_SALT_HEX} — publisher MUST generate a fresh random salt per day and keep it secret; never commit real salts.`
);
console.log(
  `Publisher placeholder: ${PUBLISHER_PLACEHOLDER} — replace with the real publisher address at publish time.`
);
console.log("");

// Epoch day of the first run day, 27/11/2026 (Q01). Q01 -> 20784, ...,
// Q10 (06/12/2026) -> 20793. Spares keep dayId 0 in the sample output.
const FIRST_DAY_EPOCH = 20784

const rows = questions.map((q) => {
  const dayId = q.day === "spare" ? 0 : FIRST_DAY_EPOCH + (q.day - 1);
  return {
    id: q.id,
    day: q.day,
    dayId,
    correct: q.correct,
    contentHash: contentHashOf(q),
    answerCommitSample: answerCommitOf({
      dayId,
      answer: q.correct,
      saltHex: SAMPLE_SALT_HEX,
      publisher: PUBLISHER_PLACEHOLDER,
    }),
  };
});

const header = ["id", "day", "dayId", "correct", "contentHash", "answerCommit (SAMPLE)"];
const widths = header.map((h, i) =>
  Math.max(h.length, ...rows.map((r) => String(Object.values(r)[i]).length))
);
const line = (cells) =>
  cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
console.log(line(header));
console.log(line(header.map((_, i) => "-".repeat(widths[i]))));
for (const r of rows) console.log(line(Object.values(r)));
console.log("");
console.log(
  `Total: ${rows.length} questions. answerCommit values above are SAMPLES only (sample salt + placeholder publisher).`
);

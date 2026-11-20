// finalLeaderboard.mjs — reproducible final leaderboard for SafeStreak.
//
// Reads Revealed / StreakUpdated events from the SafeStreak contract via a
// plain JSON-RPC endpoint (no dependencies, plain fetch). Filters reveals
// with block timestamp <= 2026-12-09T08:00:00Z (final snapshot), ranks by:
//   1. bestCorrectStreak desc
//   2. totalCorrect desc
//   3. earliest time bestCorrectStreak was achieved
//   4. tx index, then log index (of the StreakUpdated event that achieved
//      the best)
// Outputs Top 3 + the full table as JSON.
//
// Real contract events (SafeStreak.sol):
//   Revealed(address indexed user, uint256 indexed dayId, bool correct)
//   StreakUpdated(address indexed user, uint8 indexed branch,
//                 uint256 newStreak, uint256 bestStreak) — branch 1 = correct
// Per-user points / bestCorrectStreak are cross-checked with profile().
// Handles (.ai names) come from the Agent ID contract's handleOf, never
// from SafeStreak (it has no handleOf).
//
// Reproducibility: the same result can be rebuilt from BscScan by exporting
// the contract's Revealed / StreakUpdated events up to the snapshot block
// and applying the same ranking. Never publishes balances — only handle
// (.ai name if available via handleOf, else address), bestCorrectStreak,
// totalCorrect, bestAchievedAt.
//
// Env (required):
//   RPC_URL             BNB Chain JSON-RPC endpoint
//   SAFESTREAK_ADDRESS  deployed SafeStreak contract address
// Optional:
//   FROM_BLOCK          first block to scan (default 0)
//   SNAPSHOT_BLOCK      snapshot block number (default: found by binary
//                       search on block timestamps for 2026-12-09T08:00:00Z)
//   OUT                 output file path (default: stdout only)
//   AGENT_ID_ADDRESS    Agent ID contract for handleOf lookups
//                       (default 0x60b9262456de011f7d15a54cdd8c48baaa8b022f)
//
// Usage: node finalLeaderboard.mjs [--help] [--out leaderboard.json]

const SNAPSHOT_ISO = '2026-12-09T08:00:00Z'
const SNAPSHOT_TS = Math.floor(Date.parse(SNAPSHOT_ISO) / 1000)

// Event topic0 hashes (keccak256 of the canonical signature, from
// contracts/src/SafeStreak.sol).
const REVEALED_TOPIC = '0xe8e22f679dd243a416db2cf49a8950730eacf44be7f66a037d97adc3229e8b86'
const STREAK_UPDATED_TOPIC = '0x86ef2f697fe62b941a7418703babd606f40107fda69e5dad80ee01f8b07e6169'
const HANDLEOF_SELECTOR = '0xc50a1514' // handleOf(address) on the Agent ID contract
const PROFILE_SELECTOR = '0x9dd9d0fd' // profile(address) on SafeStreak

function usage() {
  console.log(`Usage: node finalLeaderboard.mjs [--help] [--out <file>]

Env (required): RPC_URL, SAFESTREAK_ADDRESS
Env (optional): FROM_BLOCK (default 0), SNAPSHOT_BLOCK, OUT
Snapshot: ${SNAPSHOT_ISO} — reveals after this time are excluded.`)
}

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  usage()
  process.exit(0)
}
const outIdx = args.indexOf('--out')
const outFile = outIdx >= 0 ? args[outIdx + 1] : process.env.OUT || null
if (outIdx >= 0 && !outFile) {
  console.error('Error: --out requires a file path.')
  process.exit(1)
}

const RPC_URL = process.env.RPC_URL
const ADDRESS = process.env.SAFESTREAK_ADDRESS
const AGENT_ID = process.env.AGENT_ID_ADDRESS || '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
if (!RPC_URL) {
  console.error('Error: RPC_URL env var is missing.')
  process.exit(1)
}
if (!ADDRESS) {
  console.error('Error: SAFESTREAK_ADDRESS env var is missing — the SafeStreak contract is not deployed yet.')
  process.exit(1)
}
const FROM_BLOCK = Number(process.env.FROM_BLOCK || 0)

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(`RPC ${method} failed: ${json.error.message}`)
  return json.result
}

const hexToInt = (h) => Number.parseInt(h, 16)
const toHex = (n) => '0x' + n.toString(16)

async function blockTimestamp(blockNumber) {
  const block = await rpc('eth_getBlockByNumber', [toHex(blockNumber), false])
  return block ? hexToInt(block.timestamp) : null
}

// Binary search: last block with timestamp <= SNAPSHOT_TS.
async function findSnapshotBlock() {
  if (process.env.SNAPSHOT_BLOCK) return Number(process.env.SNAPSHOT_BLOCK)
  const latest = hexToInt(await rpc('eth_blockNumber', []))
  let lo = FROM_BLOCK
  let hi = latest
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    const ts = await blockTimestamp(mid)
    if (ts !== null && ts <= SNAPSHOT_TS) lo = mid
    else hi = mid - 1
  }
  return lo
}

async function getLogs(fromBlock, toBlock) {
  const logs = []
  // Public BSC RPCs reject wide eth_getLogs ranges ("limit exceeded"), so
  // scan in small chunks.
  const CHUNK = 1000
  for (let from = fromBlock; from <= toBlock; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, toBlock)
    const chunk = await rpc('eth_getLogs', [{
      address: ADDRESS,
      fromBlock: toHex(from),
      toBlock: toHex(to),
      topics: [[REVEALED_TOPIC, STREAK_UPDATED_TOPIC]],
    }])
    logs.push(...chunk)
  }
  return logs
}

// Revealed(address indexed user, uint256 indexed dayId, bool correct):
// topics[1] = user, topics[2] = dayId, data word 0 = correct (bool).
function decodeRevealed(log) {
  const user = '0x' + log.topics[1].slice(26)
  const data = log.data.slice(2)
  const word = (i) => BigInt('0x' + data.slice(i * 64, (i + 1) * 64))
  return {
    user: user.toLowerCase(),
    dayId: hexToInt(log.topics[2]),
    correct: word(0) !== 0n,
    blockNumber: hexToInt(log.blockNumber),
    txIndex: hexToInt(log.transactionIndex),
    logIndex: hexToInt(log.logIndex),
  }
}

// StreakUpdated(address indexed user, uint8 indexed branch,
//               uint256 newStreak, uint256 bestStreak):
// topics[1] = user, topics[2] = branch, data word 0 = newStreak,
// data word 1 = bestStreak.
function decodeStreakUpdated(log) {
  const user = '0x' + log.topics[1].slice(26)
  const data = log.data.slice(2)
  const word = (i) => BigInt('0x' + data.slice(i * 64, (i + 1) * 64))
  return {
    user: user.toLowerCase(),
    branch: hexToInt(log.topics[2]),
    newStreak: Number(word(0)),
    bestStreak: Number(word(1)),
    blockNumber: hexToInt(log.blockNumber),
    txIndex: hexToInt(log.transactionIndex),
    logIndex: hexToInt(log.logIndex),
  }
}

// profile(address) on SafeStreak returns 9 uint256 words, in order:
// points, joinStreak, bestJoinStreak, lastJoinDay, correctStreak,
// bestCorrectStreak, bestCorrectAt, lastCorrectDay, lastRevealDay.
async function profileOf(user) {
  try {
    const data = PROFILE_SELECTOR + user.slice(2).padStart(64, '0')
    const raw = await rpc('eth_call', [{ to: ADDRESS, data }, 'latest'])
    if (!raw || raw === '0x') return null
    const body = raw.slice(2)
    const word = (i) => Number(BigInt('0x' + body.slice(i * 64, (i + 1) * 64)))
    return { points: word(0), bestCorrectStreak: word(5) }
  } catch {
    return null
  }
}

// handleOf on the AGENT ID contract (not SafeStreak).
async function handleOf(user) {
  try {
    const data = HANDLEOF_SELECTOR + user.slice(2).padStart(64, '0')
    const raw = await rpc('eth_call', [{ to: AGENT_ID, data }, 'latest'])
    if (!raw || raw === '0x') return null
    const body = raw.slice(2)
    const offset = Number.parseInt(body.slice(0, 64), 16) * 2
    const len = Number.parseInt(body.slice(offset, offset + 64), 16)
    const str = Buffer.from(body.slice(offset + 64, offset + 64 + len * 2), 'hex').toString('utf8')
    return str || null
  } catch {
    return null
  }
}

const snapshotBlock = await findSnapshotBlock()
const snapshotTs = await blockTimestamp(snapshotBlock)
if (snapshotTs === null || snapshotTs > SNAPSHOT_TS) {
  console.error(`Error: could not find a block at or before ${SNAPSHOT_ISO}.`)
  process.exit(1)
}

const logs = await getLogs(FROM_BLOCK, snapshotBlock)
// Cache block timestamps (one RPC call per distinct block).
const tsCache = new Map()
async function tsOf(blockNumber) {
  if (!tsCache.has(blockNumber)) tsCache.set(blockNumber, await blockTimestamp(blockNumber))
  return tsCache.get(blockNumber)
}

const byUser = new Map()
function userRow(user) {
  let u = byUser.get(user)
  if (!u) {
    u = { address: user, bestCorrectStreak: 0, totalCorrect: 0, bestAchievedAt: null, bestTxIndex: 0, bestLogIndex: 0, bestEvents: [] }
    byUser.set(user, u)
  }
  return u
}
for (const log of logs) {
  const ts = await tsOf(hexToInt(log.blockNumber))
  if (ts === null || ts > SNAPSHOT_TS) continue
  if (log.topics[0].toLowerCase() === REVEALED_TOPIC) {
    const r = decodeRevealed(log)
    if (!r.correct) continue
    userRow(r.user).totalCorrect += 1
  } else if (log.topics[0].toLowerCase() === STREAK_UPDATED_TOPIC) {
    const s = decodeStreakUpdated(log)
    if (s.branch !== 1) continue // branch 1 = correct-answer streak
    const u = userRow(s.user)
    u.bestEvents.push({ best: s.bestStreak, ts, txIndex: s.txIndex, logIndex: s.logIndex })
    if (s.bestStreak > u.bestCorrectStreak) u.bestCorrectStreak = s.bestStreak
  }
}
// Earliest time the final best streak was achieved (from StreakUpdated
// branch-1 events), then cross-check points/best against profile().
for (const u of byUser.values()) {
  const hits = u.bestEvents.filter((e) => e.best === u.bestCorrectStreak).sort((a, b) => a.ts - b.ts || a.txIndex - b.txIndex || a.logIndex - b.logIndex)
  if (hits.length) {
    u.bestAchievedAt = new Date(hits[0].ts * 1000).toISOString()
    u.bestTxIndex = hits[0].txIndex
    u.bestLogIndex = hits[0].logIndex
  }
  delete u.bestEvents
  const p = await profileOf(u.address)
  if (p) {
    u.totalCorrect = p.points // points = total correct answers
    u.bestCorrectStreak = p.bestCorrectStreak
  }
}

const table = [...byUser.values()]
  .sort((a, b) =>
    b.bestCorrectStreak - a.bestCorrectStreak ||
    b.totalCorrect - a.totalCorrect ||
    (a.bestAchievedAt < b.bestAchievedAt ? -1 : a.bestAchievedAt > b.bestAchievedAt ? 1 : 0) ||
    a.bestTxIndex - b.bestTxIndex ||
    a.bestLogIndex - b.bestLogIndex)
  .map((u, i) => ({ ...u }))

for (const row of table) {
  row.handle = (await handleOf(row.address)) || row.address
  delete row.bestTxIndex
  delete row.bestLogIndex
}
const ranked = table.map((r, i) => ({
  rank: i + 1,
  handle: r.handle,
  address: r.address,
  bestCorrectStreak: r.bestCorrectStreak,
  totalCorrect: r.totalCorrect,
  bestAchievedAt: r.bestAchievedAt,
}))

const result = {
  snapshot: SNAPSHOT_ISO,
  snapshotBlock,
  generatedAt: new Date().toISOString(),
  contract: ADDRESS,
  top3: ranked.slice(0, 3),
  table: ranked,
}

const json = JSON.stringify(result, null, 2)
if (outFile) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(outFile, json + '\n')
  console.log(`Wrote ${ranked.length} ranked users (Top 3 included) to ${outFile}`)
} else {
  console.log(json)
}

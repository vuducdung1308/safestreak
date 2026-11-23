// SafeStreak verifier service (Node.js, ethers v6).
// POST /attest — verifies a revoked approval and signs an EIP-712 attestation.
// GET  /health — liveness check.
//
// Security:
// - Private key ONLY from env VERIFIER_PRIVATE_KEY. Never in code, never logged.
// - Accepted token addresses ONLY from env ACCEPTED_TOKENS (JSON map
//   symbol -> address). Never hardcode mainnet addresses you are unsure of.
// - Signature deadline is now + 15 minutes. Attestation is only valid for a
//   revocation that happened before the snapshot block.
// - This service never sends transactions and never holds user funds.
'use strict'

const express = require('express')
const { ethers } = require('ethers')

const PORT = Number(process.env.PORT || 3000)
const RPC_URL = process.env.RPC_URL || ''
const SAFESTREAK_ADDRESS = process.env.SAFESTREAK_ADDRESS || ''
const SNAPSHOT_BLOCK = process.env.SNAPSHOT_BLOCK ? Number(process.env.SNAPSHOT_BLOCK) : null
const VERIFIER_PRIVATE_KEY = process.env.VERIFIER_PRIVATE_KEY || ''

let ACCEPTED_TOKENS = {}
try {
  ACCEPTED_TOKENS = JSON.parse(process.env.ACCEPTED_TOKENS || '{}')
} catch {
  ACCEPTED_TOKENS = {}
}
// Normalise to lowercase addresses for comparison.
const ACCEPTED_BY_ADDRESS = new Map(
  Object.values(ACCEPTED_TOKENS).map((a) => [String(a).toLowerCase(), true]),
)

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
]
const SAFESTREAK_ABI = ['function nonces(address user) view returns (uint256)']

// EIP-712 domain/types. chainId is read from the RPC at startup when possible;
// 56 is BNB Chain mainnet. The contract must use the same domain or the
// signature will not verify on-chain — confirm against the deployed contract.
const DOMAIN_NAME = 'SafeStreak'
const DOMAIN_VERSION = '1'
const TYPES = {
  Attestation: [
    { name: 'user', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'approvalBlock', type: 'uint64' },
    { name: 'revokeTxHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
}

const app = express()
app.use(express.json({ limit: '64kb' }))

// --- CORS: frontend chạy trên GitHub Pages (origin khác) gọi POST /attest
// từ trình duyệt, nên mọi response phải có Access-Control-Allow-Origin.
// Không có header này, trình duyệt chặn response dù server trả 200 (lỗi đã
// gặp ở verifier AgentAllowance 21/11). API chỉ xác thực và ký, không dùng
// cookie hay credential, nên "*" là đủ và an toàn.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

let provider = null
let signer = null
let chainId = 56

async function init() {
  if (RPC_URL) {
    provider = new ethers.JsonRpcProvider(RPC_URL)
    try {
      const net = await provider.getNetwork()
      chainId = Number(net.chainId)
    } catch {
      // Keep default chainId 56; RPC errors surface per-request.
    }
  }
  if (VERIFIER_PRIVATE_KEY) {
    const wallet = new ethers.Wallet(VERIFIER_PRIVATE_KEY)
    signer = provider ? wallet.connect(provider) : wallet
  }
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    chainId,
    safestreakAddress: SAFESTREAK_ADDRESS || null,
    snapshotBlock: SNAPSHOT_BLOCK,
    acceptedTokens: Object.keys(ACCEPTED_TOKENS),
    signerReady: Boolean(signer),
    rpcReady: Boolean(provider),
  })
})

app.post('/attest', async (req, res) => {
  try {
    const { user, token, spender, approvalBlock, revokeTxHash, nonce: nonceIn } = req.body || {}

    if (!signer) return res.status(500).json({ error: 'verifier signer not configured' })
    if (!provider) return res.status(500).json({ error: 'RPC_URL not configured' })
    if (!user || !ethers.isAddress(user)) return res.status(400).json({ error: 'invalid user address' })
    if (!token || !ethers.isAddress(token)) return res.status(400).json({ error: 'invalid token address' })
    if (!spender || !ethers.isAddress(spender)) return res.status(400).json({ error: 'invalid spender address' })
    if (!Number.isInteger(approvalBlock) || approvalBlock < 0) {
      return res.status(400).json({ error: 'invalid approvalBlock' })
    }
    if (!revokeTxHash || !ethers.isHexString(revokeTxHash, 32)) {
      return res.status(400).json({ error: 'invalid revokeTxHash (must be a 32-byte hash)' })
    }

    // 1. Token must be in the accepted list.
    if (!ACCEPTED_BY_ADDRESS.has(token.toLowerCase())) {
      return res.status(400).json({ error: 'token not in accepted list' })
    }

    // 2. approvalBlock must be before the snapshot block.
    if (SNAPSHOT_BLOCK === null) {
      return res.status(500).json({ error: 'SNAPSHOT_BLOCK not configured' })
    }
    if (approvalBlock >= SNAPSHOT_BLOCK) {
      return res.status(400).json({ error: 'approvalBlock must be before SNAPSHOT_BLOCK' })
    }

    // 3. Verify an Approval event with value > 0 exists for
    //    (user, token, spender) at approvalBlock.
    const tokenContract = new ethers.Contract(token, ERC20_ABI, provider)
    const approvalFilter = tokenContract.filters.Approval(user, spender)
    const logs = await tokenContract.queryFilter(approvalFilter, approvalBlock, approvalBlock)
    const hasPositiveApproval = logs.some((log) => BigInt(log.args.value) > 0n)
    if (!hasPositiveApproval) {
      return res.status(400).json({ error: 'no Approval event with value > 0 at approvalBlock' })
    }

    // 4. Current allowance(user, spender) must be 0 (revoked).
    const allowance = await tokenContract.allowance(user, spender)
    if (allowance !== 0n) {
      return res.status(400).json({ error: 'current allowance is not 0 — revoke first' })
    }

    // 5. Nonce: read nonces(user) from the SafeStreak contract when its
    //    address is set (the contract's mapping is `nonces`, not
    //    `attestNonce`); otherwise accept the nonce supplied in the request
    //    (documented fallback for pre-deployment use only).
    let nonce
    if (SAFESTREAK_ADDRESS) {
      const safestreak = new ethers.Contract(SAFESTREAK_ADDRESS, SAFESTREAK_ABI, provider)
      nonce = Number(await safestreak.nonces(user))
    } else if (Number.isInteger(nonceIn) && nonceIn >= 0) {
      nonce = nonceIn
    } else {
      return res.status(400).json({ error: 'nonce required when SAFESTREAK_ADDRESS is not set' })
    }

    // 6. Sign EIP-712 Attestation, deadline = now + 15 minutes.
    const deadline = Math.floor(Date.now() / 1000) + 15 * 60
    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId,
      verifyingContract: SAFESTREAK_ADDRESS || ethers.ZeroAddress,
    }
    const value = { user, token, spender, approvalBlock, revokeTxHash, nonce, deadline }
    const signature = await signer.signTypedData(domain, TYPES, value)

    return res.json({ signature, nonce, deadline })
  } catch (err) {
    // Never log the private key or the full request body.
    console.error('attest error:', err && err.message ? err.message : 'unknown error')
    return res.status(500).json({ error: 'internal error' })
  }
})

// --- GET /leaderboard + GET /stats ---
// The frontend CANNOT read logs itself: public BSC RPCs reject (or
// rate-limit) wide eth_getLogs ranges, so the leaderboard/stats pages showed
// a raw rate-limit error (23/11 screenshot). This verifier has a log-capable
// RPC, so it serves the data instead — same pattern as the AgentAllowance
// verifier. 120s in-memory cache: a full log scan costs dozens of RPC calls.
// All log queries start at the deploy block — never block 0.
const DEPLOY_BLOCK = 134663434
const AGENT_ID_ADDRESS = process.env.AGENT_ID_ADDRESS || '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const SAFESTREAK_READ_ABI = [
  'event ChallengePublished(uint256 indexed dayId, bytes32 contentHash, bytes32 answerCommit)',
  'event AnswerRevealed(uint256 indexed dayId, string answer)',
  'event Committed(address indexed user, uint256 indexed dayId)',
  'event Revealed(address indexed user, uint256 indexed dayId, bool correct)',
  'event StreakUpdated(address indexed user, uint8 indexed branch, uint256 newStreak, uint256 bestStreak)',
  'event Attested(address indexed user, address indexed token, address indexed spender, uint64 approvalBlock, bytes32 revokeTxHash, address verifier)',
  'function profile(address user) view returns (uint256 points, uint256 joinStreak, uint256 bestJoinStreak, uint256 lastJoinDay, uint256 correctStreak, uint256 bestCorrectStreak, uint256 bestCorrectAt, uint256 lastCorrectDay, uint256 lastRevealDay)',
]
const AGENT_ID_MIN_ABI = ['function handleOf(address account) view returns (string)']

const LOG_CHUNK = 2000
const LOG_CONCURRENCY = 10
const CACHE_TTL_MS = 120_000
let leaderboardCache = { at: 0, data: null }
let statsCache = { at: 0, data: null }
const roundCache = new Map() // dayId -> { at, data }

function shortAddress(addr) {
  const a = String(addr || '')
  return a.length > 10 ? a.slice(0, 6) + '...' + a.slice(-4) : a
}

// Chunked event scan from the deploy block to latest, in parallel batches.
// A single getLogs over the whole range exceeds the RPC log limit.
async function getEventLogs(contract, filter) {
  const latest = await provider.getBlockNumber()
  const ranges = []
  for (let to = latest; to >= DEPLOY_BLOCK; to -= LOG_CHUNK) {
    ranges.push({ fromBlock: Math.max(to - LOG_CHUNK + 1, DEPLOY_BLOCK), toBlock: to })
  }
  const out = []
  for (let i = 0; i < ranges.length; i += LOG_CONCURRENCY) {
    const batch = ranges.slice(i, i + LOG_CONCURRENCY)
    const results = await Promise.all(
      batch.map((r) => contract.queryFilter(filter, r.fromBlock, r.toBlock)),
    )
    for (const chunk of results) out.push(...chunk)
  }
  return out
}

async function blockTimestamps(blockNumbers) {
  const map = new Map()
  const uniq = [...new Set(blockNumbers.map(Number))]
  for (let i = 0; i < uniq.length; i += LOG_CONCURRENCY) {
    const batch = uniq.slice(i, i + LOG_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (n) => {
        try {
          const b = await provider.getBlock(n)
          return [n, b ? Number(b.timestamp) : null]
        } catch {
          return [n, null]
        }
      }),
    )
    for (const [n, ts] of results) if (ts) map.set(n, ts)
  }
  return map
}

async function computeLeaderboard() {
  const now = Date.now()
  if (leaderboardCache.data && now - leaderboardCache.at < CACHE_TTL_MS) {
    return leaderboardCache.data
  }
  if (!provider || !SAFESTREAK_ADDRESS) {
    throw new Error('verifier not configured: RPC_URL / SAFESTREAK_ADDRESS')
  }
  const contract = new ethers.Contract(SAFESTREAK_ADDRESS, SAFESTREAK_READ_ABI, provider)
  const [revealed, streaks] = await Promise.all([
    getEventLogs(contract, contract.filters.Revealed()),
    getEventLogs(contract, contract.filters.StreakUpdated()),
  ])
  const users = [...new Set([...revealed, ...streaks].map((e) => e.args.user))]
  const rows = []
  for (const user of users) {
    const p = await contract.profile(user)
    const totalCorrect = revealed.filter(
      (e) => e.args.user.toLowerCase() === user.toLowerCase() && e.args.correct,
    ).length
    rows.push({
      address: user,
      points: Number(p[0]),
      totalCorrect,
      best: Number(p[5]),
    })
  }
  rows.sort((a, b) => b.points - a.points || b.best - a.best)
  // .ai names from the Agent ID contract; fall back to the short address.
  const agentId = new ethers.Contract(AGENT_ID_ADDRESS, AGENT_ID_MIN_ABI, provider)
  for (const r of rows) {
    try {
      r.handle = (await agentId.handleOf(r.address)) || shortAddress(r.address)
    } catch {
      r.handle = shortAddress(r.address)
    }
  }
  const data = { totalAgents: rows.length, rows, updatedAt: Math.floor(now / 1000) }
  leaderboardCache = { at: now, data }
  return data
}

async function computeStats() {
  const now = Date.now()
  if (statsCache.data && now - statsCache.at < CACHE_TTL_MS) return statsCache.data
  if (!provider || !SAFESTREAK_ADDRESS) {
    throw new Error('verifier not configured: RPC_URL / SAFESTREAK_ADDRESS')
  }
  const contract = new ethers.Contract(SAFESTREAK_ADDRESS, SAFESTREAK_READ_ABI, provider)
  const [committed, revealed, attested] = await Promise.all([
    getEventLogs(contract, contract.filters.Committed()),
    getEventLogs(contract, contract.filters.Revealed()),
    getEventLogs(contract, contract.filters.Attested()),
  ])
  const users = new Set([...revealed, ...committed].map((e) => e.args.user.toLowerCase()))
  const tsMap = await blockTimestamps(
    [...committed, ...revealed, ...attested].map((e) => e.blockNumber),
  )
  const byDay = {}
  for (const e of [...committed, ...revealed, ...attested]) {
    const ts = tsMap.get(e.blockNumber)
    const day = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : `block-${e.blockNumber}`
    byDay[day] = (byDay[day] || 0) + 1
  }
  const data = {
    uniqueAgentIds: users.size,
    byType: { Committed: committed.length, Revealed: revealed.length, Attested: attested.length },
    byDay,
    updatedAt: Math.floor(now / 1000),
  }
  statsCache = { at: now, data }
  return data
}

// --- GET /round?day=<dayId> ---
// One round's scoreboard data for the single-page site: whether the challenge
// was published, the revealed answer (only after the on-chain AnswerRevealed
// event exists — never before), and every participant's result (committed?
// revealed? correct?). Same 120s cache and chunked-scan pattern as
// /leaderboard; all log queries start at the deploy block.
async function computeRound(dayId) {
  const now = Date.now()
  const cached = roundCache.get(dayId)
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data
  if (!provider || !SAFESTREAK_ADDRESS) {
    throw new Error('verifier not configured: RPC_URL / SAFESTREAK_ADDRESS')
  }
  const contract = new ethers.Contract(SAFESTREAK_ADDRESS, SAFESTREAK_READ_ABI, provider)
  const [published, revealedAnswer, committed, revealed] = await Promise.all([
    getEventLogs(contract, contract.filters.ChallengePublished(dayId)),
    getEventLogs(contract, contract.filters.AnswerRevealed(dayId)),
    getEventLogs(contract, contract.filters.Committed(null, dayId)),
    getEventLogs(contract, contract.filters.Revealed(null, dayId)),
  ])
  const byUser = new Map()
  for (const e of committed) {
    const addr = e.args.user
    const key = addr.toLowerCase()
    if (!byUser.has(key)) {
      byUser.set(key, {
        address: addr,
        committed: true,
        committedBlock: e.blockNumber,
        revealed: false,
        correct: null,
      })
    }
  }
  for (const e of revealed) {
    const key = e.args.user.toLowerCase()
    const row = byUser.get(key) || {
      address: e.args.user,
      committed: false,
      committedBlock: null,
      revealed: false,
      correct: null,
    }
    row.revealed = true
    row.correct = Boolean(e.args.correct)
    byUser.set(key, row)
  }
  const results = [...byUser.values()].sort(
    (a, b) => (a.committedBlock || Infinity) - (b.committedBlock || Infinity),
  )
  // .ai names from the Agent ID contract; fall back to the short address.
  const agentId = new ethers.Contract(AGENT_ID_ADDRESS, AGENT_ID_MIN_ABI, provider)
  for (const r of results) {
    try {
      r.handle = (await agentId.handleOf(r.address)) || shortAddress(r.address)
    } catch {
      r.handle = shortAddress(r.address)
    }
  }
  const data = {
    dayId,
    exists: published.length > 0,
    contentHash: published.length > 0 ? published[0].args.contentHash : null,
    answer: revealedAnswer.length > 0 ? revealedAnswer[0].args.answer : null,
    results,
    updatedAt: Math.floor(now / 1000),
  }
  roundCache.set(dayId, { at: now, data })
  return data
}

app.get('/leaderboard', async (req, res) => {
  try {
    return res.json(await computeLeaderboard())
  } catch (err) {
    console.error('GET /leaderboard error:', err && err.message ? err.message : 'unknown error')
    return res.status(500).json({ error: 'could not load leaderboard' })
  }
})

app.get('/stats', async (req, res) => {
  try {
    return res.json(await computeStats())
  } catch (err) {
    console.error('GET /stats error:', err && err.message ? err.message : 'unknown error')
    return res.status(500).json({ error: 'could not load stats' })
  }
})

app.get('/round', async (req, res) => {
  try {
    const day = Number(req.query.day)
    if (!Number.isInteger(day) || day <= 0) {
      return res.status(400).json({ error: 'invalid day (expected a UTC epoch day, e.g. 20784)' })
    }
    return res.json(await computeRound(day))
  } catch (err) {
    console.error('GET /round error:', err && err.message ? err.message : 'unknown error')
    return res.status(500).json({ error: 'could not load round' })
  }
})

init()
  .then(() => {
    app.listen(PORT, () => console.log(`SafeStreak verifier listening on ${PORT}`))
  })
  .catch((err) => {
    console.error('verifier init failed:', err && err.message ? err.message : 'unknown error')
    process.exit(1)
  })

// countAgentIds.mjs — KPI count of unique Agent ID holders in SafeStreak.
//
// Counts unique msg.sender addresses with Agent ID balance > 0 in SafeStreak
// events within 2026-11-18T08:00:00Z to 2026-12-09T08:00:00Z (KPI >= 30).
// Plain JSON-RPC via fetch, no dependencies.
//
// Note on "msg.sender": the SafeStreak events (Committed / Revealed /
// StreakUpdated / Attested) carry the acting user as their indexed `user`
// address, which equals msg.sender for those calls. This script counts
// distinct `user` values from those events, then keeps only addresses whose
// Agent ID balanceOf > 0 at the end of the window.
//
// Env (required):
//   RPC_URL             BNB Chain JSON-RPC endpoint
//   SAFESTREAK_ADDRESS  deployed SafeStreak contract address
// Optional:
//   AGENT_ID_ADDRESS    default 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
//   FROM_BLOCK          first block to scan (default 0)
//   OUT                 output file path (default: stdout only)
//
// Usage: node countAgentIds.mjs [--help] [--out count.json]

const WINDOW_START_ISO = '2026-11-18T08:00:00Z'
const WINDOW_END_ISO = '2026-12-09T08:00:00Z'
const WINDOW_START_TS = Math.floor(Date.parse(WINDOW_START_ISO) / 1000)
const WINDOW_END_TS = Math.floor(Date.parse(WINDOW_END_ISO) / 1000)
const KPI_TARGET = 30

// Event topic0 hashes (keccak256 of the canonical signature, from
// contracts/src/SafeStreak.sol):
//   Committed(address,uint256)
//   Revealed(address,uint256,bool)
//   StreakUpdated(address,uint8,uint256,uint256)
//   Attested(address,address,address,uint64,bytes32,address)
const TOPICS = {
  Committed: '0x1c183a94c6996bd61f66487b3846e20a0ebf31594a08e28ed2f6c9ff8e98338c',
  Revealed: '0xe8e22f679dd243a416db2cf49a8950730eacf44be7f66a037d97adc3229e8b86',
  StreakUpdated: '0x86ef2f697fe62b941a7418703babd606f40107fda69e5dad80ee01f8b07e6169',
  Attested: '0xa501ce4d4ed9d28da4e18269f2e024316a60d1f41bc78be38513a3866307a325',
}
const BALANCEOF_SELECTOR = '0x70a08231' // balanceOf(address)

function usage() {
  console.log(`Usage: node countAgentIds.mjs [--help] [--out <file>]

Env (required): RPC_URL, SAFESTREAK_ADDRESS
Env (optional): AGENT_ID_ADDRESS, FROM_BLOCK, OUT
Window: ${WINDOW_START_ISO} to ${WINDOW_END_ISO} (KPI >= ${KPI_TARGET} unique Agent ID holders).`)
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

// Binary search: first block with timestamp >= target, / last block <= target.
async function findBlock(targetTs, firstAtOrAfter) {
  const latest = hexToInt(await rpc('eth_blockNumber', []))
  let lo = FROM_BLOCK
  let hi = latest
  if (firstAtOrAfter) {
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      const ts = await blockTimestamp(mid)
      if (ts !== null && ts >= targetTs) hi = mid
      else lo = mid + 1
    }
    return lo
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    const ts = await blockTimestamp(mid)
    if (ts !== null && ts <= targetTs) lo = mid
    else hi = mid - 1
  }
  return lo
}

const startBlock = await findBlock(WINDOW_START_TS, true)
const endBlock = await findBlock(WINDOW_END_TS, false)
if (startBlock > endBlock) {
  console.error('Error: window is empty (start block is after end block).')
  process.exit(1)
}

const users = new Set()
// Public BSC RPCs reject wide eth_getLogs ranges ("limit exceeded"), so
// scan in small chunks.
const CHUNK = 1000
for (let from = startBlock; from <= endBlock; from += CHUNK) {
  const to = Math.min(from + CHUNK - 1, endBlock)
  const logs = await rpc('eth_getLogs', [{
    address: ADDRESS,
    fromBlock: toHex(from),
    toBlock: toHex(to),
    topics: [[...Object.values(TOPICS)]],
  }])
  for (const log of logs) {
    if (log.topics[1]) users.add(('0x' + log.topics[1].slice(26)).toLowerCase())
  }
}

// Keep only addresses holding at least 1 Agent ID at the end of the window.
const holders = []
for (const user of users) {
  const data = BALANCEOF_SELECTOR + user.slice(2).padStart(64, '0')
  const raw = await rpc('eth_call', [{ to: AGENT_ID, data }, toHex(endBlock)])
  if (raw && BigInt(raw) > 0n) holders.push(user)
}

const result = {
  windowStart: WINDOW_START_ISO,
  windowEnd: WINDOW_END_ISO,
  startBlock,
  endBlock,
  safestreakContract: ADDRESS,
  agentIdContract: AGENT_ID,
  uniqueAddressesInEvents: users.size,
  uniqueAgentIds: holders.length,
  kpiTarget: KPI_TARGET,
  kpiMet: holders.length >= KPI_TARGET,
  generatedAt: new Date().toISOString(),
  addresses: holders.sort(),
}

const json = JSON.stringify(result, null, 2)
if (outFile) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(outFile, json + '\n')
  console.log(`Unique Agent ID holders: ${holders.length} (KPI >= ${KPI_TARGET}: ${result.kpiMet ? 'met' : 'not met'}). Wrote ${outFile}`)
} else {
  console.log(json)
}

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

init()
  .then(() => {
    app.listen(PORT, () => console.log(`SafeStreak verifier listening on ${PORT}`))
  })
  .catch((err) => {
    console.error('verifier init failed:', err && err.message ? err.message : 'unknown error')
    process.exit(1)
  })

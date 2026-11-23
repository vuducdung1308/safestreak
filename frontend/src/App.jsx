import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserProvider, Contract, ethers } from 'ethers'
import { STRINGS, t } from './i18n.js'
import questions from './questions.json'
import abi from './abi.json'

// Accepted attestation tokens (symbols only in the UI; addresses come from
// the verifier env ACCEPTED_TOKENS — never hardcode mainnet addresses here).
export const ACCEPTED_TOKEN_SYMBOLS = ['USDT', 'USDC', 'WBNB', 'BTCB', 'ETH', 'CAKE']
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]
const MAX_UINT = ethers.MaxUint256
const PAGES = ['home', 'challenge', 'profile', 'leaderboard', 'approvals', 'stats']
const SNAPSHOT = '09/12/2026 08:00 UTC'
// Run window: Q01 = 27/11/2026 = epoch day 20784, Q10 = 06/12/2026 = 20793.
const RUN_START_DAY = 20784
const RUN_END_DAY = 20793
// The Agent ID contract (IAgentID in SafeStreak.sol) exposes handleOf — the
// SafeStreak contract itself does NOT. .ai names are read from the Agent ID
// contract only, with a fallback to the shortened address.
const AGENT_ID_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function handleOf(address account) view returns (string)',
]

const SAFESTREAK_ADDRESS = import.meta.env.VITE_SAFESTREAK_ADDRESS || ''
const AGENT_ID_ADDRESS = import.meta.env.VITE_AGENT_ID_ADDRESS || ''
const RPC_URL = import.meta.env.VITE_RPC_URL || ''
const VERIFIER_URL = import.meta.env.VITE_VERIFIER_URL || ''
// Badge contract (soulbound streak badges) — used ONLY for the on-chain proof
// links (BscScan) in the UI. Never used in any transaction here.
const BADGE_ADDRESS = '0xF1bC1504Dc3fF3A8039226961B4915890bcDBB4A'
const BSCSCAN_ADDRESS = 'https://bscscan.com/address/'
// Deploy block of the SafeStreak contract (BNB mainnet, verified on-chain).
// ALL on-chain log queries start here — never from block 0: the public RPC
// rate-limits (and rejects) wide eth_getLogs ranges.
const DEPLOY_BLOCK = 134663434

// Copy-paste prompt for the Binance AI agent / Claude Code driving the user's
// own Agentic Wallet. English only (the AI reads English); the surrounding
// card copy lives in i18n.js. Keep the placeholder YOUR_WALLET_ADDRESS — the
// user replaces it with their Agentic Wallet address.
const AGENT_PROMPT = `TASK: Play SafeStreak with my Binance Agentic Wallet — answer the daily challenge on-chain, check my token approvals, and attest revocations on-chain.

You are helping me with MY OWN Agentic Wallet on BNB Smart Chain (chain ID 56). My wallet holds a Binance Agent ID. Only ever act on MY wallet — never look up or act on anyone else's wallet.

IMPORTANT — the Agentic Wallet cannot log in to any web app: the Binance App's dApp browser only exposes the keyless wallet, so the Agentic Wallet cannot connect to https://vuducdung1308.github.io/safestreak/. You must complete every on-chain call below yourself, from my wallet. Do NOT send me to the web app to commit, reveal or attest with the Agentic Wallet.

1. TODAY'S CHALLENGE — commit, then reveal:
   - Today is dayId = floor(current Unix timestamp / 86400). The run is 27/11/2026-06/12/2026, dayIds 20784 (Q01) to 20793 (Q10). If today is outside that range, do nothing and tell me.
   - Get today's question from https://raw.githubusercontent.com/vuducdung1308/safestreak/main/questions/questions.json (Q01 = day 20784, Q02 = 20785, ... Q10 = 20793). Verify it against the contract: call getChallenge(dayId) on SafeStreak 0xA1D5E01B04B6c8d398219bc84F5b2f28e295b28F and confirm the contentHash matches the question (hash method in the repo's questions/hash.mjs).
   - Show me the question and its 4 options A/B/C/D, then ask me to pick ONE answer. Do not pick an answer for me.
   - Generate a fresh random 32-byte salt. Save it in a local file named safestreak-salt-<dayId>.json — never share it, never send it anywhere. Compute commitHash = keccak256(abi.encodePacked(dayId, answer, salt, myWalletAddress)).
   - Show me the exact transaction first, get my explicit approval, then call commit(uint256 dayId, bytes32 commitHash) on the SafeStreak contract (selector 0xf2f03877) FROM my wallet (from = YOUR_WALLET_ADDRESS). Report the commit transaction hash.
   - THE NEXT DAY, after the publisher has revealed the answer (check getChallenge(dayId).answerRevealedAt != 0 first), call reveal(uint256 dayId, string answer, bytes32 salt) (selector 0xae416c4b) with the SAME answer letter and SAME salt from the local file, FROM my wallet. Reveal within 36 hours of the publisher's reveal or it expires. Report whether my answer was correct, my points and streak from profile(myWalletAddress), and the reveal transaction hash.
   - One commit per UTC day, never two. If I miss a day, do NOT commit twice the next day.
2. APPROVAL HEALTH CHECK + ATTEST — scan, revoke, attest:
   - Scan MY wallet's ERC-20 approvals on BNB Smart Chain for the 6 accepted tokens:
     USDT 0x55d398326f99059fF775485246999027B3197955, USDC 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d, WBNB 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c, BTCB 0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c, ETH 0x2170Ed0880ac9A755fd29B2688956BD959F933F8, CAKE 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82.
     Read Approval events (owner = my wallet) for each token and the current allowance(owner, spender) for each spender. Report risky approvals (unlimited, or to an unverified spender), riskiest first.
   - For each risky approval I approve, revoke it by calling approve(spender, 0) on the token contract FROM my wallet — and only after I explicitly approve that specific revoke. The only approval this task ever sends is approve(spender, 0). Never create an approval with a value above 0.
   - After a revoke, attest it on-chain: POST https://safestreak-verifier.onrender.com/attest with JSON body {"user": "YOUR_WALLET_ADDRESS", "token": "<token>", "spender": "<spender>", "approvalBlock": <block number of the original Approval event with value > 0>, "revokeTxHash": "<revoke tx hash>"}. approvalBlock must be before the snapshot block 134663434. The verifier returns an EIP-712 signature (valid 15 minutes) plus nonce and deadline. Show me the exact attest transaction first, get my explicit approval, then call attest(address user, address token, address spender, uint64 approvalBlock, bytes32 revokeTxHash, uint256 nonce, uint64 deadline, bytes signature) on the SafeStreak contract (selector 0xd8c733ba) FROM my wallet, passing exactly the verifier's fields. Max 3 attestations per day. Report the transaction hash.
3. LEADERBOARD — read profile(myWalletAddress) and the on-chain leaderboard (or GET https://safestreak-verifier.onrender.com/leaderboard) and tell me my points, my best correct streak, my rank, and the top 3 wallets.

SIMULATION TROUBLESHOOTING — if a simulation reverts, do NOT stop there, check the simulation itself first:
   (a) confirm it really used from = YOUR_WALLET_ADDRESS (some tools silently ignore "from" and simulate from their own address — commit, reveal and attest all require the sender to hold an Agent ID, otherwise they revert with NotAgentId 0xdfc3592e);
   (b) for attest, confirm the signature is the FULL 65 bytes exactly as the verifier returned it — never truncated or retyped from a shortened display — and the calldata is selector 0xd8c733ba, then user, token, spender, approvalBlock, revokeTxHash, nonce, deadline, signature, in that order;
   (c) confirm on-chain state: Agent ID balanceOf(my wallet) = 1 (Agent ID contract 0x60b9262456de011f7d15a54cdd8c48baaa8b022f); for commit, dayId == today and I have not committed already; for reveal, the publisher has revealed the answer and the 36-hour window has not expired; for attest, nonces(my wallet) equals the signature nonce, block.timestamp <= deadline, deadline <= now + 15 minutes, approvalBlock < 134663434, and the signature recovers to verifier 0x1Fc6e7764059B3206eD9D146d3F923233D6e3Be1.
   A revert WITH a 4-byte error is meaningful — decode it and fix the cause (NotAgentId 0xdfc3592e, NotToday 0x5f2f180d, AlreadyCommitted 0xbfec5558, WrongCommitment 0xe2d3b1c0, AnswerNotRevealed 0x2bb778d7, RevealWindowExpired 0xde2199de, NotCommitted 0x81791cb4, NotUser 0x7aafae97, DeadlineExpired 0x1ab7da6b, DeadlineTooFar 0x48f0fae6, BadNonce 0x4bd574ec, BadSignature 0x5cd5d233, ApprovalAfterSnapshot 0x30301bb4, AlreadyAttested 0x35d90805, AttestationLimitReached 0xb00686dc, AllowanceNotZero 0xe953bbb8). A revert with EMPTY data (0x) while all checks above pass is a known simulation-tool issue, not proof the contract rejects the call: show me the full calldata and the checks, and ask me whether to proceed.

SAFETY RULES — never break these:
- Never ask me for a seed phrase, private key, password, API secret, or any login/pairing code. The Agentic Wallet is MPC/keyless; sign-in is only by QR pairing in the Binance App.
- Never send, approve, or sign any transaction without showing me the exact details first and getting my explicit approval for that transaction.
- Never move funds. Never call transfer or transferFrom. Never send BNB to any contract.
- If you are unsure about an address or a transaction, stop and ask me instead of guessing.

CONTRACTS (BNB Smart Chain, chain ID 56):
- SafeStreak: 0xA1D5E01B04B6c8d398219bc84F5b2f28e295b28F
- Badge: 0xF1bC1504Dc3fF3A8039226961B4915890bcDBB4A
- Agent ID (ERC-721): 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
- Verifier: https://safestreak-verifier.onrender.com
- Web app: https://vuducdung1308.github.io/safestreak/
- Questions: https://raw.githubusercontent.com/vuducdung1308/safestreak/main/questions/questions.json
- Source: the contract source is verified on BscScan (getsourcecode returns the full source). Do not conclude it is unverified from a Sourcify 404 — Sourcify removed its v1 API.`

// Never render a raw ethers error in the UI: its message embeds the full
// JSON-RPC error payload (that is the big blue box in the 23/11 screenshot).
// Show a short reason; the detail goes to the console.
function shortTxError(e) {
  const msg = (e && (e.reason || e.shortMessage || e.message)) || String(e || '')
  const firstLine = String(msg).split('\n')[0].trim()
  return firstLine.length > 160 ? firstLine.slice(0, 157) + '…' : firstLine
}

function randomSalt() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return ethers.hexlify(bytes)
}

function commitHash(dayId, answer, salt, account) {
  // Must match the contract's commitment scheme (SafeStreak.sol reveal):
  // keccak256(abi.encodePacked(dayId, answer, salt, msg.sender)).
  return ethers.solidityPackedKeccak256(
    ['uint256', 'string', 'bytes32', 'address'],
    [dayId, answer, salt, account],
  )
}

function dayIdToday() {
  return Math.floor(Date.now() / 86400000)
}

function countdownToMidnightUTC() {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0))
  const ms = next - now
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function badgesFor(bestStreak) {
  return [3, 7, 14].filter((n) => bestStreak >= n)
}

// Next badge milestone after the current streak (for the profile ring).
function nextMilestone(current) {
  return [3, 7, 14].find((m) => m > current) || 14
}

export default function App() {
  const [lang, setLang] = useState('vi')
  const [page, setPage] = useState('home')
  const [account, setAccount] = useState('')
  const [providerError, setProviderError] = useState('')
  const [status, setStatus] = useState('')
  const [answer, setAnswer] = useState('')
  const [salt, setSalt] = useState('')
  const [hash, setHash] = useState('')
  const [streak, setStreak] = useState(null)
  const [handle, setHandle] = useState('')
  const [history, setHistory] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [stats, setStats] = useState(null)
  const [countdown, setCountdown] = useState(countdownToMidnightUTC())
  const [customToken, setCustomToken] = useState('')
  const [allowances, setAllowances] = useState([])
  const [checking, setChecking] = useState(false)

  const L = useCallback((key) => t(lang, key), [lang])
  const dayIdEpoch = useMemo(() => dayIdToday(), [])
  // Today's question by epoch day (Q01 = day 20784). Outside the run window
  // there is no challenge — never fall back to the last question.
  const today = useMemo(
    () =>
      dayIdEpoch >= RUN_START_DAY && dayIdEpoch <= RUN_END_DAY
        ? questions[dayIdEpoch - RUN_START_DAY]
        : null,
    [dayIdEpoch],
  )
  const contractReady = Boolean(SAFESTREAK_ADDRESS)

  useEffect(() => {
    const id = setInterval(() => setCountdown(countdownToMidnightUTC()), 1000)
    return () => clearInterval(id)
  }, [])

  const connect = useCallback(async () => {
    setProviderError('')
    setStatus('')
    // Connect ONLY via injected EIP-1193 provider (window.ethereum) in the
    // Binance App dApp browser. No WalletConnect, no QR/pairing library.
    if (typeof window === 'undefined' || !window.ethereum) {
      setProviderError(L('noProvider'))
      return
    }
    try {
      const provider = new BrowserProvider(window.ethereum)
      const accounts = await provider.send('eth_requestAccounts', [])
      if (accounts && accounts[0]) setAccount(accounts[0])
    } catch (e) {
      console.error('connect failed:', e)
      setStatus(shortTxError(e))
    }
  }, [L])

  const getContract = useCallback(async (withSigner = false) => {
    if (!window.ethereum || !SAFESTREAK_ADDRESS) return null
    const provider = new BrowserProvider(window.ethereum)
    const runner = withSigner ? await provider.getSigner() : provider
    return new Contract(SAFESTREAK_ADDRESS, abi, runner)
  }, [])

  // .ai name from the Agent ID contract (not SafeStreak — it has no
  // handleOf). Returns '' when the name is unavailable.
  const loadHandle = useCallback(async (address, runner) => {
    if (!AGENT_ID_ADDRESS) return ''
    try {
      const agentId = new Contract(AGENT_ID_ADDRESS, AGENT_ID_ABI, runner)
      return (await agentId.handleOf(address)) || ''
    } catch {
      return ''
    }
  }, [])

  // Profile: connected wallet ONLY — no lookup of other wallets, no search box.
  const loadProfile = useCallback(async () => {
    if (!account) return
    try {
      const c = await getContract(false)
      if (!c) return
      // profile() returns, in order: points, joinStreak, bestJoinStreak,
      // lastJoinDay, correctStreak, bestCorrectStreak, bestCorrectAt,
      // lastCorrectDay, lastRevealDay (SafeStreak.sol).
      const p = await c.profile(account)
      const current = await c.currentCorrectStreak(account)
      setStreak({
        current: Number(current),
        best: Number(p[5]),
        totalCorrect: Number(p[0]),
        points: Number(p[0]),
        joinCurrent: Number(await c.currentJoinStreak(account)),
        joinBest: Number(p[2]),
      })
      const provider = new BrowserProvider(window.ethereum)
      setHandle(await loadHandle(account, provider))
      const filter = c.filters.Revealed(account)
      const events = await c.queryFilter(filter, DEPLOY_BLOCK)
      setHistory(
        events.map((e) => ({
          dayId: Number(e.args.dayId),
          correct: e.args.correct,
          tx: e.transactionHash,
        })),
      )
    } catch (e) {
      console.error('loadProfile failed:', e)
      setStatus(L('loadFailed'))
    }
  }, [account, getContract, loadHandle])

  useEffect(() => {
    // Also on 'home': the hero stat pills show the same profile numbers.
    if (page === 'profile' || page === 'home') loadProfile()
  }, [page, loadProfile])

  const loadLeaderboard = useCallback(async () => {
    // Name + stats only, no balances/assets. Ranked by points then streak.
    // Real events: Revealed(user, dayId, correct) and
    // StreakUpdated(user, branch, newStreak, bestStreak) with branch 1 =
    // correct-answer streak. Per-user points/best come from profile().
    if (!contractReady) {
      setLeaderboard([])
      return
    }
    // Verifier first: the public RPC rate-limits wide eth_getLogs ranges, so
    // the verifier (log-capable RPC) serves the leaderboard. Fall back to
    // direct on-chain reads when the verifier is unreachable.
    if (VERIFIER_URL) {
      try {
        const res = await fetch(`${VERIFIER_URL}/leaderboard`)
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.rows)) {
            setLeaderboard(
              data.rows.map((r) => ({
                address: r.address,
                points: Number(r.points) || 0,
                totalCorrect: Number(r.totalCorrect) || 0,
                best: Number(r.best) || 0,
                handle: r.handle || '',
              })),
            )
            return
          }
        }
        console.error('verifier /leaderboard failed:', res.status)
      } catch (e) {
        console.error('verifier /leaderboard failed:', e)
      }
    }
    try {
      const provider = RPC_URL ? new ethers.JsonRpcProvider(RPC_URL) : new BrowserProvider(window.ethereum)
      const c = new Contract(SAFESTREAK_ADDRESS, abi, provider)
      const [revealed, streaks] = await Promise.all([
        c.queryFilter(c.filters.Revealed(), DEPLOY_BLOCK),
        c.queryFilter(c.filters.StreakUpdated(), DEPLOY_BLOCK),
      ])
      const users = new Set([
        ...revealed.map((e) => e.args.user),
        ...streaks.map((e) => e.args.user),
      ])
      const rows = []
      for (const user of users) {
        const p = await c.profile(user)
        const totalCorrect = revealed.filter(
          (e) => e.args.user.toLowerCase() === user.toLowerCase() && e.args.correct,
        ).length
        rows.push({
          address: user,
          points: Number(p[0]),
          totalCorrect,
          best: Number(p[5]),
          handle: await loadHandle(user, provider),
        })
      }
      rows.sort((a, b) => b.points - a.points || b.best - a.best)
      setLeaderboard(rows)
    } catch (e) {
      // Total failure: show the empty state, never a raw error.
      console.error('loadLeaderboard failed:', e)
      setLeaderboard([])
    }
  }, [contractReady, loadHandle])

  useEffect(() => {
    // Also on 'home': the Top 3 card reads the same leaderboard.
    if (page === 'leaderboard' || page === 'home') loadLeaderboard()
  }, [page, loadLeaderboard])

  const loadStats = useCallback(async () => {
    // Read from on-chain events only.
    if (!contractReady) {
      setStats(null)
      return
    }
    // Verifier first (same reason as loadLeaderboard): the public RPC
    // rate-limits wide eth_getLogs ranges.
    if (VERIFIER_URL) {
      try {
        const res = await fetch(`${VERIFIER_URL}/stats`)
        if (res.ok) {
          const data = await res.json()
          if (data && typeof data.uniqueAgentIds === 'number' && data.byType && data.byDay) {
            setStats(data)
            return
          }
        }
        console.error('verifier /stats failed:', res.status)
      } catch (e) {
        console.error('verifier /stats failed:', e)
      }
    }
    try {
      const provider = RPC_URL ? new ethers.JsonRpcProvider(RPC_URL) : new BrowserProvider(window.ethereum)
      const c = new Contract(SAFESTREAK_ADDRESS, abi, provider)
      const [committed, revealed, attested] = await Promise.all([
        c.queryFilter(c.filters.Committed(), DEPLOY_BLOCK),
        c.queryFilter(c.filters.Revealed(), DEPLOY_BLOCK),
        c.queryFilter(c.filters.Attested(), DEPLOY_BLOCK),
      ])
      const users = new Set([...revealed, ...committed].map((e) => e.args.user.toLowerCase()))
      const byDay = {}
      for (const e of [...committed, ...revealed, ...attested]) {
        const block = await provider.getBlock(e.blockNumber)
        const day = new Date(Number(block.timestamp) * 1000).toISOString().slice(0, 10)
        byDay[day] = (byDay[day] || 0) + 1
      }
      setStats({
        uniqueAgentIds: users.size,
        byType: { Committed: committed.length, Revealed: revealed.length, Attested: attested.length },
        byDay,
      })
    } catch (e) {
      // Total failure: show the empty state, never a raw error.
      console.error('loadStats failed:', e)
      setStats(null)
    }
  }, [contractReady])

  useEffect(() => {
    if (page === 'stats') loadStats()
  }, [page, loadStats])

  const doCommit = async () => {
    if (!answer || !today) return
    const s = randomSalt()
    const h = commitHash(dayIdEpoch, answer, s, account)
    setSalt(s)
    setHash(h)
    if (!contractReady || !account) {
      setStatus(L('contractNotDeployed'))
      return
    }
    try {
      const c = await getContract(true)
      const tx = await c.commit(dayIdEpoch, h)
      setStatus(`Commit tx sent: ${tx.hash}`)
      await tx.wait()
      setStatus(`Commit confirmed: ${tx.hash}`)
    } catch (e) {
      console.error('commit failed:', e)
      setStatus(shortTxError(e))
    }
  }

  const doReveal = async () => {
    if (!answer || !salt || !today) return
    if (!contractReady || !account) {
      setStatus(L('contractNotDeployed'))
      return
    }
    try {
      const c = await getContract(true)
      const tx = await c.reveal(dayIdEpoch, answer, salt)
      setStatus(`Reveal tx sent: ${tx.hash}`)
      await tx.wait()
      setStatus(`Reveal confirmed: ${tx.hash}`)
      loadProfile()
    } catch (e) {
      console.error('reveal failed:', e)
      setStatus(shortTxError(e))
    }
  }

  // Approval Health Check — connected wallet ONLY.
  const checkAllowances = async () => {
    if (!account || !window.ethereum) {
      setProviderError(L('noProvider'))
      return
    }
    setChecking(true)
    setStatus('')
    try {
      const provider = new BrowserProvider(window.ethereum)
      // Token addresses are NOT hardcoded here (mainnet addresses are owned by
      // the verifier env ACCEPTED_TOKENS). Only user-added token addresses and
      // any address configured via env are checked. See README.
      const addresses = []
      if (customToken && ethers.isAddress(customToken)) addresses.push(customToken)
      const rows = []
      for (const addr of addresses) {
        const token = new Contract(addr, ERC20_ABI, provider)
        let symbol = addr
        try {
          symbol = await token.symbol()
        } catch { /* keep address */ }
        // Spenders are discovered from Approval events for this owner+token.
        // Logs start at the SafeStreak deploy block — never from block 0
        // (the public RPC rate-limits wide eth_getLogs ranges).
        const filter = { address: addr, topics: [ethers.id('Approval(address,address,uint256)'), ethers.zeroPadValue(account, 32)] }
        const logs = await provider.getLogs({ ...filter, fromBlock: DEPLOY_BLOCK })
        const spenders = [...new Set(logs.map((l) => ethers.getAddress('0x' + l.topics[2].slice(26))))]
        for (const spender of spenders) {
          const allowance = await token.allowance(account, spender)
          const block = logs.find((l) => l.topics[2].toLowerCase().endsWith(spender.slice(2).toLowerCase()))
          rows.push({
            token: addr,
            symbol,
            spender,
            allowance: allowance.toString(),
            unlimited: allowance === MAX_UINT,
            oldApproval: block ? Number(block.blockNumber) : null,
            // 'Unverified spender' flag: this UI has no trust registry, so any
            // spender that is not the SafeStreak contract is flagged for review.
            unverifiedSpender: SAFESTREAK_ADDRESS ? spender.toLowerCase() !== SAFESTREAK_ADDRESS.toLowerCase() : true,
          })
        }
      }
      setAllowances(rows)
      if (rows.length === 0) setStatus(customToken ? 'No Approval events found for this token.' : 'Add a token address to check, or set the accepted-token list (see README).')
    } catch (e) {
      console.error('checkAllowances failed:', e)
      setStatus(L('loadFailed'))
    } finally {
      setChecking(false)
    }
  }

  // Revoke: builds approve(spender, 0) for the USER to sign in their wallet.
  // The app never sends it itself and never creates approve with amount > 0.
  const revoke = async (row) => {
    try {
      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const token = new Contract(row.token, ERC20_ABI, signer)
      const tx = await token.approve(row.spender, 0)
      setStatus(`Revoke tx sent (approve 0) — sign in your wallet: ${tx.hash}`)
    } catch (e) {
      console.error('revoke failed:', e)
      setStatus(shortTxError(e))
    }
  }

  // Share my streak — copies a short text to the clipboard. No transaction,
  // no server call; only reads state already on screen.
  const shareStreak = async () => {
    const name = handle || (account ? `${account.slice(0, 6)}…${account.slice(-4)}` : 'SafeStreak')
    const text = streak
      ? `SafeStreak — ${name}: ${L('currentStreak')} ${streak.current}, ${L('bestStreak')} ${streak.best}, ${L('totalCorrect')} ${streak.totalCorrect}. ${L('tagline')} ${window.location.href}`
      : `SafeStreak — ${L('tagline')} ${window.location.href}`
    try {
      await navigator.clipboard.writeText(text)
      setStatus(L('shareCopied'))
    } catch {
      // Clipboard API unavailable (older in-app browsers): show the text so
      // the user can copy it manually.
      setStatus(text)
    }
  }

  // Copy the Agentic AI prompt — clipboard API with textarea fallback
  // (older in-app browsers). Never renders the prompt into the status line.
  const copyAgentPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_PROMPT)
      setStatus(L('promptCopied'))
      return
    } catch { /* fall through to the textarea fallback */ }
    const ta = document.createElement('textarea')
    ta.value = AGENT_PROMPT
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      setStatus(L('promptCopied'))
    } catch {
      // Last resort: select the <pre> text so the user can copy manually.
      const el = document.getElementById('agentPrompt')
      if (el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
      }
      setStatus(L('copyManually'))
    }
    document.body.removeChild(ta)
  }

  return (
    <div>
      <div className="topbar">
      <header>
        <div className="logo">🔥 SafeStreak</div>
        <div className="header-actions">
          {account && (
            <span className="wallet-chip" title={account}>
              {handle || `${account.slice(0, 6)}…${account.slice(-4)}`}
            </span>
          )}
          <select className="lang-toggle" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={L('language')}>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
          {account ? (
            <button className="btn btn-secondary" onClick={() => setAccount('')}>{L('disconnect')}</button>
          ) : (
            <span className="connect-wrap">
              <button className="btn" onClick={connect}>{L('connect')}</button>
              <span className="agentic-note">{L('agenticNote')}</span>
            </span>
          )}
        </div>
      </header>
      <nav>
        {PAGES.map((p) => (
          <button key={p} type="button" className={page === p ? 'active' : ''} onClick={() => setPage(p)}>
            {L('nav' + p[0].toUpperCase() + p.slice(1))}
          </button>
        ))}
      </nav>
      </div>
      <main>
        <div className="warning">{L('warning')}</div>
        {!contractReady && <div className="warning">{L('contractNotDeployed')}</div>}
        {providerError && <div className="error-box">{providerError}</div>}
        {status && <div className="notice"><code>{status}</code></div>}

        {page === 'home' && (
          <>
            <div className="hero-wrap">
              <div className="hero-left">
                <h1>SafeStreak</h1>
                <p className="hero-sub">{L('tagline')}</p>
                <div className="stat-pills">
                  <span className="pill"><span className="dot" />{L('currentStreak')}: <strong>&nbsp;{streak ? streak.current : '—'}</strong></span>
                  <span className="pill">{L('points')}: <strong>&nbsp;{streak ? streak.points : '—'}</strong></span>
                  <span className="pill">{L('bestStreak')}: <strong>&nbsp;{streak ? streak.best : '—'}</strong></span>
                </div>
                <p className="countdown-pill">{L('countdown')}: <span className="countdown">{countdown}</span></p>
                <p><button className="btn btn-big" onClick={() => setPage('challenge')}>{L('goChallenge')}</button></p>
                <p className="proof-line">{L('onChainProof')}: {SAFESTREAK_ADDRESS && <><a href={BSCSCAN_ADDRESS + SAFESTREAK_ADDRESS} target="_blank" rel="noopener">SafeStreak</a> · </>}<a href={BSCSCAN_ADDRESS + BADGE_ADDRESS} target="_blank" rel="noopener">Badge</a></p>
              </div>
              <div className="hero-right">
                <div className="card agent-id-panel">
                  <div className="agent-id-card" aria-hidden="true">
                    <div className="agent-id-top"><span>SAFESTREAK</span><span>AGENT ID</span></div>
                    <div className="agent-id-name">{handle || 'SafeStreak'}</div>
                    <div className="agent-id-foot"><span>{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : '27/11 – 06/12/2026'}</span><span>BNB CHAIN</span></div>
                  </div>
                  <h2>{L('yourStreak')}</h2>
                  <p className="muted">
                    {streak
                      ? `${L('currentStreak')}: ${streak.current} · ${L('bestStreak')}: ${streak.best} · ${L('totalCorrect')}: ${streak.totalCorrect}`
                      : L('tagline')}
                  </p>
                  {account ? (
                    <p><button className="btn btn-big" onClick={() => setPage('challenge')}>{L('goChallenge')}</button></p>
                  ) : (
                    <>
                      <p><button className="btn btn-big" onClick={connect}>{L('connect')}</button></p>
                      <p className="muted agentic-note">{L('agenticNote')}</p>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <h2>{L('howItWorks')}</h2>
              <ol className="steps">
                {[L('how1'), L('how2'), L('how3')].map((s, i) => (
                  <li key={i}>{s.replace(/^\d+\.\s*/, '')}</li>
                ))}
              </ol>
              <p className="muted" style={{ marginTop: 14 }}>{L('how4')}</p>
              <p className="muted">Final snapshot: {SNAPSHOT}. Agent ID: <code>{AGENT_ID_ADDRESS}</code></p>
              {VERIFIER_URL && <p className="muted">Verifier: <code>{VERIFIER_URL}</code></p>}
            </div>

            <div className="card">
              <h2>{L('aiTitle')}</h2>
              <p className="muted">{L('aiDesc')}</p>
              <ol className="steps">
                {[L('aiStep1'), L('aiStep2'), L('aiStep3')].map((s, i) => (
                  <li key={i}>{s.replace(/^\d+\.\s*/, '')}</li>
                ))}
              </ol>
              <p><button className="btn" type="button" onClick={copyAgentPrompt}>{L('copyPrompt')}</button></p>
              <pre id="agentPrompt" className="prompt-box">{AGENT_PROMPT}</pre>
            </div>

            <div className="card">
              <h2>{L('top3Title')}</h2>
              {leaderboard.length === 0 ? <p className="muted">{L('noHistory')}</p> : (
                <ol className="history-list">
                  {leaderboard.slice(0, 3).map((r, i) => (
                    <li key={r.address}><span className={`rank-num rank-${i + 1}`}>{i + 1}</span><span>{r.handle || r.address.slice(0, 6) + '…' + r.address.slice(-4)} — {r.points} {L('points')} · {L('bestStreak')} {r.best}</span></li>
                  ))}
                </ol>
              )}
              <p><button className="linklike" type="button" onClick={() => setPage('leaderboard')}>{L('viewAll')}</button></p>
            </div>
          </>
        )}

        {page === 'challenge' && (
          <div className="card">
            <h2>{L('todaysChallenge')}</h2>
            <p className="countdown-pill">{L('countdown')}: <span className="countdown">{countdown}</span></p>
            {!today ? (
              <p className="muted">{L('noChallenge')}</p>
            ) : (
              <>
                <p className="question-text"><strong>{today.question[lang] || today.question.en}</strong></p>
                <p className="muted">{L('pickAnswer')}</p>
                {Object.entries(today.options).map(([k, v]) => (
                  <label key={k} className={'option' + (answer === k ? ' selected' : '')}>
                    <input type="radio" name="answer" checked={answer === k} onChange={() => setAnswer(k)} />
                    <span className="opt-letter">{k}.</span>
                    <span>{v[lang] || v.en}</span>
                  </label>
                ))}
                <p>
                  <button className="btn" disabled={!answer || !account || !contractReady} onClick={doCommit}>{L('commit')}</button>{' '}
                  <button className="btn btn-secondary" disabled={!answer || !salt || !account || !contractReady} onClick={doReveal}>{L('reveal')}</button>
                </p>
                {!account && <p className="muted agentic-note">{L('agenticNote')}</p>}
                <div className="warning">{L('revealNote')}</div>
                {salt && <pre className="prompt-box">{L('saltLabel')}: {salt}</pre>}
                {hash && <pre className="prompt-box">{L('commitHash')}: {hash}</pre>}
              </>
            )}
            {streak && (
              <div className="stat-pills" style={{ marginTop: 16 }}>
                <span className="pill">{L('currentStreak')}: <strong>&nbsp;{streak.current}</strong></span>
                <span className="pill">{L('bestStreak')}: <strong>&nbsp;{streak.best}</strong></span>
                <span className="pill">{L('totalCorrect')}: <strong>&nbsp;{streak.totalCorrect}</strong></span>
                <span className="pill">{L('points')}: <strong>&nbsp;{streak.totalCorrect}</strong></span>
              </div>
            )}
          </div>
        )}

        {page === 'profile' && (
          <div className="card">
            <h2>{L('navProfile')}</h2>
            {!account && (
              <>
                <p><button className="btn" onClick={connect}>{L('connect')}</button></p>
                <p className="muted agentic-note">{L('agenticNote')}</p>
              </>
            )}
            {account && (
              <>
                <p>Wallet: <code>{account}</code></p>
                {handle && <p>.ai name: <strong>{handle}</strong></p>}
                {streak && (
                  <>
                    <div className="score-hero">
                      <div className="score-ring">
                        <svg viewBox="0 0 120 120" aria-hidden="true">
                          <circle className="ring-track" cx="60" cy="60" r="52" />
                          <circle
                            className="ring-fill"
                            cx="60"
                            cy="60"
                            r="52"
                            transform="rotate(-90 60 60)"
                            strokeDasharray={2 * Math.PI * 52}
                            strokeDashoffset={2 * Math.PI * 52 * (1 - Math.min(streak.current / nextMilestone(streak.current), 1))}
                          />
                        </svg>
                        <div className="score-hero-inner">
                          <div className="score-hero-label">{L('currentStreak')}</div>
                          <div className="score-hero-value">{streak.current}</div>
                        </div>
                      </div>
                      <div className="score-hero-sub">{L('bestStreak')}: {streak.best} · {L('totalCorrect')}: {streak.totalCorrect}</div>
                    </div>
                    <div className="stat-grid">
                      <div className="stat"><div className="num">{streak.best}</div><div className="lbl">{L('bestStreak')}</div></div>
                      <div className="stat"><div className="num">{streak.totalCorrect}</div><div className="lbl">{L('totalCorrect')}</div></div>
                      <div className="stat"><div className="num">{streak.points}</div><div className="lbl">{L('points')}</div></div>
                    </div>
                    <p style={{ marginTop: 14 }}>{L('badges')}: {badgesFor(streak.best).length > 0
                      ? badgesFor(streak.best).map((b) => <span key={b} className="badge-tier"><span className="badge-dot" />{b}</span>)
                      : '—'}</p>
                    <p>
                      <button className="btn btn-secondary" onClick={shareStreak}>{L('shareStreak')}</button>
                    </p>
                  </>
                )}
                <h3>{L('history')}</h3>
                {history.length === 0 ? <p className="muted">{L('noHistory')}</p> : (
                  <ul className="history-list">{history.map((h, i) => <li key={i}>#{h.dayId} — {h.correct ? <span className="ok">✓</span> : <span className="bad">✗</span>} — <code>{h.tx.slice(0, 18)}…</code></li>)}</ul>
                )}
                <h3>{L('onChainProof')}</h3>
                {SAFESTREAK_ADDRESS && <p className="proof-line">SafeStreak: <a href={BSCSCAN_ADDRESS + SAFESTREAK_ADDRESS} target="_blank" rel="noopener">{SAFESTREAK_ADDRESS}</a></p>}
                <p className="proof-line">Badge: <a href={BSCSCAN_ADDRESS + BADGE_ADDRESS} target="_blank" rel="noopener">{BADGE_ADDRESS}</a></p>
              </>
            )}
          </div>
        )}

        {page === 'leaderboard' && (
          <div className="card">
            <h2>{L('navLeaderboard')}</h2>
            <p className="muted">{L('leaderboardNote')}</p>
            <p className="muted">Final snapshot: {SNAPSHOT}</p>
            {leaderboard.length === 0 ? <p className="muted">{L('noHistory')}</p> : (
              <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Name</th><th>{L('points')}</th><th>{L('bestStreak')}</th></tr></thead>
                <tbody>
                  {leaderboard.map((r, i) => (
                    <tr key={r.address}><td>{i < 3 ? <span className={`rank-num rank-${i + 1}`}>{i + 1}</span> : <span className="rank-num">{i + 1}</span>}</td><td>{r.handle || r.address.slice(0, 6) + '…' + r.address.slice(-4)}</td><td>{r.points}</td><td>{r.best}</td></tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}

        {page === 'approvals' && (
          <div className="card">
            <h2>{L('approvalsTitle')}</h2>
            <p className="muted">{L('approvalsNote')}</p>
            <p>Accepted tokens: {ACCEPTED_TOKEN_SYMBOLS.join(', ')}</p>
            <p>
              <input placeholder={L('addToken')} value={customToken} onChange={(e) => setCustomToken(e.target.value)} size={44} />{' '}
              <button className="btn" disabled={!account || checking} onClick={checkAllowances}>{L('check')}</button>
            </p>
            {allowances.length > 0 && (
              <div className="table-wrap">
              <table>
                <thead><tr><th>Token</th><th>Spender</th><th>Allowance</th><th>Flags</th><th></th></tr></thead>
                <tbody>
                  {allowances.map((r, i) => (
                    <tr key={i}>
                      <td>{r.symbol}</td>
                      <td><code>{r.spender.slice(0, 10)}…</code></td>
                      <td><code>{r.allowance}</code></td>
                      <td>
                        {r.unlimited && <span className="flag flag-risk">{L('unlimited')} </span>}
                        {r.unverifiedSpender && <span className="flag flag-risk">{L('unverifiedSpender')} </span>}
                        {r.oldApproval !== null && <span className="flag flag-warn">{L('oldApproval')} #{r.oldApproval}</span>}
                      </td>
                      <td><button className="btn btn-small" disabled={!account} onClick={() => revoke(r)}>{L('revoke')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}

        {page === 'stats' && (
          <div className="card">
            <h2>{L('navStats')}</h2>
            <p className="muted">{L('statsNote')}</p>
            {!stats ? <p className="muted">{L('noHistory')}</p> : (
              <>
                <div className="stat-grid stat-grid-4">
                  <div className="stat"><div className="num">{stats.uniqueAgentIds}</div><div className="lbl">{L('uniqueAgentIds')}</div></div>
                  <div className="stat"><div className="num">{stats.byType.Committed}</div><div className="lbl">Committed</div></div>
                  <div className="stat"><div className="num">{stats.byType.Revealed}</div><div className="lbl">Revealed</div></div>
                  <div className="stat"><div className="num">{stats.byType.Attested}</div><div className="lbl">Attested</div></div>
                </div>
                <h3>{L('txByType')}</h3>
                <ul className="history-list">{Object.entries(stats.byType).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
                <h3>{L('txByDay')}</h3>
                <ul className="history-list">{Object.entries(stats.byDay).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
              </>
            )}
          </div>
        )}
      </main>
      <footer>
        <p>SafeStreak — {L('tagline')} Final snapshot: {SNAPSHOT}. Agent ID: <code>{AGENT_ID_ADDRESS}</code>{VERIFIER_URL && <> · Verifier: <code>{VERIFIER_URL}</code></>}</p>
      </footer>
    </div>
  )
}

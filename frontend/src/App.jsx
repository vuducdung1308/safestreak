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
  return [3, 7, 14].filter((n) => bestStreak >= n).map((n) => `🏅 ${n}`)
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
      setStatus(e?.message || String(e))
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
      const events = await c.queryFilter(filter)
      setHistory(
        events.map((e) => ({
          dayId: Number(e.args.dayId),
          correct: e.args.correct,
          tx: e.transactionHash,
        })),
      )
    } catch (e) {
      setStatus(e?.message || String(e))
    }
  }, [account, getContract, loadHandle])

  useEffect(() => {
    if (page === 'profile') loadProfile()
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
    try {
      const provider = RPC_URL ? new ethers.JsonRpcProvider(RPC_URL) : new BrowserProvider(window.ethereum)
      const c = new Contract(SAFESTREAK_ADDRESS, abi, provider)
      const [revealed, streaks] = await Promise.all([
        c.queryFilter(c.filters.Revealed()),
        c.queryFilter(c.filters.StreakUpdated()),
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
      setStatus(e?.message || String(e))
    }
  }, [contractReady, loadHandle])

  useEffect(() => {
    if (page === 'leaderboard') loadLeaderboard()
  }, [page, loadLeaderboard])

  const loadStats = useCallback(async () => {
    // Read from on-chain events only.
    if (!contractReady) {
      setStats(null)
      return
    }
    try {
      const provider = RPC_URL ? new ethers.JsonRpcProvider(RPC_URL) : new BrowserProvider(window.ethereum)
      const c = new Contract(SAFESTREAK_ADDRESS, abi, provider)
      const [committed, revealed, attested] = await Promise.all([
        c.queryFilter(c.filters.Committed()),
        c.queryFilter(c.filters.Revealed()),
        c.queryFilter(c.filters.Attested()),
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
      setStatus(e?.message || String(e))
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
      setStatus(e?.message || String(e))
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
      setStatus(e?.message || String(e))
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
        const filter = { address: addr, topics: [ethers.id('Approval(address,address,uint256)'), ethers.zeroPadValue(account, 32)] }
        const logs = await provider.getLogs({ ...filter, fromBlock: 0 })
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
      setStatus(e?.message || String(e))
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
      setStatus(e?.message || String(e))
    }
  }

  return (
    <div>
      <header>
        <strong>SafeStreak</strong>
        <span className="muted">{L('tagline')}</span>
        <nav style={{ marginLeft: 'auto' }}>
          {PAGES.map((p) => (
            <button key={p} className={page === p ? '' : 'secondary'} onClick={() => setPage(p)}>
              {L('nav' + p[0].toUpperCase() + p.slice(1))}
            </button>
          ))}
        </nav>
        <label>
          {L('language')}{' '}
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </label>
        {account ? (
          <span>
            {L('connected')}: <code>{account.slice(0, 6)}…{account.slice(-4)}</code>{' '}
            <button className="secondary" onClick={() => setAccount('')}>{L('disconnect')}</button>
          </span>
        ) : (
          <button onClick={connect}>{L('connect')}</button>
        )}
      </header>
      <main>
        <div className="banner">⚠️ {L('warning')}</div>
        {!contractReady && <p className="warn">{L('contractNotDeployed')}</p>}
        {providerError && <p className="warn">{providerError}</p>}
        {status && <p><code>{status}</code></p>}

        {page === 'home' && (
          <div className="card">
            <h1>SafeStreak</h1>
            <p>{L('tagline')}</p>
            <h2>{L('howItWorks')}</h2>
            <p>{L('how1')}</p>
            <p>{L('how2')}</p>
            <p>{L('how3')}</p>
            <p>{L('how4')}</p>
            <p className="muted">Final snapshot: {SNAPSHOT}. Agent ID: <code>{AGENT_ID_ADDRESS}</code></p>
            {VERIFIER_URL && <p className="muted">Verifier: <code>{VERIFIER_URL}</code></p>}
          </div>
        )}

        {page === 'challenge' && (
          <div className="card">
            <h2>{L('todaysChallenge')}</h2>
            <p>{L('countdown')}: <strong>{countdown}</strong></p>
            {!today ? (
              <p className="muted">{L('noChallenge')}</p>
            ) : (
              <>
                <p><strong>{today.question}</strong></p>
                {Object.entries(today.options).map(([k, v]) => (
                  <label key={k} style={{ display: 'block', margin: '6px 0' }}>
                    <input type="radio" name="answer" checked={answer === k} onChange={() => setAnswer(k)} /> {k}. {v}
                  </label>
                ))}
                <p>
                  <button disabled={!answer || !account || !contractReady} onClick={doCommit}>{L('commit')}</button>{' '}
                  <button disabled={!answer || !salt || !account || !contractReady} onClick={doReveal}>{L('reveal')}</button>
                </p>
                <p className="muted">{L('revealNote')}</p>
                {salt && <p>{L('saltLabel')}: <code>{salt}</code></p>}
                {hash && <p>{L('commitHash')}: <code>{hash}</code></p>}
              </>
            )}
            {streak && (
              <p>
                {L('currentStreak')}: {streak.current} · {L('bestStreak')}: {streak.best} · {L('totalCorrect')}: {streak.totalCorrect} · {L('points')}: {streak.totalCorrect}
              </p>
            )}
          </div>
        )}

        {page === 'profile' && (
          <div className="card">
            <h2>{L('navProfile')}</h2>
            {!account && <p>{L('connect')}</p>}
            {account && (
              <>
                <p>Wallet: <code>{account}</code></p>
                {handle && <p>.ai name: <strong>{handle}</strong></p>}
                {streak && (
                  <>
                    <p>{L('currentStreak')}: {streak.current}</p>
                    <p>{L('bestStreak')}: {streak.best}</p>
                    <p>{L('totalCorrect')}: {streak.totalCorrect}</p>
                    <p>{L('points')}: {streak.totalCorrect}</p>
                    <p>{L('badges')}: {badgesFor(streak.best).join(', ') || '—'}</p>
                  </>
                )}
                <h3>{L('history')}</h3>
                {history.length === 0 ? <p className="muted">{L('noHistory')}</p> : (
                  <ul>{history.map((h, i) => <li key={i}>#{h.dayId} — {h.correct ? '✓' : '✗'} — <code>{h.tx.slice(0, 18)}…</code></li>)}</ul>
                )}
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
              <table>
                <thead><tr><th>#</th><th>Name</th><th>{L('points')}</th><th>{L('bestStreak')}</th></tr></thead>
                <tbody>
                  {leaderboard.map((r, i) => (
                    <tr key={r.address}><td>{i + 1}</td><td>{r.handle || r.address.slice(0, 6) + '…' + r.address.slice(-4)}</td><td>{r.points}</td><td>{r.best}</td></tr>
                  ))}
                </tbody>
              </table>
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
              <button disabled={!account || checking} onClick={checkAllowances}>{L('check')}</button>
            </p>
            {allowances.length > 0 && (
              <table>
                <thead><tr><th>Token</th><th>Spender</th><th>Allowance</th><th>Flags</th><th></th></tr></thead>
                <tbody>
                  {allowances.map((r, i) => (
                    <tr key={i}>
                      <td>{r.symbol}</td>
                      <td><code>{r.spender.slice(0, 10)}…</code></td>
                      <td><code>{r.allowance}</code></td>
                      <td>
                        {r.unlimited && <span className="warn">{L('unlimited')} </span>}
                        {r.unverifiedSpender && <span className="warn">{L('unverifiedSpender')} </span>}
                        {r.oldApproval !== null && <span className="muted">{L('oldApproval')} #{r.oldApproval}</span>}
                      </td>
                      <td><button disabled={!account} onClick={() => revoke(r)}>{L('revoke')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {page === 'stats' && (
          <div className="card">
            <h2>{L('navStats')}</h2>
            <p className="muted">{L('statsNote')}</p>
            {!stats ? <p className="muted">{L('noHistory')}</p> : (
              <>
                <p>{L('uniqueAgentIds')}: <strong>{stats.uniqueAgentIds}</strong></p>
                <h3>{L('txByType')}</h3>
                <ul>{Object.entries(stats.byType).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
                <h3>{L('txByDay')}</h3>
                <ul>{Object.entries(stats.byDay).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserProvider, Contract, ethers } from 'ethers'
import { STRINGS, t } from './i18n.js'
import questions from './questions.json'
import abi from './abi.json'

// SafeStreak scoreboard — ONE page, read-only. The game lives in the Binance
// AI chat (the Agentic Wallet cannot log in to any web app), so this site has
// no wallet connection, no profile, no on-chain actions. It shows this
// round's question, who answered and whether they were right, and the
// leaderboard — all from public on-chain data via the verifier.
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
// Short loader prompt for the Agentic AI card. The AI fetches the full skill
// from the repo itself — the user never pastes the long prompt. This site
// version is generic (no personal handle); the personal version lives in
// skill/SAFESTREAK_SKILL.md.
const SHORT_PROMPT = `Đọc skill SafeStreak ở https://raw.githubusercontent.com/vuducdung1308/safestreak/main/skill/SAFESTREAK_SKILL.md và làm đúng theo skill đó. Chạy briefing hôm nay: Câu hỏi SafeStreak hôm nay là gì?`

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

// UTC date (YYYY-MM-DD) of an epoch dayId, for display.
function dateOfDay(dayId) {
  return new Date(dayId * 86400000).toISOString().slice(0, 10)
}

export default function App() {
  const [lang, setLang] = useState('vi')
  const [status, setStatus] = useState('')
  const [round, setRound] = useState(null)
  const [roundFailed, setRoundFailed] = useState(false)
  const [leaderboard, setLeaderboard] = useState([])
  const [countdown, setCountdown] = useState(countdownToMidnightUTC())

  const L = useCallback((key) => t(lang, key), [lang])
  const dayIdEpoch = useMemo(() => dayIdToday(), [])
  // The round shown: today's question during the run; Q01 (upcoming) before
  // the run starts; Q10 (last round) after it ends. Never falls back to an
  // arbitrary question.
  const displayDay = useMemo(
    () =>
      dayIdEpoch < RUN_START_DAY
        ? RUN_START_DAY
        : dayIdEpoch > RUN_END_DAY
          ? RUN_END_DAY
          : dayIdEpoch,
    [dayIdEpoch],
  )
  const question = useMemo(() => questions[displayDay - RUN_START_DAY], [displayDay])
  const contractReady = Boolean(SAFESTREAK_ADDRESS)

  useEffect(() => {
    const id = setInterval(() => setCountdown(countdownToMidnightUTC()), 1000)
    return () => clearInterval(id)
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

  const loadRound = useCallback(async () => {
    // Verifier only: the public RPC rate-limits wide eth_getLogs ranges, so
    // the round's Committed/Revealed/AnswerRevealed events come from the
    // verifier (log-capable RPC). No on-chain fallback here — a failure shows
    // the friendly loadFailed message, never a raw error.
    if (!VERIFIER_URL) {
      setRoundFailed(true)
      return
    }
    try {
      const res = await fetch(`${VERIFIER_URL}/round?day=${displayDay}`)
      if (res.ok) {
        const data = await res.json()
        if (data && Array.isArray(data.results)) {
          setRound(data)
          setRoundFailed(false)
          return
        }
      }
      console.error('verifier /round failed:', res.status)
    } catch (e) {
      console.error('verifier /round failed:', e)
    }
    setRoundFailed(true)
  }, [displayDay])

  useEffect(() => {
    loadRound()
  }, [loadRound])

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
    loadLeaderboard()
  }, [loadLeaderboard])

  // Copy the short Agentic AI prompt — clipboard API with textarea fallback
  // (older in-app browsers). Never renders the prompt into the status line.
  const copyAgentPrompt = async () => {
    try {
      await navigator.clipboard.writeText(SHORT_PROMPT)
      setStatus(L('promptCopied'))
      return
    } catch { /* fall through to the textarea fallback */ }
    const ta = document.createElement('textarea')
    ta.value = SHORT_PROMPT
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

  // Round status, from the on-chain data only. The correct answer and the
  // explanation are shown ONLY when the contract has emitted AnswerRevealed
  // for this day — the bank file contains the answer (the AI quizmaster
  // needs it to grade in chat), so the page must never read it for display
  // before the on-chain reveal.
  const roundStatus = !round
    ? 'loading'
    : round.answer !== null && round.answer !== undefined
      ? 'revealed'
      : displayDay < dayIdEpoch
        ? 'waiting'
        : displayDay > dayIdEpoch
          ? 'upcoming'
          : 'open'
  const roundLabel =
    roundStatus === 'revealed' ? L('roundRevealed')
    : roundStatus === 'waiting' ? L('roundWaiting')
    : roundStatus === 'upcoming' ? L('roundUpcoming')
    : roundStatus === 'open' ? L('roundOpen')
    : ''
  const roundNo = `Q${String(displayDay - RUN_START_DAY + 1).padStart(2, '0')}`

  return (
    <div>
      <div className="topbar">
        <header>
          <div className="logo">🔥 SafeStreak</div>
          <div className="header-actions">
            <select className="lang-toggle" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={L('language')}>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </div>
        </header>
      </div>
      <main>
        <div className="warning">{L('warning')}</div>
        {!contractReady && <div className="warning">{L('contractNotDeployed')}</div>}
        {roundFailed && <div className="notice">{L('loadFailed')}</div>}
        {status && <div className="notice"><code>{status}</code></div>}

        <div className="hero-wrap">
          <div className="hero-left">
            <h1>SafeStreak</h1>
            <p className="hero-sub">{L('tagline')}</p>
            <div className="stat-pills">
              <span className="pill">{L('currentRound')}: <strong>&nbsp;{roundNo} · {dateOfDay(displayDay)}</strong></span>
              <span className="pill">{L('playersThisRound')}: <strong>&nbsp;{round ? round.results.length : '—'}</strong></span>
              <span className="pill">{L('totalPlayers')}: <strong>&nbsp;{leaderboard.length}</strong></span>
            </div>
            {roundStatus === 'open' && (
              <p className="countdown-pill">{L('countdown')}: <span className="countdown">{countdown}</span></p>
            )}
            <p className="proof-line">{L('onChainProof')}: {SAFESTREAK_ADDRESS && <><a href={BSCSCAN_ADDRESS + SAFESTREAK_ADDRESS} target="_blank" rel="noopener">SafeStreak</a> · </>}<a href={BSCSCAN_ADDRESS + BADGE_ADDRESS} target="_blank" rel="noopener">Badge</a></p>
          </div>
        </div>

        <div className="card">
          <h2>{L('roundTitle')} — {roundNo}</h2>
          {roundLabel && <p><span className={`round-status status-${roundStatus}`}>{roundLabel}</span></p>}
          {roundStatus === 'open' && (
            <p className="countdown-pill">{L('countdown')}: <span className="countdown">{countdown}</span></p>
          )}
          {!question ? (
            <p className="muted">{L('noChallenge')}</p>
          ) : (
            <>
              <p className="question-text"><strong>{question.question[lang] || question.question.en}</strong></p>
              <div>
                {Object.entries(question.options).map(([k, v]) => {
                  const isCorrect = roundStatus === 'revealed' && round && round.answer === k
                  return (
                    <div key={k} className={'option-static' + (isCorrect ? ' correct' : '')}>
                      <span className="opt-letter">{k}.</span>
                      <span>{v[lang] || v.en}</span>
                      {isCorrect && <span className="result-correct"> ✓ {L('resultCorrect')}</span>}
                    </div>
                  )
                })}
              </div>
              {roundStatus === 'revealed' && round && (
                <>
                  <p style={{ marginTop: 14 }}><strong>{L('correctAnswer')}: {round.answer}</strong></p>
                  {question.explanation && (
                    <p className="muted">{question.explanation[lang] || question.explanation.en}</p>
                  )}
                </>
              )}
              {round && round.exists && round.contentHash && (
                <p className="muted">contentHash: <code>{round.contentHash.slice(0, 18)}…</code></p>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h2>{L('participantsTitle')} — {roundNo}</h2>
          {!round || round.results.length === 0 ? (
            <p className="muted">{L('participantsEmpty')}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>{L('player')}</th><th>{L('answered')}</th><th>{L('result')}</th></tr></thead>
                <tbody>
                  {round.results.map((r, i) => (
                    <tr key={r.address}>
                      <td>{i + 1}</td>
                      <td>{r.handle || r.address.slice(0, 6) + '…' + r.address.slice(-4)}</td>
                      <td>{r.committed ? <span className="ok">✓</span> : '—'}</td>
                      <td>
                        {!r.revealed
                          ? <span className="result-pending">{L('resultPending')}</span>
                          : r.correct
                            ? <span className="result-correct">✓ {L('resultCorrect')}</span>
                            : <span className="result-wrong">✗ {L('resultWrong')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2>{L('leaderboardTitle')}</h2>
          <p className="muted">{L('leaderboardNote')}</p>
          <p className="muted">Final snapshot: {SNAPSHOT}</p>
          {leaderboard.length === 0 ? <p className="muted">{L('noHistory')}</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>{L('player')}</th><th>{L('points')}</th><th>{L('totalCorrect')}</th><th>{L('bestStreak')}</th></tr></thead>
                <tbody>
                  {leaderboard.map((r, i) => (
                    <tr key={r.address}><td>{i < 3 ? <span className={`rank-num rank-${i + 1}`}>{i + 1}</span> : <span className="rank-num">{i + 1}</span>}</td><td>{r.handle || r.address.slice(0, 6) + '…' + r.address.slice(-4)}</td><td>{r.points}</td><td>{r.totalCorrect}</td><td>{r.best}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
          <pre id="agentPrompt" className="prompt-box">{SHORT_PROMPT}</pre>
        </div>
      </main>
      <footer>
        <p>SafeStreak — {L('tagline')} Final snapshot: {SNAPSHOT}. Agent ID: <code>{AGENT_ID_ADDRESS}</code>{VERIFIER_URL && <> · Verifier: <code>{VERIFIER_URL}</code></>}</p>
        <p className="muted">Q01 27/11 · Q02 28/11 · Q03 29/11 · Q04 30/11 · Q05 01/12 · Q06 02/12 · Q07 03/12 · Q08 04/12 · Q09 05/12 · Q10 06/12/2026</p>
      </footer>
    </div>
  )
}

// Circular maturity gauge.
//
// Two phases drive the SAME gauge:
//   • 'loading' — sweeps 0 → 95% over 5 s with an ease-out curve, sub-label
//     rotates through "מתחבר ל-GovMap…", "סורק תכניות…", etc. Holds at 95%
//     if the API hasn't responded yet (rare; usually 2–4 s).
//   • 'done'    — animates from the current sweep value to the actual score,
//     stroke colour switches to the bucket palette, sub-label shows the
//     bucket Hebrew label.
//
// One ring, one transition — no flash, no remount.

import { useEffect, useRef, useState } from 'react'
import type { Bucket } from '../../types'

type Phase = 'loading' | 'done'

interface Props {
  phase: Phase
  score?: number       // 0-100, required when phase === 'done'
  bucket?: Bucket
  size?: number        // px, default 220
  // When mounting a fresh gauge directly in 'done' state, seed the start
  // value so the score animates DOWN from where the loading gauge left
  // off (≈95%) instead of jumping back to 0.
  startPct?: number
}

const LOADING_MS  = 5000
const LOADING_CAP = 100   // sweep completes a full ring; a ✓ marks the end-of-load
const SUB_LABELS  = [
  'מתחבר ל-GovMap…',
  'מאתר גוש וחלקה…',
  'סורק תכניות במינהל התכנון…',
  'בודק מתחמי התחדשות מוכרזים…',
  'מצליב נתוני data.gov.il…',
  'מחשב את הציון…',
]

const BUCKET_COLORS: Record<Bucket, { stroke: string; glow: string; label: string }> = {
  very_high: { stroke: '#0e9f6e', glow: 'rgba(14,159,110,0.35)', label: 'בשלות גבוהה מאוד' },
  high:      { stroke: '#3b6b9c', glow: 'rgba(59,107,156,0.35)', label: 'בשלות גבוהה'      },
  moderate:  { stroke: '#5a8db8', glow: 'rgba(90,141,184,0.35)', label: 'בשלות חלקית'      },
  low:       { stroke: '#c4841d', glow: 'rgba(196,132,29,0.35)', label: 'בשלות נמוכה'      },
  very_low:  { stroke: '#8e8e9e', glow: 'rgba(142,142,158,0.30)', label: 'בשלות נמוכה מאוד' },
}

const LOADING_STROKE = '#8b6f47'  // gold
const LOADING_GLOW   = 'rgba(139,111,71,0.4)'

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function MaturityGauge({ phase, score, bucket, size = 220, startPct }: Props) {
  const initial = phase === 'done' && startPct != null ? startPct : 0
  const [pct, setPct] = useState(initial)
  const [subIdx, setSubIdx] = useState(0)
  const rafRef = useRef<number | null>(null)
  // We need the latest sweep value when phase flips to 'done' so the next
  // animation continues from where loading left off (not from 0).
  const pctRef = useRef(initial)

  // ── Loading sweep ──
  useEffect(() => {
    if (phase !== 'loading') return
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / LOADING_MS)
      const v = LOADING_CAP * easeOutCubic(t)
      pctRef.current = v
      setPct(v)
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)

    // Rotate the sub-label every ~LOADING_MS / SUB_LABELS.length so all phrases
    // are seen at least once during the 5 s loader.
    const interval = window.setInterval(() => {
      setSubIdx(i => (i + 1) % SUB_LABELS.length)
    }, Math.round(LOADING_MS / SUB_LABELS.length))

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.clearInterval(interval)
    }
  }, [phase])

  // ── Settle to the real score ──
  useEffect(() => {
    if (phase !== 'done' || score == null) return
    const start = performance.now()
    const from = pctRef.current
    const to = Math.max(0, Math.min(100, score))
    const duration = 1200
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const v = from + (to - from) * easeOutCubic(t)
      pctRef.current = v
      setPct(v)
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [phase, score])

  // ── Geometry ──
  const STROKE = 14
  const R = (size - STROKE) / 2
  const C = 2 * Math.PI * R
  const offset = C * (1 - pct / 100)

  const palette = phase === 'done' && bucket
    ? BUCKET_COLORS[bucket]
    : { stroke: LOADING_STROKE, glow: LOADING_GLOW, label: SUB_LABELS[subIdx] }

  // End-of-load marker: when the sweep crosses ~99%, swap the percentage
  // readout for a green checkmark. Keeps the "we finished checking sources"
  // beat visible to the user before the score animation kicks in.
  const showCheck = phase === 'loading' && pct >= 99

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <div
        className="relative"
        style={{ width: size, height: size, filter: `drop-shadow(0 0 18px ${palette.glow})` }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            fill="none"
            stroke="#eeeeee"
            strokeWidth={STROKE}
          />
          {/* Progress */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            fill="none"
            stroke={showCheck ? '#0e9f6e' : palette.stroke}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke 0.6s ease' }}
          />
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ pointerEvents: 'none' }}
        >
          {showCheck ? (
            <svg
              width={size * 0.38}
              height={size * 0.38}
              viewBox="0 0 24 24"
              fill="none"
              style={{ animation: 'gauge-pop 0.5s cubic-bezier(0.2,0.7,0.2,1.2) both' }}
              aria-hidden
            >
              <path
                d="M5 12l5 5 9-10"
                stroke="#0e9f6e"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <div
              className="tabular-nums font-extrabold"
              style={{
                fontSize: size * 0.32,
                lineHeight: 1,
                color: phase === 'done' ? palette.stroke : '#1e3a5f',
                letterSpacing: '-0.02em',
              }}
            >
              {Math.round(pct)}
              {phase === 'done'
                ? <span style={{ fontSize: size * 0.13, fontWeight: 500, color: '#8e8e9e' }}>/100</span>
                : <span style={{ fontSize: size * 0.13, color: '#8e8e9e' }}>%</span>}
            </div>
          )}
        </div>
        {/* Local keyframes for the checkmark pop. */}
        <style>{`@keyframes gauge-pop { 0%{transform:scale(0.4);opacity:0} 60%{transform:scale(1.15);opacity:1} 100%{transform:scale(1)} }`}</style>
      </div>
      {/* Sub-label visible during loading only — it carries the "currently
          fetching X…" rotation. Once done, the score number itself is the
          headline, so no label clutters the bottom. */}
      {phase === 'loading' && !showCheck && (
        <div className="mt-4 text-center" style={{ minHeight: 22 }}>
          <div className="text-[13px] font-bold" style={{ color: '#8b6f47' }}>
            {SUB_LABELS[subIdx]}
          </div>
        </div>
      )}
    </div>
  )
}

export default MaturityGauge

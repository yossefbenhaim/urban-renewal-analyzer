// Pure scoring helpers — no I/O. The orchestrator passes in the flattened
// signal list from every source and gets back a 0..100 score + bucket.

import type { Bucket, Signal } from '../types.js'

const BASELINE = 50
const MAX = 100
const MIN = 0

export function computeScore(signals: Signal[]): number {
  let s = BASELINE
  for (const sig of signals) s += sig.weight
  if (s < MIN) return MIN
  if (s > MAX) return MAX
  return Math.round(s)
}

export function bucketize(score: number): Bucket {
  if (score >= 85) return 'very_high'
  if (score >= 70) return 'high'
  if (score >= 50) return 'moderate'
  if (score >= 30) return 'low'
  return 'very_low'
}

// Sort signals so the highest-magnitude ones surface first in the report.
export function rankSignals(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => {
    const diff = Math.abs(b.weight) - Math.abs(a.weight)
    if (diff !== 0) return diff
    // Tiebreak: positives before negatives (they read as "good news first").
    if (a.kind === b.kind) return 0
    return a.kind === 'positive' ? -1 : 1
  })
}

// Cross-validation step. Runs AFTER all six adapters have returned.
//
// Sends the flattened signal list + resolved address to Claude with a
// frozen schema, asks it to mark each signal as confirmed / contradicted
// / unverified, and computes an overall data-quality `confidence`
// number (0-100).
//
// The verdict is INFORMATIONAL ONLY — it does not change the rubric
// score. The UI uses it to render badges and a footer; the determinism
// of the score itself is unaffected.

import { extractJson, llmModelInUse } from '../lib/anthropic.js'
import type { ResolvedAddress, Signal, ValidationStatus, ValidationSummary } from '../types.js'

const CACHE_VERSION = 1

interface ValidationLlmOutput {
  per_signal: Array<{
    title: string                     // must match an input signal's title verbatim
    status: ValidationStatus
    reason: string                    // 1-line Hebrew justification
  }>
  overall_notes: string[]             // 1-3 short Hebrew bullets
}

const SYSTEM_PROMPT = `אתה כלי בקרת איכות לכלי ניתוח התחדשות עירונית בישראל. תפקידך: לבדוק אם הסיגנלים שנאספו ממקורות שונים (govmap, mavat, data.gov.il, אתר עירייה) עקביים זה עם זה.

עבור כל סיגנל החזר אחד מ:
  "confirmed"     - לפחות מקור נוסף תומך בו (לדוגמה: govmap אומר "מתחם מוכרז" + data.gov.il מציג את אותו מתחם בעיר).
  "contradicted"  - מקור אחר אומר ההפך (לדוגמה: govmap אומר "אין מתחם" אבל אתר העירייה כן מתאר מתחם בכתובת).
  "unverified"    - אין מקור נוסף שאפשר להצליב מולו.

החזר JSON גולמי בדיוק כך, ללא code fences:
{
  "per_signal": [
    { "title": "<העתק מילולי של title>", "status": "confirmed|contradicted|unverified", "reason": "<עד 15 מילים בעברית>" }
  ],
  "overall_notes": [ "<1-3 בולטים קצרים בעברית על איכות הנתונים>" ]
}

כללים:
- אל תכניס שדה title שלא הופיע בקלט.
- per_signal חייב לכלול שורה אחת לכל סיגנל בקלט - לא יותר, לא פחות.
- היה שמרני: אם אין באמת מקור נוסף שתומך/סותר → unverified.
- אם הקלט סותר את עצמו בבירור → contradicted, גם אם זה רק שני מקורות.`

function buildUserPrompt(address: ResolvedAddress, signals: Signal[]): string {
  const lines = signals.map((s, i) => {
    const parts = [
      `[${i + 1}] title: ${s.title}`,
      `    source: ${s.source}`,
      `    kind: ${s.kind}`,
      `    description: ${s.description.slice(0, 200)}`,
    ]
    if (s.category) parts.push(`    category: ${s.category}`)
    return parts.join('\n')
  })
  return [
    `כתובת: ${address.formatted}`,
    `עיר: ${address.city} · רחוב: ${address.street} · מספר: ${address.number}`,
    address.gush ? `גוש ${address.gush} חלקה ${address.chelka ?? '?'}` : '',
    '',
    `סיגנלים שנאספו (${signals.length}):`,
    ...lines,
  ]
    .filter(Boolean)
    .join('\n')
}

function summarize(
  signals: Signal[],
  perSignal: Map<string, ValidationStatus>,
): { confirmed: number; contradicted: number; unverified: number; confidence: number } {
  let confirmed = 0,
    contradicted = 0,
    unverified = 0
  for (const s of signals) {
    const v = perSignal.get(s.title) ?? 'unverified'
    if (v === 'confirmed') confirmed++
    else if (v === 'contradicted') contradicted++
    else unverified++
  }
  const total = confirmed + contradicted + unverified
  // Confidence rewards confirmations, penalizes contradictions, treats
  // unverified as neutral. Bounded to [0, 100].
  const raw = total === 0 ? 50 : (confirmed * 100 - contradicted * 150) / total + 50
  const confidence = Math.max(0, Math.min(100, Math.round(raw)))
  return { confirmed, contradicted, unverified, confidence }
}

export async function crossValidate(
  address: ResolvedAddress,
  signals: Signal[],
): Promise<{ summary: ValidationSummary | null; annotated: Signal[] }> {
  // Skip cleanly if there's nothing to cross-check or only one source.
  const distinctSources = new Set(signals.map(s => s.source))
  if (signals.length < 2 || distinctSources.size < 2) {
    return { summary: null, annotated: signals }
  }

  const { value, cached, model } = await extractJson<ValidationLlmOutput>({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(address, signals),
    cacheNamespace: 'validation',
    cacheVersion: CACHE_VERSION,
    maxTokens: 1500,
  })

  if (!value || !Array.isArray(value.per_signal)) {
    return { summary: null, annotated: signals }
  }

  // Build a title → status map (LLM was told to echo the exact title).
  const perSignal = new Map<string, ValidationStatus>()
  for (const row of value.per_signal) {
    if (typeof row?.title !== 'string') continue
    const s = row.status
    if (s === 'confirmed' || s === 'contradicted' || s === 'unverified') {
      perSignal.set(row.title, s)
    }
  }

  const annotated: Signal[] = signals.map(s => ({
    ...s,
    validation: perSignal.get(s.title) ?? 'unverified',
  }))

  const counts = summarize(signals, perSignal)
  const notes = Array.isArray(value.overall_notes)
    ? value.overall_notes.filter(n => typeof n === 'string').slice(0, 3)
    : []

  const summary: ValidationSummary = {
    confidence: counts.confidence,
    confirmed_count: counts.confirmed,
    contradicted_count: counts.contradicted,
    unverified_count: counts.unverified,
    notes,
    model: model || llmModelInUse(),
    cached,
  }
  return { summary, annotated }
}

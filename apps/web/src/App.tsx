// Public landing page for feasibility.byclick.co.il.
// One screen, one job: enter address → get the Hebrew report.

import { useState } from 'react'
import {
  Building2, Sparkles, ArrowLeft, Loader2, Check, AlertTriangle, X,
  ShieldCheck, MapPin, Crown, Clock, Star, Wand2, ExternalLink,
} from 'lucide-react'
import { AddressPicker } from './features/address/AddressPicker'
import { MaturityGauge } from './features/report/MaturityGauge'
import type {
  Bucket, Category, EvaluateResponse, SourceContribution, SourceResult, Track,
} from './types'

// The maturity gauge sweeps 0 → 95% over this duration before settling on
// the real score. We hold the response in `pendingReport` until the floor
// has elapsed, so the user always sees the gauge animation.
const MIN_LOADING_MS = 5000

export function App() {
  const [addr, setAddr] = useState({ city: '', street: '', building_number: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<EvaluateResponse | null>(null)

  async function onEvaluate(e: React.FormEvent) {
    e.preventDefault()
    if (!addr.city || !addr.street || !addr.building_number) return
    setBusy(true)
    setError(null)
    setReport(null)
    const startedAt = Date.now()
    // Wait at least MIN_LOADING_MS before revealing the result — the gauge
    // animation needs time to play. Promise.all lets the API race the floor.
    const floor = new Promise<void>(r => setTimeout(r, MIN_LOADING_MS))
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(addr),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error ?? `שגיאת שרת (${res.status})`)
      }
      const data = (await res.json()) as EvaluateResponse
      const elapsed = Date.now() - startedAt
      if (elapsed < MIN_LOADING_MS) await floor
      setReport(data)
    } catch (err: any) {
      const elapsed = Date.now() - startedAt
      if (elapsed < MIN_LOADING_MS) await floor
      setError(err?.message ?? 'שגיאה לא צפויה')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 px-4 sm:px-6 py-4 sm:py-6 max-w-[1100px] w-full mx-auto">
        <Hero />
        <form onSubmit={onEvaluate} className="mt-4 bg-white rounded-sc-card border border-sc-border shadow-sm p-3 sm:p-4">
          <AddressPicker value={addr} onChange={setAddr} disabled={busy} />
          <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              type="submit"
              disabled={busy || !addr.city || !addr.street || !addr.building_number}
              className="inline-flex items-center justify-center gap-2 bg-sc-primary text-white font-extrabold text-[14px] px-5 py-2.5 rounded-sc-btn shadow-[0_2px_8px_rgba(59,107,156,0.2)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <><Loader2 size={16} className="animate-spin" /> בודקים את הכתובת…</> : <><Wand2 size={16} /> הערך עכשיו</>}
            </button>
            <p className="text-[12px] text-sc-text-muted">
              בחינם, ללא הרשמה. מבוסס על מקורות ציבוריים בלבד.
            </p>
          </div>
          {error && (
            <div className="mt-4 bg-sc-danger/10 text-sc-danger border border-sc-danger/30 rounded-sc-input px-4 py-3 text-[13px]">
              {error}
            </div>
          )}
        </form>
        {(busy || report) && (
          <ResultSection busy={busy} report={report} />
        )}
        {!report && !busy && <Marketing />}
      </main>
      <Footer />
    </div>
  )
}

// ─── Layout ──────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="bg-gradient-to-l from-sc-navy to-sc-primary text-white shadow-sm">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-sc-input bg-white/20 grid place-items-center">
          <Building2 size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold leading-tight">Pre-Feasibility AI</div>
          <div className="text-[10.5px] opacity-85">הערכת היתכנות פינוי-בינוי לפי כתובת</div>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="text-center sm:text-start">
      <div className="inline-flex items-center gap-1.5 bg-sc-light-blue text-sc-primary text-[11px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-sc-pill mb-2">
        <Sparkles size={12} /> חינמי
      </div>
      <h1 className="text-[22px] sm:text-[28px] font-extrabold text-sc-text leading-tight mb-1.5">
        האם הבניין שלך מתאים לפינוי-בינוי?
      </h1>
      <p className="text-[13px] sm:text-[14px] text-sc-text-secondary max-w-[640px] leading-snug">
        הזן כתובת ונחזיר לך הערכה ראשונית מבוססת נתונים פתוחים — תכניות,
        מתחמים מוכרזים וזכויות בנייה — מתורגמים לסיכוי, מסלול ולוח זמנים.
      </p>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mt-6 border-t border-sc-border bg-white">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-3 text-[10.5px] text-sc-text-muted leading-snug">
        מבוסס על 4 מקורות ציבוריים — GovMap (גוש/חלקה + מתחמי התחדשות מוכרזים),
        מינהל התכנון (MAVAT), שכבת שימושי קרקע במבא"ת, ו-data.gov.il.
        אינו מהווה חוות דעת אדריכלית, משפטית או שמאית רשמית.
      </div>
    </footer>
  )
}

// ─── Marketing strip shown before a query is run ─────────────────────

function Marketing() {
  const cards = [
    { icon: <ShieldCheck size={16} />,  title: 'מבוסס נתונים בלבד', body: 'אין ניחושים. כל איתות מקורו במקור ציבורי מאומת — עם קישור לראות את הנתון המקורי.' },
    { icon: <Building2 size={16} />,    title: '4 מקורות · 6 שכבות מידע', body: 'GovMap, מינהל התכנון, שימושי קרקע במבא"ת, ו-data.gov.il — מצליבים במקביל לתמונה אחת ברורה.' },
  ]
  return (
    <section className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {cards.map(c => (
        <div key={c.title} className="bg-white border border-sc-border rounded-sc-card p-3">
          <div className="w-8 h-8 rounded-sc-input bg-sc-light-blue text-sc-primary grid place-items-center mb-1.5">
            {c.icon}
          </div>
          <div className="text-[13px] font-extrabold text-sc-text mb-1 leading-tight">{c.title}</div>
          <div className="text-[11.5px] text-sc-text-secondary leading-snug">{c.body}</div>
        </div>
      ))}
    </section>
  )
}

// ─── Result section — covers both the loading phase and the final report ───
//
// The MaturityGauge stays mounted across the busy→done transition, so its
// internal sweep value continues from where loading left off (≈95%) and
// then animates smoothly down to the real score.

function ResultSection({ busy, report }: { busy: boolean; report: EvaluateResponse | null }) {
  if (busy && !report) {
    return (
      <div className="mt-8 flex flex-col items-center justify-center py-10 sm:py-16 bg-white rounded-sc-card border border-sc-border shadow-sm">
        <div className="text-[11px] font-bold uppercase tracking-wider text-sc-text-muted mb-4">
          בודקים את הכתובת
        </div>
        <MaturityGauge phase="loading" size={240} />
        <div className="mt-5 text-[12px] text-sc-text-muted text-center max-w-[380px] leading-relaxed px-4">
          מצליבים 4 מקורות פתוחים (GovMap, MAVAT, שימושי קרקע, data.gov.il)
          על פני 6 שכבות מידע — התהליך לוקח כ-5 שניות.
        </div>
      </div>
    )
  }
  if (!report) return null
  return (
    <div className="mt-6 space-y-4">
      <ScoreHero data={report} />
      <AddressFacts data={report} />
      <CategoriesList categories={report.categories} />
      <SourceBreakdown contributions={report.source_contributions} />
      <RecommendationCard data={report} />
      <SourcesFooter sources={report.sources_used} disclaimer={report.disclaimer} />
    </div>
  )
}

function ScoreHero({ data }: { data: EvaluateResponse }) {
  const cls = bucketStyles(data.bucket)
  return (
    <div className={`rounded-sc-card overflow-hidden border ${cls.border} bg-white shadow-sm`}>
      <div className={`px-5 py-6 sm:py-7 ${cls.bg} text-white relative overflow-hidden`}>
        {/* Subtle radial glow behind the gauge for depth */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(35% 70% at 50% 50%, rgba(255,255,255,0.12) 0%, transparent 70%)' }}
        />
        <div className="relative flex flex-col sm:flex-row items-center gap-5 sm:gap-7">
          <div className="bg-white/95 rounded-full p-3 shadow-lg shrink-0">
            <MaturityGauge phase="done" score={data.score} bucket={data.bucket} size={190} startPct={100} />
          </div>
          <div className="flex-1 min-w-0 text-center sm:text-start">
            <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider opacity-85 mb-1">
              תוצאת ההערכה
            </div>
            <div className="text-[20px] sm:text-[24px] font-extrabold leading-tight mb-2">
              {data.summary_he}
            </div>
            <div className="text-[12px] opacity-90 inline-flex items-center gap-1.5 flex-wrap justify-center sm:justify-start">
              <MapPin size={12} /> {data.address.formatted}
              {data.address.gush != null && data.address.chelka != null && (
                <span className="opacity-80">· גוש {data.address.gush} חלקה {data.address.chelka}</span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 bg-white">
        <Stat label="לוח זמנים" value={data.expected_time_years.max > 0 ? `${data.expected_time_years.min}-${data.expected_time_years.max} שנים` : '—'} />
        <Stat label="מסלול" value={trackLabel(data.recommended_track)} />
      </div>
    </div>
  )
}

function AddressFacts({ data }: { data: EvaluateResponse }) {
  const facts = [
    data.address.lot_sqm != null && { label: 'שטח מגרש', value: `${data.address.lot_sqm} מ"ר` },
    data.address.gush    != null && { label: 'גוש',       value: String(data.address.gush) },
    data.address.chelka  != null && { label: 'חלקה',      value: String(data.address.chelka) },
    { label: 'יחיד מספיק?', value: data.single_building_feasible ? 'כן' : 'נדרש מתחם' },
  ].filter(Boolean) as Array<{ label: string; value: string }>
  return (
    <div className="bg-white rounded-sc-card border border-sc-border p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-sc-text-muted mb-2">פרטי הנכס</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {facts.map(f => (
          <div key={f.label} className="text-[12px]">
            <div className="text-sc-text-muted">{f.label}</div>
            <div className="font-extrabold text-sc-text text-[14px]">{f.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CategoriesList({ categories }: { categories: Category[] }) {
  if (!categories || categories.length === 0) return null
  return (
    <div className="bg-white rounded-sc-card border border-sc-border p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-sc-text-muted mb-3">
        📊 מה בדקנו ומה נמצא
      </div>
      <ul className="m-0 p-0 space-y-3">
        {categories.map(c => <CategoryRow key={c.key} c={c} />)}
      </ul>
    </div>
  )
}
function CategoryRow({ c }: { c: Category }) {
  return (
    <li className="list-none flex items-start gap-2.5">
      <span className="mt-0.5 w-5 text-[16px] leading-none flex-shrink-0">{c.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-extrabold text-sc-text text-[13px]">{c.title}</div>
          {c.found && c.weight_pct > 0 && (
            <span
              className={
                'text-[10px] font-bold px-1.5 py-0.5 rounded-sc-pill ' +
                (c.weight_contribution > 0
                  ? 'bg-sc-success/15 text-sc-success'
                  : c.weight_contribution < 0
                    ? 'bg-sc-warning/15 text-sc-warning'
                    : 'bg-sc-text-muted/15 text-sc-text-muted')
              }
            >
              {c.weight_contribution > 0 ? '+' : ''}{c.weight_contribution} · {c.weight_pct}% מהציון
            </span>
          )}
        </div>
        <div className="text-[12px] font-semibold text-sc-text leading-relaxed mt-0.5">
          {c.summary}
        </div>
        <div className="text-[11px] text-sc-text-secondary leading-relaxed mt-0.5">
          {c.impact}
        </div>
        {c.detail && (
          <div className="mt-1.5 text-[11px] text-sc-text leading-relaxed bg-sc-bg/60 border border-sc-border rounded-sc-input px-2.5 py-1.5">
            {c.detail}
          </div>
        )}
        <div className="text-[10px] text-sc-text-muted mt-1 inline-flex items-center gap-1.5 flex-wrap">
          <span>מקור: {sourceLabel(c.source)}</span>
          {c.url && (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sc-primary font-semibold hover:underline"
            >
              <ExternalLink size={10} /> צפה במקור
            </a>
          )}
        </div>
      </div>
    </li>
  )
}

function SourceBreakdown({ contributions }: { contributions: SourceContribution[] }) {
  if (!contributions || contributions.length === 0) return null
  return (
    <div className="bg-white rounded-sc-card border border-sc-border p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-sc-text-muted mb-3">
        🧮 משקל כל מקור בציון
      </div>
      <ul className="m-0 p-0 space-y-2.5">
        {contributions.map(s => {
          const neutral = s.total_weight === 0
          const badgeCls = s.failed
            ? 'bg-sc-danger/15 text-sc-danger'
            : 'bg-sc-text-muted/15 text-sc-text-muted'
          const badgeText = s.failed ? 'לא הגיב' : 'ללא תרומה לציון'
          return (
            <li key={s.name} className="list-none">
              <div className="flex items-center justify-between text-[12px] mb-1 gap-2">
                <span className="font-extrabold text-sc-text inline-flex items-center gap-1.5">
                  {sourceLabel(s.name)}
                  {neutral && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-sc-pill ${badgeCls}`}>
                      {badgeText}
                    </span>
                  )}
                </span>
                <span className="text-sc-text-muted tabular-nums">
                  {neutral
                    ? (s.failed ? <>שגיאה / טיים-אאוט</> : <>נבדקו {s.signals_count} נקודות</>)
                    : <>{s.pct_of_total}% · {s.positive_weight > 0 ? '+' : ''}{s.positive_weight}{s.negative_weight > 0 ? <> / −{s.negative_weight}</> : null}</>}
                </span>
              </div>
              {neutral ? (
                s.note && (
                  <div className={
                    'text-[11px] leading-relaxed rounded-sc-input px-2.5 py-1.5 border ' +
                    (s.failed
                      ? 'text-sc-danger bg-sc-danger/5 border-sc-danger/30'
                      : 'text-sc-text-muted bg-sc-bg border-sc-border')
                  }>
                    {s.note}
                  </div>
                )
              ) : (
                <div className="h-1.5 rounded-sc-pill bg-sc-light-blue overflow-hidden flex">
                  <div
                    className="h-full bg-sc-success"
                    style={{ width: `${(s.positive_weight / Math.max(1, s.total_weight)) * s.pct_of_total}%` }}
                  />
                  <div
                    className="h-full bg-sc-warning"
                    style={{ width: `${(s.negative_weight / Math.max(1, s.total_weight)) * s.pct_of_total}%` }}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function RecommendationCard({ data }: { data: EvaluateResponse }) {
  return (
    <div className="bg-gradient-to-l from-sc-gold/15 to-sc-gold/5 rounded-sc-card border border-sc-gold/40 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Star size={14} className="text-sc-gold" />
        <div className="text-[11px] font-bold uppercase tracking-wider text-sc-gold">ההמלצה שלנו</div>
      </div>
      <div className="text-[15px] font-extrabold text-sc-text mb-1">
        {trackHeadline(data.recommended_track)}
      </div>
      <div className="text-[12px] text-sc-text-secondary mb-3 inline-flex items-center gap-1.5">
        <Clock size={11} /> לוח זמנים צפוי: {data.expected_time_years.max > 0 ? `${data.expected_time_years.min}-${data.expected_time_years.max} שנים` : '—'}
      </div>
      <ol className="m-0 ps-5 space-y-1">
        {data.recommendations.map((r, i) => (
          <li key={i} className="text-[13px] text-sc-text">
            <span className="font-bold">{i + 1}.</span> {r}
          </li>
        ))}
      </ol>
    </div>
  )
}

function SourcesFooter({ sources, disclaimer }: { sources: SourceResult[]; disclaimer: string }) {
  return (
    <div className="bg-white rounded-sc-card border border-sc-border p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-sc-text-muted mb-2">
        מקורות שנבדקו
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {sources.map(s => (
          <span
            key={s.name}
            className={
              'inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-sc-pill ' +
              (s.status === 'success'
                ? 'bg-sc-success/15 text-sc-success'
                : s.status === 'partial'
                  ? 'bg-sc-warning/15 text-sc-warning'
                  : 'bg-sc-danger/10 text-sc-danger')
            }
          >
            {s.status === 'success' ? <Check size={11} /> : s.status === 'partial' ? <AlertTriangle size={11} /> : <X size={11} />}
            {sourceLabel(s.name)} · {s.duration_ms} ms
          </span>
        ))}
      </div>
      <div className="text-[11px] text-sc-text-muted leading-relaxed">{disclaimer}</div>
    </div>
  )
}

// ─── Tiny helpers ────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={'text-center rounded-sc-input p-2 ' + (accent ? 'bg-sc-light-blue' : 'bg-sc-bg')}>
      <div className="text-[10px] text-sc-text-muted">{label}</div>
      <div className={'text-[14px] font-extrabold ' + (accent ? 'text-sc-primary' : 'text-sc-text')}>{value}</div>
    </div>
  )
}

function trackLabel(t: Track): string {
  switch (t) {
    case 'tama_38':              return 'תמ"א 38'
    case 'pinui_binui_single':   return 'פינוי-בינוי (בניין יחיד)'
    case 'pinui_binui_complex':  return 'פינוי-בינוי במתחם'
    case 'unlikely':             return 'לא סביר כרגע'
  }
}
function trackHeadline(t: Track): string {
  switch (t) {
    case 'tama_38':              return 'תמ"א 38 — חיזוק וצירוף מ"ר ללא הריסה מלאה'
    case 'pinui_binui_single':   return 'פינוי-בינוי בבניין יחיד — הריסה ובנייה מחדש של הבניין שלך בלבד'
    case 'pinui_binui_complex':  return 'פינוי-בינוי במתחם — חיבור עם בניינים שכנים לפרויקט כלכלי'
    case 'unlikely':             return 'אין כרגע מסלול מתאים — שווה לעקוב בעוד שנה'
  }
}
function sourceLabel(s: string): string {
  switch (s) {
    case 'govmap':         return 'GovMap'
    case 'mavat':          return 'מינהל התכנון (MAVAT)'
    case 'mavat.landuse':  return 'מבא"ת — שימושי קרקע'
    case 'data.gov.il':    return 'data.gov.il'
    default:               return s
  }
}
function bucketStyles(b: Bucket): { bg: string; border: string } {
  switch (b) {
    case 'very_high': return { bg: 'bg-gradient-to-l from-emerald-700 to-emerald-600', border: 'border-emerald-200' }
    case 'high':      return { bg: 'bg-gradient-to-l from-sc-navy to-sc-primary',       border: 'border-sc-border' }
    case 'moderate':  return { bg: 'bg-gradient-to-l from-sc-primary to-blue-400',      border: 'border-sc-border' }
    case 'low':       return { bg: 'bg-gradient-to-l from-amber-700 to-amber-600',      border: 'border-amber-200' }
    case 'very_low':  return { bg: 'bg-gradient-to-l from-stone-700 to-stone-600',      border: 'border-stone-200' }
  }
}

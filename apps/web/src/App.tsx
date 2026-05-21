// Public landing page for feasibility.byclick.co.il.
// One screen, one job: enter address → get the Hebrew report.

import { useState } from 'react'
import {
  Building2, Sparkles, ArrowLeft, Loader2, Check, AlertTriangle, X,
  ShieldCheck, MapPin, Crown, Clock, Star, Wand2,
} from 'lucide-react'
import { AddressPicker } from './features/address/AddressPicker'
import type {
  Bucket, Category, EvaluateResponse, SourceContribution, SourceResult, Track,
} from './types'

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
      setReport(data)
    } catch (err: any) {
      setError(err?.message ?? 'שגיאה לא צפויה')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 px-4 sm:px-6 py-6 sm:py-10 max-w-[1100px] w-full mx-auto">
        <Hero />
        <form onSubmit={onEvaluate} className="mt-6 bg-white rounded-sc-card border border-sc-border shadow-sm p-4 sm:p-5">
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
        {report && (
          <div className="mt-6">
            <Report data={report} />
          </div>
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
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-sc-input bg-white/20 grid place-items-center">
          <Building2 size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-[16px] font-extrabold leading-tight">Pre-Feasibility AI</div>
          <div className="text-[11px] opacity-85">הערכת היתכנות פינוי-בינוי לפי כתובת</div>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="text-center sm:text-start">
      <div className="inline-flex items-center gap-1.5 bg-sc-light-blue text-sc-primary text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-sc-pill mb-3">
        <Sparkles size={12} /> חינמי
      </div>
      <h1 className="text-[24px] sm:text-[34px] font-extrabold text-sc-text leading-tight mb-2">
        האם הבניין שלך מתאים לפינוי-בינוי?
      </h1>
      <p className="text-[14px] sm:text-[15px] text-sc-text-secondary max-w-[640px] leading-relaxed">
        הזן כתובת ונחזיר לך הערכה ראשונית מבוססת נתונים פתוחים — תכניות בניין-עיר,
        מתחמי התחדשות מוכרזים, וזכויות בנייה — מתורגמים לסיכוי, מסלול מומלץ
        ולוח זמנים צפוי.
      </p>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mt-12 border-t border-sc-border bg-white">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 text-[11px] text-sc-text-muted">
        מבוסס על נתוני GovMap, מינהל התכנון (MAVAT), ו-data.gov.il.
        אינו מהווה חוות דעת אדריכלית, משפטית או שמאית רשמית.
      </div>
    </footer>
  )
}

// ─── Marketing strip shown before a query is run ─────────────────────

function Marketing() {
  const cards = [
    { icon: <ShieldCheck size={18} />,  title: 'מבוסס נתונים בלבד', body: 'אין ניחושים. כל איתות מקורו במקור ציבורי מאומת.' },
    { icon: <Building2 size={18} />,    title: 'תוצאה תוך 5 שניות', body: 'אנחנו מצליבים 3 מקורות במקביל ומחזירים תמונה ברורה.' },
    { icon: <Crown size={18} />,        title: 'תאמת מול אנשי מקצוע', body: 'הכלי הוא Pre-Feasibility — בשלב מאוחר יותר אדריכל ושמאי יאמתו.' },
  ]
  return (
    <section className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3">
      {cards.map(c => (
        <div key={c.title} className="bg-white border border-sc-border rounded-sc-card p-4">
          <div className="w-9 h-9 rounded-sc-input bg-sc-light-blue text-sc-primary grid place-items-center mb-2">
            {c.icon}
          </div>
          <div className="text-[14px] font-extrabold text-sc-text mb-1">{c.title}</div>
          <div className="text-[12px] text-sc-text-secondary leading-relaxed">{c.body}</div>
        </div>
      ))}
    </section>
  )
}

// ─── Report renderer ─────────────────────────────────────────────────

function Report({ data }: { data: EvaluateResponse }) {
  return (
    <div className="space-y-4">
      <ScoreBanner data={data} />
      <AddressFacts data={data} />
      <CategoriesList categories={data.categories} />
      <SourceBreakdown contributions={data.source_contributions} />
      <RecommendationCard data={data} />
      <SourcesFooter sources={data.sources_used} disclaimer={data.disclaimer} />
    </div>
  )
}

function ScoreBanner({ data }: { data: EvaluateResponse }) {
  const cls = bucketStyles(data.bucket)
  return (
    <div className={`rounded-sc-card overflow-hidden border ${cls.border} bg-white shadow-sm`}>
      <div className={`px-5 py-5 ${cls.bg} text-white`}>
        <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider opacity-85 mb-1">
          תוצאת ההערכה
        </div>
        <div className="text-[20px] sm:text-[24px] font-extrabold leading-tight mb-1">
          {data.summary_he}
        </div>
        <div className="text-[12px] opacity-90 inline-flex items-center gap-1.5">
          <MapPin size={12} /> {data.address.formatted}
          {data.address.gush != null && data.address.chelka != null && (
            <span className="opacity-80">· גוש {data.address.gush} חלקה {data.address.chelka}</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3 bg-white">
        <Stat label="ציון" value={`${data.score}/100`} accent />
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
        <div className="text-[10px] text-sc-text-muted mt-1">מקור: {sourceLabel(c.source)}</div>
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
      <ul className="m-0 p-0 space-y-2">
        {contributions.map(s => (
          <li key={s.name} className="list-none">
            <div className="flex items-center justify-between text-[12px] mb-1">
              <span className="font-extrabold text-sc-text">{sourceLabel(s.name)}</span>
              <span className="text-sc-text-muted tabular-nums">
                {s.pct_of_total}% · {s.positive_weight > 0 ? '+' : ''}{s.positive_weight}
                {s.negative_weight > 0 ? <> / −{s.negative_weight}</> : null}
              </span>
            </div>
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
          </li>
        ))}
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
    case 'govmap':       return 'GovMap'
    case 'mavat':        return 'מינהל התכנון (MAVAT)'
    case 'data.gov.il':  return 'data.gov.il'
    default:             return s
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

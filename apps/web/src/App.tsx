// Public landing page for feasibility.byclick.co.il.
// One screen, one job: enter address → get the Hebrew report.

import { useEffect, useState } from 'react'
import {
  Building2, Sparkles, ArrowLeft, Loader2, Check, AlertTriangle, X,
  ShieldCheck, MapPin, Crown, Clock, Star, Wand2, ExternalLink,
  Download, Plus,
} from 'lucide-react'
import { AddressPicker } from './features/address/AddressPicker'
import { MaturityGauge } from './features/report/MaturityGauge'
import { LeadGate, readStoredLead, type LeadInfo } from './features/lead/LeadGate'
import type {
  Bucket, Category, CommercialLevel, EvaluateResponse, SourceContribution, SourceResult, Track,
} from './types'

// The maturity gauge sweeps 0 → 95% over this duration before settling on
// the real score. We hold the response in `pendingReport` until the floor
// has elapsed, so the user always sees the gauge animation.
const MIN_LOADING_MS = 5000

export function App() {
  const [addr, setAddr] = useState({ city: '', street: '', building_number: '' })
  const [apartmentsCount, setApartmentsCount] = useState<string>('')
  const [yearBuilt, setYearBuilt] = useState<string>('')
  const [commercial, setCommercial] = useState<CommercialLevel | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<EvaluateResponse | null>(null)
  // Lead-gate state — `null` until we've checked localStorage on mount.
  // After that: a LeadInfo means the user has accepted; `null` still means
  // they haven't (in which case LeadGate is rendered as a blocker).
  const [lead, setLead] = useState<LeadInfo | null>(null)
  const [leadChecked, setLeadChecked] = useState(false)

  useEffect(() => {
    setLead(readStoredLead())
    setLeadChecked(true)
  }, [])

  // Prefill from URL query. Three cases when arriving from Asset Rise:
  //   1. Full address (?city=X&street=Y&number=Z) — auto-submit so the
  //      loader starts immediately; LeadGate (if not accepted) layers on top.
  //   2. Partial — city+street only — prefill both, focus number input.
  //   3. Partial — city only — prefill city, focus street input.
  // Partial cases never auto-submit; the user needs to type the missing bit.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const city   = params.get('city')?.trim()   ?? ''
    const street = params.get('street')?.trim() ?? ''
    const number = params.get('number')?.trim() ?? ''
    if (!city) return
    setAddr({ city, street, building_number: number })
    if (city && street && number) {
      // Full address — submit immediately.
      const t = window.setTimeout(() => {
        document.querySelector<HTMLFormElement>('form[data-evaluate-form]')?.requestSubmit()
      }, 80)
      return () => window.clearTimeout(t)
    }
    // Partial — focus the next empty field so the user knows what to fill.
    // AddressPicker inputs don't carry `name=`, so we identify them by their
    // unique Hebrew placeholders.
    const t = window.setTimeout(() => {
      const placeholder = !street
        ? 'הקלד שם רחוב…'
        : !number ? 'מספר הבניין'
        : null
      if (!placeholder) return
      const el = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
        .find(i => i.placeholder === placeholder)
      el?.focus()
    }, 120)
    return () => window.clearTimeout(t)
  }, [])

  const isResultMode = busy || report !== null

  async function onEvaluate(e: React.FormEvent) {
    e.preventDefault()
    if (!addr.city || !addr.street || !addr.building_number) return
    setBusy(true)
    setError(null)
    setReport(null)
    const startedAt = Date.now()
    // Floor — keep the gauge animation visible for at least MIN_LOADING_MS
    // even when the API/cache returns quickly.
    const floor = new Promise<void>(r => setTimeout(r, MIN_LOADING_MS))
    try {
      const payload: Record<string, unknown> = { ...addr }
      const aptInt = parseInt(apartmentsCount, 10)
      if (!Number.isNaN(aptInt) && aptInt > 0) payload.apartments_count = aptInt
      if (commercial) payload.commercial = commercial
      const yearInt = parseInt(yearBuilt, 10)
      const currentYear = new Date().getFullYear()
      if (!Number.isNaN(yearInt) && yearInt >= 1900 && yearInt <= currentYear + 1) {
        payload.year_built = yearInt
      }

      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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

  function reset() {
    setAddr({ city: '', street: '', building_number: '' })
    setApartmentsCount('')
    setYearBuilt('')
    setCommercial('')
    setBusy(false)
    setError(null)
    setReport(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Until localStorage has been read we render nothing to avoid a flash of
  // either the gate or the form — there's no SSR here so this only delays
  // the first paint by a single tick.
  if (!leadChecked) {
    return <div className="min-h-screen" />
  }

  // No accepted lead yet → render the gate as a blocker. The address form
  // and the rest of the app are hidden until the user submits.
  if (!lead) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header onReset={undefined} />
        <main className="flex-1 px-4 sm:px-6 py-6 sm:py-10 max-w-[1100px] w-full mx-auto">
          <LeadGate onAccepted={info => setLead(info)} />
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header onReset={isResultMode ? reset : undefined} />
      <main className="flex-1 px-4 sm:px-6 py-4 sm:py-6 max-w-[1100px] w-full mx-auto">
        {!isResultMode && (
          <>
            <Hero />
            <form onSubmit={onEvaluate} data-evaluate-form className="mt-4 bg-white rounded-sc-card border border-sc-border shadow-sm p-3 sm:p-4">
              <AddressPicker value={addr} onChange={setAddr} disabled={busy} />

              {/* Three optional details that materially change the score:
                  year_built drives the building_age rubric AND a hard cap,
                  apartments_count drives the density rubric (m²/apt ratio),
                  commercial level drives the complexity rubric. */}
              <div className="mt-3 pt-3 border-t border-sc-border space-y-3">
                <div className="text-[13px] font-bold text-sc-text-secondary">
                  פרטים נוספים על הבניין <span className="font-normal text-sc-text-muted">(אופציונלי, מדויק יותר)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-[14px] font-semibold text-sc-text-secondary mb-1.5">
                      שנת בנייה
                      <span className="font-normal text-sc-text-muted"> (הגורם המכריע)</span>
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1900}
                      max={new Date().getFullYear() + 1}
                      value={yearBuilt}
                      onChange={e => setYearBuilt(e.target.value)}
                      disabled={busy}
                      placeholder="לדוגמה: 1975"
                      className="w-full bg-white border border-sc-border-strong rounded-sc-input ps-3 pe-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-sc-primary/10 focus:border-sc-primary disabled:bg-sc-bg disabled:text-sc-text-muted"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[14px] font-semibold text-sc-text-secondary mb-1.5">
                      מספר דירות בבניין
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={500}
                      value={apartmentsCount}
                      onChange={e => setApartmentsCount(e.target.value)}
                      disabled={busy}
                      placeholder="לדוגמה: 12"
                      className="w-full bg-white border border-sc-border-strong rounded-sc-input ps-3 pe-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-sc-primary/10 focus:border-sc-primary disabled:bg-sc-bg disabled:text-sc-text-muted"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="block text-[14px] font-semibold text-sc-text-secondary mb-1.5">
                    האם יש מסחר בבניין?
                  </span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      { v: 'none',  label: 'אין' },
                      { v: 'small', label: 'מסחר קטן' },
                      { v: 'large', label: 'מסחר משמעותי' },
                      { v: '',      label: 'לא יודע' },
                    ] as const).map(o => (
                      <button
                        key={o.label}
                        type="button"
                        disabled={busy}
                        onClick={() => setCommercial(o.v)}
                        className={
                          'inline-flex items-center justify-center text-[13px] font-bold leading-none px-2 py-2 rounded-sc-input border transition-colors ' +
                          (commercial === o.v
                            ? 'bg-sc-primary text-white border-sc-primary'
                            : 'bg-white text-sc-text-secondary border-sc-border hover:border-sc-primary')
                        }
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </label>
              </div>

              <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button
                  type="submit"
                  disabled={busy || !addr.city || !addr.street || !addr.building_number}
                  className="inline-flex items-center justify-center gap-2 bg-sc-primary text-white font-extrabold text-[15px] leading-none px-5 py-3 rounded-sc-btn shadow-[0_2px_8px_rgba(59,107,156,0.2)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Wand2 size={16} /> הערך עכשיו
                </button>
                <p className="text-[13px] text-sc-text-muted">
                  בחינם, ללא הרשמה. מבוסס על מקורות ציבוריים בלבד.
                </p>
              </div>
              {error && (
                <div className="mt-4 bg-sc-danger/10 text-sc-danger border border-sc-danger/30 rounded-sc-input px-4 py-3 text-[14px]">
                  {error}
                </div>
              )}
            </form>
            <Marketing />
          </>
        )}
        {isResultMode && (
          <ResultSection busy={busy} report={report} address={addr} />
        )}
      </main>
      {!isResultMode && <Footer />}
    </div>
  )
}

// ─── Layout ──────────────────────────────────────────────────────────

function Header({ onReset }: { onReset?: () => void }) {
  return (
    <header className="bg-gradient-to-l from-sc-navy to-sc-primary text-white shadow-sm sticky top-0 z-30 no-print">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-sc-input bg-white/20 grid place-items-center">
          <Building2 size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-[16px] font-extrabold leading-tight">בודק היתכנות פינוי-בינוי</div>
          <div className="text-[12px] opacity-85 inline-flex items-center gap-1">
            <Crown size={11} /> כלי חינמי מאת <span className="font-bold">Silver Castle</span>
          </div>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 bg-white text-sc-navy text-[13px] font-extrabold leading-none px-3.5 py-2.5 rounded-sc-pill shadow-sm hover:bg-white/95 transition-colors"
            >
              <Plus size={14} strokeWidth={3} /> להערכה חדשה
            </button>
          )}
          <a
            href="https://silver-castle.byclick.co.il/"
            target="_blank"
            rel="noopener noreferrer"
            title="Silver Castle — מערכת ניהול הפרויקט"
            className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-[13px] font-extrabold leading-none ps-2.5 pe-3 py-2.5 rounded-sc-pill border border-white/30 transition-colors"
          >
            <Building2 size={14} strokeWidth={2.5} />
            <span className="hidden sm:inline">Silver Castle</span>
            <ExternalLink size={11} className="opacity-75" />
          </a>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="text-center sm:text-start">
      <div className="inline-flex items-center gap-1.5 bg-sc-light-blue text-sc-primary text-[12px] font-bold uppercase tracking-wider leading-none px-3 py-1.5 rounded-sc-pill mb-2">
        <Sparkles size={13} /> חינמי
      </div>
      <h1 className="text-[22px] sm:text-[28px] font-extrabold text-sc-text leading-tight mb-1.5">
        האם הבניין שלך מתאים לפינוי-בינוי?
      </h1>
      <p className="text-[15px] text-sc-text-secondary max-w-[640px] leading-snug">
        הזן כתובת ונחזיר לך הערכה ראשונית מבוססת נתונים פתוחים — תכניות,
        מתחמים מוכרזים וזכויות בנייה — מתורגמים לסיכוי, מסלול ולוח זמנים.
      </p>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mt-6 border-t border-sc-border bg-white no-print">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-3 text-[12px] text-sc-text-muted leading-snug flex flex-wrap items-center justify-between gap-2">
        <span>
          מבוסס על 4 מקורות ציבוריים — GovMap, מינהל התכנון (MAVAT), שימושי קרקע, ו-data.gov.il.
          אינו מהווה חוות דעת אדריכלית, משפטית או שמאית רשמית.
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-sc-text-secondary">
          <Crown size={11} className="text-sc-gold" /> Powered by{' '}
          <a href="https://silver-castle.byclick.co.il/" target="_blank" rel="noopener noreferrer" className="text-sc-primary hover:underline">
            Silver Castle
          </a>
        </span>
      </div>
    </footer>
  )
}

// ─── End-of-report CTA — invites the resident to sign up at Silver Castle
// for the actual project journey (the analyzer is just the appetiser). ──

function SilverCastleCTA() {
  return (
    <div
      data-pdf-block
      className="rounded-sc-card overflow-hidden border border-sc-gold/40 bg-gradient-to-l from-sc-navy to-sc-primary text-white shadow-md"
    >
      <div className="p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="w-12 h-12 rounded-sc-input bg-white/15 grid place-items-center flex-shrink-0">
          <Crown size={24} className="text-sc-gold" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold uppercase tracking-wider opacity-85 mb-1 inline-flex items-center gap-1.5">
            <Sparkles size={12} /> השלב הבא
          </div>
          <div className="text-[18px] sm:text-[20px] font-extrabold leading-tight mb-1.5">
            ההערכה היא רק ההתחלה. <span className="text-sc-gold">Silver Castle</span> מלווה אותך לאורך כל הפרויקט.
          </div>
          <div className="text-[13px] opacity-95 leading-snug">
            מערכת ניהול דיירים מלאה: ועד, הצבעות, חתימות, יזמים, עו״ד, ארכיון מסמכים והתקדמות שלב-שלב.
            הצטרף בחינם ובוא נראה אם הבניין שלך מתאים — בלי התחייבות.
          </div>
        </div>
        <a
          href="https://silver-castle.byclick.co.il/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-white text-sc-navy text-[14px] font-extrabold leading-none px-5 py-3 rounded-sc-pill shadow-md hover:bg-white/95 transition-colors whitespace-nowrap"
        >
          הירשם ב-Silver Castle
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  )
}

// ─── Marketing strip shown before a query is run ─────────────────────

function Marketing() {
  const cards = [
    { icon: <ShieldCheck size={18} />,  title: 'מבוסס נתונים בלבד', body: 'אין ניחושים. כל איתות מקורו במקור ציבורי מאומת — עם קישור לראות את הנתון המקורי.' },
    { icon: <Building2 size={18} />,    title: '4 מקורות · 6 שכבות מידע', body: 'GovMap, מינהל התכנון, שימושי קרקע במבא"ת, ו-data.gov.il — מצליבים במקביל לתמונה אחת ברורה.' },
  ]
  return (
    <section className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {cards.map(c => (
        <div key={c.title} className="bg-white border border-sc-border rounded-sc-card p-3.5">
          <div className="w-9 h-9 rounded-sc-input bg-sc-light-blue text-sc-primary grid place-items-center mb-2">
            {c.icon}
          </div>
          <div className="text-[14px] font-extrabold text-sc-text mb-1 leading-tight">{c.title}</div>
          <div className="text-[13px] text-sc-text-secondary leading-snug">{c.body}</div>
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

function ResultSection({
  busy,
  report,
  address,
}: {
  busy: boolean
  report: EvaluateResponse | null
  address: { city: string; street: string; building_number: string }
}) {
  if (busy && !report) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center py-12 sm:py-20 bg-white rounded-sc-card border border-sc-border shadow-sm">
        <div className="text-[13px] font-bold uppercase tracking-wider text-sc-text-muted mb-4">
          בודקים את הכתובת
        </div>
        <MaturityGauge phase="loading" size={240} />
        <div className="mt-5 text-[14px] text-sc-text-muted text-center max-w-[420px] leading-relaxed px-4">
          מצליבים 4 מקורות פתוחים (GovMap, MAVAT, שימושי קרקע, data.gov.il)
          על פני 6 שכבות מידע — התהליך לוקח כ-5 שניות.
        </div>
      </div>
    )
  }
  if (!report) return null
  return (
    <div id="report-root" className="mt-4 space-y-4">
      <ScoreHero data={report} />
      <ExportBar data={report} />
      <AddressFacts data={report} />
      <CategoriesList categories={report.categories} />
      <SourceBreakdown contributions={report.source_contributions} />
      <RecommendationCard data={report} />
      <SourcesFooter sources={report.sources_used} disclaimer={report.disclaimer} />
      <SilverCastleCTA />
    </div>
  )
}

function ScoreHero({ data }: { data: EvaluateResponse }) {
  const cls = bucketStyles(data.bucket)
  return (
    <div className={`rounded-sc-card overflow-hidden border ${cls.border} bg-white shadow-sm`}>
      <div className={`px-5 py-6 sm:py-7 ${cls.bg} text-white relative overflow-hidden`}>
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
            <div className="text-[12px] sm:text-[13px] font-bold uppercase tracking-wider opacity-85 mb-1.5">
              תוצאת ההערכה
            </div>
            <div className="text-[20px] sm:text-[24px] font-extrabold leading-tight mb-2">
              {data.summary_he}
            </div>
            <div className="text-[14px] opacity-95 inline-flex items-center gap-1.5 flex-wrap justify-center sm:justify-start">
              <MapPin size={13} /> {data.address.formatted}
              {data.address.gush != null && data.address.chelka != null && (
                <span className="opacity-85">· גוש {data.address.gush} חלקה {data.address.chelka}</span>
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

// ─── ExportBar: single "Download PDF" action ─────────────────────────
// Direct client-side PDF generation via modern-screenshot → jsPDF. We
// screenshot #report-root, paginate the resulting image across A4 portrait
// pages, and save the file with a slugified address as the filename.
//
// modern-screenshot delegates the actual rendering to the browser via SVG
// foreignObject, so every CSS rule (flex centering, line-height, mixed font
// sizes, RTL Hebrew, drop-shadow filters, gradients) renders *exactly* as the
// user sees it on the live page. html2canvas — used here previously — runs
// its own text-layout pipeline that mis-aligned text inside coloured pills.

function ExportBar({ data }: { data: EvaluateResponse }) {
  const [busy, setBusy] = useState(false)

  async function downloadPdf() {
    const node = document.getElementById('report-root')
    if (!node) return
    setBusy(true)
    try {
      // Wait for web fonts before the screenshot so the score number doesn't
      // shift mid-capture, and give the score-settle animation (1.2 s) time
      // to finish so the gauge value matches what the user sees.
      if (document.fonts?.ready) await document.fonts.ready
      await new Promise(r => setTimeout(r, 1300))

      const [{ domToCanvas }, jsPdfMod] = await Promise.all([
        import('modern-screenshot'),
        import('jspdf'),
      ])
      // jsPDF ships both a default export and a named one; favour the named.
      const JsPDF = (jsPdfMod as any).jsPDF ?? (jsPdfMod as any).default

      const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const margin = 8
      const usableW = pageW - margin * 2
      const usableH = pageH - margin * 2

      // Each top-level child of #report-root that's NOT the no-print toolbar
      // is rendered on its own dedicated A4 page. Strategy:
      //   - Screenshot the section.
      //   - If it fits the page → place it natural size, vertically centred.
      //   - If it's taller than the page → scale it down proportionally so
      //     the WHOLE section fits on one page. No cutting, no overlaps —
      //     the worst-case is a slightly smaller font for very long
      //     sections (in practice no section has > 7 rows so the scale
      //     factor stays comfortable).
      const sections = Array.from(node.children)
        .filter((c): c is HTMLElement =>
          c instanceof HTMLElement && !c.classList.contains('no-print'),
        )

      let pageStarted = false
      for (const section of sections) {
        const canvas = await domToCanvas(section, { scale: 2, backgroundColor: '#ffffff' })
        const ratio = canvas.width / canvas.height

        // Fit-to-page: start by maximising width, then clamp height.
        let imgW = usableW
        let imgH = imgW / ratio
        if (imgH > usableH) {
          imgH = usableH
          imgW = imgH * ratio
        }

        if (pageStarted) pdf.addPage()
        pageStarted = true

        // Centre the image both horizontally and vertically on the page.
        const xOff = margin + Math.max(0, (usableW - imgW) / 2)
        const yOff = margin + Math.max(0, (usableH - imgH) / 2)
        pdf.addImage(
          canvas.toDataURL('image/jpeg', 0.92), 'JPEG',
          xOff, yOff, imgW, imgH, undefined, 'FAST',
        )
      }

      pdf.save(`feasibility-${slugifyAddress(data.address.formatted)}.pdf`)
    } catch (err) {
      console.error('PDF export failed', err)
      // Fallback: trigger browser print dialog so the user can still save as PDF.
      window.print()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="no-print flex justify-end">
      <button
        type="button"
        onClick={downloadPdf}
        disabled={busy}
        className="inline-flex items-center gap-1.5 bg-sc-primary text-white text-[14px] font-bold leading-none px-4 py-3 rounded-sc-btn shadow-[0_2px_8px_rgba(59,107,156,0.2)] hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
        {busy ? 'מכין PDF…' : 'הורד כ-PDF'}
      </button>
    </div>
  )
}

function slugifyAddress(s: string): string {
  return s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report'
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
      <div className="text-[13px] font-bold uppercase tracking-wider text-sc-text-muted mb-2">פרטי הנכס</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {facts.map(f => (
          <div key={f.label} className="text-[14px]">
            <div className="text-sc-text-muted">{f.label}</div>
            <div className="font-extrabold text-sc-text text-[15px]">{f.value}</div>
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
      <div className="text-[13px] font-bold uppercase tracking-wider text-sc-text-muted mb-3">
        📊 מה בדקנו ומה נמצא
      </div>
      <ul className="m-0 p-0 space-y-3">
        {categories.map(c => <CategoryRow key={c.key} c={c} />)}
      </ul>
    </div>
  )
}
function CategoryRow({ c }: { c: Category }) {
  // Deterministic display:
  //   "75/100 · משקל 25% · תורם 18.75 נק'"
  // — the weight is a fixed budget that never changes between runs.
  const subscoreCls =
    c.subscore >= 65 ? 'bg-sc-success/15 text-sc-success' :
    c.subscore <= 30 ? 'bg-sc-warning/15 text-sc-warning' :
                       'bg-sc-text-muted/15 text-sc-text-muted'
  return (
    <li data-pdf-block className="list-none flex items-start gap-2.5 break-inside-avoid">
      <span className="mt-0.5 w-5 text-[18px] leading-none flex-shrink-0">{c.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-extrabold text-sc-text text-[15px]">{c.title}</div>
          <span className={`inline-flex items-center text-[12px] font-bold px-2 py-1 leading-none rounded-sc-pill ${subscoreCls}`}>
            {c.subscore}/100
          </span>
          <span className="text-[11px] text-sc-text-muted">
            משקל {c.weight}% · תורם {c.contribution.toFixed(1)} נק׳
          </span>
        </div>
        <div className="text-[14px] font-semibold text-sc-text leading-relaxed mt-0.5">
          {c.summary}
        </div>
        <div className="text-[13px] text-sc-text-secondary leading-relaxed mt-0.5">
          {c.impact}
        </div>
        {c.detail && (
          <div className="mt-1.5 text-[13px] text-sc-text leading-relaxed bg-sc-bg/60 border border-sc-border rounded-sc-input px-2.5 py-1.5">
            {c.detail}
          </div>
        )}
        <div className="text-[12px] text-sc-text-muted mt-1.5 inline-flex items-center gap-2 flex-wrap">
          <span>מקור: {sourceLabel(c.source)}</span>
          {c.url && (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sc-primary font-semibold hover:underline"
            >
              <ExternalLink size={11} /> צפה במקור
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
      <div className="text-[13px] font-bold uppercase tracking-wider text-sc-text-muted mb-3">
        🧮 משקל כל מקור בציון <span className="font-normal text-sc-text-muted normal-case">· אחוזים קבועים, אותם בכל הרצה</span>
      </div>
      <ul className="m-0 p-0 space-y-2.5">
        {contributions.map(s => {
          const efficiency = s.fixed_pct > 0 ? Math.round((s.contribution / s.fixed_pct) * 100) : 0
          return (
            <li key={s.name} data-pdf-block className="list-none break-inside-avoid">
              <div className="flex items-center justify-between text-[14px] mb-1 gap-2">
                <span className="font-extrabold text-sc-text inline-flex items-center gap-1.5">
                  {sourceLabel(s.name)}
                  {s.failed && (
                    <span className="inline-flex items-center gap-1 text-[12px] font-bold leading-none px-2 py-1 rounded-sc-pill bg-sc-danger/15 text-sc-danger">
                      לא הגיב
                    </span>
                  )}
                </span>
                <span className="text-sc-text-muted tabular-nums">
                  משקל {s.fixed_pct}% · תרם {s.contribution.toFixed(1)} נק׳
                </span>
              </div>
              {s.failed && s.note ? (
                <div className="text-[13px] leading-relaxed rounded-sc-input px-2.5 py-1.5 border text-sc-danger bg-sc-danger/5 border-sc-danger/30">
                  {s.note}
                </div>
              ) : (
                <div className="h-2 rounded-sc-pill bg-sc-light-blue overflow-hidden">
                  <div
                    className="h-full bg-sc-primary transition-all"
                    style={{ width: `${efficiency}%` }}
                  />
                </div>
              )}
              <div className="text-[11px] text-sc-text-muted mt-0.5">
                ניקוד מקסימלי אפשרי: {s.fixed_pct} נק׳ · ניצול: {efficiency}%
              </div>
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
        <Star size={15} className="text-sc-gold" />
        <div className="text-[13px] font-bold uppercase tracking-wider text-sc-gold">ההמלצה שלנו</div>
      </div>
      <div className="text-[16px] font-extrabold text-sc-text mb-1.5">
        {trackHeadline(data.recommended_track)}
      </div>
      <div className="text-[14px] text-sc-text-secondary mb-3 inline-flex items-center gap-1.5">
        <Clock size={13} /> לוח זמנים צפוי: {data.expected_time_years.max > 0 ? `${data.expected_time_years.min}-${data.expected_time_years.max} שנים` : '—'}
      </div>
      <ol className="m-0 ps-5 space-y-1.5">
        {data.recommendations.map((r, i) => (
          <li key={i} className="text-[14px] text-sc-text leading-relaxed">
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
      <div className="text-[13px] font-bold uppercase tracking-wider text-sc-text-muted mb-2">
        מקורות שנבדקו
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {sources.map(s => (
          <span
            key={s.name}
            className={
              'inline-flex items-center gap-1.5 text-[13px] font-bold leading-none px-2.5 py-1.5 rounded-sc-pill ' +
              (s.status === 'success'
                ? 'bg-sc-success/15 text-sc-success'
                : s.status === 'partial'
                  ? 'bg-sc-warning/15 text-sc-warning'
                  : 'bg-sc-danger/10 text-sc-danger')
            }
          >
            {s.status === 'success' ? <Check size={12} /> : s.status === 'partial' ? <AlertTriangle size={12} /> : <X size={12} />}
            {sourceLabel(s.name)} · {s.duration_ms} ms
          </span>
        ))}
      </div>
      <div className="text-[12px] text-sc-text-muted leading-relaxed">{disclaimer}</div>
    </div>
  )
}

// ─── Tiny helpers ────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={'text-center rounded-sc-input p-2.5 flex flex-col items-center justify-center gap-1 ' + (accent ? 'bg-sc-light-blue' : 'bg-sc-bg')}>
      <div className="text-[12px] leading-none text-sc-text-muted">{label}</div>
      <div className={'text-[15px] font-extrabold leading-none ' + (accent ? 'text-sc-primary' : 'text-sc-text')}>{value}</div>
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

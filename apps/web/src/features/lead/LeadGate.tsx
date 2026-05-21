// Lead-capture gate — every visitor fills this form before they're allowed
// to run an evaluation. The submitted info is POSTed to /api/lead (which
// appends it to the leads.jsonl log on the server) AND mirrored to
// localStorage so the user is not asked again on refresh or when running
// additional evaluations.
//
// Storage keys:
//   ura.lead.accepted = '1'
//   ura.lead.info     = JSON.stringify({ name, phone, email, ts })

import { useState } from 'react'
import {
  Building2, Crown, ShieldCheck, Sparkles, Wand2, Loader2, AlertCircle,
} from 'lucide-react'

export interface LeadInfo {
  name: string
  phone: string
  email: string
  ts: string
}

interface Props {
  onAccepted: (lead: LeadInfo) => void
}

export function LeadGate({ onAccepted }: Props) {
  const [name, setName]   = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const canSubmit =
    name.trim().length >= 2 &&
    phone.replace(/\D/g, '').length >= 7 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) &&
    agreed &&
    !busy

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim(), agreed: true }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error ?? `שגיאת שרת (${res.status})`)
      }
      const info: LeadInfo = {
        name: name.trim(), phone: phone.trim(), email: email.trim(),
        ts: new Date().toISOString(),
      }
      localStorage.setItem('ura.lead.accepted', '1')
      localStorage.setItem('ura.lead.info', JSON.stringify(info))
      onAccepted(info)
    } catch (err: any) {
      setError(err?.message ?? 'שגיאה — נסה שוב')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-[640px] mx-auto">
      <div className="bg-white rounded-sc-card border border-sc-border shadow-sm overflow-hidden">
        <div className="bg-gradient-to-l from-sc-navy to-sc-primary text-white px-5 py-6">
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider opacity-90 mb-2">
            <Crown size={14} /> כלי מאת Silver Castle
          </div>
          <h1 className="text-[24px] sm:text-[28px] font-extrabold leading-tight mb-2">
            הערכת היתכנות פינוי-בינוי בחינם
          </h1>
          <p className="text-[14px] opacity-95 leading-snug">
            לפני שנציג את הניתוח, נשמח להכיר. הפרטים נשמרים אצל Silver Castle
            ויאפשרו לנו לחזור אליכם עם ליווי מקצועי במידת הצורך.
          </p>
        </div>

        <form onSubmit={onSubmit} className="p-5 space-y-4">
          <Field label="שם מלא *">
            <input
              dir="rtl"
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="name"
              placeholder="ישראל ישראלי"
              className={inputCls}
              disabled={busy}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="טלפון *">
              <input
                dir="ltr"
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="050-1234567"
                className={inputCls}
                disabled={busy}
              />
            </Field>
            <Field label="אימייל *">
              <input
                dir="ltr"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="name@example.com"
                className={inputCls}
                disabled={busy}
              />
            </Field>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              disabled={busy}
              className="mt-1 w-4 h-4 accent-sc-primary"
            />
            <span className="text-[13px] text-sc-text-secondary leading-snug">
              אני מאשר/ת שהפרטים שמסרתי יישמרו על ידי Silver Castle, וייתכן
              שניצור איתי קשר לליווי מקצועי בנושא התחדשות עירונית. הניתוח
              הוא הערכה ראשונית בלבד ואינו מהווה חוות דעת אדריכלית, משפטית
              או שמאית.
            </span>
          </label>

          {error && (
            <div className="bg-sc-danger/10 text-sc-danger border border-sc-danger/30 rounded-sc-input px-3 py-2 text-[13px] flex items-start gap-2">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full inline-flex items-center justify-center gap-2 bg-sc-primary text-white font-extrabold text-[15px] leading-none px-5 py-3.5 rounded-sc-btn shadow-[0_2px_8px_rgba(59,107,156,0.2)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {busy
              ? <><Loader2 size={16} className="animate-spin" /> שולח…</>
              : <><Wand2 size={16} /> אשר והתחל הערכה</>}
          </button>

          <div className="flex items-center justify-center gap-4 pt-1 text-[11px] text-sc-text-muted">
            <span className="inline-flex items-center gap-1"><ShieldCheck size={11} /> חינם · ללא תשלום</span>
            <span className="inline-flex items-center gap-1"><Building2 size={11} /> מבוסס מקורות ציבוריים</span>
            <span className="inline-flex items-center gap-1"><Sparkles size={11} /> תוצאה תוך 5 שניות</span>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputCls =
  'w-full bg-white border border-sc-border-strong rounded-sc-input ps-3 pe-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-sc-primary/10 focus:border-sc-primary disabled:bg-sc-bg disabled:text-sc-text-muted'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[14px] font-semibold text-sc-text-secondary mb-1.5">{label}</span>
      {children}
    </label>
  )
}

// ─── Helper: read accepted state from localStorage ────────────────

export function readStoredLead(): LeadInfo | null {
  if (typeof window === 'undefined') return null
  try {
    if (localStorage.getItem('ura.lead.accepted') !== '1') return null
    const raw = localStorage.getItem('ura.lead.info')
    if (!raw) return null
    return JSON.parse(raw) as LeadInfo
  } catch {
    return null
  }
}

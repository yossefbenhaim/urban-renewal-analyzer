// 3-stack address picker mirroring silver-castle/apps/web/src/features/
// address/AddressPicker.tsx — adapted to use plain fetch() against the
// urban-renewal-analyzer api (/api/cities + /api/streets) instead of trpc.
//
// Each field maintains a "query" (what the user is typing) AND a
// "committed" value. Picking a row from the dropdown locks the field
// (green check); typing reopens it. A document-level pointerdown
// listener closes the dropdown when clicking outside.

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, AlertTriangle, X as XIcon, ExternalLink } from 'lucide-react'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

export interface AddressValue {
  city: string
  street: string
  building_number: string
}

interface Item { name: string; code: string }

interface Props {
  value: AddressValue
  onChange: (v: AddressValue) => void
  disabled?: boolean
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" fill="none" />
      <path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  )
}

// ─── Generic dropdown field — used for city + street with different feeds. ──

function PickerField({
  label, value, query, setQuery, onPick, results, loading, pending, disabled, placeholder, disabledPlaceholder,
}: {
  label: string
  value: string
  query: string
  setQuery: (q: string) => void
  onPick: (name: string) => void
  results: Item[]
  loading: boolean
  pending: boolean
  disabled: boolean
  placeholder: string
  disabledPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [])

  const confirmed   = !!value && query === value
  // Loading shows only inside the dropdown options panel — never on the input.
  const showLoading = (loading || pending) && query.length >= 1 && !confirmed && open
  const showEmpty   = !showLoading && open && query.length >= 1 && results.length === 0 && !disabled && !confirmed && !(loading || pending)
  const showResults = !showLoading && open && results.length > 0 && !disabled && !confirmed
  const showHint    = !showLoading && open && query.length < 1 && !disabled

  const borderCls = confirmed
    ? 'border-sc-success'
    : open
      ? 'border-sc-primary'
      : 'border-sc-border-strong'

  return (
    <div>
      <label className="block text-[14px] font-semibold text-sc-text-secondary mb-1.5">{label}</label>
      <div ref={ref} className="relative">
        <input
          dir="rtl"
          value={query}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { if (!disabled) setOpen(true) }}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
          placeholder={disabled ? (disabledPlaceholder ?? placeholder) : placeholder}
          autoComplete="off"
          className={
            `w-full bg-white border rounded-sc-input ps-3 pe-9 py-2.5 text-[15px] outline-none ` +
            `focus:ring-2 focus:ring-sc-primary/10 transition-colors ${borderCls} ` +
            (disabled ? 'bg-sc-bg text-sc-text-muted' : '')
          }
        />
        {/* Icon sits on the trailing edge (left in RTL) so it never overlaps
            the typed text. No spinner here — loading shows inside the panel. */}
        <span className="absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center text-sc-text-muted">
          {confirmed
            ? <Check size={16} strokeWidth={3} className="text-sc-success" />
            : <ChevronDown size={16} />}
        </span>

        {(showHint || showLoading || showEmpty || showResults) && (
          <div className="absolute top-full inset-x-0 mt-1 bg-white border border-sc-border rounded-sc-input shadow-lg z-50 max-h-60 overflow-y-auto">
            {showHint && (
              <div className="px-3 py-2 text-[14px] text-sc-text-muted">הקלד לפחות אות אחת</div>
            )}
            {showLoading && (
              <div className="px-3 py-2 text-[14px] text-sc-text-muted flex items-center gap-2">
                <Spinner /> מחפש…
              </div>
            )}
            {showEmpty && (
              <div className="px-3 py-2 text-[14px] text-sc-text-muted">לא נמצאו תוצאות</div>
            )}
            {showResults && results.map(r => (
              <div
                key={r.code || r.name}
                onPointerDown={e => { e.preventDefault(); onPick(r.name); setOpen(false) }}
                className="px-3 py-2 text-[15px] cursor-pointer hover:bg-sc-light-blue border-b border-sc-border last:border-b-0"
              >
                {r.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Building-number validation ────────────────────────────────────
// As the user types the number, we debounce and call /api/validate-address
// (which hits GovMap's FreeSearch). Three possible outcomes drive the inline
// feedback shown under the input:
//   address  — ✓ ירוק, "מצפה 30, חיפה" + לינק לצפייה ב-GovMap
//   street   — ⚠ אמבר, "רחוב קיים אבל המספר לא נמצא ב-GovMap"
//   not_found — ✗ אדום, "כתובת לא נמצאה — בדוק שגיאות הקלדה"

type ValidationStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'address';  formatted: string; viewUrl: string }
  | { kind: 'street';   formatted: string }
  | { kind: 'not_found' }
  | { kind: 'error' }

// ─── Public component ────────────────────────────────────────────────

export function AddressPicker({ value, onChange, disabled = false }: Props) {
  const [cityQuery, setCityQuery]     = useState(value.city || '')
  const [streetQuery, setStreetQuery] = useState(value.street || '')

  const debCity   = useDebouncedValue(cityQuery, 250)
  const debStreet = useDebouncedValue(streetQuery, 300)
  const debNumber = useDebouncedValue(value.building_number, 450)
  const [validation, setValidation] = useState<ValidationStatus>({ kind: 'idle' })

  // Keep local mirrors aligned when the parent resets the address.
  useEffect(() => { if (!value.city)   setCityQuery('')   }, [value.city])
  useEffect(() => { if (!value.street) setStreetQuery('') }, [value.street])

  const [cities, setCities]   = useState<Item[]>([])
  const [streets, setStreets] = useState<Item[]>([])
  const [citiesLoading,  setCitiesLoading]  = useState(false)
  const [streetsLoading, setStreetsLoading] = useState(false)

  // Cities fetch — fires on debounced query change.
  useEffect(() => {
    if (debCity.length < 1 || debCity === value.city) {
      setCities([])
      return
    }
    let cancelled = false
    setCitiesLoading(true)
    fetch(`/api/cities?q=${encodeURIComponent(debCity)}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setCities(j?.items ?? []) })
      .catch(() => { if (!cancelled) setCities([]) })
      .finally(() => { if (!cancelled) setCitiesLoading(false) })
    return () => { cancelled = true }
  }, [debCity, value.city])

  // Building-number validation — fires on debounced number change (and on
  // city/street changes so changing the street re-validates). We cancel
  // stale fetches via AbortController so the last-typed number wins.
  useEffect(() => {
    if (!value.city || !value.street || !debNumber) {
      setValidation({ kind: 'idle' })
      return
    }
    const ctrl = new AbortController()
    setValidation({ kind: 'loading' })
    const url =
      `/api/validate-address?city=${encodeURIComponent(value.city)}` +
      `&street=${encodeURIComponent(value.street)}` +
      `&number=${encodeURIComponent(debNumber)}`
    fetch(url, { signal: ctrl.signal })
      .then(r => r.json())
      .then(j => {
        if (ctrl.signal.aborted) return
        if (j.status === 'address')   setValidation({ kind: 'address', formatted: j.formatted, viewUrl: j.view_url })
        else if (j.status === 'street')    setValidation({ kind: 'street', formatted: j.formatted })
        else if (j.status === 'not_found') setValidation({ kind: 'not_found' })
        else                               setValidation({ kind: 'error' })
      })
      .catch(err => {
        if (err?.name === 'AbortError') return
        setValidation({ kind: 'error' })
      })
    return () => ctrl.abort()
  }, [value.city, value.street, debNumber])

  // Streets fetch — gated on city being set.
  useEffect(() => {
    if (!value.city) { setStreets([]); return }
    if (debStreet === value.street && debStreet.length > 0) {
      setStreets([])
      return
    }
    let cancelled = false
    setStreetsLoading(true)
    const url =
      `/api/streets?city=${encodeURIComponent(value.city)}&q=${encodeURIComponent(debStreet)}`
    fetch(url)
      .then(r => r.json())
      .then(j => { if (!cancelled) setStreets(j?.items ?? []) })
      .catch(() => { if (!cancelled) setStreets([]) })
      .finally(() => { if (!cancelled) setStreetsLoading(false) })
    return () => { cancelled = true }
  }, [value.city, debStreet, value.street])

  const cityPending   = cityQuery   !== debCity
  const streetPending = streetQuery !== debStreet && !!value.city

  function handleCityPick(city: string) {
    setCityQuery(city)
    setStreetQuery('')
    onChange({ city, street: '', building_number: '' })
  }
  function handleCityTyping(q: string) {
    setCityQuery(q)
    if (q !== value.city && value.city) onChange({ city: '', street: '', building_number: '' })
  }
  function handleStreetPick(street: string) {
    setStreetQuery(street)
    onChange({ ...value, street, building_number: '' })
  }
  function handleStreetTyping(q: string) {
    setStreetQuery(q)
    if (q !== value.street && value.street) onChange({ ...value, street: '', building_number: '' })
  }

  return (
    <div dir="rtl" className="space-y-3">
      <PickerField
        label="עיר *"
        value={value.city}
        query={cityQuery}
        setQuery={handleCityTyping}
        onPick={handleCityPick}
        results={cities}
        loading={citiesLoading}
        pending={cityPending}
        disabled={disabled}
        placeholder="התחל להקליד שם עיר…"
      />
      <PickerField
        label="רחוב *"
        value={value.street}
        query={streetQuery}
        setQuery={handleStreetTyping}
        onPick={handleStreetPick}
        results={streets}
        loading={streetsLoading}
        pending={streetPending}
        disabled={disabled || !value.city}
        placeholder="הקלד שם רחוב…"
        disabledPlaceholder="בחר עיר תחילה"
      />
      <div>
        <label className="block text-[14px] font-semibold text-sc-text-secondary mb-1.5">מספר בית *</label>
        <input
          dir="ltr"
          inputMode="numeric"
          value={value.building_number}
          onChange={e => onChange({ ...value, building_number: e.target.value })}
          placeholder={value.street ? 'מספר הבניין' : 'בחר רחוב תחילה'}
          disabled={disabled || !value.street}
          className={
            `w-full bg-white border rounded-sc-input px-3 py-2.5 text-[15px] outline-none ` +
            `focus:ring-2 focus:ring-sc-primary/10 transition-colors border-sc-border-strong ` +
            (disabled || !value.street ? 'bg-sc-bg text-sc-text-muted' : '')
          }
        />
      </div>
      <ValidationStrip status={validation} fallback={{ city: value.city, street: value.street, number: value.building_number }} />
    </div>
  )
}

// ─── Validation strip — inline ✓ / ⚠ / ✗ under the building-number ──

function ValidationStrip({
  status,
  fallback,
}: {
  status: ValidationStatus
  fallback: { city: string; street: string; number: string }
}) {
  if (status.kind === 'idle') return null
  if (status.kind === 'loading') {
    return (
      <div className="bg-sc-bg border border-sc-border rounded-sc-input px-3 py-2.5 text-[14px] text-sc-text-muted flex items-center gap-2">
        <Spinner />
        <span>מאמת מול GovMap…</span>
      </div>
    )
  }
  if (status.kind === 'address') {
    return (
      <div className="bg-sc-success-bg border border-sc-success/30 rounded-sc-input px-3 py-2.5 text-[14px] text-sc-success flex items-center justify-between gap-2 flex-wrap">
        <span className="inline-flex items-center gap-2">
          <Check size={16} strokeWidth={3} />
          <span className="font-semibold">{status.formatted}</span>
          <span className="text-[12px] font-bold uppercase tracking-wider bg-sc-success/15 px-2 py-0.5 rounded-sc-pill">אומת ב-GovMap</span>
        </span>
        <a
          href={status.viewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[13px] font-bold text-sc-success hover:underline"
        >
          <ExternalLink size={12} /> צפה במפה
        </a>
      </div>
    )
  }
  if (status.kind === 'street') {
    return (
      <div className="bg-sc-warning-bg border border-sc-warning/30 rounded-sc-input px-3 py-2.5 text-[14px] text-sc-warning flex items-start gap-2">
        <AlertTriangle size={16} strokeWidth={2.5} className="mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-semibold">{status.formatted}</span>
          <span className="mr-1">— הרחוב קיים, אבל מספר הבית {fallback.number} לא נמצא ב-GovMap.</span>
          <span className="block mt-0.5 text-[13px] opacity-90">תוכל להמשיך — ההערכה תתבצע על מרכז הרחוב, ייתכן ועם פחות דיוק.</span>
        </div>
      </div>
    )
  }
  if (status.kind === 'not_found') {
    return (
      <div className="bg-sc-danger/10 border border-sc-danger/30 rounded-sc-input px-3 py-2.5 text-[14px] text-sc-danger flex items-start gap-2">
        <XIcon size={16} strokeWidth={2.5} className="mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-semibold">הכתובת לא נמצאה ב-GovMap.</span>
          <span className="block mt-0.5 text-[13px] opacity-90">בדוק שגיאות הקלדה במספר הבית.</span>
        </div>
      </div>
    )
  }
  // error
  return (
    <div className="bg-sc-bg border border-sc-border-strong rounded-sc-input px-3 py-2.5 text-[14px] text-sc-text-muted flex items-center gap-2">
      <AlertTriangle size={15} />
      <span>תיקוף הכתובת לא זמין כרגע — תוכל להמשיך, נבדוק שוב בעת ההערכה.</span>
    </div>
  )
}

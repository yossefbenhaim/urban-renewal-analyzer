// 3-stack address picker mirroring silver-castle/apps/web/src/features/
// address/AddressPicker.tsx — adapted to use plain fetch() against the
// urban-renewal-analyzer api (/api/cities + /api/streets) instead of trpc.
//
// Each field maintains a "query" (what the user is typing) AND a
// "committed" value. Picking a row from the dropdown locks the field
// (green check); typing reopens it. A document-level pointerdown
// listener closes the dropdown when clicking outside.

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
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
  const showLoading = (loading || pending) && query.length >= 1 && !confirmed
  const showEmpty   = !showLoading && open && query.length >= 1 && results.length === 0 && !disabled && !confirmed
  const showResults = !showLoading && open && results.length > 0 && !disabled && !confirmed
  const showHint    = !showLoading && open && query.length < 1 && !disabled

  const borderCls = confirmed
    ? 'border-sc-success'
    : open
      ? 'border-sc-primary'
      : 'border-sc-border-strong'

  return (
    <div>
      <label className="block text-[12px] font-semibold text-sc-text-secondary mb-1.5">{label}</label>
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
            `w-full bg-white border rounded-sc-input px-3 py-2.5 text-[14px] outline-none ` +
            `focus:ring-2 focus:ring-sc-primary/10 transition-colors ${borderCls} ` +
            (disabled ? 'bg-sc-bg text-sc-text-muted' : '')
          }
        />
        <span className="absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center text-sc-text-muted">
          {showLoading
            ? <Spinner />
            : confirmed
              ? <Check size={16} strokeWidth={3} className="text-sc-success" />
              : <ChevronDown size={16} />}
        </span>

        {(showHint || showLoading || showEmpty || showResults) && (
          <div className="absolute top-full inset-x-0 mt-1 bg-white border border-sc-border rounded-sc-input shadow-lg z-50 max-h-60 overflow-y-auto">
            {showHint && (
              <div className="px-3 py-2 text-[12px] text-sc-text-muted">הקלד לפחות אות אחת</div>
            )}
            {showLoading && (
              <div className="px-3 py-2 text-[12px] text-sc-text-muted flex items-center gap-2">
                <Spinner /> מחפש…
              </div>
            )}
            {showEmpty && (
              <div className="px-3 py-2 text-[12px] text-sc-text-muted">לא נמצאו תוצאות</div>
            )}
            {showResults && results.map(r => (
              <div
                key={r.code || r.name}
                onPointerDown={e => { e.preventDefault(); onPick(r.name); setOpen(false) }}
                className="px-3 py-2 text-[13px] cursor-pointer hover:bg-sc-light-blue border-b border-sc-border last:border-b-0"
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

// ─── Public component ────────────────────────────────────────────────

export function AddressPicker({ value, onChange, disabled = false }: Props) {
  const [cityQuery, setCityQuery]     = useState(value.city || '')
  const [streetQuery, setStreetQuery] = useState(value.street || '')

  const debCity   = useDebouncedValue(cityQuery, 250)
  const debStreet = useDebouncedValue(streetQuery, 300)

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
        <label className="block text-[12px] font-semibold text-sc-text-secondary mb-1.5">מספר בית *</label>
        <input
          dir="ltr"
          inputMode="numeric"
          value={value.building_number}
          onChange={e => onChange({ ...value, building_number: e.target.value })}
          placeholder={value.street ? 'מספר הבניין' : 'בחר רחוב תחילה'}
          disabled={disabled || !value.street}
          className={
            `w-full bg-white border rounded-sc-input px-3 py-2.5 text-[14px] outline-none ` +
            `focus:ring-2 focus:ring-sc-primary/10 transition-colors border-sc-border-strong ` +
            (disabled || !value.street ? 'bg-sc-bg text-sc-text-muted' : '')
          }
        />
      </div>
      {value.city && value.street && value.building_number && (
        <div className="bg-sc-success-bg border border-sc-success/30 rounded-sc-input px-3 py-2 text-[12px] text-sc-success flex items-center gap-2">
          <Check size={14} strokeWidth={3} />
          <span className="font-semibold">{value.street} {value.building_number}, {value.city}</span>
        </div>
      )}
    </div>
  )
}

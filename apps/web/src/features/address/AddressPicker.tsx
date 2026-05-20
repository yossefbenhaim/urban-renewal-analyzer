// Three-tier address picker: city (autocomplete) → street (autocomplete,
// scoped to the chosen city) → building number (free text).
// Each input fetches its own data lazily from /api/cities and /api/streets,
// reusing the cached gov.il lists already exposed by the api service.

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, ChevronDown, Loader2 } from 'lucide-react'

interface Item { name: string; code: string }

interface Props {
  value: { city: string; street: string; building_number: string }
  onChange: (v: { city: string; street: string; building_number: string }) => void
  busy?: boolean
}

export function AddressPicker({ value, onChange, busy }: Props) {
  const [cityFocus, setCityFocus] = useState(false)
  const [streetFocus, setStreetFocus] = useState(false)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1.4fr_0.7fr] gap-2">
      <Autocomplete
        label="עיר"
        value={value.city}
        onChange={city => onChange({ ...value, city, street: '' })}
        fetchUrl={q => `/api/cities?q=${encodeURIComponent(q)}`}
        focused={cityFocus}
        setFocused={setCityFocus}
        disabled={busy}
      />
      <Autocomplete
        label="רחוב"
        value={value.street}
        onChange={street => onChange({ ...value, street })}
        fetchUrl={q =>
          value.city
            ? `/api/streets?city=${encodeURIComponent(value.city)}&q=${encodeURIComponent(q)}`
            : null
        }
        focused={streetFocus}
        setFocused={setStreetFocus}
        disabled={busy || !value.city}
      />
      <Field label="מס׳">
        <input
          dir="ltr"
          inputMode="numeric"
          className="w-full bg-white border border-sc-border-strong rounded-sc-input px-3 py-2.5 text-[14px] outline-none focus:border-sc-primary focus:ring-2 focus:ring-sc-primary/10 disabled:bg-sc-bg"
          value={value.building_number}
          onChange={e => onChange({ ...value, building_number: e.target.value })}
          placeholder="14"
          disabled={busy}
        />
      </Field>
    </div>
  )
}

// ─── Autocomplete primitive ────────────────────────────────────────────

function Autocomplete({
  label, value, onChange, fetchUrl, focused, setFocused, disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  fetchUrl: (q: string) => string | null
  focused: boolean
  setFocused: (b: boolean) => void
  disabled?: boolean
}) {
  const [items, setItems]   = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [internal, setInternal] = useState(value)

  // Sync upward `value` into the local input (when the parent clears it
  // e.g. after city change wiped the street).
  useEffect(() => { setInternal(value) }, [value])

  const url = useMemo(() => fetchUrl(internal), [internal, fetchUrl])

  // Debounced fetch.
  useEffect(() => {
    if (!focused) return
    if (!url) { setItems([]); return }
    setLoading(true)
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(url)
        const json = await res.json()
        setItems(json?.items ?? [])
      } catch {
        setItems([])
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => window.clearTimeout(t)
  }, [url, focused])

  return (
    <Field label={label}>
      <div className="relative">
        <input
          className="w-full bg-white border border-sc-border-strong rounded-sc-input px-3 py-2.5 text-[14px] outline-none focus:border-sc-primary focus:ring-2 focus:ring-sc-primary/10 disabled:bg-sc-bg"
          value={internal}
          onChange={e => setInternal(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder=" "
          disabled={disabled}
        />
        <ChevronDown size={14} className="absolute end-3 top-1/2 -translate-y-1/2 text-sc-text-muted pointer-events-none" />
        {focused && (
          <div className="absolute z-20 top-full mt-1 inset-x-0 bg-white border border-sc-border rounded-sc-input shadow-md max-h-64 overflow-auto">
            {loading && <div className="px-3 py-2 text-[12px] text-sc-text-muted flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />טוען…</div>}
            {!loading && items.length === 0 && internal && (
              <div className="px-3 py-2 text-[12px] text-sc-text-muted">לא נמצאו תוצאות</div>
            )}
            {items.map(it => (
              <button
                key={it.code}
                type="button"
                className="block w-full text-start px-3 py-2 text-[13px] hover:bg-sc-light-blue"
                onMouseDown={() => { onChange(it.name); setInternal(it.name); setFocused(false) }}
              >
                {it.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold text-sc-text-secondary mb-1">{label}</span>
      {children}
    </label>
  )
}

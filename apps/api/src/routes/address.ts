// Cities + streets autocomplete — ported from silver-castle's address.ts.
// Two key differences from the earlier "walk all 30k streets once" approach:
//
// 1. Streets are fetched PER CITY using CKAN's `filters` param. Each city has
//    only 50–500 streets, so the first fetch for a city is ~1 page (~ms).
//    Previously we loaded all 30k streets on the first miss — multi-second
//    cold start.
// 2. Per-key in-flight promise dedup. Two users opening the same city at the
//    same time share one upstream fetch instead of N parallel walks.

import type { Request, Response } from 'express'
import { fetchJson } from '../lib/http.js'

const CKAN_URL         = 'https://data.gov.il/api/3/action/datastore_search'
const CITIES_RESOURCE  = '5c78e9fa-c2e2-4771-93ff-7f400a12f7ba'
const STREETS_RESOURCE = '9ad3862c-8391-4b2f-84a4-2d4c68625f4b'
const PAGE             = 1000
const TTL_MS           = 24 * 60 * 60 * 1000

interface NamedEntry { name: string; code: string }

interface CkanResp {
  result?: { records?: any[]; total?: number }
}

// ─── Paged CKAN fetcher with optional filters param ─────────────────────

async function ckanFetchAll(
  resourceId: string,
  fields: string,
  mapRow: (row: any) => NamedEntry | null,
  filters?: Record<string, string>,
): Promise<NamedEntry[]> {
  const out: NamedEntry[] = []
  let offset = 0
  while (offset < 20_000) {
    const params = new URLSearchParams({
      resource_id: resourceId,
      limit:  String(PAGE),
      offset: String(offset),
      fields,
    })
    if (filters) params.set('filters', JSON.stringify(filters))
    const res = await fetchJson<CkanResp>(
      `${CKAN_URL}?${params.toString()}`,
      { timeoutMs: 10_000, retries: 2 },
    )
    const rows = res?.result?.records ?? []
    if (rows.length === 0) break
    for (const r of rows) {
      const m = mapRow(r)
      if (m) out.push(m)
    }
    offset += rows.length
    if (rows.length < PAGE) break
  }
  return out
}

// ─── Cities — one global cache + in-flight dedup ─────────────────────────

let citiesCache: { data: NamedEntry[]; at: number } | null = null
let citiesInFlight: Promise<NamedEntry[]> | null = null

async function getCities(): Promise<NamedEntry[]> {
  if (citiesCache && Date.now() - citiesCache.at < TTL_MS) return citiesCache.data
  if (citiesInFlight) return citiesInFlight
  citiesInFlight = (async () => {
    try {
      const data = await ckanFetchAll(
        CITIES_RESOURCE,
        'שם_ישוב,סמל_ישוב',
        r => {
          const name = String(r['שם_ישוב'] ?? '').trim()
          const code = String(r['סמל_ישוב'] ?? '').trim()
          if (!name || !code || name === 'לא רלוונטי' || name === 'ללא שם') return null
          return { name, code }
        },
      )
      // Only cache non-empty success — a failed fetch should be retried next call.
      if (data.length > 0) citiesCache = { data, at: Date.now() }
      return data
    } finally {
      citiesInFlight = null
    }
  })()
  return citiesInFlight
}

// ─── Streets — per-city caches + in-flight dedup ─────────────────────────

const streetsCache = new Map<string, { data: NamedEntry[]; at: number }>()
const streetsInFlight = new Map<string, Promise<NamedEntry[]>>()

async function getStreetsForCity(cityCode: string): Promise<NamedEntry[]> {
  const cached = streetsCache.get(cityCode)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data
  const existing = streetsInFlight.get(cityCode)
  if (existing) return existing

  const p = (async () => {
    try {
      // CKAN's `filters` lets us pull only one city's streets — ~50–500 rows,
      // one page in almost every case.
      const data = await ckanFetchAll(
        STREETS_RESOURCE,
        'שם_רחוב,סמל_רחוב',
        r => {
          const name = String(r['שם_רחוב'] ?? '').trim()
          const code = String(r['סמל_רחוב'] ?? '').trim()
          if (!name || !code || name === 'לא רלוונטי' || name === 'ללא שם') return null
          return { name, code }
        },
        { 'סמל_ישוב': cityCode },
      )
      // Some cities have duplicate street names across neighborhoods —
      // collapse so the dropdown shows each name once.
      const dedup = Array.from(new Map(data.map(s => [s.name, s])).values())
      if (dedup.length > 0) streetsCache.set(cityCode, { data: dedup, at: Date.now() })
      return dedup
    } finally {
      streetsInFlight.delete(cityCode)
    }
  })()
  streetsInFlight.set(cityCode, p)
  return p
}

// ─── Ranked substring search ────────────────────────────────────────────
// Four tiers: prefix → word-start → substring → multi-token. CKAN's full-text
// `q` requires whole tokens ("חי" matches nothing), so we substring-filter the
// cached list in memory.

function scoreAndRank(items: NamedEntry[], query: string, max: number): NamedEntry[] {
  const q = query.trim()
  if (!q) return items.slice(0, max)
  const tokens = q.split(/\s+/).filter(Boolean)
  const prefix: NamedEntry[] = []
  const wordStart: NamedEntry[] = []
  const contains: NamedEntry[] = []
  const multi: NamedEntry[] = []
  for (const e of items) {
    const n = e.name
    if (n.startsWith(q)) prefix.push(e)
    else if (n.includes(' ' + q)) wordStart.push(e)
    else if (n.includes(q)) contains.push(e)
    else if (tokens.length >= 2 && tokens.every(t => n.includes(t))) multi.push(e)
  }
  return [...prefix, ...wordStart, ...contains, ...multi].slice(0, max)
}

// ─── Express handlers ───────────────────────────────────────────────────

export async function citiesHandler(req: Request, res: Response) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const cities = await getCities()
    res.json({ items: scoreAndRank(cities, q, 12) })
  } catch (e: any) {
    console.error('[cities]', e?.message)
    res.status(500).json({ error: e?.message ?? 'cities error' })
  }
}

export async function streetsHandler(req: Request, res: Response) {
  try {
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : ''
    const q    = typeof req.query.q    === 'string' ? req.query.q    : ''
    if (!city) { res.json({ items: [] }); return }
    const cities = await getCities()
    const cityRow = cities.find(c => c.name === city)
    if (!cityRow) { res.json({ items: [] }); return }
    const streets = await getStreetsForCity(cityRow.code)
    res.json({ items: scoreAndRank(streets, q, 30) })
  } catch (e: any) {
    console.error('[streets]', e?.message)
    res.status(500).json({ error: e?.message ?? 'streets error' })
  }
}

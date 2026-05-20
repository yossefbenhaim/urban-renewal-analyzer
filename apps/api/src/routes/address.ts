// Cities + streets autocomplete — lifted from silver-castle's address.ts.
// Same CKAN-datastore data sources, same 24 h in-memory cache, same ranked
// substring search (prefix > word-start > substring > multi-token).

import type { Request, Response } from 'express'
import { fetchJson } from '../lib/http.js'

const CKAN_URL = 'https://data.gov.il/api/3/action/datastore_search'
const CITIES_RESOURCE  = '5c78e9fa-c2e2-4771-93ff-7f400a12f7ba'
const STREETS_RESOURCE = '9ad3862c-8391-4b2f-84a4-2d4c68625f4b'
const PAGE = 1000
const TTL_MS = 24 * 60 * 60 * 1000

interface City  { name: string; code: string }
interface Street { name: string; code: string; cityCode: string }

interface CkanResp<R> {
  result?: {
    records?: R[]
    total?: number
  }
}

async function walk<R>(
  resourceId: string,
  mapRow: (row: any) => R | null,
): Promise<R[]> {
  const out: R[] = []
  let offset = 0
  while (true) {
    const url =
      `${CKAN_URL}?resource_id=${resourceId}&limit=${PAGE}&offset=${offset}`
    const res = await fetchJson<CkanResp<any>>(url, { timeoutMs: 10_000, retries: 2 })
    const rows = res?.result?.records ?? []
    if (rows.length === 0) break
    for (const r of rows) {
      const mapped = mapRow(r)
      if (mapped) out.push(mapped)
    }
    offset += rows.length
    if (rows.length < PAGE) break
  }
  return out
}

// ─── Cities ──────────────────────────────────────────────────────────

let citiesCache: { at: number; data: City[] } | null = null
async function getCities(): Promise<City[]> {
  if (citiesCache && Date.now() - citiesCache.at < TTL_MS) return citiesCache.data
  const data = await walk<City>(CITIES_RESOURCE, r => {
    const name = String(r['שם_ישוב'] ?? '').trim()
    const code = String(r['סמל_ישוב'] ?? '').trim()
    if (!name || !code) return null
    return { name, code }
  })
  citiesCache = { at: Date.now(), data }
  return data
}

// ─── Streets ─────────────────────────────────────────────────────────

let streetsCache: { at: number; data: Street[] } | null = null
async function getStreets(): Promise<Street[]> {
  if (streetsCache && Date.now() - streetsCache.at < TTL_MS) return streetsCache.data
  const data = await walk<Street>(STREETS_RESOURCE, r => {
    const name = String(r['שם_רחוב'] ?? '').trim()
    const code = String(r['סמל_רחוב'] ?? '').trim()
    const cityCode = String(r['סמל_ישוב'] ?? '').trim()
    if (!name || !code || !cityCode) return null
    return { name, code, cityCode }
  })
  streetsCache = { at: Date.now(), data }
  return data
}

// ─── Ranked substring search ────────────────────────────────────────

function rank(query: string, name: string): number {
  const q = query.trim()
  if (!q) return -1
  const n = name
  if (n.startsWith(q))                     return 100
  if (new RegExp(`(?:^|\\s)${q}`).test(n)) return 75
  if (n.includes(q))                       return 50
  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.every(t => n.includes(t)))    return 25
  return -1
}

function pickTop<T extends { name: string }>(items: T[], q: string, max = 12): T[] {
  if (!q.trim()) return items.slice(0, max)
  const scored: Array<{ item: T; score: number }> = []
  for (const it of items) {
    const s = rank(q, it.name)
    if (s >= 0) scored.push({ item: it, score: s })
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length)
  return scored.slice(0, max).map(s => s.item)
}

// ─── Express handlers ────────────────────────────────────────────────

export async function citiesHandler(req: Request, res: Response) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const cities = await getCities()
    res.json({ items: pickTop(cities, q) })
  } catch (e: any) {
    console.error('[cities]', e?.message)
    res.status(500).json({ error: e?.message ?? 'cities error' })
  }
}

export async function streetsHandler(req: Request, res: Response) {
  try {
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : ''
    const q    = typeof req.query.q    === 'string' ? req.query.q    : ''
    if (!city) {
      res.json({ items: [] })
      return
    }
    const cities = await getCities()
    const cityRow = cities.find(c => c.name === city)
    if (!cityRow) {
      res.json({ items: [] })
      return
    }
    const all = await getStreets()
    const ours = all.filter(s => s.cityCode === cityRow.code)
    res.json({ items: pickTop(ours, q) })
  } catch (e: any) {
    console.error('[streets]', e?.message)
    res.status(500).json({ error: e?.message ?? 'streets error' })
  }
}

// /api/freesearch?q=... — smart aggregator for the Asset Rise landing
// page's single search field. Combines three sources and ranks the union:
//
//   1. GovMap FreeSearch       — best for full addresses with house number
//   2. CKAN cities (cached)    — city matches across Israel
//   3. CKAN streets index      — cross-city street search
//
// The aggregator also parses 2-token queries: if one token is a known
// city ("דיזנגוף תל אביב"), it constrains the street search to that city
// and bumps those matches to the top.
//
// Response is the same shape the old GovMap-only endpoint produced —
// `{ results: Suggestion[] }` with kind ∈ {address, street, city} — so the
// frontend needs no API contract change. LRU-cached for 1h.

import type { Request, Response } from 'express'
import { LRUCache } from 'lru-cache'
import { freeSearchSuggest, type FreeSearchSuggestion, type SuggestionKind } from '../sources/govmap.js'
import {
  getCities, scoreAndRank,
  getAllStreetsIndex, searchStreetsIndex,
  type StreetIndexEntry,
} from './address.js'

interface Suggestion {
  kind: SuggestionKind
  label: string
  city: string
  street: string
  number: string
}

// Cache the assembled suggestion array. Misses are NOT cached — a CKAN
// hiccup that returns nothing should be retried, not memorised.
const responseCache = new LRUCache<string, Suggestion[]>({
  max: 1000,
  ttl: 60 * 60 * 1000,  // 1 hour
})

const RESULT_LIMIT = 10

export async function freeSearchHandler(req: Request, res: Response) {
  const q = (typeof req.query.q === 'string' ? req.query.q : '').trim()
  if (q.length < 1) {
    res.json({ results: [] })
    return
  }
  const cacheKey = q.toLowerCase()
  const cached = responseCache.get(cacheKey)
  if (cached) {
    res.json({ results: cached })
    return
  }
  try {
    const results = await aggregate(q)
    if (results.length > 0) responseCache.set(cacheKey, results)
    res.json({ results })
  } catch (e: any) {
    console.error('[freesearch]', e?.message)
    res.status(502).json({ error: 'search unavailable', detail: e?.message ?? null })
  }
}

// ─── aggregator ────────────────────────────────────────────────────────

async function aggregate(q: string): Promise<Suggestion[]> {
  const tokens = q.split(/\s+/).filter(Boolean)

  // Fire all three sources in parallel — even if the streets index is
  // still loading on first call (~15-20s on a cold start), the GovMap and
  // cities branches will return immediately so the user sees SOMETHING.
  const [govmapResults, citiesAll, streetsIndex] = await Promise.allSettled([
    freeSearchSuggest(q, 10),
    getCities(),
    getAllStreetsIndex(),
  ])

  const govmap = govmapResults.status === 'fulfilled' ? govmapResults.value : []
  const cities = citiesAll.status === 'fulfilled' ? citiesAll.value : []
  const streets = streetsIndex.status === 'fulfilled' ? streetsIndex.value : []

  // ── 2-token city detection ──
  // For "דיזנגוף תל אביב" or "תל אביב דיזנגוף" — figure out which token(s)
  // are a city, treat the rest as the street query.
  let cityFilter: string | undefined
  let streetQuery: string = q
  if (tokens.length >= 2 && cities.length > 0) {
    const lcCityNames = new Set(cities.map(c => c.name.toLowerCase()))
    // Try the longest suffix and longest prefix that matches a city name.
    for (let take = tokens.length - 1; take >= 1; take--) {
      const suffix = tokens.slice(tokens.length - take).join(' ').toLowerCase()
      if (lcCityNames.has(suffix)) {
        cityFilter = cities.find(c => c.name.toLowerCase() === suffix)?.name
        streetQuery = tokens.slice(0, tokens.length - take).join(' ')
        break
      }
      const prefix = tokens.slice(0, take).join(' ').toLowerCase()
      if (lcCityNames.has(prefix)) {
        cityFilter = cities.find(c => c.name.toLowerCase() === prefix)?.name
        streetQuery = tokens.slice(take).join(' ')
        break
      }
    }
  }

  const out: Suggestion[] = []
  const seen = new Set<string>()

  function dedupKey(s: Suggestion): string {
    return `${s.kind}|${s.street.toLowerCase()}|${s.city.toLowerCase()}|${s.number}`
  }
  function push(s: Suggestion) {
    const k = dedupKey(s)
    if (seen.has(k)) return
    seen.add(k)
    out.push(s)
  }

  // 1) GovMap addresses (full address with house number — always strongest signal)
  for (const r of govmap) if (r.kind === 'address') push(r)

  // 2) Streets in the resolved city (when 2-token parse detected one) —
  //    these are the most specific matches the user could pick from a
  //    cross-city street search.
  if (cityFilter && streets.length > 0) {
    const inCity = searchStreetsIndex(streets, streetQuery, 6, cityFilter)
    for (const e of inCity) {
      push({ kind: 'street', label: `${e.street}, ${e.city}`, city: e.city, street: e.street, number: '' })
    }
  }

  // 3) GovMap street matches
  for (const r of govmap) if (r.kind === 'street') push(r)

  // 4) Cross-city street matches from the CKAN index
  if (streets.length > 0) {
    const crossCity = searchStreetsIndex(streets, tokens[0] ?? q, 6)
    for (const e of crossCity) {
      push({ kind: 'street', label: `${e.street}, ${e.city}`, city: e.city, street: e.street, number: '' })
    }
  }

  // 5) City matches from CKAN (in addition to GovMap city suggestions)
  if (cities.length > 0) {
    const ranked = scoreAndRank(cities, q, 6)
    for (const c of ranked) {
      push({ kind: 'city', label: c.name, city: c.name, street: '', number: '' })
    }
  }

  // 6) GovMap cities (might catch a few CKAN missed)
  for (const r of govmap) if (r.kind === 'city') push(r)

  return out.slice(0, RESULT_LIMIT)
}

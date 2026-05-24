// Ministry of Labor — אתרי בנייה פעילים.
//
// CKAN dataset listing every active construction site in Israel (≈10k rows).
// Each record is one site with city, work type, contractor and "has crane"
// flag. There are no lat/lon — the data is city-grained only, so this source
// powers the `city_build_activity` category (a city-level "is anything being
// built here in practice" signal).
//
// Resource verified live: 10,604 rows, fields: work_id, site_name,
// executor_name, executor_id, foreman_name, has_cranes, city_name,
// build_types, safety_warrents, sanctions, sanctions_sum.

import { fetchJson } from '../lib/http.js'
import type { Signal, SourceFetchResult } from '../types.js'

const CKAN_URL = 'https://data.gov.il/api/3/action/datastore_search'
const RESOURCE_ID = 'b072e36c-a53b-49e1-be08-4a608fcf4638'

interface BuildSiteRecord {
  work_id?: number | string
  site_name?: string
  city_name?: string
  build_types?: string | null
  has_cranes?: number | string | null
}
interface CkanResponse {
  success?: boolean
  result?: { records?: BuildSiteRecord[]; total?: number }
}

function clean(v?: string | number | null): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

export async function fetchBuildingSites(city: string): Promise<SourceFetchResult> {
  if (!city) return { ok: true, signals: [] }

  // CKAN `filters` does exact-field matching → no substring confusion
  // ("חיפה" won't match "חיפת" or similar). limit=1000 covers even the
  // largest cities (Tel Aviv is ~600 rows); the rubric tops out at ≥20
  // residential sites so any over-cap doesn't matter for the score.
  const filters = encodeURIComponent(JSON.stringify({ city_name: city.trim() }))
  const url = `${CKAN_URL}?resource_id=${RESOURCE_ID}&filters=${filters}&limit=1000`

  // CKAN is intermittently slow (multi-second responses, occasional 5xx) —
  // same 10s / 2 retries that `datagov.ts` uses for the urban-renewal list.
  const res = await fetchJson<CkanResponse>(url, { timeoutMs: 10_000, retries: 2 })
  const records = res?.result?.records ?? []

  // Public dataset page — opens the data.gov.il preview filtered to all
  // building-sites rows. Users can verify the count themselves.
  const datasetUrl = `https://data.gov.il/dataset/buildingsites/resource/${RESOURCE_ID}`

  const total = records.length
  const residential = records.filter(r => /מגורים/.test(clean(r.build_types))).length
  const cranes      = records.filter(r => Number(r.has_cranes) > 0).length

  if (total === 0) {
    return {
      ok: true,
      signals: [{
        kind: 'neutral', weight: 0, source: 'data.gov.il.buildingsites',
        category: 'city_build_activity',
        title: `אין אתרי בנייה פעילים ב${city}`,
        description: 'בדקנו את רשימת אתרי הבנייה הפעילים של משרד העבודה — אף אתר פתוח לא דווח בעיר. סימן שאין כרגע פעילות בנייה רחבה.',
        url: datasetUrl,
      }],
      raw: res,
    }
  }

  // The score scales primarily with residential sites — they're the direct
  // proxy for renewal-style activity. Total + cranes are reported for
  // context but don't drive the rubric.
  const kind: 'positive' | 'neutral' = residential >= 1 ? 'positive' : 'neutral'
  const weight = residential >= 20 ? 6
               : residential >= 10 ? 4
               : residential >= 5  ? 3
               : residential >= 1  ? 1
               : 0

  const signal: Signal = {
    kind, weight, source: 'data.gov.il.buildingsites',
    category: 'city_build_activity',
    title: residential >= 1
      ? `${residential} אתרי בנייה למגורים פעילים ב${city}`
      : `${total} אתרי בנייה פעילים ב${city} (לא למגורים)`,
    description:
      `נרשמו ${total} אתרי בנייה פעילים בעיר, מתוכם ${residential} למגורים` +
      (cranes > 0 ? ` ו-${cranes} עם עגורן פעיל.` : '.') +
      ' מקור: רשימת ההודעות על פעולות בנייה של משרד העבודה.',
    url: datasetUrl,
  }

  return { ok: true, signals: [signal], raw: { total, residential, cranes } }
}

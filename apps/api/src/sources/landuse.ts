// MAVAT Xplan layer 4 — "יעודי קרקע" (land use designations). Each feature
// is a polygon with `mavat_name` describing the land use category for that
// area (e.g. "מגורים", "מגורים ב'", "מסחר ומגורים", "שטח ציבורי פתוח").
//
// Verified live: querying our Haifa reference point returns 7 overlapping
// features (some are aliases of the same area through different plans).
// We pick the most specific residential land use as the signal.

import { fetchJson } from '../lib/http.js'
import type { Signal, SourceFetchResult } from '../types.js'

const LANDUSE_URL =
  'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/4/query'

interface XplanResponse {
  features?: Array<{ attributes?: { mavat_name?: string; legal_area?: number } }>
}

function residentialBoost(name: string): { weight: number; kind: 'positive' | 'negative' | 'neutral'; label: string } {
  const n = (name ?? '').replace(/\s+/g, ' ').trim()
  if (/מגורים/.test(n) && !/לא תכנוני|פתוח|ציבורי/.test(n)) {
    return { weight: 8, kind: 'positive', label: 'יעוד מגורים' }
  }
  if (/מסחר ומגורים|תעסוקה ומגורים/.test(n)) {
    return { weight: 5, kind: 'positive', label: 'יעוד מעורב' }
  }
  if (/ציבורי|שטח ציבורי פתוח|חינוך|מבני ציבור/.test(n)) {
    return { weight: -20, kind: 'negative', label: 'יעוד ציבורי / שצ"פ' }
  }
  if (/תעשייה|תעסוקה|מלאכה/.test(n)) {
    return { weight: -10, kind: 'negative', label: 'יעוד תעסוקה / תעשייה' }
  }
  if (/חקלאי|יער|שטח פתוח/.test(n)) {
    return { weight: -25, kind: 'negative', label: 'יעוד חקלאי / שטח פתוח' }
  }
  return { weight: 0, kind: 'neutral', label: 'יעוד אחר' }
}

export async function fetchLandUse(itmX: number, itmY: number): Promise<SourceFetchResult> {
  const url =
    `${LANDUSE_URL}?geometry=${itmX},${itmY}` +
    '&geometryType=esriGeometryPoint&inSR=2039&outFields=mavat_name,legal_area&returnGeometry=false&f=json'
  const res = await fetchJson<XplanResponse>(url, { timeoutMs: 8000, retries: 2 })
  const feats = res?.features ?? []
  // Public viewer URL at the parcel coords — lets the user open the MAVAT
  // map and inspect the land-use polygon themselves.
  const landUseUrl = `https://mavat.iplan.gov.il/?c=${itmX},${itmY}`
  if (feats.length === 0) {
    return {
      ok: true,
      signals: [{
        kind: 'neutral', weight: 0, source: 'mavat.landuse',
        category: 'land_use',
        title: 'שימושי קרקע',
        description: 'לא נמצא יעוד קרקע רשום באזור הזה במערכת מבא"ת.',
        url: landUseUrl,
      }],
    }
  }
  // Pick the most-positive land use (we prefer residential matches).
  let best = feats[0]
  let bestScore = -Infinity
  for (const f of feats) {
    const s = residentialBoost(f.attributes?.mavat_name ?? '').weight
    if (s > bestScore) { best = f; bestScore = s }
  }
  const name = best.attributes?.mavat_name ?? 'יעוד לא ידוע'
  const cls = residentialBoost(name)
  const signal: Signal = {
    kind: cls.kind,
    weight: cls.weight,
    source: 'mavat.landuse',
    category: 'land_use',
    title: 'שימושי קרקע',
    description: `יעוד הקרקע במקום: "${name.trim()}". ${cls.label}.`,
    url: landUseUrl,
  }
  return { ok: true, signals: [signal], raw: feats.slice(0, 3) }
}

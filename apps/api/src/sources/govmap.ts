// GovMap adapter — three responsibilities:
//   1. geocode the free-text address → ITM coords + canonical label
//   2. resolve those coords → gush, chelka, lot area (PARCEL_ALL layer)
//   3. check whether the point sits inside a declared urban-renewal area
//      (ADD_PROJECTS_UR_MUCHRAZ layer)
//
// Verified live against ags.govmap.gov.il while writing this — both endpoints
// answer without auth, return JSON, and produce the expected fields for the
// Yossef-supplied reference address (מצפה 30, חיפה → גוש 11213 / חלקה 4 /
// 897 m²).

import { fetchJson } from '../lib/http.js'
import { itmToWgs84 } from '../lib/itm.js'
import type { ResolvedAddress, Signal, SourceFetchResult } from '../types.js'

const FREE_SEARCH_URL  = 'https://ags.govmap.gov.il/Search/FreeSearch'
const IDENTIFY_XY_URL  = 'https://ags.govmap.gov.il/Identify/IdentifyByXY'

interface FreeSearchResponse {
  errorCode: number
  data?: {
    Result?: Array<{
      ResultLable?: string
      X?: number               // ITM easting
      Y?: number               // ITM northing
    }>
  }
}

interface IdentifyResponse {
  errorCode: number
  data?: Array<{
    LayerName?: string
    Result?: Array<{
      tabs?: Array<{
        fields?: Array<{ FieldName?: string; FieldValue?: string | number | null }>
      }>
      centroid?: { x: number; y: number }
    }>
  }>
}

function fieldValue(
  result: NonNullable<IdentifyResponse['data']>[number]['Result'],
  name: string,
): string | null {
  if (!result) return null
  for (const r of result) {
    for (const t of r.tabs ?? []) {
      for (const f of t.fields ?? []) {
        if (f.FieldName === name) {
          const v = f.FieldValue
          if (v === null || v === undefined || v === '') return null
          return String(v)
        }
      }
    }
  }
  return null
}

// ─── Public adapter entry points ────────────────────────────────────────

export async function geocode(text: string): Promise<{
  itmX: number; itmY: number; label: string
} | null> {
  const res = await fetchJson<FreeSearchResponse>(FREE_SEARCH_URL, {
    method: 'POST',
    body: { keyword: text, LstResult: '' },
    timeoutMs: 4000,
  })
  const first = res?.data?.Result?.[0]
  if (!first || first.X == null || first.Y == null) return null
  return {
    itmX: first.X,
    itmY: first.Y,
    label: first.ResultLable ?? text,
  }
}

async function identify(
  itmX: number,
  itmY: number,
  layerName: 'PARCEL_ALL' | 'ADD_PROJECTS_UR_MUCHRAZ',
  tolerance = 1,
): Promise<IdentifyResponse> {
  return fetchJson<IdentifyResponse>(IDENTIFY_XY_URL, {
    method: 'POST',
    body: {
      x: itmX,
      y: itmY,
      mapTolerance: tolerance,
      IsPersonalSite: false,
      layers: [{ LayerType: 0, LayerName: layerName, LayerFilter: '' }],
    },
    timeoutMs: 4000,
  })
}

// ─── Source: geocode + parcel ────────────────────────────────────────
// This is the FOUNDATION adapter — without it we can't drive the others.
// Produces address fields, not signals; the orchestrator merges its
// `address` payload into the response top-level.

export async function fetchAddress(addrText: string): Promise<SourceFetchResult> {
  const geo = await geocode(addrText)
  if (!geo) {
    return { ok: false, signals: [] }
  }
  const wgs = itmToWgs84(geo.itmX, geo.itmY)
  const parcel = await identify(geo.itmX, geo.itmY, 'PARCEL_ALL', 1)
  const result = parcel?.data?.[0]?.Result
  const gushRaw   = fieldValue(result, 'מספר גוש')
  const chelkaRaw = fieldValue(result, 'חלקה')
  const lotRaw    = fieldValue(result, 'שטח רשום (מ"ר)')

  const address: Partial<ResolvedAddress> = {
    formatted: geo.label,
    lat: wgs.lat,
    lon: wgs.lon,
    itm_x: geo.itmX,
    itm_y: geo.itmY,
    gush:    gushRaw   ? Number(gushRaw)   : undefined,
    chelka:  chelkaRaw ? Number(chelkaRaw) : undefined,
    lot_sqm: lotRaw    ? Number(lotRaw)    : undefined,
  }

  const signals: Signal[] = []
  // Lot-size penalties — only fire when we actually have a number.
  if (address.lot_sqm != null) {
    if (address.lot_sqm < 350) {
      signals.push({
        kind: 'negative', weight: -20, source: 'govmap', category: 'lot_size',
        title: 'מגרש קטן מאוד',
        description: `שטח המגרש הרשום הוא ${address.lot_sqm} מ"ר. פרויקט עצמאי כמעט בלתי אפשרי — נדרש חיבור למתחם רחב יותר.`,
      })
    } else if (address.lot_sqm < 600) {
      signals.push({
        kind: 'negative', weight: -10, source: 'govmap', category: 'lot_size',
        title: 'מגרש קטן יחסית',
        description: `שטח המגרש ${address.lot_sqm} מ"ר. פרויקט עצמאי פחות אטרקטיבי — שווה לבחון חיבור עם שכנים.`,
      })
    } else if (address.lot_sqm >= 1500) {
      signals.push({
        kind: 'positive', weight: 5, source: 'govmap', category: 'lot_size',
        title: 'מגרש גדול',
        description: `שטח המגרש ${address.lot_sqm} מ"ר — מספק מקום לבנייה עצמאית רחבה.`,
      })
    } else {
      signals.push({
        kind: 'neutral', weight: 0, source: 'govmap', category: 'lot_size',
        title: 'גודל מגרש סטנדרטי',
        description: `שטח המגרש ${address.lot_sqm} מ"ר — בטווח הרגיל לפרויקט.`,
      })
    }
  }

  return { ok: true, address, signals, raw: { geo, parcel } }
}

// ─── Source: declared urban-renewal area (GovMap layer) ─────────────────

export async function fetchUrbanRenewalLayer(
  itmX: number,
  itmY: number,
): Promise<SourceFetchResult> {
  const res = await identify(itmX, itmY, 'ADD_PROJECTS_UR_MUCHRAZ', 50)
  const hits = res?.data?.[0]?.Result ?? []
  if (hits.length === 0) {
    // Emit a neutral signal so the source's "checked, no match" state is
    // visible in the report — instead of looking like the source failed.
    return {
      ok: true,
      signals: [{
        kind: 'neutral', weight: 0, source: 'govmap', category: 'urban_renewal_area',
        title: 'אין מתחם התחדשות מוכרז כאן',
        description: 'בדקנו את שכבת מתחמי ההתחדשות המוכרזים של GovMap — הכתובת לא נמצאת בתוך מתחם שכבר הוכרז רשמית.',
      }],
      raw: res,
    }
  }
  const project = hits[0]
  const name = fieldValue([project], 'שם המתחם') ?? 'מתחם התחדשות'
  return {
    ok: true,
    signals: [{
      kind: 'positive', weight: 20, source: 'govmap', category: 'urban_renewal_area',
      title: 'מתחם התחדשות עירונית מוכרז',
      description: `הכתובת נמצאת בתוך מתחם "${name}". זהו אינדיקטור חזק במיוחד להיתכנות.`,
    }],
    raw: res,
  }
}

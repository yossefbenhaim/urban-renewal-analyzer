// MAVAT (Iplan) Xplan ArcGIS adapter — checks whether any planning scheme
// (תב"ע) covers the gush/chelka.
//
// Endpoint verified live:
//   https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/1/query
//   ?geometry=<x,y>&geometryType=esriGeometryPoint&inSR=2039&outFields=*&f=json
//
// Layer 1 = "קוים כחולים-תכניות מקוונות" (active online plans).
// Key fields per feature:
//   pl_number          – plan id (304-…)
//   pl_name            – plan name
//   station_desc       – Hebrew status string ("מאושר", "בהפקדה", "בעיבוד", "בייזום" …)
//   internet_short_status – short stage code
//   depositing_date    – deposit date (UNIX ms)
//   pl_url             – link to the MAVAT page for the plan
//
// The adapter emits at most one signal per plan it finds, and a "no plans"
// neutral signal when the parcel is unaffected. Score weights match the
// approved plan / Tier-2 rules in the plan file.

import { fetchJson } from '../lib/http.js'
import type { Signal, SourceFetchResult } from '../types.js'

const XPLAN_LAYER_QUERY =
  'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/1/query'

interface XplanFeature {
  attributes: {
    pl_number?: string
    pl_name?: string
    station_desc?: string
    internet_short_status?: string
    depositing_date?: number | null
    pl_url?: string | null
  }
}
interface XplanResponse {
  features?: XplanFeature[]
}

function classifyStatus(s?: string): {
  weight: number
  kind: 'positive' | 'neutral'
  label: string
} {
  const t = (s ?? '').trim()
  if (/מאושר|פורסמ/.test(t)) return { weight: 25, kind: 'positive', label: 'תכנית מאושרת' }
  if (/הפקד/.test(t))         return { weight: 20, kind: 'positive', label: 'תכנית בהפקדה' }
  if (/בעיבוד|בייזום|בבדיק/.test(t)) return { weight: 10, kind: 'positive', label: 'תכנית בעיבוד' }
  return { weight: 5, kind: 'neutral', label: 'תכנית רשומה' }
}

export async function fetchPlanningSchemes(
  itmX: number,
  itmY: number,
): Promise<SourceFetchResult> {
  const url =
    `${XPLAN_LAYER_QUERY}?geometry=${itmX},${itmY}` +
    '&geometryType=esriGeometryPoint&inSR=2039&outFields=*&returnGeometry=false&f=json'
  const res = await fetchJson<XplanResponse>(url, { timeoutMs: 4000 })
  const feats = res?.features ?? []

  if (feats.length === 0) {
    return {
      ok: true,
      signals: [{
        kind: 'neutral', weight: 0, source: 'mavat',
        title: 'אין תכנית בניין-עיר עדכנית באזור',
        description: 'לא נמצאה תב"ע פעילה החופפת לחלקה. ייתכן שתכנון יתחיל בעתיד.',
      }],
    }
  }

  // Pick the strongest signal across all overlapping plans, plus reference
  // the strongest plan in the description.
  let strongest: XplanFeature | null = null
  let strongestWeight = -Infinity
  for (const f of feats) {
    const w = classifyStatus(f.attributes?.station_desc).weight
    if (w > strongestWeight) { strongest = f; strongestWeight = w }
  }
  const a = strongest!.attributes
  const { weight, kind, label } = classifyStatus(a.station_desc)

  const signal: Signal = {
    kind: kind === 'positive' ? 'positive' : 'neutral',
    weight,
    source: 'mavat',
    title: label,
    description:
      `תכנית ${a.pl_number ?? ''} "${a.pl_name ?? ''}" בסטטוס "${a.station_desc ?? '—'}" ` +
      `חופפת את החלקה (סה"כ ${feats.length} תכניות פעילות באזור).`.trim(),
  }
  return { ok: true, signals: [signal], raw: res }
}

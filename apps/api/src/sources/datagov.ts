// data.gov.il adapter — queries the Ministry of Housing's urban-renewal
// master list (CKAN datastore resource `f65a0daf-…`). Each record describes
// one declared urban-renewal area: city name, area number, area name, plan
// number, declaration date, current status, # of units (existing/added).
//
// Verified live: `q=חיפה` returns dozens of records covering Haifa areas
// (e.g. אריה לוין / area 4353, plan 304-0740860, status "תכנית מאושרת").

import { fetchJson } from '../lib/http.js'
import type { Signal, SourceFetchResult } from '../types.js'

const CKAN_URL = 'https://data.gov.il/api/3/action/datastore_search'
const RESOURCE_ID = 'f65a0daf-f737-49c5-9424-d378d52104f5'

interface UrbanRenewalRecord {
  MisparMitham?: number | string
  Yeshuv?: string                // city name, padded with spaces
  ShemMitcham?: string
  MisparTochnit?: string
  Status?: string
  Bebitzua?: string
  ShnatMatanTokef?: string | number
}
interface CkanResponse {
  success?: boolean
  result?: {
    records?: UrbanRenewalRecord[]
    total?: number
  }
}

function clean(value?: string | number | null): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export async function fetchCityUrbanRenewal(city: string): Promise<SourceFetchResult> {
  if (!city) return { ok: true, signals: [] }
  const url = `${CKAN_URL}?resource_id=${RESOURCE_ID}&q=${encodeURIComponent(city)}&limit=100`
  const res = await fetchJson<CkanResponse>(url, { timeoutMs: 4000 })
  const records = (res?.result?.records ?? [])
    // CKAN's `q` matches any field — filter to records whose Yeshuv actually
    // includes the requested city (avoids matching plans where the city
    // appears in a comment or area name only).
    .filter(r => clean(r.Yeshuv) === city.trim())

  if (records.length === 0) {
    return {
      ok: true,
      signals: [
        {
          kind: 'neutral', weight: 0, source: 'data.gov.il', category: 'municipal_policy',
          title: `אין מתחמי התחדשות מוכרזים ב${city}`,
          description: 'העיר אינה ברשימת רשות ההתחדשות העירונית למתחמים מוכרזים.',
        },
        {
          kind: 'neutral', weight: 0, source: 'data.gov.il', category: 'projects_in_city',
          title: 'אין פרויקטי התחדשות פעילים באותה רשות',
          description: 'לא נמצאו פרויקטים בביצוע באותה עיר.',
        },
      ],
      raw: res,
    }
  }

  // Aggregate counts by status — useful for the headline copy.
  const approved   = records.filter(r => /מאושר/.test(clean(r.Status))).length
  const inProgress = records.filter(r => /ביצוע|מימוש/.test(clean(r.Status)) || clean(r.Bebitzua) === 'כן').length

  const signals: Signal[] = [{
    kind: 'positive', weight: 7, source: 'data.gov.il', category: 'municipal_policy',
    title: `${city} ברשימת התחדשות עירונית פעילה`,
    description:
      `נמצאו ${records.length} מתחמי התחדשות מוכרזים בעיר (מתוכם ${approved} בסטטוס מאושר).` +
      (inProgress > 0 ? ` ${inProgress} מתחמים בביצוע פעיל.` : ''),
  }]

  if (inProgress > 0) {
    signals.push({
      kind: 'positive', weight: 5, source: 'data.gov.il', category: 'projects_in_city',
      title: 'מתחמי התחדשות בביצוע באותה רשות',
      description: `${inProgress} מתחמים בביצוע פעיל בעיר — סימן לפעילות יזמית רציפה.`,
    })
  } else {
    signals.push({
      kind: 'neutral', weight: 0, source: 'data.gov.il', category: 'projects_in_city',
      title: 'אין פרויקטי התחדשות בביצוע כעת',
      description: 'יש מתחמים מוכרזים אבל אף אחד מהם לא בשלב ביצוע פעיל.',
    })
  }

  return { ok: true, signals, raw: records.slice(0, 5) }
}

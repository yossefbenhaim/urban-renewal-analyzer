// POST /api/evaluate — public entry point.
//
// Flow:
//   1. Validate input.
//   2. Cache lookup (LRU keyed on canonical "city|street|number").
//   3. Geocode + parcel via GovMap (foundation). If this fails we fail
//      the whole request — without coordinates the other adapters have
//      nothing to work with.
//   4. Fan out the Tier-2 adapters with Promise.allSettled.
//   5. Aggregate signals, compute score + bucket + recommendations.
//   6. Cache and respond.

import type { Request, Response } from 'express'
import { z } from 'zod'
import { fetchAddress, fetchUrbanRenewalLayer } from '../sources/govmap.js'
import { fetchPlanningSchemes } from '../sources/mavat.js'
import { fetchCityUrbanRenewal } from '../sources/datagov.js'
import { fetchLandUse } from '../sources/landuse.js'
import { bucketize, rankSignals } from '../engine/score.js'
import {
  expectedTimeYears, recommendTrack, recommendations,
  singleBuildingFeasible, summaryHe,
} from '../engine/recommend.js'
import { evaluateRubric } from '../engine/rubric.js'
import { reportCache, cacheKey } from '../lib/cache.js'
import type {
  EvaluateResponse, ResolvedAddress, Signal, SourceFetchResult,
  SourceName, SourceResult, SourceStatus,
} from '../types.js'

const Input = z.object({
  city:             z.string().trim().min(1),
  street:           z.string().trim().min(1),
  building_number:  z.string().trim().min(1),
  apartments_count: z.number().int().min(1).max(500).optional(),
  commercial:       z.enum(['none', 'small', 'large', 'unknown']).optional(),
})

const DISCLAIMER =
  'זוהי הערכה ראשונית בלבד המבוססת על מקורות ציבוריים ואינה מהווה חוות דעת ' +
  'משפטית, אדריכלית או שמאית. השימוש בכלי לסינון ראשוני בלבד.'

interface RunResult {
  result: SourceFetchResult | null
  ms: number
}
async function timed(p: Promise<SourceFetchResult>): Promise<RunResult> {
  const start = Date.now()
  try {
    const result = await p
    return { result, ms: Date.now() - start }
  } catch {
    return { result: null, ms: Date.now() - start }
  }
}

function classify(r: RunResult): SourceStatus {
  if (!r.result) return 'failed'
  if (!r.result.ok) return 'failed'
  if (r.result.partial) return 'partial'
  return 'success'
}

export async function evaluateHandler(req: Request, res: Response) {
  const parsed = Input.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid input' })
    return
  }
  const { city, street, building_number, apartments_count, commercial } = parsed.data
  // Cache key includes the user-supplied facts so different inputs for the
  // same address produce distinct cached reports.
  const key = cacheKey(city, street, building_number) +
    `|${apartments_count ?? '_'}|${commercial ?? '_'}`

  const cached = reportCache.get(key)
  if (cached) {
    res.json({ ...cached, generated_at: cached.generated_at, cached: true } as any)
    return
  }

  // 1. Foundation: GovMap geocode + parcel. If this fails we can't proceed.
  const addressFreeText = `${street} ${building_number} ${city}`
  const foundation = await timed(fetchAddress(addressFreeText))
  if (!foundation.result || !foundation.result.ok || !foundation.result.address?.itm_x) {
    res.status(404).json({
      error: 'לא הצלחנו למצוא את הכתובת ב-GovMap',
      address_text: addressFreeText,
    })
    return
  }
  const foundationAddr = foundation.result.address as Partial<ResolvedAddress>
  const itmX = foundationAddr.itm_x!
  const itmY = foundationAddr.itm_y!

  // 2. Tier-2 fan-out.
  const [renewalLayer, planningSchemes, cityRenewal, landUse] = await Promise.all([
    timed(fetchUrbanRenewalLayer(itmX, itmY)),
    timed(fetchPlanningSchemes(itmX, itmY)),
    timed(fetchCityUrbanRenewal(city)),
    timed(fetchLandUse(itmX, itmY)),
  ])

  // 3. Aggregate.
  const all = [foundation, renewalLayer, planningSchemes, cityRenewal, landUse]
  const signals: Signal[] = []
  for (const r of all) if (r.result?.signals) signals.push(...r.result.signals)
  const ranked = rankSignals(signals)

  const address: ResolvedAddress = {
    city,
    street,
    number: building_number,
    formatted: foundationAddr.formatted ?? addressFreeText,
    gush:    foundationAddr.gush,
    chelka:  foundationAddr.chelka,
    lot_sqm: foundationAddr.lot_sqm,
    lat:     foundationAddr.lat,
    lon:     foundationAddr.lon,
    itm_x:   foundationAddr.itm_x,
    itm_y:   foundationAddr.itm_y,
  }

  // Deterministic rubric — same inputs always produce the same numbers,
  // and each source contributes a fixed share of the report regardless of
  // which signals fired this run. Defined later inside `response` below.
  const userInputs = { apartments_count, commercial }
  const rubric  = evaluateRubric(ranked, { lot_sqm: address.lot_sqm }, [], userInputs)
  const score   = rubric.score
  const bucket  = bucketize(score)
  const engineCtx = { address, signals: ranked, score, bucket }
  const track = recommendTrack(engineCtx)

  const sourceOrder: Array<{ name: SourceName; run: RunResult }> = [
    { name: 'govmap',        run: foundation      },
    { name: 'govmap',        run: renewalLayer    },
    { name: 'mavat',         run: planningSchemes },
    { name: 'data.gov.il',   run: cityRenewal     },
    { name: 'mavat.landuse', run: landUse         },
  ]
  // Collapse the two govmap rows into one for the user-facing footer.
  const sourcesByName = new Map<SourceName, SourceResult>()
  for (const { name, run } of sourceOrder) {
    const status = classify(run)
    const existing = sourcesByName.get(name)
    if (!existing) {
      sourcesByName.set(name, { name, status, duration_ms: run.ms })
    } else {
      // Prefer "success" over "failed" if any sub-call succeeded.
      const better: SourceStatus =
        existing.status === 'success' || status === 'success' ? 'success'
        : existing.status === 'partial' || status === 'partial' ? 'partial'
        : existing.status === 'failed'  && status === 'failed'  ? 'failed'
        : 'failed'
      sourcesByName.set(name, {
        name,
        status: better,
        duration_ms: existing.duration_ms + run.ms,
      })
    }
  }

  const sourcesUsed = Array.from(sourcesByName.values())
  // Re-run the rubric with the now-known sourcesUsed so the notes on
  // `source_contributions` can flag failed sources accurately.
  const rubric2 = evaluateRubric(ranked, { lot_sqm: address.lot_sqm }, sourcesUsed, userInputs)

  const response: EvaluateResponse = {
    address,
    score,
    bucket,
    signals: ranked,
    categories: rubric2.categories,
    source_contributions: rubric2.source_contributions,
    summary_he: summaryHe(engineCtx),
    recommended_track: track,
    single_building_feasible: singleBuildingFeasible(engineCtx),
    expected_time_years: expectedTimeYears(track),
    recommendations: recommendations(engineCtx, track),
    sources_used: sourcesUsed,
    generated_at: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  }

  reportCache.set(key, response)
  res.json(response)
}

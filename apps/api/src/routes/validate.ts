// GET /api/validate-address?city=...&street=...&number=...
//
// Cheap inline check against GovMap's FreeSearch so the AddressPicker can
// show ✓ / ⚠ / ✗ as the user types the building number. Results are cached
// in the shared geocodeCache, so the eventual /api/evaluate call reuses
// them — zero extra GovMap hits.
//
// Response shapes:
//   { status: 'address',   formatted, view_url }  // valid house number (ADDR_V1)
//   { status: 'street',    formatted }            // street exists, number missing/wrong
//   { status: 'not_found' }                       // GovMap returned nothing
//   { status: 'error', error }                    // upstream timeout / 5xx

import type { Request, Response } from 'express'
import { geocode } from '../sources/govmap.js'

export async function validateAddressHandler(req: Request, res: Response) {
  const city   = String(req.query.city   ?? '').trim()
  const street = String(req.query.street ?? '').trim()
  const number = String(req.query.number ?? '').trim()

  if (!city || !street) {
    res.json({ status: 'idle' })
    return
  }

  const text = number ? `${street} ${number} ${city}` : `${street} ${city}`

  try {
    const hit = await geocode(text)
    if (!hit) {
      res.json({ status: 'not_found' })
      return
    }
    if (hit.kind === 'address') {
      res.json({
        status: 'address',
        formatted: hit.label,
        view_url: `https://www.govmap.gov.il/?c=${hit.itmX},${hit.itmY}&z=10`,
      })
      return
    }
    if (hit.kind === 'street') {
      res.json({ status: 'street', formatted: hit.label })
      return
    }
    res.json({ status: 'other', formatted: hit.label })
  } catch (e: any) {
    console.error('[validate-address]', e?.message)
    res.status(500).json({ status: 'error', error: e?.message ?? 'validation error' })
  }
}

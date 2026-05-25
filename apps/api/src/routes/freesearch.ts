// /api/freesearch?q=... — public autocomplete endpoint.
// Returns up to 8 parsed address suggestions from GovMap FreeSearch.
// Used by the Asset Rise landing-page hero so users can type free text
// like "דיזנגוף 50 תל אביב" and pick from a dropdown.

import type { Request, Response } from 'express'
import { freeSearchSuggest } from '../sources/govmap.js'

export async function freeSearchHandler(req: Request, res: Response) {
  const q = typeof req.query.q === 'string' ? req.query.q : ''
  if (!q.trim() || q.trim().length < 2) {
    res.json({ results: [] })
    return
  }
  try {
    const results = await freeSearchSuggest(q, 8)
    res.json({ results })
  } catch (e: any) {
    res.status(502).json({ error: 'upstream geocoder unavailable', detail: e?.message ?? null })
  }
}

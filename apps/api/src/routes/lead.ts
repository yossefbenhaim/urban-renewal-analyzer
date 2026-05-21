// POST /api/lead — capture a lead before they're allowed to run an
// evaluation. Writes append-only to `/data/leads.jsonl` (mounted volume in
// docker-compose) so the file survives container restarts and the future
// Silver Castle CRM can ingest it directly without an extra DB layer.

import type { Request, Response } from 'express'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

const LeadInput = z.object({
  name:    z.string().trim().min(2).max(80),
  phone:   z.string().trim().min(6).max(40),
  email:   z.string().trim().email().max(160),
  agreed:  z.literal(true, { error: 'יש לאשר את תנאי השימוש' }),
  // Optional context — populated when the user has already searched an
  // address from the same session. Helps the lead row carry the intent.
  city:            z.string().trim().max(80).optional(),
  street:          z.string().trim().max(120).optional(),
  building_number: z.string().trim().max(20).optional(),
})

const LEADS_FILE = process.env.LEADS_FILE ?? '/data/leads.jsonl'

let dirReady = false
async function ensureDir() {
  if (dirReady) return
  await mkdir(dirname(LEADS_FILE), { recursive: true })
  dirReady = true
}

export async function leadHandler(req: Request, res: Response) {
  const parsed = LeadInput.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid input' })
    return
  }
  const row = {
    ts:    new Date().toISOString(),
    ip:    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? '',
    ua:    (req.headers['user-agent'] as string | undefined) ?? '',
    ...parsed.data,
  }
  try {
    await ensureDir()
    await appendFile(LEADS_FILE, JSON.stringify(row) + '\n', 'utf8')
  } catch (e: any) {
    console.error('[lead] write failed:', e?.message)
    // Don't block the user — the lead going unstored is better than blocking
    // the report. We log the failure for ops.
  }
  res.json({ ok: true })
}

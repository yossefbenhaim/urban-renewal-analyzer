// POST /api/lead — capture a lead before they're allowed to run an
// evaluation. Writes append-only to `/data/leads.jsonl` (mounted volume in
// docker-compose) so the file survives container restarts. Also forwards
// the lead to the Silver Castle / Asset Rise admin CRM in real time.

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
const CRM_URL    = process.env.CRM_LEADS_URL ?? 'https://admin.byclick.co.il/api/trpc/leads.create'

let dirReady = false
async function ensureDir() {
  if (dirReady) return
  await mkdir(dirname(LEADS_FILE), { recursive: true })
  dirReady = true
}

// Fire-and-forget POST to the Asset Rise CRM. tRPC v10 single-procedure
// HTTP transport (no data transformer) expects the body to be the raw
// input object. Failures are logged but never block the user — local
// jsonl is the source of truth, CRM is just a mirror.
async function forwardToCrm(payload: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(CRM_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[lead→crm] HTTP', res.status, text.slice(0, 200))
    }
  } catch (e: any) {
    console.error('[lead→crm] fetch failed:', e?.message ?? e)
  }
}

export async function leadHandler(req: Request, res: Response) {
  const parsed = LeadInput.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid input' })
    return
  }
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? ''
  const ua = (req.headers['user-agent'] as string | undefined) ?? ''

  const row = {
    ts: new Date().toISOString(),
    ip, ua,
    ...parsed.data,
  }
  try {
    await ensureDir()
    await appendFile(LEADS_FILE, JSON.stringify(row) + '\n', 'utf8')
  } catch (e: any) {
    console.error('[lead] write failed:', e?.message)
  }

  // Mirror to the CRM. Map URA's (city, street, building_number) into the
  // CRM's combined `building_address` field. We do NOT await — the report
  // page shouldn't be slowed by an outbound HTTP call.
  const buildingAddress = [parsed.data.street, parsed.data.building_number].filter(Boolean).join(' ').trim()
  void forwardToCrm({
    name:  parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email,
    city:  parsed.data.city,
    building_address: buildingAddress || undefined,
    source: 'analyzer',
    utm_source: 'urban-renewal-analyzer',
  })

  res.json({ ok: true })
}

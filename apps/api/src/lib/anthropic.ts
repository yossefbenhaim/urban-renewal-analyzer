// Claude API wrapper for structured extraction + cross-validation.
//
// Design points:
//   • Direct fetch — no SDK — matches the rest of the codebase and avoids
//     dragging anthropic-sdk's transitive deps into the API container.
//   • Temperature 0 + disk cache → same input always produces the same
//     output. The rubric stays deterministic from the caller's view: a
//     given (system_prompt, user_prompt) pair returns the same JSON
//     forever (until you bump `version` on the cache).
//   • Prompt caching (anthropic-beta) on the system block — extraction
//     calls share the same long schema description so the cache pays for
//     itself after the first call.
//   • If ANTHROPIC_API_KEY is unset the wrapper returns null so the
//     adapter can degrade to a "source failed" outcome instead of
//     crashing the whole evaluate.

import { diskCacheGet, diskCacheSet } from './disk_cache.js'

const API_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = process.env.URA_LLM_MODEL ?? 'claude-sonnet-4-6'
const DEFAULT_TIMEOUT_MS = 30_000

interface CallOptions {
  system: string                   // system prompt — cached via prompt caching
  user: string                     // per-request user content
  maxTokens?: number               // defaults to 1024 (extractions are small)
  cacheNamespace: string           // disk-cache bucket name
  cacheVersion?: number            // bump to invalidate
}

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
  error?: { type?: string; message?: string }
}

function readApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null
}

async function callRaw(opts: CallOptions, signal: AbortSignal): Promise<{ text: string; model: string } | null> {
  const key = readApiKey()
  if (!key) {
    console.warn('[anthropic] ANTHROPIC_API_KEY missing — skipping LLM call')
    return null
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: 0,
      system: [
        {
          type: 'text',
          text: opts.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: opts.user }],
    }),
    signal,
  })
  const body = (await res.json()) as ClaudeResponse
  if (!res.ok || body.error) {
    throw new Error(`Anthropic HTTP ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}`)
  }
  const text = body.content?.find(c => c.type === 'text')?.text?.trim()
  if (!text) throw new Error(`Anthropic returned empty content`)
  return { text, model: body.model ?? DEFAULT_MODEL }
}

// Cached structured extraction. The cache key includes the system+user
// text so any change to either invalidates the cached output.
export async function extractJson<T = unknown>(opts: CallOptions): Promise<{ value: T | null; cached: boolean; model: string }> {
  const cacheKey = `${opts.system}\n----\n${opts.user}`
  const cacheOpts = { namespace: opts.cacheNamespace, version: opts.cacheVersion ?? 1 }
  type Cached = { value: T; model: string }
  const hit = await diskCacheGet<Cached>(cacheKey, cacheOpts)
  if (hit) return { value: hit.value, cached: true, model: hit.model }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const raw = await callRaw(opts, controller.signal)
    if (!raw) return { value: null, cached: false, model: DEFAULT_MODEL }
    let parsed: T
    try {
      parsed = parseJsonStrict<T>(raw.text)
    } catch (e: any) {
      console.error('[anthropic] JSON parse failed:', e?.message, 'raw:', raw.text.slice(0, 200))
      return { value: null, cached: false, model: raw.model }
    }
    await diskCacheSet(cacheKey, { value: parsed, model: raw.model } satisfies Cached, cacheOpts)
    return { value: parsed, cached: false, model: raw.model }
  } catch (e: any) {
    console.error('[anthropic] call failed:', e?.message ?? e)
    return { value: null, cached: false, model: DEFAULT_MODEL }
  } finally {
    clearTimeout(timer)
  }
}

// Lenient JSON parser — Claude sometimes wraps JSON in ```json fences
// when we don't push hard enough in the system prompt. Strip that
// pattern before parsing.
function parseJsonStrict<T>(raw: string): T {
  let s = raw.trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  }
  // Cut off any leading prose before the first { or [.
  const firstBrace = s.search(/[{[]/)
  if (firstBrace > 0) s = s.slice(firstBrace)
  return JSON.parse(s) as T
}

export function llmModelInUse(): string {
  return DEFAULT_MODEL
}

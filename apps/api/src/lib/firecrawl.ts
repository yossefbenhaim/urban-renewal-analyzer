// Firecrawl scrape wrapper — converts an HTML page to clean markdown for
// downstream LLM extraction. No SDK; raw fetch keeps the dependency
// surface flat and matches the rest of the codebase.
//
// Caching is integral: a URL's markdown is stable for the 7-day TTL, so
// the second call for the same URL is free + deterministic.
//
// API key required via FIRECRAWL_API_KEY. If the var is unset, every call
// returns null (without throwing) so the adapter degrades cleanly to a
// "source failed" outcome instead of crashing the whole evaluate.

import { diskCacheGet, diskCacheSet } from './disk_cache.js'

const FIRECRAWL_URL = 'https://api.firecrawl.dev/v1/scrape'
const DEFAULT_TIMEOUT_MS = 25_000    // scrape can be slow; gov sites in Hebrew often take 10-15s

export interface FirecrawlScrape {
  url: string
  markdown: string
  title?: string
  fetched_at: string
}

async function scrapeRaw(url: string, signal?: AbortSignal): Promise<FirecrawlScrape | null> {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) {
    console.warn('[firecrawl] FIRECRAWL_API_KEY missing — skipping scrape', url)
    return null
  }
  const res = await fetch(FIRECRAWL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      // Hebrew gov pages — leave default browser behavior; no JS rendering opts.
    }),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Firecrawl HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const body = (await res.json()) as {
    success?: boolean
    data?: { markdown?: string; metadata?: { title?: string } }
    error?: string
  }
  if (!body.success || !body.data?.markdown) {
    throw new Error(`Firecrawl returned no markdown for ${url}: ${body.error ?? 'unknown'}`)
  }
  return {
    url,
    markdown: body.data.markdown,
    title: body.data.metadata?.title,
    fetched_at: new Date().toISOString(),
  }
}

// Public API: scrape with disk cache.
//
// Caches successes only. Transient failures are NOT cached — that way a
// 503 or rate-limit doesn't stick for the full 7 days; the next caller
// gets a fresh attempt.
export async function scrape(url: string): Promise<{ scrape: FirecrawlScrape | null; cached: boolean }> {
  const cacheOpts = { namespace: 'firecrawl', version: 1 }
  const hit = await diskCacheGet<FirecrawlScrape>(url, cacheOpts)
  if (hit) return { scrape: hit, cached: true }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const fresh = await scrapeRaw(url, controller.signal)
    if (fresh) {
      await diskCacheSet(url, fresh, cacheOpts)
    }
    return { scrape: fresh, cached: false }
  } catch (e: any) {
    console.error('[firecrawl] scrape failed:', url, e?.message ?? e)
    return { scrape: null, cached: false }
  } finally {
    clearTimeout(timer)
  }
}

// Disk-backed cache for the LLM/Firecrawl pipeline.
//
// In-memory LRU isn't enough here: container restarts (deploys) would
// re-trigger paid scrape + extraction calls and break determinism
// ("same address yesterday = different report today" because the cache
// got blown away). We persist JSON files under /data/llm-cache so a
// 7-day window survives any number of restarts inside the volume.
//
// Key is hashed (SHA-256, hex) so callers can pass long strings (URLs,
// prompts) without worrying about filename safety.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

const DEFAULT_DIR = process.env.LLM_CACHE_DIR ?? '/data/llm-cache'
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000   // 7 days

interface CacheEntry<T> {
  ts: number          // Date.now() when written
  v: number           // schema version (bump to invalidate)
  value: T
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function pathFor(dir: string, namespace: string, key: string): string {
  const h = hashKey(key)
  // Shard by first 2 hex chars to keep any single directory small even
  // after thousands of entries.
  return join(dir, namespace, h.slice(0, 2), `${h}.json`)
}

let dirReady = new Set<string>()
async function ensureDir(dir: string) {
  if (dirReady.has(dir)) return
  await mkdir(dir, { recursive: true })
  dirReady.add(dir)
}

export interface DiskCacheOptions {
  namespace: string                 // e.g. 'firecrawl', 'anthropic'
  version?: number                  // bump to invalidate all entries (defaults to 1)
  ttlMs?: number                    // override 7-day default
  dir?: string                      // override /data/llm-cache (tests, dev)
}

export async function diskCacheGet<T>(
  key: string,
  opts: DiskCacheOptions,
): Promise<T | null> {
  const dir = opts.dir ?? DEFAULT_DIR
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS
  const version = opts.version ?? 1
  const file = pathFor(dir, opts.namespace, key)
  try {
    const buf = await readFile(file, 'utf8')
    const entry = JSON.parse(buf) as CacheEntry<T>
    if (entry.v !== version) return null
    if (Date.now() - entry.ts > ttl) return null
    return entry.value
  } catch {
    return null
  }
}

export async function diskCacheSet<T>(
  key: string,
  value: T,
  opts: DiskCacheOptions,
): Promise<void> {
  const dir = opts.dir ?? DEFAULT_DIR
  const version = opts.version ?? 1
  const file = pathFor(dir, opts.namespace, key)
  const entry: CacheEntry<T> = { ts: Date.now(), v: version, value }
  try {
    await ensureDir(dirname(file))
    await writeFile(file, JSON.stringify(entry), 'utf8')
  } catch (e: any) {
    // Cache failure should never break a request — log + move on.
    console.error('[disk_cache] write failed:', file, e?.message ?? e)
  }
}

// Convenience wrapper: get-or-compute pattern with a single call.
export async function diskCacheWrap<T>(
  key: string,
  opts: DiskCacheOptions,
  compute: () => Promise<T>,
): Promise<{ value: T; cached: boolean }> {
  const hit = await diskCacheGet<T>(key, opts)
  if (hit !== null) return { value: hit, cached: true }
  const value = await compute()
  await diskCacheSet(key, value, opts)
  return { value, cached: false }
}

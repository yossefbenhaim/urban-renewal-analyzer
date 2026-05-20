// Thin wrapper around global fetch that adds:
//   • AbortController-driven timeouts (default 4 s)
//   • a single retry on transient errors with jittered backoff
//   • automatic JSON parsing when content-type is application/json
//
// Each source adapter calls this so they all share the same timeout
// behaviour and the orchestrator can safely Promise.allSettled them.

export interface FetchOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  retries?: number
}

export class HttpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const {
    method  = 'GET',
    body,
    headers = {},
    timeoutMs = 4000,
    retries   = 1,
  } = opts

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) {
        // 5xx → retry; 4xx → fail fast
        if (res.status >= 500 && attempt < retries) {
          await sleep(jitter(150 + attempt * 200))
          continue
        }
        throw new HttpError(`HTTP ${res.status} for ${url}`, res.status)
      }
      const text = await res.text()
      if (!text) return undefined as T
      try {
        return JSON.parse(text) as T
      } catch {
        // Some gov.il endpoints occasionally return a JSON envelope wrapped
        // in HTML on error pages — surface the first 200 chars so logs are
        // actually useful when diagnosing.
        throw new HttpError(`bad JSON from ${url}: ${text.slice(0, 200)}`)
      }
    } catch (err: any) {
      clearTimeout(timer)
      lastErr = err
      const abort = err?.name === 'AbortError'
      if (attempt < retries && (abort || err instanceof HttpError === false)) {
        await sleep(jitter(150 + attempt * 200))
        continue
      }
      break
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }
function jitter(ms: number) { return ms + Math.floor(Math.random() * 100) }

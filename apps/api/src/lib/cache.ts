// In-process LRU. Keyed by canonical address string. 1 h TTL is short enough
// that newly-published plans show up quickly but long enough that the second
// load of the same address from the same browser is instant.

import { LRUCache } from 'lru-cache'
import type { EvaluateResponse } from '../types.js'

// 24 h TTL — gov source datasets change slowly (plans, declared areas,
// city policy). Longer TTL ALSO makes repeated lookups deterministic for
// the user: same address, same score, no surprise variance when one
// upstream source is transiently slow.
export const reportCache = new LRUCache<string, EvaluateResponse>({
  max: 500,
  ttl: 24 * 60 * 60 * 1000,
})

export function cacheKey(city: string, street: string, number: string): string {
  return `${city.trim()}|${street.trim()}|${number.trim()}`
}

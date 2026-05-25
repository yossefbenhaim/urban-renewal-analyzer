// municipal_web — a sixth data source on top of the five structured APIs.
// For each city we know about, scrapes 1-3 municipal pages via Firecrawl,
// hands the markdown to Claude with a frozen Zod schema, and emits
// Signals tagged with `municipal_policy` / `projects_in_city`.
//
// Determinism: temperature 0 + 7-day disk cache (per URL + per system+user
// prompt). The cache layer makes "same city = same JSON" hold across
// container restarts, deploys, and parallel evaluate calls.
//
// Failure semantics: if Firecrawl returns nothing (rate limit, 503) or
// Claude returns malformed JSON, the adapter returns `ok:true` with an
// empty signals array (NOT failed) — the rubric already knows how to
// score "no signal" via the placeholder branch.

import { scrape, type FirecrawlScrape } from '../lib/firecrawl.js'
import { extractJson } from '../lib/anthropic.js'
import { lookupCitySources } from './municipal_sources.js'
import type { Signal, SourceFetchResult } from '../types.js'

// Frozen extraction schema. Claude is told to return EXACTLY these
// fields — anything else is ignored. Bump CACHE_VERSION when this
// schema changes so old entries get invalidated.
const CACHE_VERSION = 1

interface MunicipalExtraction {
  // Does the page describe an active urban-renewal program at all?
  has_active_program: boolean
  // Rough count of declared mitchamim / project areas mentioned, or null.
  declared_areas_count: number | null
  // Did the page mention an explicit policy stance favoring renewal?
  policy_stance: 'supportive' | 'neutral' | 'restrictive' | 'unknown'
  // 0-2 short Hebrew bullets summarizing what was found.
  key_findings: string[]
  // Any specific addresses / streets named (free text). Helps when the
  // user's address matches an in-progress project.
  named_addresses: string[]
}

const SYSTEM_PROMPT = `אתה כלי חילוץ עובדות מדפי אינטרנט של עיריות בישראל בנושא התחדשות עירונית (פינוי-בינוי / תמ"א 38).

המשימה: לקרוא markdown של דף עירייה, לחלץ עובדות מובנות, ולהחזיר JSON אחד בלבד - ללא טקסט נוסף, ללא code fences.

הסכמה בדיוק:
{
  "has_active_program": boolean,           // האם העיר מציגה תוכנית פעילה להתחדשות?
  "declared_areas_count": number | null,   // מספר מתחמים מוכרזים שמוזכרים. null אם לא ברור.
  "policy_stance": "supportive" | "neutral" | "restrictive" | "unknown",
  "key_findings": string[],                // 0-2 בולטים קצרים בעברית, כל אחד עד 20 מילים
  "named_addresses": string[]              // רחובות/מתחמים ספציפיים שמוזכרים בדף
}

כללים:
- אסור להמציא מספרים. אם אתה לא בטוח, declared_areas_count = null.
- key_findings בעברית, ענייני, ללא שיווק.
- policy_stance = "supportive" רק אם העירייה כותבת במפורש שהיא תומכת/מעודדת.
- אם הדף ריק/לא רלוונטי: has_active_program=false, count=null, stance="unknown", arrays ריקים.
- החזר JSON גולמי בלבד. בלי הסברים. בלי \\\`\\\`\\\`.`

function buildUserPrompt(city: string, scrape: FirecrawlScrape): string {
  // Truncate to keep cost predictable. 12k chars ≈ 3k tokens of Hebrew.
  const md = scrape.markdown.slice(0, 12_000)
  return `עיר: ${city}\nכתובת המקור: ${scrape.url}\nכותרת: ${scrape.title ?? '(ללא)'}\n\nתוכן הדף:\n${md}`
}

function extractionToSignals(
  city: string,
  url: string,
  ex: MunicipalExtraction,
  sourceFetchedAt: string,
): Signal[] {
  const out: Signal[] = []

  // Signal 1: overall program presence → municipal_policy category.
  if (ex.has_active_program && ex.policy_stance === 'supportive') {
    out.push({
      kind: 'positive',
      weight: 6,
      title: `${city} - מדיניות התחדשות פעילה`,
      description: ex.key_findings[0] ?? 'אתר העירייה מציג תוכנית פעילה להתחדשות עירונית.',
      source: 'municipal_web',
      category: 'municipal_policy',
      url,
    })
  } else if (ex.has_active_program) {
    out.push({
      kind: 'neutral',
      weight: 3,
      title: `${city} - מידע על התחדשות`,
      description: ex.key_findings[0] ?? 'אתר העירייה מתייחס להתחדשות עירונית ללא הצהרת מדיניות מפורשת.',
      source: 'municipal_web',
      category: 'municipal_policy',
      url,
    })
  } else if (ex.policy_stance === 'restrictive') {
    out.push({
      kind: 'negative',
      weight: -4,
      title: `${city} - מדיניות מגבילה`,
      description: ex.key_findings[0] ?? 'אתר העירייה מציג עמדה מגבילה כלפי התחדשות עירונית.',
      source: 'municipal_web',
      category: 'municipal_policy',
      url,
    })
  }

  // Signal 2: count of declared areas → reinforces projects_in_city
  // when data.gov.il already saw them, OR provides the only datapoint
  // when data.gov.il was missing/stale.
  if (typeof ex.declared_areas_count === 'number' && ex.declared_areas_count > 0) {
    out.push({
      kind: 'positive',
      weight: 4,
      title: `${city} - ${ex.declared_areas_count} מתחמים בעיר`,
      description: `אתר העירייה מציג ${ex.declared_areas_count} מתחמי התחדשות. נסרק ב-${sourceFetchedAt.slice(0, 10)}.`,
      source: 'municipal_web',
      category: 'projects_in_city',
      url,
    })
  }

  return out
}

export async function fetchMunicipalWeb(city: string): Promise<SourceFetchResult> {
  const sources = lookupCitySources(city)
  if (sources.length === 0) {
    return {
      ok: true,
      signals: [],
      partial: true,
      raw: { skipped: true, reason: `no municipal sources configured for "${city}"` },
    }
  }

  const signals: Signal[] = []
  let anyOk = false

  // Scrape pages SEQUENTIALLY to stay within Firecrawl rate limits and
  // keep the API container's working set small. With cache hits this is
  // ~10ms; cache misses are 5-15s and we'd hit rate limits in parallel.
  for (const source of sources) {
    const { scrape: page } = await scrape(source.url)
    if (!page) continue

    const { value: extraction, model } = await extractJson<MunicipalExtraction>({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(city, page),
      cacheNamespace: 'municipal_extraction',
      cacheVersion: CACHE_VERSION,
      maxTokens: 600,
    })
    if (!extraction) continue
    anyOk = true

    // Belt-and-suspenders validation — Claude is told to obey the schema
    // but we still gate every field before turning it into Signals.
    const safe: MunicipalExtraction = {
      has_active_program: extraction.has_active_program === true,
      declared_areas_count:
        typeof extraction.declared_areas_count === 'number' && extraction.declared_areas_count >= 0
          ? Math.round(extraction.declared_areas_count)
          : null,
      policy_stance: ['supportive', 'neutral', 'restrictive', 'unknown'].includes(extraction.policy_stance)
        ? extraction.policy_stance
        : 'unknown',
      key_findings: Array.isArray(extraction.key_findings)
        ? extraction.key_findings.filter(s => typeof s === 'string').slice(0, 2)
        : [],
      named_addresses: Array.isArray(extraction.named_addresses)
        ? extraction.named_addresses.filter(s => typeof s === 'string').slice(0, 10)
        : [],
    }

    signals.push(...extractionToSignals(city, source.url, safe, page.fetched_at))
    void model // captured per-call inside the cache; not needed in the signal
  }

  return {
    ok: true,
    signals,
    partial: !anyOk,
    raw: { sources_attempted: sources.length, signals_emitted: signals.length },
  }
}

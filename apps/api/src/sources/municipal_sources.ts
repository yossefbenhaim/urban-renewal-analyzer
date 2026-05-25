// Per-city seed URLs for the municipal_web adapter. Each city gets a
// short list of 1-3 pages that describe the city's urban-renewal policy
// or its declared mitchamim. Firecrawl converts them to markdown, then
// Claude extracts structured facts.
//
// IMPORTANT: these URLs are starting points only. Verify each one by
// opening it in a browser before relying on the output. If a city
// publishes its policy at a different URL, swap it here — the cache
// key is the URL itself, so old cached entries auto-expire on change.
//
// Adding a new city: add an entry to MUNICIPAL_SOURCES below; the cache
// will populate itself on the first lookup. No other code changes
// needed — the adapter reads this table on every call.

export interface CitySource {
  url: string
  // Short label for logs / debugging. Not shown to the user.
  label: string
}

export const MUNICIPAL_SOURCES: Record<string, CitySource[]> = {
  // Haifa — אגף שיפור פני העיר / מינהל ההנדסה
  'חיפה': [
    {
      url: 'https://www.haifa.muni.il/residents/construction-and-planning/urban-renewal/',
      label: 'Haifa — urban renewal landing',
    },
  ],

  // Tel Aviv–Yafo — מינהלת ההתחדשות העירונית
  'תל אביב-יפו': [
    {
      url: 'https://www.tel-aviv.gov.il/Residents/Planning/Pages/urbanRenewal.aspx',
      label: 'Tel Aviv — urban renewal',
    },
  ],
  'תל אביב': [
    {
      url: 'https://www.tel-aviv.gov.il/Residents/Planning/Pages/urbanRenewal.aspx',
      label: 'Tel Aviv — urban renewal',
    },
  ],

  // Ramat Gan — אגף ההתחדשות העירונית
  'רמת גן': [
    {
      url: 'https://www.ramat-gan.muni.il/Residents/CityPlanning/Pages/urban-renewal.aspx',
      label: 'Ramat Gan — urban renewal',
    },
  ],

  // Jerusalem — מינהלת ההתחדשות העירונית
  'ירושלים': [
    {
      url: 'https://www.jerusalem.muni.il/he/residents/planningandbuilding/urbanRenewal/',
      label: 'Jerusalem — urban renewal',
    },
  ],
}

// Normalize a city string (trim, fold common variants) before lookup.
// data.gov.il and govmap occasionally pad city names with spaces or
// drop the hyphen in "תל אביב-יפו".
export function lookupCitySources(rawCity: string): CitySource[] {
  const c = rawCity.trim()
  if (MUNICIPAL_SOURCES[c]) return MUNICIPAL_SOURCES[c]
  // Drop trailing "-יפו" → try the base form.
  const noYafo = c.replace(/-יפו$/, '').trim()
  if (MUNICIPAL_SOURCES[noYafo]) return MUNICIPAL_SOURCES[noYafo]
  return []
}

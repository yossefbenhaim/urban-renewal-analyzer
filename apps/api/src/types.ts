// Public response contract — kept in one place so both the engine and the
// web client agree on the shape. If you change a field name here, update
// apps/web/src/types.ts and the renderer at the same time.

export type SignalKind = 'positive' | 'negative' | 'neutral'

export interface Signal {
  kind: SignalKind
  weight: number            // signed int; engine sums these into the raw score
  title: string             // headline shown as the bullet
  description: string       // 1-2 sentences explaining the impact in Hebrew
  source: SourceName        // which adapter produced this signal
  category?: CategoryKey    // which UI category this rolls up into
  url?: string              // public URL where the user can verify the underlying source data
}

export type SourceName =
  | 'govmap'
  | 'mavat'
  | 'data.gov.il'
  | 'mavat.landuse'
  | 'data.gov.il.buildingsites'

export type SourceStatus = 'success' | 'partial' | 'failed' | 'skipped'

export interface SourceResult {
  name: SourceName
  status: SourceStatus
  duration_ms: number
}

export interface ResolvedAddress {
  formatted: string
  city: string
  street: string
  number: string
  gush?: number
  chelka?: number
  lot_sqm?: number
  lat?: number              // WGS84 latitude
  lon?: number              // WGS84 longitude
  itm_x?: number            // EPSG:2039 easting
  itm_y?: number            // EPSG:2039 northing
}

export type Bucket = 'very_high' | 'high' | 'moderate' | 'low' | 'very_low'

export type Track =
  | 'tama_38'
  | 'pinui_binui_single'
  | 'pinui_binui_complex'
  | 'unlikely'

export interface EvaluateRequest {
  city: string
  street: string
  building_number: string
  // Optional resident-supplied facts. When provided they drive the new
  // `density` + `commercial_mix` categories. When missing the engine falls
  // back to lot-only heuristics for density and skips commercial entirely.
  apartments_count?: number
  commercial?: CommercialLevel
}

// Categorized signal view — the report UI renders one row per category in
// a stable order so reports look comparable across addresses. A category
// can be `found:true` (✅/⚠️ depending on signal kind) or `found:false`
// (rendered as a neutral · row, "no data" copy).
export type CategoryKey =
  | 'planning_schemes'    // תכנון / זכויות בנייה
  | 'urban_renewal_area'  // מתחם מוכרז
  | 'projects_in_city'    // פרויקטים פעילים בעיר
  | 'municipal_policy'    // מדיניות עירונית
  | 'land_use'            // שימושי קרקע
  | 'density'             // יחס שטח מגרש ↔ מס׳ דירות (חדש)
  | 'commercial_mix'      // מורכבות מסחרית בבניין (חדש)
  | 'city_build_activity' // אתרי בנייה פעילים בעיר (חדש)

export type CommercialLevel = 'none' | 'small' | 'large' | 'unknown'

export interface Category {
  key: CategoryKey
  emoji: '✅' | '⚠️' | '·'
  title: string                 // "זכויות בנייה" etc.
  summary: string               // one-sentence finding
  impact: string                // one-sentence "what it means for the building"
  detail?: string               // specific data — plan IDs, m², counts. Rendered below impact.

  // Deterministic rubric fields — same input always produces the same numbers:
  weight: number                // fixed % budget of this category in the report (sums to 100 across all categories)
  subscore: number              // 0–100 — the rubric's evaluation of this category
  contribution: number          // (subscore × weight) / 100 — points added to the final score

  // Legacy mirrors kept while older clients catch up. Both equal the
  // deterministic fields above.
  weight_contribution: number
  weight_pct: number

  source: SourceName
  found: boolean
  url?: string                  // verifiable source URL pulled from the underlying Signal
}

export interface SourceContribution {
  name: SourceName

  // Deterministic fields — only depend on which categories the source owns,
  // never on what fired this run.
  fixed_pct: number             // sum of weights of the categories this source owns (always the same across runs)
  contribution: number          // sum of points this source actually contributed to the score this run
  categories: CategoryKey[]     // category keys this source owns

  // Legacy mirrors (kept for older clients):
  positive_weight: number
  negative_weight: number
  total_weight: number
  pct_of_total: number          // alias of fixed_pct
  signals_count: number
  failed: boolean
  note?: string
}

export interface EvaluateResponse {
  address: ResolvedAddress
  score: number             // 0-100
  bucket: Bucket
  signals: Signal[]         // raw signals, ordered by |weight| desc
  categories: Category[]    // user-facing categorized rows, stable order
  source_contributions: SourceContribution[]
  summary_he: string        // one-line headline
  recommended_track: Track
  single_building_feasible: boolean
  expected_time_years: { min: number; max: number }
  recommendations: string[] // 5-7 Hebrew action items
  sources_used: SourceResult[]
  generated_at: string      // ISO timestamp
  disclaimer: string
}

// Internal: every source adapter returns this shape so the orchestrator can
// flatten signals from all sources and tally `sources_used`.
export interface SourceFetchResult {
  ok: boolean
  signals: Signal[]
  partial?: boolean         // true when adapter completed but with missing fields
  // Adapters that contribute to the resolved address (GovMap) attach the
  // canonical fields here so the orchestrator can merge them in.
  address?: Partial<ResolvedAddress>
  raw?: unknown             // kept for /debug endpoints in dev; not exposed publicly
}

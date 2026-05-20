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
}

export type SourceName =
  | 'govmap'
  | 'mavat'
  | 'data.gov.il'

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
}

export interface EvaluateResponse {
  address: ResolvedAddress
  score: number             // 0-100
  bucket: Bucket
  signals: Signal[]         // ordered by |weight| desc
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

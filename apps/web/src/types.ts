// Mirror of apps/api/src/types.ts — keep them in sync. The web app only
// reads these; the server is the source of truth.

export type SignalKind = 'positive' | 'negative' | 'neutral'

export type SourceName =
  | 'govmap'
  | 'mavat'
  | 'data.gov.il'
  | 'mavat.landuse'

export type CategoryKey =
  | 'planning_schemes'
  | 'urban_renewal_area'
  | 'projects_in_city'
  | 'municipal_policy'
  | 'lot_size'
  | 'land_use'

export interface Signal {
  kind: SignalKind
  weight: number
  title: string
  description: string
  source: SourceName
  category?: CategoryKey
}

export interface Category {
  key: CategoryKey
  emoji: '✅' | '⚠️' | '·'
  title: string
  summary: string
  impact: string
  weight_contribution: number
  weight_pct: number
  source: SourceName
  found: boolean
}

export interface SourceContribution {
  name: SourceName
  positive_weight: number
  negative_weight: number
  total_weight: number
  pct_of_total: number
}

export type Bucket = 'very_high' | 'high' | 'moderate' | 'low' | 'very_low'

export type Track =
  | 'tama_38'
  | 'pinui_binui_single'
  | 'pinui_binui_complex'
  | 'unlikely'

export interface ResolvedAddress {
  formatted: string
  city: string
  street: string
  number: string
  gush?: number
  chelka?: number
  lot_sqm?: number
  lat?: number
  lon?: number
  itm_x?: number
  itm_y?: number
}

export interface SourceResult {
  name: SourceName
  status: 'success' | 'partial' | 'failed' | 'skipped'
  duration_ms: number
}

export interface EvaluateResponse {
  address: ResolvedAddress
  score: number
  bucket: Bucket
  signals: Signal[]
  categories: Category[]
  source_contributions: SourceContribution[]
  summary_he: string
  recommended_track: Track
  single_building_feasible: boolean
  expected_time_years: { min: number; max: number }
  recommendations: string[]
  sources_used: SourceResult[]
  generated_at: string
  disclaimer: string
}

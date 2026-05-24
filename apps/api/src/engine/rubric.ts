// Deterministic appraiser-style scoring.
//
// The previous version summed signed `signal.weight` numbers + a baseline of
// 50, which made the per-source contribution percentage *relative* to whatever
// fired in any given run — two queries for the same address could return
// different proportions depending on which source happened to fail/succeed.
//
// This module replaces that with a fixed rubric:
//   1. Six categories with a fixed % budget (sum = 100).
//   2. Each category produces a 0–100 sub-score from a fixed lookup table.
//   3. The final score = Σ (subscore × weight) / 100 → always 0–100.
//   4. The per-source share is also fixed (deterministic): a source's % of the
//      report equals the sum of weights of the categories it owns, regardless
//      of what its signals returned this run.
//
// Same address ⇒ same numbers ⇒ trustable comparisons across runs.

import type {
  Category, CategoryKey, CommercialLevel, ResolvedAddress, Signal, SourceContribution, SourceName, SourceResult,
} from '../types.js'

// ─── Fixed category weights ─────────────────────────────────────────
// Reviewed with the same rough intuition a שמאי uses: actual planning is the
// strongest single signal, declared מתחם is the second strongest, then
// physical/policy/usage.

export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
  planning_schemes:    20,
  urban_renewal_area:  18,
  municipal_policy:    12,
  land_use:            12,
  density:             18,   // ↑ replaces stand-alone lot_size — now uses ratio
  commercial_mix:       8,   // ← new, complexity flag
  projects_in_city:     7,   // was 12 — 5 pts moved to city_build_activity
  city_build_activity:  5,   // ← active construction sites (משרד העבודה)
}

// Which source "owns" each category. Used to compute the deterministic
// per-source share of the report (always sums to 100).
export const CATEGORY_SOURCE: Record<CategoryKey, SourceName> = {
  planning_schemes:    'mavat',
  urban_renewal_area:  'govmap',
  municipal_policy:    'data.gov.il',
  projects_in_city:    'data.gov.il',
  land_use:            'mavat.landuse',
  density:             'govmap',                       // lot size from GovMap + user-supplied apartments
  commercial_mix:      'govmap',                       // category is driven by user input
  city_build_activity: 'data.gov.il.buildingsites',    // אתרי בנייה פעילים — משרד העבודה
}

const ORDER: CategoryKey[] = [
  'planning_schemes',
  'urban_renewal_area',
  'projects_in_city',
  'city_build_activity',
  'municipal_policy',
  'land_use',
  'density',
  'commercial_mix',
]

const TITLES: Record<CategoryKey, string> = {
  planning_schemes:    'תכנון וזכויות בנייה',
  urban_renewal_area:  'מתחם התחדשות מוכרז',
  projects_in_city:    'פרויקטים פעילים באזור',
  city_build_activity: 'פעילות בנייה בעיר',
  municipal_policy:    'מדיניות עירונית',
  land_use:            'שימושי קרקע',
  density:             'יחס מגרש ↔ דירות',
  commercial_mix:      'מורכבות מסחרית',
}

const PLACEHOLDER_IMPACT: Record<CategoryKey, string> = {
  planning_schemes:    'אין כרגע תכנון פעיל — תהליך התחדשות יתחיל מאוחר יותר.',
  urban_renewal_area:  'הכתובת לא בתוך מתחם מוכרז — דורש יזם שיגדיר מתחם חדש.',
  projects_in_city:    'אין פרויקטי התחדשות בביצוע כעת באזור.',
  city_build_activity: 'אין אתרי בנייה פעילים בעיר ברגע זה — אזור שקט.',
  municipal_policy:    'אין רשימת התחדשות מוכרזת בעיר.',
  land_use:            'יעוד הקרקע לא נטען — אין השפעה ידועה על ההיתכנות.',
  density:             'לא צוין מספר דירות — ההערכה מבוססת על שטח המגרש בלבד.',
  commercial_mix:      'לא צוין האם יש מסחרי בבניין — קטגוריה זו זמינה לאחר שתסמן.',
}

// ─── Per-category rubrics ───────────────────────────────────────────
// Each takes the strongest matching signal (and address for lot_size) and
// returns:
//   subscore — the deterministic 0..100 figure that drives the score
//   label    — short Hebrew copy explaining which rubric band we landed in
//   emoji    — ✅ / ⚠️ / · for the UI row

interface RubricOutcome {
  subscore: number
  label: string
  emoji: '✅' | '⚠️' | '·'
  detail?: string
  found: boolean
}

function pickStrongest(signals: Signal[]): Signal | null {
  if (signals.length === 0) return null
  let best = signals[0]
  for (const s of signals.slice(1)) {
    if (Math.abs(s.weight) > Math.abs(best.weight)) best = s
  }
  return best
}

function fmtEmoji(subscore: number): '✅' | '⚠️' | '·' {
  if (subscore >= 60) return '✅'
  if (subscore <= 30) return '⚠️'
  return '·'
}

function rubricPlanningSchemes(signals: Signal[]): RubricOutcome {
  const s = pickStrongest(signals)
  if (!s) return { subscore: 15, label: 'אין נתון', emoji: '·', found: false }
  const t = s.title
  if (/מאושר|פורסמ/.test(t))    return { subscore: 100, label: 'תכנית מאושרת', emoji: '✅', detail: s.description, found: true }
  if (/הפקד/.test(t))           return { subscore:  75, label: 'תכנית בהפקדה', emoji: '✅', detail: s.description, found: true }
  if (/בעיבוד|בייזום|בבדיק/.test(t)) return { subscore: 50, label: 'תכנית בעיבוד', emoji: '·', detail: s.description, found: true }
  if (/אין/.test(t))            return { subscore: 15, label: 'אין תכנון פעיל', emoji: '⚠️', detail: s.description, found: true }
  return { subscore: 30, label: 'תכנית רשומה', emoji: '·', detail: s.description, found: true }
}

function rubricUrbanRenewalArea(signals: Signal[]): RubricOutcome {
  const s = pickStrongest(signals)
  if (s && s.weight > 0) {
    return { subscore: 100, label: 'בתוך מתחם מוכרז', emoji: '✅', detail: s.description, found: true }
  }
  return { subscore: 20, label: 'לא בתוך מתחם', emoji: '⚠️', found: false }
}

function rubricProjectsInCity(signals: Signal[]): RubricOutcome {
  const s = pickStrongest(signals)
  if (!s) return { subscore: 15, label: 'אין נתון', emoji: '·', found: false }
  // Parse "N מתחמים בביצוע" from the description.
  const m = s.description.match(/(\d+)\s*מתחמים בביצוע/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 10) return { subscore: 100, label: `${n} מתחמים בביצוע`, emoji: '✅', detail: s.description, found: true }
    if (n >= 5)  return { subscore:  80, label: `${n} מתחמים בביצוע`, emoji: '✅', detail: s.description, found: true }
    if (n >= 1)  return { subscore:  60, label: `${n} מתחמים בביצוע`, emoji: '✅', detail: s.description, found: true }
  }
  if (/אין/.test(s.title)) return { subscore: 10, label: 'אין פרויקטים פעילים', emoji: '⚠️', detail: s.description, found: true }
  return { subscore: 35, label: 'מתחמים מוכרזים בלי ביצוע פעיל', emoji: '·', detail: s.description, found: true }
}

function rubricMunicipalPolicy(signals: Signal[]): RubricOutcome {
  const s = pickStrongest(signals)
  if (!s) return { subscore: 15, label: 'אין נתון', emoji: '·', found: false }
  const m = s.description.match(/(\d+)\s*מתחמי התחדשות/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 20) return { subscore: 95, label: `${n} מתחמים בעיר`, emoji: '✅', detail: s.description, found: true }
    if (n >= 10) return { subscore: 80, label: `${n} מתחמים בעיר`, emoji: '✅', detail: s.description, found: true }
    if (n >=  5) return { subscore: 65, label: `${n} מתחמים בעיר`, emoji: '✅', detail: s.description, found: true }
    if (n >=  1) return { subscore: 50, label: `${n} מתחמים בעיר`, emoji: '·', detail: s.description, found: true }
  }
  if (/אין/.test(s.title)) return { subscore: 15, label: 'אין רשימה רשמית', emoji: '⚠️', detail: s.description, found: true }
  return { subscore: 40, label: 'נתון חלקי', emoji: '·', detail: s.description, found: true }
}

function rubricLandUse(signals: Signal[]): RubricOutcome {
  const s = pickStrongest(signals)
  if (!s)                                              return { subscore: 45, label: 'יעוד לא ידוע', emoji: '·', found: false }
  const d = s.description
  if (/יעוד מגורים\b/.test(d) && !/מעורב/.test(d))    return { subscore: 90, label: 'יעוד מגורים', emoji: '✅', detail: d, found: true }
  if (/מעורב|מסחר ומגורים|תעסוקה ומגורים/.test(d))    return { subscore: 75, label: 'יעוד מעורב', emoji: '✅', detail: d, found: true }
  if (/ציבורי|שצ"פ|מבני ציבור/.test(d))               return { subscore: 10, label: 'יעוד ציבורי / שצ"פ', emoji: '⚠️', detail: d, found: true }
  if (/תעשייה|תעסוקה(?! ומגורים)|מלאכה/.test(d))      return { subscore: 25, label: 'תעסוקה / תעשייה', emoji: '⚠️', detail: d, found: true }
  if (/חקלאי|יער|שטח פתוח/.test(d))                   return { subscore:  5, label: 'חקלאי / שטח פתוח', emoji: '⚠️', detail: d, found: true }
  if (/לא נמצא/.test(d))                              return { subscore: 45, label: 'יעוד לא ידוע', emoji: '·', detail: d, found: false }
  return                                                    { subscore: 50, label: 'יעוד אחר', emoji: '·', detail: d, found: true }
}

function rubricLotSize(lotSqm: number | undefined): RubricOutcome {
  if (lotSqm == null)        return { subscore: 50, label: 'גודל לא ידוע', emoji: '·', found: false }
  if (lotSqm >= 1500)        return { subscore: 100, label: `${lotSqm} מ"ר — גדול מאוד`, emoji: '✅', found: true }
  if (lotSqm >= 1000)        return { subscore:  85, label: `${lotSqm} מ"ר — גדול`, emoji: '✅', found: true }
  if (lotSqm >=  700)        return { subscore:  70, label: `${lotSqm} מ"ר — בינוני`, emoji: '✅', found: true }
  if (lotSqm >=  500)        return { subscore:  55, label: `${lotSqm} מ"ר — בינוני-קטן`, emoji: '·', found: true }
  if (lotSqm >=  350)        return { subscore:  35, label: `${lotSqm} מ"ר — קטן`, emoji: '⚠️', found: true }
  return                            { subscore:  15, label: `${lotSqm} מ"ר — קטן מאוד`, emoji: '⚠️', found: true }
}

// Density rubric — the appraiser-style "is there room to build" check.
// Uses the m² / apartment ratio when the user supplies apartment count;
// falls back to lot-only when count is missing.
//
// Reference points from the discussion:
//   300 m² × 12 dirot →  25 m²/dira → קשה מאוד
//   600 m² × 20 dirot →  30 m²/dira → בעייתי
//   900 m² ×  8 dirot → 112 m²/dira → טוב
//  1200 m² × 10 dirot → 120 m²/dira → טוב מאוד
function rubricDensity(lotSqm: number | undefined, aptCount: number | undefined): RubricOutcome {
  // Fallback: no apartment count → use lot-size rubric but tag the label
  // so the UI explains why density is approximate.
  if (aptCount == null || aptCount <= 0) {
    const r = rubricLotSize(lotSqm)
    return { ...r, label: r.label + ' · מבוסס על שטח בלבד (מס׳ דירות לא צוין)', found: r.found }
  }
  if (lotSqm == null || lotSqm <= 0) {
    return { subscore: 50, label: `${aptCount} דירות · שטח מגרש לא נטען`, emoji: '·', found: false }
  }
  const ratio = lotSqm / aptCount
  const r = Math.round(ratio)
  const tag = `${lotSqm} מ"ר ÷ ${aptCount} דירות = ${r} מ"ר לדירה`
  if (ratio >= 150)  return { subscore: 100, label: `${tag} — מצוין`,        emoji: '✅', detail: tag, found: true }
  if (ratio >= 100)  return { subscore:  85, label: `${tag} — טוב מאוד`,     emoji: '✅', detail: tag, found: true }
  if (ratio >=  75)  return { subscore:  70, label: `${tag} — טוב`,          emoji: '✅', detail: tag, found: true }
  if (ratio >=  50)  return { subscore:  50, label: `${tag} — סביר`,         emoji: '·', detail: tag, found: true }
  if (ratio >=  30)  return { subscore:  30, label: `${tag} — בעייתי`,       emoji: '⚠️', detail: tag, found: true }
  return                    { subscore:  10, label: `${tag} — קשה מאוד`,     emoji: '⚠️', detail: tag, found: true }
}

// City build-activity rubric — derived from the Ministry of Labor list.
// Reads the single signal emitted by the buildingsites adapter and turns its
// raw counts into a deterministic 0..100 sub-score.
//
// Threshold table (residential sites in the city):
//   ≥20 → 100  ·  10–19 → 80  ·  5–9 → 60  ·  1–4 → 40  ·  0 → 10
function rubricCityBuildActivity(signals: Signal[]): RubricOutcome {
  const s = pickStrongest(signals)
  if (!s) return { subscore: 15, label: 'אין נתון', emoji: '·', found: false }
  // Description is "נרשמו N אתרי בנייה פעילים בעיר, מתוכם M למגורים..." —
  // pull the second number (residential count).
  const m = s.description.match(/מתוכם\s*(\d+)\s*למגורים/)
  const residential = m ? parseInt(m[1], 10) : 0
  if (residential >= 20) return { subscore: 100, label: `${residential} אתרי בנייה למגורים`, emoji: '✅', detail: s.description, found: true }
  if (residential >= 10) return { subscore:  80, label: `${residential} אתרי בנייה למגורים`, emoji: '✅', detail: s.description, found: true }
  if (residential >=  5) return { subscore:  60, label: `${residential} אתרי בנייה למגורים`, emoji: '✅', detail: s.description, found: true }
  if (residential >=  1) return { subscore:  40, label: `${residential} אתרי בנייה למגורים`, emoji: '·', detail: s.description, found: true }
  // Sites exist but none residential — still better than zero overall.
  if (/אתרי בנייה פעילים/.test(s.title)) return { subscore: 25, label: 'בנייה לא־מגורים בעיר', emoji: '·', detail: s.description, found: true }
  return { subscore: 10, label: 'אין בנייה פעילה', emoji: '⚠️', detail: s.description, found: true }
}

// Commercial-mix rubric — appraiser flag, not a blocker.
// User-supplied: 'none' / 'small' / 'large' / 'unknown'.
function rubricCommercialMix(level: CommercialLevel | undefined): RubricOutcome {
  switch (level) {
    case 'none':
      return {
        subscore: 100, label: 'אין שטחי מסחר — תהליך פשוט יותר', emoji: '✅', found: true,
        detail: 'בניין מגורים בלבד. תהליך פינוי-בינוי / תמ"א ללא סיבוכים תכנוניים מסחריים.',
      }
    case 'small':
      return {
        subscore: 70, label: 'מסחר קטן בקומת קרקע — מורכבות נמוכה', emoji: '·', found: true,
        detail: 'חנות קטנה או שתיים בקומת קרקע. דורש פתרון תכנוני אך לא חריג. קיימים פרויקטים שבוצעו במצב דומה.',
      }
    case 'large':
      return {
        subscore: 35, label: 'שטחי מסחר משמעותיים — מורכבות גבוהה', emoji: '⚠️', found: true,
        detail: 'חנויות גדולות, משרדים או מתחם מסחרי משולב. יתכן צורך בפתרונות תכנוניים ומשפטיים מורכבים יותר. הפרויקט עדיין אפשרי — קיימים פרויקטים שבוצעו גם במבנים עם מסחר, אך מומלץ לקחת ייעוץ משפטי מוקדם.',
      }
    case 'unknown':
    case undefined:
    default:
      return {
        subscore: 70, label: 'לא צוין', emoji: '·', found: false,
        detail: 'סמן אם יש מסחר בבניין כדי לקבל הערכה מדויקת יותר של המורכבות.',
      }
  }
}

const SUMMARY_HEAD: Record<CategoryKey, string> = {
  planning_schemes:    'תכנון וזכויות בנייה',
  urban_renewal_area:  'מתחם התחדשות מוכרז',
  projects_in_city:    'פרויקטים פעילים באזור',
  city_build_activity: 'פעילות בנייה בעיר',
  municipal_policy:    'מדיניות עירונית',
  land_use:            'שימושי קרקע',
  density:             'יחס מגרש ↔ דירות',
  commercial_mix:      'מורכבות מסחרית',
}

function impactCopy(key: CategoryKey, found: boolean): string {
  if (!found) return PLACEHOLDER_IMPACT[key]
  switch (key) {
    case 'planning_schemes':    return 'יזם יכול לקדם בנייה מחדש על בסיס תכנון קיים.'
    case 'urban_renewal_area':  return 'הכרזה רשמית של רשות ההתחדשות — מסלול ברור ליזמים.'
    case 'projects_in_city':    return 'אזור מתעורר — יזמים נכנסים אקטיבית.'
    case 'city_build_activity': return 'בנייה בפועל בעיר מוכיחה שיש קבלנים פעילים, צוותי ביצוע ומימון זמין — תרגום של מדיניות לפעולה.'
    case 'municipal_policy':    return 'העירייה תומכת באופן פעיל — תהליכים מהירים יותר.'
    case 'land_use':            return 'יעוד הקרקע משפיע ישירות על האפשרות לבנייה חדשה.'
    case 'density':             return 'יחס שטח המגרש למספר הדירות קובע אם פרויקט עצמאי כלכלי או נדרש חיבור למתחם.'
    case 'commercial_mix':      return 'שטחי מסחר בבניין מוסיפים מורכבות תכנונית ומשפטית — לא חוסמים אך מצריכים פתרונות.'
  }
}

// ─── Public engine entry point ───────────────────────────────────────

export interface RubricResult {
  score: number                          // 0..100, deterministic
  categories: Category[]
  source_contributions: SourceContribution[]
}

export interface UserInputs {
  apartments_count?: number
  commercial?: CommercialLevel
}

export function evaluateRubric(
  signals: Signal[],
  address: Pick<ResolvedAddress, 'lot_sqm'>,
  sourcesUsed: SourceResult[] = [],
  userInputs: UserInputs = {},
): RubricResult {
  // Group by category once.
  const byKey = new Map<CategoryKey, Signal[]>()
  for (const s of signals) {
    if (!s.category) continue
    const list = byKey.get(s.category) ?? []
    list.push(s)
    byKey.set(s.category, list)
  }

  // Run rubrics in stable order.
  const outcomes: Record<CategoryKey, RubricOutcome> = {
    planning_schemes:    rubricPlanningSchemes(byKey.get('planning_schemes')    ?? []),
    urban_renewal_area:  rubricUrbanRenewalArea(byKey.get('urban_renewal_area') ?? []),
    projects_in_city:    rubricProjectsInCity(byKey.get('projects_in_city')     ?? []),
    city_build_activity: rubricCityBuildActivity(byKey.get('city_build_activity') ?? []),
    municipal_policy:    rubricMunicipalPolicy(byKey.get('municipal_policy')    ?? []),
    land_use:            rubricLandUse(byKey.get('land_use')                    ?? []),
    density:             rubricDensity(address.lot_sqm, userInputs.apartments_count),
    commercial_mix:      rubricCommercialMix(userInputs.commercial),
  }

  // Build Category[] rows + accumulate the weighted score. We keep a
  // separate `contributions` map keyed by CategoryKey so the source-summary
  // block below can read each category's points without re-deriving them.
  const contributions = {} as Record<CategoryKey, number>
  let total = 0
  const categories: Category[] = ORDER.map(key => {
    const out = outcomes[key]
    const weight = CATEGORY_WEIGHTS[key]
    const contribution = Math.round((out.subscore * weight) / 100 * 10) / 10
    contributions[key] = contribution
    total += (out.subscore * weight) / 100

    // Try to thread the source-specific URL from the strongest signal.
    const sig = pickStrongest(byKey.get(key) ?? [])
    return {
      key,
      emoji: out.emoji,
      title: TITLES[key],
      summary: out.label,
      impact: impactCopy(key, out.found),
      detail: out.detail,
      // Legacy fields kept for backward compat with the old renderer:
      weight_contribution: contribution,
      weight_pct: weight,
      // New deterministic fields:
      weight,
      subscore: out.subscore,
      contribution,
      source: CATEGORY_SOURCE[key],
      found: out.found,
      url: sig?.url,
    } as Category
  })

  const score = Math.round(total)

  // ─── Source contributions ──────────────────────────────────────
  // Pre-built map "source → categories it owns". The fixed_pct of a source is
  // the sum of its categories' weights — deterministic across runs.
  const byOwner = new Map<SourceName, CategoryKey[]>()
  for (const [k, owner] of Object.entries(CATEGORY_SOURCE) as Array<[CategoryKey, SourceName]>) {
    const list = byOwner.get(owner) ?? []
    list.push(k)
    byOwner.set(owner, list)
  }

  const failedByName = new Set<SourceName>()
  for (const s of sourcesUsed) if (s.status === 'failed') failedByName.add(s.name)

  const sourceContributions: SourceContribution[] = []
  for (const [owner, keys] of byOwner) {
    const fixed_pct = keys.reduce((a, k) => a + CATEGORY_WEIGHTS[k], 0)
    const contribution = keys.reduce((a, k) => a + contributions[k], 0)
    const positive = keys.reduce((a, k) => a + Math.max(0, contributions[k]), 0)
    const failed = failedByName.has(owner)
    sourceContributions.push({
      name: owner,
      // Legacy:
      positive_weight: Math.round(positive),
      negative_weight: 0,
      total_weight: Math.round(positive),
      pct_of_total: fixed_pct,
      // New:
      fixed_pct,
      contribution: Math.round(contribution * 10) / 10,
      categories: keys,
      signals_count: signals.filter(s => s.source === owner).length,
      failed,
      note: failed
        ? sourceFailedNote(owner)
        : contribution === 0
          ? sourceZeroNote(owner)
          : undefined,
    })
  }
  sourceContributions.sort((a, b) => b.fixed_pct - a.fixed_pct)
  return { score, categories, source_contributions: sourceContributions }
}

// ─── Source notes ───────────────────────────────────────────────────

function sourceFailedNote(name: SourceName): string {
  switch (name) {
    case 'govmap':                     return 'GovMap לא הגיב בזמן — לא הצלחנו לבדוק גוש/חלקה/מתחם מוכרז בריצה הזו.'
    case 'mavat.landuse':              return 'שכבת שימושי הקרקע של מבא"ת לא הגיבה בזמן.'
    case 'mavat':                      return 'מאגר התכניות של מינהל התכנון לא הגיב בזמן.'
    case 'data.gov.il':                return 'data.gov.il לא הגיב בזמן (CKAN איטי / 5xx).'
    case 'data.gov.il.buildingsites':  return 'רשימת אתרי הבנייה של משרד העבודה לא הגיבה בזמן.'
  }
}

function sourceZeroNote(name: SourceName): string {
  switch (name) {
    case 'govmap':                     return 'GovMap בדק את המתחם המוכרז וגודל המגרש — שני הקריטריונים יצאו ניטרליים.'
    case 'mavat.landuse':              return 'שכבת שימושי הקרקע של מבא"ת החזירה ציון נמוך — היעוד לא מקדם פרויקט.'
    case 'mavat':                      return 'אין תכניות פעילות מתאימות באזור.'
    case 'data.gov.il':                return 'העיר לא ברשימת ההתחדשות הרשמית.'
    case 'data.gov.il.buildingsites':  return 'אין אתרי בנייה פעילים בעיר ברגע זה.'
  }
}

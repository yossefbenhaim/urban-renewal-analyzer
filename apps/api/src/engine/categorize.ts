// Turns the flat signal list into:
//   - `categories[]` — one row per CategoryKey in a stable order. Each row
//     either reflects a found signal (✅/⚠️) or is a "·" placeholder so the
//     report layout looks consistent across addresses.
//   - `source_contributions[]` — % share of |weight| each source contributed,
//     useful for the "X% of the score came from MAVAT" footer.

import type {
  Category, CategoryKey, Signal, SourceContribution, SourceName,
} from '../types.js'

// Stable order — matches the order the user pasted in their reference report.
const ORDER: CategoryKey[] = [
  'planning_schemes',
  'urban_renewal_area',
  'projects_in_city',
  'municipal_policy',
  'land_use',
  'lot_size',
]

const TITLES: Record<CategoryKey, string> = {
  planning_schemes:    'תכנון וזכויות בנייה',
  urban_renewal_area:  'מתחם התחדשות מוכרז',
  projects_in_city:    'פרויקטים פעילים באזור',
  municipal_policy:    'מדיניות עירונית',
  land_use:            'שימושי קרקע',
  lot_size:            'גודל מגרש',
}

const PLACEHOLDER_IMPACT: Record<CategoryKey, string> = {
  planning_schemes:   'אין כרגע תכנון פעיל — תהליך התחדשות יתחיל מאוחר יותר.',
  urban_renewal_area: 'הכתובת לא בתוך מתחם מוכרז — דורש יזם שיגדיר מתחם חדש.',
  projects_in_city:   'אין פרויקטי התחדשות בביצוע כעת באזור.',
  municipal_policy:   'אין רשימת התחדשות מוכרזת בעיר.',
  land_use:           'יעוד הקרקע לא נטען — אין השפעה ידועה על ההיתכנות.',
  lot_size:           'גודל המגרש לא נטען.',
}

function impactFor(s: Signal): string {
  // Free-form impact per category — kept short for the bullet renderer.
  switch (s.category) {
    case 'planning_schemes':
      return s.kind === 'positive'
        ? 'יזם יכול לקדם בנייה מחדש על בסיס תכנון קיים — האזור פעיל תכנונית.'
        : 'תהליך התחדשות עוד לא התחיל — ייקח יותר זמן.'
    case 'urban_renewal_area':
      return 'הכרזה רשמית של רשות ההתחדשות — מסלול ברור ליזמים.'
    case 'projects_in_city':
      return 'אזור מתעורר — יזמים נכנסים אקטיבית.'
    case 'municipal_policy':
      return 'העירייה תומכת באופן פעיל — תהליכים מהירים יותר.'
    case 'land_use':
      return s.kind === 'positive'
        ? 'יעוד הקרקע מתאים לפינוי-בינוי / תמ"א.'
        : s.kind === 'negative'
          ? 'יעוד הקרקע מקשה על הריסה ובנייה מחדש.'
          : 'יעוד הקרקע ניטרלי לעניין ההיתכנות.'
    case 'lot_size':
      return s.kind === 'negative'
        ? 'פרויקט עצמאי פחות אטרקטיבי — שווה לבחון חיבור עם שכנים.'
        : s.kind === 'positive'
          ? 'מגרש גדול — נותן ליזם מרחב לבנייה רחבה.'
          : 'מגרש בטווח רגיל — לא משפיע משמעותית לטוב או לרע.'
    default:
      return ''
  }
}

export function categorize(signals: Signal[]): Category[] {
  const totalWeight = signals.reduce((acc, s) => acc + Math.abs(s.weight), 0) || 1

  // Bucket signals by their CategoryKey; keep the strongest per bucket.
  const byKey = new Map<CategoryKey, Signal>()
  for (const s of signals) {
    if (!s.category) continue
    const cur = byKey.get(s.category)
    if (!cur || Math.abs(s.weight) > Math.abs(cur.weight)) {
      byKey.set(s.category, s)
    }
  }

  const out: Category[] = []
  for (const key of ORDER) {
    const s = byKey.get(key)
    if (s) {
      out.push({
        key,
        emoji: s.kind === 'positive' ? '✅' : s.kind === 'negative' ? '⚠️' : '·',
        title: TITLES[key],
        summary: s.title,
        impact: impactFor(s) || s.description,
        weight_contribution: s.weight,
        weight_pct: Math.round((Math.abs(s.weight) / totalWeight) * 100),
        source: s.source,
        found: s.kind !== 'neutral' || s.weight !== 0,
      })
    } else {
      out.push({
        key,
        emoji: '·',
        title: TITLES[key],
        summary: 'לא נטען',
        impact: PLACEHOLDER_IMPACT[key],
        weight_contribution: 0,
        weight_pct: 0,
        source: 'govmap',
        found: false,
      })
    }
  }
  return out
}

const SOURCE_NEUTRAL_NOTE: Record<SourceName, string> = {
  'govmap':       'בדקנו את שכבות GovMap (מתחם התחדשות מוכרז, גוש/חלקה, גודל מגרש). הנתונים נטענו בהצלחה אך לא נמצאה אינדיקציה שמטיבה או מרעה את הציון.',
  'mavat.landuse':'בדקנו את שכבת שימושי הקרקע של מבא"ת. יעוד הקרקע שאותר אינו מטיב ואינו מרעה את ההיתכנות.',
  'mavat':        'בדקנו את מאגר התכניות של מינהל התכנון — אף תכנית פעילה לא הוסיפה משקל לציון.',
  'data.gov.il':  'בדקנו את ערכות הנתונים של data.gov.il — אף ערכת מידע לא הוסיפה משקל לציון.',
}

export function sourceContributions(signals: Signal[]): SourceContribution[] {
  const totals: Record<string, { pos: number; neg: number; count: number }> = {}
  for (const s of signals) {
    const k = s.source
    if (!totals[k]) totals[k] = { pos: 0, neg: 0, count: 0 }
    totals[k].count += 1
    if (s.weight > 0) totals[k].pos += s.weight
    if (s.weight < 0) totals[k].neg += Math.abs(s.weight)
  }
  const grandTotal = Object.values(totals).reduce((a, b) => a + b.pos + b.neg, 0) || 1
  return Object.entries(totals).map(([name, v]) => {
    const total = v.pos + v.neg
    return {
      name: name as SourceName,
      positive_weight: v.pos,
      negative_weight: v.neg,
      total_weight: total,
      pct_of_total: Math.round((total / grandTotal) * 100),
      signals_count: v.count,
      note: total === 0 ? SOURCE_NEUTRAL_NOTE[name as SourceName] : undefined,
    }
  }).sort((a, b) => b.total_weight - a.total_weight)
}

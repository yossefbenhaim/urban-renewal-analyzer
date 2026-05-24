// Given the address + signals + score, decide:
//   - which renewal track is the right pitch for this property
//   - whether a single-building project is realistic or it needs a מתחם
//   - an expected timeline range (in years)
//   - 5–7 Hebrew action steps the user should take next
//
// Pure functions, no I/O. The orchestrator wires them after the score is in.

import type {
  Bucket, ResolvedAddress, Signal, Track,
} from '../types.js'

interface Inputs {
  address: ResolvedAddress
  signals: Signal[]
  score: number
  bucket: Bucket
  year_built?: number
}

// Hard cap by building age — the single most decisive factor. Even if the
// area is perfect on every other dimension, a brand-new building is not a
// realistic renewal candidate. Returns the MAX score allowed for the given
// year, or null when no cap should be applied (no input, or old enough).
//
// Aligned with the building_age rubric thresholds in engine/rubric.ts.
export function ageCap(yearBuilt: number | undefined): number | null {
  if (yearBuilt == null || !Number.isFinite(yearBuilt)) return null
  const age = new Date().getFullYear() - yearBuilt
  if (age <= 5)  return 15
  if (age <= 15) return 30
  if (age <= 25) return 55
  return null
}

export function recommendTrack({ address, signals, score, year_built }: Inputs): Track {
  // Age veto: brand-new buildings get a hard 'unlikely' regardless of
  // anything else. The 15-pt cap above means score < 30 already, but make
  // the track explicit.
  if (year_built != null && Number.isFinite(year_built)) {
    const age = new Date().getFullYear() - year_built
    if (age <= 5) return 'unlikely'
  }
  if (score < 30) return 'unlikely'
  const lot = address.lot_sqm ?? 0
  const declared = signals.some(s => s.source === 'govmap' && /מתחם/.test(s.title))
  if (declared) return 'pinui_binui_complex'
  if (lot >= 800 && score >= 65) return 'pinui_binui_single'
  if (lot && lot < 600) return 'pinui_binui_complex'
  return 'tama_38'
}

export function singleBuildingFeasible(input: Inputs): boolean {
  const { address, score, bucket } = input
  if (bucket === 'very_low' || bucket === 'low') return false
  const lot = address.lot_sqm ?? 0
  if (lot && lot < 600) return false
  return score >= 60
}

export function expectedTimeYears(track: Track): { min: number; max: number } {
  switch (track) {
    case 'tama_38':              return { min: 4, max: 7 }
    case 'pinui_binui_single':   return { min: 5, max: 8 }
    case 'pinui_binui_complex':  return { min: 6, max: 10 }
    case 'unlikely':             return { min: 0, max: 0 }
  }
}

export function summaryHe(input: Inputs): string {
  const { bucket, score, year_built } = input
  // If the building age explains a capped score, lead with that so the
  // user sees WHY the score is low — the rest is just supporting detail.
  if (year_built != null && Number.isFinite(year_built)) {
    const age = new Date().getFullYear() - year_built
    if (age <= 5)  return `בניין חדש (${age} שנים) — פינוי-בינוי לא רלוונטי. הציון נחתך ל-${score}/100.`
    if (age <= 15) return `בניין צעיר (${age} שנים) — סיכוי נמוך מאוד בעשור הקרוב. הציון נחתך ל-${score}/100.`
    if (age <= 25) return `בניין בגיל בינוני (${age} שנים) — עדיין מוקדם. הציון נחתך ל-${score}/100.`
  }
  switch (bucket) {
    case 'very_high': return `בשלות גבוהה מאוד (${score}/100) — סיכוי גבוה לפרויקט פעיל בשנים הקרובות.`
    case 'high':      return `בשלות גבוהה (${score}/100) — האזור מתבשל לכיוון התחדשות.`
    case 'moderate':  return `בשלות חלקית (${score}/100) — סימנים מוקדמים לפרויקט אפשרי.`
    case 'low':       return `בשלות נמוכה (${score}/100) — עדיין רחוק מפרויקט פעיל.`
    case 'very_low':  return `בשלות נמוכה מאוד (${score}/100) — כרגע אין סימני התחדשות באזור.`
  }
}

export function recommendations(input: Inputs, track: Track): string[] {
  // Age-based veto override — when the building is too new, the standard
  // "collect signatures" advice is misleading. Tell the user the truth.
  if (input.year_built != null && Number.isFinite(input.year_built)) {
    const age = new Date().getFullYear() - input.year_built
    if (age <= 5) {
      return [
        'בניין חדש — אין סיבה הנדסית או כלכלית להריסה ובנייה מחדש',
        'תהליך פינוי-בינוי דורש בדרך כלל בניין בן 25+ שנים',
        'אפשר לעקוב אחרי האזור — בעוד 15-20 שנים יתכן שהתמונה תשתנה',
        'אם יש בעיה בטיחותית/הנדסית ספציפית — להתייעץ עם מהנדס מבנים',
      ]
    }
    if (age <= 15) {
      return [
        'הבניין עדיין צעיר — לרוב נדרש גיל 25+ לפני שפינוי-בינוי הופך לכדאי',
        'מומלץ להתעדכן שוב בעוד 5-10 שנים',
        'אפשר לבחון תוספות חוקיות בלי הריסה (מרפסות, מחסנים, יחידות דיור נוספות בקומה)',
      ]
    }
  }
  const base = [
    'איסוף חתימות של 80%+ מהדיירים בבניין',
    'פנייה לעורך דין מקרקעין המתמחה בהתחדשות עירונית',
    'בקשת הצעות מ-3 יזמים שעובדים באזור',
  ]
  if (track === 'pinui_binui_complex') {
    return [
      'יצירת קשר עם דיירים בבניינים שכנים',
      'בדיקה האם הם פתוחים לפרויקט משותף',
      'ארגון ועד דיירים פעיל',
      ...base,
      'גיבוש הסכם משותף עם יזם שתואם מתחמים',
    ]
  }
  if (track === 'pinui_binui_single') {
    return [
      'הקמת ועד דיירים פעיל בבניין',
      'בדיקת זכויות בנייה עדכניות מול הוועדה המקומית',
      ...base,
      'בדיקת הצעות הפיצוי המוצעות לדיירים',
    ]
  }
  if (track === 'tama_38') {
    return [
      'בדיקת היתכנות תמ"א 38 מול אדריכל מוסמך',
      'הקמת ועד דיירים פעיל',
      'בקשת הצעות מקבלני תמ"א באזור',
      ...base,
    ]
  }
  return [
    'בינתיים אין סימנים לפרויקט פעיל באזור — שווה לעקוב אחר פרסומי הרשות',
    'מומלץ להתעדכן בשנה הבאה — תמונת התכנון עשויה להשתנות',
    'כדאי לבחון השבחת ערך הנכס דרך שיפוץ או הוספת מ"ר חוקי',
  ]
}

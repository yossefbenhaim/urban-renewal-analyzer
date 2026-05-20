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
}

export function recommendTrack({ address, signals, score }: Inputs): Track {
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
  const { bucket, score } = input
  switch (bucket) {
    case 'very_high': return `בשלות גבוהה מאוד (${score}/100) — סיכוי גבוה לפרויקט פעיל בשנים הקרובות.`
    case 'high':      return `בשלות גבוהה (${score}/100) — האזור מתבשל לכיוון התחדשות.`
    case 'moderate':  return `בשלות חלקית (${score}/100) — סימנים מוקדמים לפרויקט אפשרי.`
    case 'low':       return `בשלות נמוכה (${score}/100) — עדיין רחוק מפרויקט פעיל.`
    case 'very_low':  return `בשלות נמוכה מאוד (${score}/100) — כרגע אין סימני התחדשות באזור.`
  }
}

export function recommendations(input: Inputs, track: Track): string[] {
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

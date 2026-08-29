import { useEffect, useState } from 'react'

/**
 * Plain numeric birthday entry.
 *
 * A native <input type="date"> opens the OS date picker, which is several taps
 * of scrolling to reach a year in the 1980s. Typing eight digits is faster, so
 * this is a numeric text field that formats itself as DD.MM.YYYY and only emits
 * a value once it parses.
 *
 * The year is optional: four digits alone mean "day and month known, year not",
 * which is stored as the ISO 8601 yearless form "--MM-DD".
 */

interface Props {
  value: string | null | undefined
  onChange: (iso: string | null) => void
}

function isoToDigits(iso: string | null | undefined): string {
  if (!iso) return ''
  if (iso.startsWith('--')) return iso.slice(5, 7) + iso.slice(2, 4)
  if (iso.length === 10) return iso.slice(8, 10) + iso.slice(5, 7) + iso.slice(0, 4)
  return ''
}

function format(digits: string): string {
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`
}

function digitsToIso(digits: string): { iso: string | null; error: string | null } {
  if (digits.length === 0) return { iso: null, error: null }

  const day = Number(digits.slice(0, 2))
  const month = Number(digits.slice(2, 4))

  if (digits.length !== 4 && digits.length !== 8) {
    return { iso: null, error: 'Enter DD.MM, or DD.MM.YYYY if you know the year.' }
  }
  if (month < 1 || month > 12) return { iso: null, error: 'That month does not exist.' }
  if (day < 1 || day > 31) return { iso: null, error: 'That day does not exist.' }

  const pad = (n: number) => String(n).padStart(2, '0')

  if (digits.length === 4) {
    // Guard against 31.02 by checking the day against a leap year.
    const probe = new Date(2000, month - 1, day)
    if (probe.getMonth() !== month - 1) return { iso: null, error: 'That date does not exist.' }
    return { iso: `--${pad(month)}-${pad(day)}`, error: null }
  }

  const year = Number(digits.slice(4, 8))
  if (year < 1900 || year > new Date().getFullYear()) {
    return { iso: null, error: 'That year looks wrong.' }
  }
  const probe = new Date(year, month - 1, day)
  if (probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return { iso: null, error: 'That date does not exist.' }
  }
  return { iso: `${year}-${pad(month)}-${pad(day)}`, error: null }
}

export default function BirthdayInput({ value, onChange }: Props) {
  const [digits, setDigits] = useState(() => isoToDigits(value))
  const [error, setError] = useState<string | null>(null)

  // Keep in step when the form is filled from elsewhere (loading a person, or
  // accepting an AI suggestion).
  useEffect(() => {
    const incoming = isoToDigits(value)
    setDigits((current) => (digitsToIso(current).iso === (value ?? null) ? current : incoming))
  }, [value])

  const handle = (raw: string) => {
    const next = raw.replace(/\D/g, '').slice(0, 8)
    setDigits(next)
    const { iso, error: problem } = digitsToIso(next)
    setError(problem)
    if (iso !== null || next.length === 0) onChange(iso)
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Birthday</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={format(digits)}
        onChange={(e) => handle(e.target.value)}
        placeholder="DD.MM.YYYY"
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-base outline-none placeholder:text-slate-600 focus:border-sky-500"
      />
      <span className={`mt-1 block text-xs ${error ? 'text-amber-400' : 'text-slate-600'}`}>
        {error ?? 'Day and month are enough — add the year if you know it.'}
      </span>
    </label>
  )
}

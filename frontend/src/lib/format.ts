import type { Address, Person, Salary } from '../api/types'

export function fullName(p: { given_name: string; family_name: string }): string {
  return [p.given_name, p.family_name].filter(Boolean).join(' ') || '(unnamed)'
}

// Country is deliberately not shown: every address here is in Germany.
export function formatAddress(address: Address): string {
  const line2 = [address.postal_code, address.city].filter(Boolean).join(' ')
  return [address.street, line2].filter(Boolean).join(', ')
}

export function formatSalary(salary: Salary): string {
  if (salary.amount == null) return ''
  const period = { year: 'per year', month: 'per month', hour: 'per hour' }[salary.period]
  const amount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(salary.amount)
  return `${amount} ${period}`
}

/** Accepts "YYYY-MM-DD" and "--MM-DD" (year unknown). */
export function formatBirthday(birthday?: string | null): string {
  if (!birthday) return ''
  const yearless = birthday.startsWith('--')
  const [year, month, day] = yearless
    ? [null, birthday.slice(2, 4), birthday.slice(5, 7)]
    : [birthday.slice(0, 4), birthday.slice(5, 7), birthday.slice(8, 10)]

  const monthName = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(
    new Date(2000, Number(month) - 1, 1),
  )
  const base = `${Number(day)} ${monthName}`
  return year ? `${base} ${year}` : base
}

/** "in 12 days", "today", or "" when there is no birthday stored. */
export function birthdayCountdown(birthday?: string | null): string {
  if (!birthday) return ''
  const month = Number(birthday.startsWith('--') ? birthday.slice(2, 4) : birthday.slice(5, 7))
  const day = Number(birthday.startsWith('--') ? birthday.slice(5, 7) : birthday.slice(8, 10))
  if (!month || !day) return ''

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let next = new Date(today.getFullYear(), month - 1, day)
  if (next < today) next = new Date(today.getFullYear() + 1, month - 1, day)

  const days = Math.round((next.getTime() - today.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 120) return ''
  return `in ${days} days`
}

export function ageTurning(person: Person): string {
  if (!person.birthday || person.birthday.startsWith('--')) return ''
  const birthYear = Number(person.birthday.slice(0, 4))
  const today = new Date()
  const thisYearBirthday = new Date(
    today.getFullYear(),
    Number(person.birthday.slice(5, 7)) - 1,
    Number(person.birthday.slice(8, 10)),
  )
  const turningYear = thisYearBirthday < today ? today.getFullYear() + 1 : today.getFullYear()
  return `turns ${turningYear - birthYear}`
}

export function kidsSummary(person: Person): string {
  if (person.kids.length === 0) return ''
  const named = person.kids.map((k) => k.name).filter(Boolean)
  const count = `${person.kids.length} ${person.kids.length === 1 ? 'child' : 'children'}`
  return named.length ? `${count} — ${named.join(', ')}` : count
}

const PATH_LABELS: Record<string, string> = {
  given_name: 'First name',
  family_name: 'Last name',
  'address.street': 'Street',
  'address.postal_code': 'Postal code',
  'address.city': 'City',
  birthday: 'Birthday',
  'salary.amount': 'Salary',
  'salary.period': 'Salary period',
  'job.title': 'Job title',
  'job.company': 'Company',
  'job.description': 'Job description',
  kids: 'Children',
  phone: 'Phone',
  email: 'Email',
  tags: 'Tags',
  how_we_met: 'How we met',
}

export const labelForPath = (path: string): string => PATH_LABELS[path] ?? path

export function renderValue(value: unknown): string {
  if (value == null || value === '') return '—'
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        item && typeof item === 'object'
          ? Object.values(item as Record<string, unknown>)
              .filter(Boolean)
              .join(' ')
          : String(item),
      )
      .join(', ')
  }
  return String(value)
}

/** Downscale and re-encode in the browser so Lambda never touches image bytes. */
export async function resizeImage(file: File, maxSize = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable in this browser.')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
      'image/jpeg',
      0.82,
    )
  })
}

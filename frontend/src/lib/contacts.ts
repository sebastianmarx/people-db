/**
 * Importing a person from the phone's address book.
 *
 * Two routes, because no single one works everywhere:
 *
 *  1. The Contact Picker API (`navigator.contacts`). One tap, no file handling,
 *     but it only exists in Chrome on Android. Feature-detected.
 *  2. A vCard (.vcf) file. Works on every platform — on iOS, open the contact,
 *     Share, then Save to Files and pick it here. Parsed entirely in the
 *     browser; the file is never uploaded anywhere.
 */

import type { PersonInput } from '../api/types'
import { emptyPerson } from '../api/types'

interface ContactsManager {
  select: (
    properties: string[],
    options?: { multiple?: boolean },
  ) => Promise<
    Array<{
      name?: string[]
      tel?: string[]
      email?: string[]
      address?: Array<{ addressLine?: string[]; postalCode?: string; city?: string }>
    }>
  >
  getProperties: () => Promise<string[]>
}

function contactsApi(): ContactsManager | null {
  const nav = navigator as Navigator & { contacts?: ContactsManager }
  return nav.contacts && 'ContactsManager' in window ? nav.contacts : null
}

export const deviceContactsSupported = (): boolean => contactsApi() !== null

function splitName(full: string): { given_name: string; family_name: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length <= 1) return { given_name: full.trim(), family_name: '' }
  return { given_name: parts.slice(0, -1).join(' '), family_name: parts.at(-1)! }
}

export async function pickDeviceContact(): Promise<PersonInput | null> {
  const api = contactsApi()
  if (!api) return null

  const available = await api.getProperties()
  const wanted = ['name', 'tel', 'email', 'address'].filter((p) => available.includes(p))
  const [contact] = await api.select(wanted, { multiple: false })
  if (!contact) return null

  const person = emptyPerson()
  if (contact.name?.[0]) Object.assign(person, splitName(contact.name[0]))
  if (contact.tel?.[0]) person.phone = contact.tel[0]
  if (contact.email?.[0]) person.email = contact.email[0]

  const address = contact.address?.[0]
  if (address) {
    person.address = {
      street: address.addressLine?.join(' ') || null,
      postal_code: address.postalCode || null,
      city: address.city || null,
    }
  }
  return person
}

function unfold(text: string): string[] {
  // RFC 6350: a line beginning with a space or tab continues the previous one.
  const out: string[] = []
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) {
      out[out.length - 1] += raw.slice(1)
    } else {
      out.push(raw)
    }
  }
  return out
}

const unescape = (value: string) =>
  value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')

function toIsoBirthday(raw: string): string | null {
  const value = raw.trim()
  const full = value.match(/^(\d{4})-?(\d{2})-?(\d{2})/)
  if (full) {
    const [, year, month, day] = full
    return year === '0000' ? `--${month}-${day}` : `${year}-${month}-${day}`
  }
  const yearless = value.match(/^--(\d{2})-?(\d{2})/)
  return yearless ? `--${yearless[1]}-${yearless[2]}` : null
}

/** Parses one or many contacts out of a .vcf file. */
export function parseVCard(text: string): PersonInput[] {
  const people: PersonInput[] = []
  let current: PersonInput | null = null

  for (const line of unfold(text)) {
    const upper = line.toUpperCase()
    if (upper.startsWith('BEGIN:VCARD')) {
      current = emptyPerson()
      continue
    }
    if (upper.startsWith('END:VCARD')) {
      if (current && (current.given_name || current.family_name)) people.push(current)
      current = null
      continue
    }
    if (!current) continue

    const colon = line.indexOf(':')
    if (colon === -1) continue
    const name = line.slice(0, colon).split(';')[0].toUpperCase().replace(/^ITEM\d+\./, '')
    const value = unescape(line.slice(colon + 1))
    if (!value) continue

    switch (name) {
      case 'N': {
        // family;given;additional;prefix;suffix
        const [family, given] = value.split(';')
        if (family) current.family_name = family.trim()
        if (given) current.given_name = given.trim()
        break
      }
      case 'FN':
        if (!current.given_name && !current.family_name) Object.assign(current, splitName(value))
        break
      case 'TEL':
        current.phone ??= value
        break
      case 'EMAIL':
        current.email ??= value
        break
      case 'ADR': {
        // pobox;extended;street;locality;region;postcode;country
        const parts = value.split(';')
        current.address = {
          street: [parts[1], parts[2]].filter(Boolean).join(' ').trim() || null,
          postal_code: parts[5]?.trim() || null,
          city: parts[3]?.trim() || null,
        }
        break
      }
      case 'BDAY':
        current.birthday ??= toIsoBirthday(value)
        break
      case 'ORG':
        current.job = { ...current.job, company: value.split(';')[0].trim() || null }
        break
      case 'TITLE':
        current.job = { ...current.job, title: value }
        break
      case 'NOTE':
        current.how_we_met ??= value
        break
    }
  }

  return people
}

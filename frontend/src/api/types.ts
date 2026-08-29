export interface Address {
  street?: string | null
  postal_code?: string | null
  city?: string | null
  country?: string | null
}

export interface Salary {
  amount?: number | null
  currency: string
  period: 'year' | 'month' | 'hour'
}

export interface Job {
  title?: string | null
  company?: string | null
  description?: string | null
}

export interface Kid {
  name?: string | null
  birth_year?: number | null
}

export interface PersonInput {
  given_name: string
  family_name: string
  address: Address
  birthday?: string | null
  salary: Salary
  job: Job
  kids: Kid[]
  phone?: string | null
  email?: string | null
  tags: string[]
  how_we_met?: string | null
  ai_optout: boolean
}

export interface Person extends PersonInput {
  id: string
  photo_key?: string | null
  photo_url?: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface PersonSummary {
  id: string
  given_name: string
  family_name: string
  display_name: string
  photo_url?: string | null
  job_title?: string | null
  company?: string | null
  city?: string | null
  tags: string[]
}

export type RelationshipType =
  | 'spouse'
  | 'partner'
  | 'parent'
  | 'child'
  | 'sibling'
  | 'grandparent'
  | 'grandchild'
  | 'friend'
  | 'colleague'
  | 'relative'
  | 'other'

/** Read as "<the other person> is my <label>". */
export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  spouse: 'Spouse',
  partner: 'Partner',
  parent: 'Parent',
  child: 'Child',
  sibling: 'Sibling',
  grandparent: 'Grandparent',
  grandchild: 'Grandchild',
  friend: 'Friend',
  colleague: 'Colleague',
  relative: 'Relative',
  other: 'Connected to',
}

export interface Relationship {
  other_id: string
  type: RelationshipType
  note?: string | null
  other_name: string
  other_photo_url?: string | null
  created_at: string
}

export interface Note {
  sk: string
  person_id: string
  body: string
  occurred_on?: string | null
  source: 'manual' | 'ai_import'
  created_at: string
}

export interface FieldChange {
  path: string
  current: unknown
  proposed: unknown
  reason?: string | null
  confidence: number
}

export interface ExtractionResult {
  changes: FieldChange[]
  summary?: string | null
}

export interface NoteCreated {
  note: Note
  extraction?: ExtractionResult | null
  extraction_error?: string | null
}

export interface ChatResponse {
  answer: string
  people: PersonSummary[]
  tool_trace: string[]
}

export interface AppConfig {
  ai_enabled: boolean
  model: string | null
  note_language: string
  redacted_fields: string[]
}

export const emptyPerson = (): PersonInput => ({
  given_name: '',
  family_name: '',
  address: {},
  birthday: null,
  salary: { amount: null, currency: 'EUR', period: 'year' },
  job: {},
  kids: [],
  phone: null,
  email: null,
  tags: [],
  how_we_met: null,
  ai_optout: false,
})

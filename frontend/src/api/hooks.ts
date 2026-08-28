import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request } from './client'
import type {
  AppConfig,
  ChatResponse,
  ExtractionResult,
  FieldChange,
  Note,
  NoteCreated,
  Person,
  PersonInput,
  PersonSummary,
} from './types'

export const keys = {
  people: ['people'] as const,
  person: (id: string) => ['person', id] as const,
  notes: (id: string) => ['notes', id] as const,
  config: ['config'] as const,
}

export const usePeople = () =>
  useQuery({
    queryKey: keys.people,
    queryFn: () => request<PersonSummary[]>('/api/people'),
    staleTime: 30_000,
  })

export const usePerson = (id: string | undefined) =>
  useQuery({
    queryKey: keys.person(id ?? ''),
    queryFn: () => request<Person>(`/api/people/${id}`),
    enabled: Boolean(id) && id !== 'new',
  })

export const useNotes = (id: string | undefined) =>
  useQuery({
    queryKey: keys.notes(id ?? ''),
    queryFn: () => request<Note[]>(`/api/people/${id}/notes`),
    enabled: Boolean(id) && id !== 'new',
  })

export const useConfig = () =>
  useQuery({
    queryKey: keys.config,
    queryFn: () => request<AppConfig>('/api/config'),
    staleTime: Infinity,
  })

export function useCreatePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PersonInput) =>
      request<Person>('/api/people', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.people }),
  })
}

export function useUpdatePerson(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<PersonInput> & { version?: number }) =>
      request<Person>(`/api/people/${id}`, { method: 'PATCH', body }),
    onSuccess: (person) => {
      qc.setQueryData(keys.person(id), person)
      qc.invalidateQueries({ queryKey: keys.people })
    },
  })
}

export function useDeletePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/api/people/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.people }),
  })
}

export function useAddNote(personId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ body, extract }: { body: string; extract: boolean }) =>
      request<NoteCreated>(`/api/people/${personId}/notes?extract=${extract}`, {
        method: 'POST',
        body: { body },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notes(personId) }),
  })
}

export function useDeleteNote(personId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sk: string) =>
      request<void>(`/api/people/${personId}/notes?sk=${encodeURIComponent(sk)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notes(personId) }),
  })
}

export function useApplyExtraction(personId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ changes, version }: { changes: FieldChange[]; version: number }) =>
      request<Person>(`/api/people/${personId}/apply-extraction`, {
        method: 'POST',
        body: { changes, version },
      }),
    onSuccess: (person) => {
      qc.setQueryData(keys.person(personId), person)
      qc.invalidateQueries({ queryKey: keys.people })
    },
  })
}

export const useExtractText = () =>
  useMutation({
    mutationFn: ({ text, personId }: { text: string; personId?: string }) =>
      request<ExtractionResult>('/api/extract', {
        method: 'POST',
        body: { text, person_id: personId ?? null },
      }),
  })

export const useChat = () =>
  useMutation({
    mutationFn: (messages: { role: string; content: string }[]) =>
      request<ChatResponse>('/api/chat', { method: 'POST', body: { messages } }),
  })

export function usePhotoUpload(personId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: Blob) => {
      const presigned = await request<{ key: string; url: string; fields: Record<string, string> }>(
        `/api/people/${personId}/photo-upload`,
        { method: 'POST' },
      )

      const form = new FormData()
      Object.entries(presigned.fields).forEach(([k, v]) => form.append(k, v))
      form.append('file', file)

      const upload = await fetch(presigned.url, { method: 'POST', body: form })
      if (!upload.ok) throw new Error('Photo upload was rejected by storage.')

      return request<Person>(`/api/people/${personId}/photo`, {
        method: 'POST',
        body: { key: presigned.key },
      })
    },
    onSuccess: (person) => {
      qc.setQueryData(keys.person(personId), person)
      qc.invalidateQueries({ queryKey: keys.people })
    },
  })
}

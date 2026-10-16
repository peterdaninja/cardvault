import { get, set } from 'idb-keyval'
import type { AppState } from './types'

const KEY = 'cardvault-state-v1'
const empty: AppState = { collections: [], cards: [] }

export async function loadState(): Promise<AppState> {
  try {
    return (await get<AppState>(KEY)) ?? empty
  } catch {
    return empty
  }
}

export async function saveState(state: AppState): Promise<void> {
  await set(KEY, state)
}

export function exportJson(state: AppState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `cardvault-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function parseImport(file: File): Promise<AppState> {
  const data = JSON.parse(await file.text())
  if (!Array.isArray(data?.collections) || !Array.isArray(data?.cards)) {
    throw new Error('Not a CardVault backup file')
  }
  return data as AppState
}

// randomUUID is unavailable on plain-http dev servers, so fall back.
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)

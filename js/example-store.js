// ═══════════════════════════════════════════
// SAVED EXAMPLE STORAGE
// ═══════════════════════════════════════════

const KEY = 'myExamples';

export function loadExamples(storage = globalThis.localStorage) {
  const raw = storage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveExamples(items, storage = globalThis.localStorage) {
  storage.setItem(KEY, JSON.stringify(items));
}

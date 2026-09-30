// ═══════════════════════════════════════════
// SAVED EXAMPLE STORAGE
// ═══════════════════════════════════════════

const KEY = 'myExamples';

function isExample(value) {
  return value && typeof value.label === 'string' && typeof value.fen === 'string';
}

export function loadExamples(storage = globalThis.localStorage) {
  const raw = storage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isExample) : [];
  } catch {
    return [];
  }
}

export function saveExamples(items, storage = globalThis.localStorage) {
  if (!Array.isArray(items) || !items.every(isExample)) throw new TypeError('範例資料格式錯誤');
  try {
    storage.setItem(KEY, JSON.stringify(items));
  } catch (error) {
    throw new Error(`無法儲存範例：${error.message}`);
  }
}

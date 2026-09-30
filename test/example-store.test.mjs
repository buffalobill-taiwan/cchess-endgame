import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExamples, saveExamples } from '../js/example-store.js';

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('example storage tolerates malformed and non-array data', () => {
  const s = storage();
  s.setItem('myExamples', '{bad');
  assert.deepEqual(loadExamples(s), []);
  s.setItem('myExamples', JSON.stringify({ label: 'wrong' }));
  assert.deepEqual(loadExamples(s), []);
});

test('example storage round-trips saved examples', () => {
  const s = storage();
  const items = [{ label: '局面', fen: '4k4/9/9/9/9/9/9/9/9/4K4' }];
  saveExamples(items, s);
  assert.deepEqual(loadExamples(s), items);
});

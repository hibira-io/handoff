import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, strings } from '../strings.js';

test('every language has every string', () => {
  const keys = Object.keys(strings('en')).sort();
  assert.equal(LANGS.length, 7);
  for (const l of LANGS) assert.deepEqual(Object.keys(strings(l)).sort(), keys, l);
});

test('picks the closest language', () => {
  assert.equal(strings('zh-Hant-TW'), strings('zh-TW'));
  assert.equal(strings('zh-HK'), strings('zh-TW'));
  assert.equal(strings('zh'), strings('zh-CN'));
  assert.equal(strings('ja-JP'), strings('ja'));
  assert.equal(strings('de'), strings('en'));
  assert.equal(strings(undefined), strings('en'));
});

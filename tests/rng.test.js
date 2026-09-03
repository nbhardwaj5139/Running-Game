import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hashString, mixSeed, normalizeSeed } from '../prototype/src/core/rng.js';

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = mulberry32(12345), b = mulberry32(12345);
  for (let i = 0; i < 1000; i++) {
    const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1);
  }
});

test('hashString / mixSeed are stable uint32', () => {
  assert.equal(hashString('vitreous'), hashString('vitreous'));
  assert.notEqual(hashString('vitreous'), hashString('vitreoux'));
  assert.notEqual(mixSeed(1, 0), mixSeed(1, 1));
  assert.ok(mixSeed(7, 7) >= 0 && mixSeed(7, 7) <= 0xffffffff);
});

test('normalizeSeed accepts strings and numbers', () => {
  assert.equal(normalizeSeed('42'), 42);
  assert.equal(normalizeSeed(42), 42);
  assert.equal(normalizeSeed('sleeper'), hashString('sleeper'));
  assert.equal(normalizeSeed(''), hashString('vitreous'));
});

import { describe, expect, it } from 'vitest';
import { canonicalJson, checksumOf } from './checksum.js';

describe('checksum', () => {
  it('is stable across object key order', () => {
    expect(checksumOf({ b: 2, a: { d: 4, c: 3 } })).toBe(checksumOf({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it('preserves array order', () => {
    expect(canonicalJson({ values: [2, 1] })).not.toBe(canonicalJson({ values: [1, 2] }));
  });
});

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { apiKeyNameFingerprint } from '../src/features/config/apiKeyNames';

describe('API key name fingerprints', () => {
  test('uses the SHA-256 fingerprint of the complete API key', () => {
    const apiKey = 'fixture-client-key';
    const expected = createHash('sha256').update(apiKey).digest('hex');

    expect(apiKeyNameFingerprint(apiKey)).toBe(expected);
    expect(apiKeyNameFingerprint(apiKey)).not.toContain(apiKey);
  });

  test('distinguishes keys that share a display prefix and suffix', () => {
    const firstKey = 'sk-same-prefix-first-middle-a-last';
    const secondKey = 'sk-same-prefix-first-middle-b-last';

    expect(apiKeyNameFingerprint(firstKey)).not.toBe(apiKeyNameFingerprint(secondKey));
  });
});

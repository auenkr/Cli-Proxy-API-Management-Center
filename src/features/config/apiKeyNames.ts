import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Names live in the config file (access.api-key-names), keyed by the SHA-256 of the client key. */
export function apiKeyNameFingerprint(apiKey: string): string {
  // Pure JS hashing also works when the panel is served over non-localhost HTTP.
  return bytesToHex(sha256(new TextEncoder().encode(apiKey)));
}

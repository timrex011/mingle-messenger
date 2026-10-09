const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { hashToken, createOpaqueToken } = require('./auth');

test('opaque tokens are unique and URL-safe', () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);
});

test('token hashes are deterministic SHA-256 hex digests', () => {
  const token = 'verification-token';
  assert.equal(hashToken(token), crypto.createHash('sha256').update(token).digest('hex'));
});

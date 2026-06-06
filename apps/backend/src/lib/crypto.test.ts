import { describe, it, expect, vi } from 'vitest'

// Must be hoisted before any import that pulls in config.ts.
vi.mock('../config.js', () => ({
  config: {
    aiKeyEncryptionSecret: 'a'.repeat(64), // 32 bytes as hex (all 0xaa)
  },
}))

import { encryptApiKey, decryptApiKey } from './crypto.js'

describe('encryptApiKey / decryptApiKey', () => {
  it('round-trips a plaintext API key', () => {
    const plaintext = 'sk-ant-test-api-key-12345'
    expect(decryptApiKey(encryptApiKey(plaintext))).toBe(plaintext)
  })

  it('round-trips an empty string', () => {
    expect(decryptApiKey(encryptApiKey(''))).toBe('')
  })

  it('round-trips a long key containing special characters', () => {
    const key = 'sk-ant-' + 'x'.repeat(200) + '=!@#$%^&*()'
    expect(decryptApiKey(encryptApiKey(key))).toBe(key)
  })

  it('returns a valid base64 string', () => {
    const ct = encryptApiKey('my-api-key')
    // base64url or standard base64
    expect(() => Buffer.from(ct, 'base64')).not.toThrow()
    expect(ct.length).toBeGreaterThan(0)
  })

  it('generates a distinct ciphertext on every call (random IV)', () => {
    const plaintext = 'sk-test-key'
    const ct1 = encryptApiKey(plaintext)
    const ct2 = encryptApiKey(plaintext)
    expect(ct1).not.toBe(ct2)
  })

  it('ciphertext length equals IV(12) + authTag(16) + plaintext.length bytes', () => {
    const plaintext = 'sk-test-key'
    const buf = Buffer.from(encryptApiKey(plaintext), 'base64')
    expect(buf.length).toBe(12 + 16 + Buffer.byteLength(plaintext, 'utf8'))
  })

  it('throws when the auth tag is tampered (ciphertext integrity failure)', () => {
    const ct = encryptApiKey('original-key')
    const buf = Buffer.from(ct, 'base64')
    // Flip a byte inside the auth tag region (bytes 12–27)
    buf[14] ^= 0xff
    expect(() => decryptApiKey(buf.toString('base64'))).toThrow()
  })

  it('throws when the ciphertext body is tampered', () => {
    const ct = encryptApiKey('original-key')
    const buf = Buffer.from(ct, 'base64')
    // Flip the last byte (inside the ciphertext)
    buf[buf.length - 1] ^= 0xff
    expect(() => decryptApiKey(buf.toString('base64'))).toThrow()
  })
})

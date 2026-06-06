import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../config.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

export function encryptApiKey(plaintext: string): string {
  const key = Buffer.from(config.aiKeyEncryptionSecret, 'hex')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Layout: [12-byte IV][16-byte authTag][ciphertext]
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export function decryptApiKey(ciphertext: string): string {
  const key = Buffer.from(config.aiKeyEncryptionSecret, 'hex')
  const buf = Buffer.from(ciphertext, 'base64')
  const iv = buf.subarray(0, IV_LENGTH)
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

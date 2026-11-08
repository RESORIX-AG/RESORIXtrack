/**
 * Password hashing: Argon2id only (PHC strings; any Argon2id hash verifies). Never log or store a plaintext
 * password.
 */
import { hash, verify } from "@node-rs/argon2"

// t=3, m=64 MiB, p=4
const OPTS = { algorithm: 2 /* Argon2id */, timeCost: 3, memoryCost: 65536, parallelism: 4, outputLen: 32 } as const

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS)
}

export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  if (!data.hash?.startsWith("$argon2")) return false
  try {
    return await verify(data.hash, data.password)
  } catch {
    return false
  }
}

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-policy"

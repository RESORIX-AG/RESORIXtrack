/**
 * Password-based, authenticated encryption of backup archives, streamed in chunks. Byte-compatible with
 * RESORIXtrack 1.x (`backend/resorixtrack/services/backup_crypto.py`), format "RTBK1":
 *
 *   magic   "RTBK\x01"
 *   header  2-byte big-endian length + compact JSON
 *           {"v":1,"kdf":"argon2id","t":3,"m":65536,"p":1,"salt":"<base64 16 bytes>","cipher":"chacha20poly1305","chunk":1048576}
 *   body    ChaCha20-Poly1305 chunks of `chunk` plaintext bytes, each followed by its 16-byte tag.
 *           nonce = 11-byte big-endian chunk counter + 1 byte "last chunk" flag; the header bytes are the
 *           associated data of every chunk.
 *
 * A fresh salt per archive gives a fresh key, so the counter nonce never repeats. The last-chunk flag makes
 * truncation detectable; any other modification fails authentication.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { closeSync, createReadStream, createWriteStream, openSync, readSync } from "node:fs"
import { Readable, Transform, type TransformCallback, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { hashRaw } from "@node-rs/argon2"
import { z } from "zod"
import { asError } from "@/lib/guards"

export const MAGIC = Buffer.from("RTBK\x01", "latin1")
export const CHUNK = 1024 * 1024
export const KDF = { t: 3, m: 65536, p: 1 } as const
export const MIN_BACKUP_PASSWORD_LENGTH = 12
const TAG = 16
const ARGON2ID = 2 // Algorithm.Argon2id

export class BackupCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BackupCryptoError"
  }
}

const positiveInt = z.number().int().positive()
const HeaderSchema = z.object({
  v: z.literal(1),
  kdf: z.literal("argon2id"),
  t: positiveInt,
  m: positiveInt,
  p: positiveInt,
  salt: z.string(),
  cipher: z.literal("chacha20poly1305"),
  chunk: positiveInt,
})
export type BackupHeader = z.infer<typeof HeaderSchema>

export function deriveKey(password: string, salt: Uint8Array, t: number, m: number, p: number): Promise<Buffer> {
  return hashRaw(Buffer.from(password, "utf8"), {
    // @node-rs/argon2 declares Algorithm as an ambient const enum, which verbatimModuleSyntax cannot import
    // oxlint-disable-next-line typescript/no-unsafe-enum-assignment
    algorithm: ARGON2ID,
    timeCost: t,
    memoryCost: m,
    parallelism: p,
    outputLen: 32,
    salt,
  })
}

function nonce(counter: number, last: boolean): Buffer {
  const n = Buffer.alloc(12)
  // 11-byte big-endian counter; JS numbers are exact up to 2^53, far beyond any real archive
  n.writeUIntBE(Math.floor(counter / 2 ** 48), 0, 5)
  n.writeUIntBE(counter % 2 ** 48, 5, 6)
  n[11] = last ? 1 : 0
  return n
}

function seal(key: Buffer, counter: number, last: boolean, aad: Buffer, plain: Buffer): Buffer {
  const c = createCipheriv("chacha20-poly1305", key, nonce(counter, last), { authTagLength: TAG })
  c.setAAD(aad, { plaintextLength: plain.length })
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()])
}

function open(key: Buffer, counter: number, last: boolean, aad: Buffer, block: Buffer): Buffer {
  if (block.length < TAG) throw new Error("short block")
  const body = block.subarray(0, block.length - TAG)
  const d = createDecipheriv("chacha20-poly1305", key, nonce(counter, last), { authTagLength: TAG })
  d.setAAD(aad, { plaintextLength: body.length })
  d.setAuthTag(block.subarray(block.length - TAG))
  return Buffer.concat([d.update(body), d.final()])
}

/** Header bytes exactly as Python's `json.dumps(..., separators=(",", ":"))` writes them (same key order). */
export function buildHeader(salt: Buffer, chunk = CHUNK): Buffer {
  const header: BackupHeader = {
    v: 1,
    kdf: "argon2id",
    t: KDF.t,
    m: KDF.m,
    p: KDF.p,
    salt: salt.toString("base64"),
    cipher: "chacha20poly1305",
    chunk,
  }
  return Buffer.from(JSON.stringify(header), "utf8")
}

export function parseHeader(raw: Buffer): BackupHeader {
  try {
    const meta = HeaderSchema.parse(JSON.parse(raw.toString("utf8")))
    const salt = Buffer.from(meta.salt, "base64")
    // a crafted header must not stall the KDF for hours or exhaust memory
    if (salt.length !== 16 || meta.chunk > 64 * 1024 * 1024 || meta.m > 1024 * 1024 || meta.t > 10 || meta.p > 16)
      throw new Error("limits")
    return meta
  } catch {
    throw new BackupCryptoError("Damaged backup header")
  }
}

/** Streaming encryptor: plaintext in, RTBK1 out. */
export class Encryptor extends Transform {
  #key: Promise<Buffer>
  #header: Buffer
  #chunk: number
  #buf: Buffer[] = []
  #len = 0
  #counter = 0
  #started = false

  constructor(password: string, chunk = CHUNK) {
    super()
    if (!password) throw new BackupCryptoError("A backup password is required")
    const salt = randomBytes(16)
    this.#chunk = chunk
    this.#header = buildHeader(salt, chunk)
    this.#key = deriveKey(password, salt, KDF.t, KDF.m, KDF.p)
  }

  #start() {
    if (this.#started) return
    this.#started = true
    const len = Buffer.alloc(2)
    len.writeUInt16BE(this.#header.length)
    this.push(Buffer.concat([MAGIC, len, this.#header]))
  }

  override _transform(data: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.#key.then(
      (key) => {
        this.#start()
        this.#buf.push(data)
        this.#len += data.length
        // emit a chunk only when more data follows it: the final chunk must carry the "last" flag
        if (this.#len > this.#chunk) {
          let all = Buffer.concat(this.#buf)
          while (all.length > this.#chunk) {
            this.push(seal(key, this.#counter++, false, this.#header, all.subarray(0, this.#chunk)))
            all = all.subarray(this.#chunk)
          }
          this.#buf = [all]
          this.#len = all.length
        }
        cb()
      },
      (err: unknown) => cb(asError(err)),
    )
  }

  override _flush(cb: TransformCallback): void {
    this.#key.then(
      (key) => {
        this.#start()
        this.push(seal(key, this.#counter, true, this.#header, Buffer.concat(this.#buf)))
        cb()
      },
      (err: unknown) => cb(asError(err)),
    )
  }
}

/** Streaming decryptor: RTBK1 in, plaintext out. Errors with BackupCryptoError on a wrong password or damage. */
export class Decryptor extends Transform {
  #password: string
  #pending: Buffer = Buffer.alloc(0)
  #header: Buffer | null = null
  #meta: BackupHeader | null = null
  #key: Buffer | null = null
  #counter = 0

  constructor(password: string) {
    super()
    this.#password = password
  }

  get header(): BackupHeader | null {
    return this.#meta
  }

  async #ensureKey(): Promise<boolean> {
    if (this.#key) return true
    const buf = this.#pending
    if (buf.length < MAGIC.length + 2) return false
    if (!buf.subarray(0, MAGIC.length).equals(MAGIC))
      throw new BackupCryptoError("Not an encrypted RESORIXtrack backup (expected the RTBK header)")
    const n = buf.readUInt16BE(MAGIC.length)
    const start = MAGIC.length + 2
    if (buf.length < start + n) return false
    this.#header = Buffer.from(buf.subarray(start, start + n))
    this.#meta = parseHeader(this.#header)
    this.#pending = buf.subarray(start + n)
    this.#key = await deriveKey(
      this.#password,
      Buffer.from(this.#meta.salt, "base64"),
      this.#meta.t,
      this.#meta.m,
      this.#meta.p,
    )
    return true
  }

  #openBlock(block: Buffer, last: boolean): Buffer {
    try {
      return open(this.#key!, this.#counter, last, this.#header!, block)
    } catch {
      throw new BackupCryptoError(
        this.#counter === 0
          ? "Wrong backup password, or the file is damaged or truncated"
          : "The backup file is damaged or truncated",
      )
    }
  }

  override _transform(data: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.#pending = this.#pending.length ? Buffer.concat([this.#pending, data]) : data
    this.#ensureKey().then(
      (ready) => {
        try {
          if (ready) {
            const size = this.#meta!.chunk + TAG
            while (this.#pending.length > size) {
              this.push(this.#openBlock(this.#pending.subarray(0, size), false))
              this.#counter++
              this.#pending = this.#pending.subarray(size)
            }
          }
          cb()
        } catch (err) {
          cb(asError(err))
        }
      },
      (err: unknown) => cb(asError(err)),
    )
  }

  override _flush(cb: TransformCallback): void {
    this.#ensureKey().then(
      (ready) => {
        try {
          if (!ready) throw new BackupCryptoError("Not an encrypted RESORIXtrack backup (expected the RTBK header)")
          this.push(this.#openBlock(this.#pending, true))
          cb()
        } catch (err) {
          cb(asError(err))
        }
      },
      (err: unknown) => cb(asError(err)),
    )
  }
}

export function isEncryptedFile(path: string): boolean {
  const fd = openSync(path, "r")
  try {
    const buf = Buffer.alloc(MAGIC.length)
    const n = readSync(fd, buf, 0, buf.length, 0)
    return n === MAGIC.length && buf.equals(MAGIC)
  } finally {
    closeSync(fd)
  }
}

export async function encryptFile(src: string, dest: string, password: string, chunk = CHUNK): Promise<void> {
  await pipeline(createReadStream(src), new Encryptor(password, chunk), createWriteStream(dest, { mode: 0o600 }))
}

/** Decrypts into memory (no plaintext on disk). */
export async function decryptFileToBuffer(
  src: string,
  password: string,
): Promise<{ data: Buffer; header: BackupHeader }> {
  const dec = new Decryptor(password)
  const parts: Buffer[] = []
  await pipeline(
    createReadStream(src),
    dec,
    new Writable({
      write(chunk: Buffer, _enc, cb) {
        parts.push(chunk)
        cb()
      },
    }),
  )
  return { data: Buffer.concat(parts), header: dec.header! }
}

export async function encryptBuffer(plain: Uint8Array, password: string, chunk = CHUNK): Promise<Buffer> {
  return collect(Readable.from([Buffer.from(plain)]), new Encryptor(password, chunk))
}

export async function decryptBuffer(data: Uint8Array, password: string): Promise<Buffer> {
  return collect(Readable.from([Buffer.from(data)]), new Decryptor(password))
}

async function collect(src: Readable, t: Transform): Promise<Buffer> {
  const parts: Buffer[] = []
  await pipeline(
    src,
    t,
    new Writable({
      write(chunk: Buffer, _enc, cb) {
        parts.push(chunk)
        cb()
      },
    }),
  )
  return Buffer.concat(parts)
}

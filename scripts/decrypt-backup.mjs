#!/usr/bin/env node
/**
 * Decrypt a RESORIXtrack backup (.zip.enc, v1 or v2) without RESORIXtrack, for disaster recovery.
 *
 *   npm install @node-rs/argon2          (the only dependency; everything else is node:crypto)
 *   BACKUP_PASSWORD=... node decrypt-backup.mjs resorixtrack-20261106-020000-auto.zip.enc backup.zip
 *   (without BACKUP_PASSWORD in the environment the password is asked for)
 *
 * The result is a plain ZIP with personal data: unzip it somewhere safe and delete it when you are done.
 *
 * Format "RTBK1": magic "RTBK\x01", 2-byte big-endian header length, JSON header (Argon2id parameters, salt,
 * chunk size), then ChaCha20-Poly1305 chunks of `chunk` bytes plus a 16-byte tag; nonce = 11-byte big-endian
 * counter + 1 byte last-chunk flag; the header bytes are the associated data of every chunk.
 */
import { createDecipheriv } from "node:crypto"
import { closeSync, openSync, readSync, rmSync, writeSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { hashRaw } from "@node-rs/argon2"

const MAGIC = Buffer.from("RTBK\x01", "latin1")
const TAG = 16

function readExactly(fd, length) {
  const buf = Buffer.alloc(length)
  let got = 0
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, null)
    if (n === 0) break
    got += n
  }
  return buf.subarray(0, got)
}

function nonce(counter, last) {
  const n = Buffer.alloc(12)
  n.writeUIntBE(Math.floor(counter / 2 ** 48), 0, 5)
  n.writeUIntBE(counter % 2 ** 48, 5, 6)
  n[11] = last ? 1 : 0
  return n
}

const int = (v, max) => Number.isInteger(v) && v > 0 && v <= max
async function askPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  rl._writeToOutput = (s) => {
    if (s.startsWith("Backup password: ")) process.stdout.write("Backup password: ")
  }
  const answer = await rl.question("Backup password: ")
  rl.close()
  process.stdout.write("\n")
  return answer
}

async function main(src, dest) {
  const password = process.env.BACKUP_PASSWORD || (await askPassword())
  const fd = openSync(src, "r")
  let out = null
  try {
    if (!readExactly(fd, MAGIC.length).equals(MAGIC)) {
      console.error("not an encrypted RESORIXtrack backup")
      return 2
    }
    const header = readExactly(fd, readExactly(fd, 2).readUInt16BE(0))
    const meta = JSON.parse(header.toString("utf8"))
    if (!int(meta.t, 10) || !int(meta.m, 1024 * 1024) || !int(meta.p, 16) || !int(meta.chunk, 64 * 1024 * 1024)) {
      console.error("damaged backup header")
      return 2
    }
    const key = await hashRaw(Buffer.from(password, "utf8"), {
      // Argon2id; @node-rs/argon2 declares Algorithm as a const enum that plain JavaScript cannot import
      // oxlint-disable-next-line typescript/no-unsafe-enum-assignment
      algorithm: 2,
      timeCost: meta.t,
      memoryCost: meta.m,
      parallelism: meta.p,
      outputLen: 32,
      salt: Buffer.from(meta.salt, "base64"),
    })
    out = openSync(dest, "wx", 0o600)
    const size = meta.chunk + TAG
    let block = readExactly(fd, size)
    for (let counter = 0; ; counter++) {
      const next = readExactly(fd, size)
      const last = next.length === 0
      const d = createDecipheriv("chacha20-poly1305", key, nonce(counter, last), { authTagLength: TAG })
      const body = block.subarray(0, Math.max(0, block.length - TAG))
      d.setAAD(header, { plaintextLength: body.length })
      d.setAuthTag(block.subarray(body.length))
      try {
        writeSync(out, Buffer.concat([d.update(body), d.final()]))
      } catch {
        console.error("wrong password, or the file is damaged or truncated")
        closeSync(out)
        out = null
        rmSync(dest, { force: true })
        return 1
      }
      if (last) break
      block = next
    }
  } finally {
    if (out != null) closeSync(out)
    closeSync(fd)
  }
  console.log(`decrypted to ${dest}`)
  return 0
}

const [src, dest] = process.argv.slice(2)
if (!src || !dest) {
  console.error("usage: node decrypt-backup.mjs <backup.zip.enc> <out.zip>")
  process.exit(2)
}
process.exit(await main(src, dest))

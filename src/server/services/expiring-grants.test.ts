import { describe, expect, it } from "vitest"
import { freeze } from "../time"
import { breakGlassAllowed, consumeBreakGlass, grantBreakGlass } from "./break-glass"
import { grant, granted, revoke } from "./expiring-grants"
import { consumePasskeyRegistration, grantPasskeyRegistration, passkeyRegistrationAllowed } from "./passkey-step-up"

describe("expiring grants", () => {
  it("hold until they expire or are revoked; granting again extends", () => {
    freeze("2026-06-15T10:00:00Z")
    expect(grant("test:a", 5)).toBe("2026-06-15T10:05:00.000000Z")
    expect(granted("test:a")).toBe(true)
    expect(granted("test:b")).toBe(false)
    freeze("2026-06-15T10:05:00Z")
    expect(granted("test:a")).toBe(false)
    grant("test:a", 5)
    expect(granted("test:a")).toBe(true)
    revoke("test:a")
    expect(granted("test:a")).toBe(false)
  })

  it("break glass lasts an hour per email, passkey step-up five minutes per person", () => {
    freeze("2026-06-15T10:00:00Z")
    grantBreakGlass(" Anna@Example.nomail ")
    grantPasskeyRegistration(7)
    freeze("2026-06-15T10:04:59Z")
    expect([breakGlassAllowed("anna@example.nomail"), passkeyRegistrationAllowed(7)]).toEqual([true, true])
    expect(passkeyRegistrationAllowed(8)).toBe(false)
    freeze("2026-06-15T10:05:00Z")
    expect([breakGlassAllowed("anna@example.nomail"), passkeyRegistrationAllowed(7)]).toEqual([true, false])
    consumeBreakGlass("ANNA@example.nomail")
    consumePasskeyRegistration(7)
    expect(breakGlassAllowed("anna@example.nomail")).toBe(false)
  })
})

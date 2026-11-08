import { describe, expect, it } from "vitest"
import { isProjectPrompted, promptProject, readNextProject, writeNextProject } from "./next-project"

describe("next clock-in project", () => {
  it("flags the picker after a refused clock-in until a project is chosen", () => {
    writeNextProject(1, null)
    expect(isProjectPrompted()).toBe(false)
    promptProject()
    expect(isProjectPrompted()).toBe(true)
    writeNextProject(1, null)
    expect(isProjectPrompted()).toBe(true)
    writeNextProject(1, 7)
    expect(readNextProject(1)).toBe(7)
    expect(isProjectPrompted()).toBe(false)
  })
})

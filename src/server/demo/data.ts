import type { Locale } from "@/lib/locales"
import type { Capability } from "../db/schema"

export const DEMO_DOMAIN = "example.nomail"

export interface DemoPerson {
  name: string
  email: string
  team: string | null
  role: "admin" | "employee"
  /** lead of the team; "deputy" stands in for two weeks from today */
  lead?: "lead" | "deputy"
  caps?: Capability[]
  pensum: number
  locale: Locale
  /** what the accounts table says about the person */
  label: string
}

export const TEAMS: Record<string, string> = {
  "RF Engineering": "#35a1cc",
  "Software & DSP": "#8a63d2",
  Operations: "#d4882b",
}

export const PEOPLE: DemoPerson[] = [
  {
    name: "RESORIXtrack Admin",
    email: "admin",
    team: null,
    role: "admin",
    pensum: 100,
    locale: "de",
    label: "administrator",
  },
  {
    name: "Nina Graf",
    email: "nina.graf",
    team: "Operations",
    role: "employee",
    caps: ["hr", "projects"],
    pensum: 80,
    locale: "de",
    label: "HR, 80 %",
  },
  {
    name: "Luca Bianchi",
    email: "luca.bianchi",
    team: "RF Engineering",
    role: "employee",
    lead: "lead",
    pensum: 100,
    locale: "en",
    label: "lead",
  },
  {
    name: "Anna Meier",
    email: "anna.meier",
    team: "RF Engineering",
    role: "employee",
    pensum: 100,
    locale: "de",
    label: "employee",
  },
  {
    name: "Marc Dubois",
    email: "marc.dubois",
    team: "RF Engineering",
    role: "employee",
    pensum: 80,
    locale: "fr",
    label: "employee, 80 %",
  },
  {
    name: "Sofia Rossi",
    email: "sofia.rossi",
    team: "RF Engineering",
    role: "employee",
    lead: "deputy",
    pensum: 100,
    locale: "it",
    label: "deputy (2 weeks)",
  },
  {
    name: "Jonas Keller",
    email: "jonas.keller",
    team: "Software & DSP",
    role: "employee",
    lead: "lead",
    pensum: 100,
    locale: "de",
    label: "lead",
  },
  {
    name: "Lea Schneider",
    email: "lea.schneider",
    team: "Software & DSP",
    role: "employee",
    pensum: 100,
    locale: "de",
    label: "employee",
  },
  {
    name: "Noah Favre",
    email: "noah.favre",
    team: "Software & DSP",
    role: "employee",
    pensum: 60,
    locale: "fr",
    label: "employee, 60 %",
  },
  {
    name: "Mia Brunner",
    email: "mia.brunner",
    team: "Software & DSP",
    role: "employee",
    pensum: 100,
    locale: "en",
    label: "employee",
  },
  {
    name: "Elena Kovac",
    email: "elena.kovac",
    team: "Operations",
    role: "employee",
    lead: "lead",
    pensum: 100,
    locale: "en",
    label: "lead",
  },
  {
    name: "Tim Baumann",
    email: "tim.baumann",
    team: "Operations",
    role: "employee",
    pensum: 100,
    locale: "de",
    label: "employee, clocked in",
  },
]

/** Clocked in right now (running entry). */
export const RUNNING = "tim.baumann"
/** Team whose previous month is signed off. */
export const SIGNED_TEAM = "RF Engineering"

export const PROJECTS: { name: string; code: string; team: string | null; color: string }[] = [
  { name: "Internal & administration", code: "INT", team: null, color: "#6b7280" },
  { name: "Training", code: "TRN", team: null, color: "#2e9e6b" },
  { name: "Antenna tuner v2", code: "AT2", team: "RF Engineering", color: "#35a1cc" },
  { name: "EMC lab", code: "EMC", team: "RF Engineering", color: "#d4882b" },
  { name: "DSP firmware", code: "DSP", team: "Software & DSP", color: "#8a63d2" },
  { name: "Customer portal", code: "WEB", team: "Software & DSP", color: "#d0525b" },
]

export const WORK_NOTES = [
  "Code review and bug fixes",
  "Measurements and test report",
  "Customer call and follow-up",
  "Documentation",
  "Planning meeting",
  "Prototype assembly",
  "Firmware debugging",
  "Release preparation",
]

export const emailOf = (local: string) => `${local}@${DEMO_DOMAIN}`

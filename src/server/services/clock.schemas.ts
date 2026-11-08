/** Inputs and constants of clock (client-safe: referenced by server-function validators). */

/** `switch`: carry on working on another project (the running entry ends, the next starts at the same time). */
export const CLOCK_ACTIONS = ["start", "stop", "unschedule", "switch"] as const

/** Actions a device may queue while offline and replay later. */
export const OFFLINE_ACTIONS = ["start", "stop", "switch"] as const

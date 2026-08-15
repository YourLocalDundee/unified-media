/**
 * Named release flags → detection regex, and the key list derived from them.
 *
 * Split out of quality.ts so it can be imported from a client component. quality.ts imports
 * `getDb` (better-sqlite3), so anything importing it is server-bound; that is why the admin
 * quality-profile UI could never use `CUSTOM_FORMAT_FLAGS` despite the constant existing for
 * exactly that purpose, and kept a hand-written list of flag names in a placeholder string
 * instead. That copy had drifted to 12 of the 18 flags. This module has no imports at all, so
 * both sides can share one definition.
 */

// The 'flag' spec value is one of these keys; an unknown key falls back to a word-boundary
// match of the value itself, so a new tag still works before it is added here.
export const FLAG_PATTERNS: Record<string, RegExp> = {
  proper: /\bproper\b/i,
  repack: /\brepack\b/i,
  internal: /\binternal\b/i,
  real: /\breal\b/i,
  extended: /\bextended\b/i,
  uncut: /\buncut\b/i,
  remux: /\bremux\b/i,
  hybrid: /\bhybrid\b/i,
  hdr10plus: /\bhdr10\+|\bhdr10plus\b/i,
  hdr: /\bhdr\b/i,
  dv: /\b(?:dv|dovi|dolby[\s.]?vision)\b/i,
  atmos: /\batmos\b/i,
  imax: /\bimax\b/i,
  // Edition flags — dotted scene titles use [._\s-] as separators, so patterns must match across them
  directors_cut: /\bdirectors?'?[._\s-]?cut\b/i,
  theatrical:    /\btheatrical(?:[._\s-]?(?:cut|edition|version))?\b/i,
  remastered:    /\bre-?master(?:ed)?\b/i,
  unrated:       /\bunrated(?:[._\s-]?(?:cut|edition))?\b/i,
  // Hardcoded (burned-in) subtitle flag — de-prioritize or reject these releases
  hc: /\b(?:HC|HCSUB|KORSUB|RUSUB|HardSub|HardCoded)\b/i,
}

/** Known flag keys, for the admin UI's flag dropdown. Derived, never hand-listed. */
export const CUSTOM_FORMAT_FLAGS = Object.keys(FLAG_PATTERNS)

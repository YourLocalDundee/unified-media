// POST /api/auth/register — CLOSED.
//
// Public sign-up was disabled when the app became reachable at https://minijoe.dev/unified. With
// no WAF in front of it (CLAUDE.md §7), an open registration endpoint on the public internet let
// anyone create an account and reach the authenticated API surface.
//
// Accounts are now created by an admin through POST /api/admin/users, which validates the same
// way but issues no session and sets force_pw_change so the admin's temporary password cannot
// stay in use. The previous implementation — email verification, pending_registrations, invite
// handling — is in git history if self-service sign-up is ever wanted again.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CLOSED = {
  error: 'Registration is closed. Ask the site owner for an account.',
} as const

export async function POST() {
  return NextResponse.json(CLOSED, { status: 403 })
}

/**
 * Invite landing page — validates the invite code from the URL segment and
 * renders either a "You're Invited" card with a link to /register?code=... or
 * an "Invalid Invite" card if the code is expired, exhausted, or not found.
 *
 * Registration is now open enrollment (no code required), but invite links
 * still function for direct onboarding. The code is passed through to the
 * register page purely as a convenience — /register does not enforce it.
 *
 * Validation is done server-side in the Server Component render; no API round-
 * trip is needed. The code is upper-cased to make links case-insensitive.
 */

import { getDb } from '@/lib/db/index'
import { nowMs } from '@/lib/utils'
import Link from 'next/link'

interface Props { params: Promise<{ code: string }> }

export default async function InvitePage({ params }: Props) {
  const { code } = await params
  const db = getDb()

  // expires_at IS NULL means no expiry; max_uses = 0 means unlimited uses.
  // Both conditions must hold simultaneously for the invite to be valid.
  const invite = db.prepare(
    'SELECT * FROM invite_codes WHERE code = ? AND (expires_at IS NULL OR expires_at > ?) AND (max_uses = 0 OR use_count < max_uses)'
  ).get(code.toUpperCase(), nowMs()) as { code: string; label: string | null; created_by: string } | undefined

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md text-center">
          <div className="rounded-xl border border-border bg-card p-8">
            <h1 className="text-xl font-semibold text-foreground mb-2">Invalid Invite</h1>
            <p className="text-muted-foreground text-sm">
              This invite link is invalid, expired, or has already been used.
            </p>
            <p className="mt-2 text-muted-foreground text-sm">
              Contact the site owner if you believe this is an error.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center">
        <div className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">You&apos;re Invited</h1>
          <p className="text-muted-foreground mb-1">You have been invited to Unified Media</p>
          {invite.label && (
            <p className="text-sm text-muted-foreground mb-6">Invited by: {invite.label}</p>
          )}
          <Link
            href={`/register?code=${invite.code}`}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Create Your Account &rarr;
          </Link>
        </div>
      </div>
    </div>
  )
}

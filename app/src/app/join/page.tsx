// /join — party invite landing page.
//
// Public route (no requireAuth). Unauthenticated visitors see the nickname form (JoinForm).
// Already-authenticated visitors are redirected straight to /play so they skip the form.
//
// Key variables:
//   searchParams.code — the 6-char join code from the invite link (?code=AB12CD)
//   party             — WatchPartyRow from DB; used to validate the party is still active
//                       and to pass media_id to JoinForm so it can redirect after join
//   session           — null = unauthenticated visitor (show form)
//                       non-null = logged-in user (redirect to /play directly)

import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dal'
import { getActivePartyByCode } from '@/lib/party/db'
import { JoinForm } from './JoinForm'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function JoinPage({ searchParams }: Props) {
  const params = await searchParams
  const code = typeof params.code === 'string' ? params.code.toUpperCase() : ''

  if (!code) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
          <p className="text-lg font-semibold text-white">Invalid invite link</p>
          <p className="mt-1 text-sm text-zinc-400">No party code was provided.</p>
        </div>
      </div>
    )
  }

  const party = getActivePartyByCode(code)
  if (!party) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
          <p className="text-lg font-semibold text-white">Party not found</p>
          <p className="mt-1 text-sm text-zinc-400">
            This watch party may have ended or the link is invalid.
          </p>
        </div>
      </div>
    )
  }

  // Logged-in users skip the nickname form and go straight to the player.
  const session = await getSession()
  if (session) {
    redirect(`/play/${party.media_id}?party=${party.join_code}`)
  }

  return <JoinForm joinCode={party.join_code} mediaId={party.media_id} />
}

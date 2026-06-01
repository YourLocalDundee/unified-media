import type { Metadata } from 'next'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import ProfileClient from './ProfileClient'

export const metadata: Metadata = { title: 'Profile — Settings' }

interface UserRow {
  username: string; email: string | null; display_name: string | null
  first_name: string | null; last_name: string | null; bio: string | null; location: string | null
}

export default async function ProfilePage() {
  const session = await requireAuth()
  const db = getDb()
  const user = db.prepare(
    'SELECT username, email, display_name, first_name, last_name, bio, location FROM users WHERE id = ?'
  ).get(session.userId) as UserRow

  return (
    <ProfileClient
      username={user.username}
      email={user.email ?? ''}
      displayName={user.display_name ?? ''}
      firstName={user.first_name ?? ''}
      lastName={user.last_name ?? ''}
      bio={user.bio ?? ''}
      location={user.location ?? ''}
      currentSessionId={session.sessionId}
    />
  )
}

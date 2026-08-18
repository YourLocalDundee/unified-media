// /register — CLOSED. Public sign-up is disabled; see src/app/api/auth/register/route.ts.
// Kept as a redirect rather than deleted so old links, bookmarks and the installed PWA's
// cached shell land somewhere sensible instead of on a 404.

import { redirect } from 'next/navigation'

export default function RegisterPage() {
  redirect('/login')
}

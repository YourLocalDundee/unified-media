/**
 * /settings — immediate redirect to the default settings sub-page.
 * Having a root /settings route avoids a 404 if the user navigates there
 * directly; the actual content lives in the sub-pages.
 */
import { redirect } from 'next/navigation'

export default function SettingsPage() {
  redirect('/settings/profile')
}

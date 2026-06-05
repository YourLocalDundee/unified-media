import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/dal'

export default async function AdminRequestsPage() {
  await requireAdmin()
  redirect('/requests')
}

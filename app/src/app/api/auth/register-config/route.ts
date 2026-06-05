import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({
    emailVerificationRequired: process.env.EMAIL_VERIFICATION_REQUIRED === 'true',
  })
}

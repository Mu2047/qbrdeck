import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const { userId, sessionId } = auth()
  return NextResponse.json({
    userId,
    sessionId,
    authenticated: !!userId,
  })
}
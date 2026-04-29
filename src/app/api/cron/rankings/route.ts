import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Vercel Cron sends the secret as a Bearer token in the Authorization header.
  // Protect this endpoint so random callers can't trigger ranking recalculation.
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('recalculate_rankings')

  if (error) {
    console.error('[cron/rankings] recalculate_rankings failed', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, timestamp: new Date().toISOString() })
}

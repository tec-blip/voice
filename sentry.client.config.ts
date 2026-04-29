import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === 'production' && !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  // No grabamos replays de sesión para respetar privacidad de los closers
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
})

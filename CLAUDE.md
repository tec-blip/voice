# SalesVoice — Context for AI Assistants

## What is this

SalesVoice is a voice-based sales roleplay training app. Users practice sales calls by talking to an AI prospect in real time. After the call, they get scored feedback across 6 categories. Built with Next.js 16, Supabase, and Gemini Live API.

## Tech Stack

- **Framework**: Next.js 16 App Router (TypeScript strict)
- **Auth & DB**: Supabase (Auth + PostgreSQL with RLS)
- **Voice**: Google Gemini Live API (WebSocket, bidirectional audio)
- **Evaluation**: Gemini 2.5 Flash (JSON response mode)
- **Charts**: Recharts
- **Styling**: Tailwind CSS v4, dark theme (zinc-950 base)
- **Language**: All UI text is in Spanish (es-MX)

## Project Structure

```
src/
  app/
    api/
      evaluate/route.ts      # POST — sends transcript to Gemini for scoring
      gemini/config/route.ts  # GET — returns Gemini WebSocket URL with API key
      rankings/route.ts       # GET — leaderboard with user names
      sessions/route.ts       # POST — save session to Supabase
      sessions/list/route.ts  # GET — user's session history
    auth/callback/route.ts    # OAuth callback, exchanges code for session
    dashboard/
      layout.tsx              # Sidebar + main content area
      page.tsx                # Stats overview, progress chart, recent sessions
      history/page.tsx        # Filterable session list with expandable feedback
      onboarding/page.tsx     # 4-step tutorial for new users
      practice/page.tsx       # Main flow: select type → call → evaluate → results
      profile/page.tsx        # User profile, stats, badge collection
      ranking/page.tsx        # Leaderboard with top 3 medals
    login/page.tsx
    register/page.tsx
  components/
    auth/                     # LoginForm, RegisterForm (client components)
    dashboard/                # FeedbackCard, ProgressChart
    layout/                   # Sidebar with navigation
    phone/                    # PhoneUI (call interface), AudioVisualizer
    ui/                       # Button, Card, Input, Badge, Avatar
  lib/
    hooks/
      use-auth.ts             # Auth state listener + signOut
      use-gemini-live.ts      # WebSocket to Gemini Live, PCM encode/decode, audio playback
      use-microphone.ts       # Web Audio API mic capture at 16kHz
    prompts/
      roleplay.ts             # 5 scenario types with Spanish system prompts
      evaluation.ts           # Evaluation prompt, 6 scoring categories, JSON output
    supabase/
      client.ts               # Browser client (@supabase/ssr)
      server.ts               # Server client with cookie handling
      middleware.ts            # Auth refresh, route protection
      schema.sql              # Full DB schema — RUN THIS IN SUPABASE FIRST
    types/
      database.ts             # Database types, TranscriptEntry, FeedbackScores
    utils/
      badges.ts               # 10 badge definitions with icons and unlock conditions
  middleware.ts               # Next.js middleware entry point
```

## Setup

```bash
npm install
cp .env.local.example .env.local  # Then fill in real values
```

### Required Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
GEMINI_API_KEY=your-gemini-api-key
```

### Database Setup

Run `src/lib/supabase/schema.sql` in your Supabase SQL Editor. This creates:
- 5 tables: `users`, `sessions`, `knowledge_base`, `rankings`, `methodology`
- RLS policies for all tables
- A trigger that auto-creates user profile + rankings row on signup

## Build & Dev

```bash
npm run dev     # Starts on localhost:3000
npm run build   # Production build
npm run lint    # ESLint
```

## Key Architecture Decisions

1. **Gemini Live API** (not OpenAI Realtime or Deepgram+ElevenLabs) — chosen for cost (~$0.04/min vs $0.12-0.18/min) while maintaining real-time bidirectional voice
2. **Single WebSocket** for voice — audio goes Float32 → Int16 → base64 → Gemini, responses come back as base64 PCM at 24kHz played via scheduled AudioBufferSourceNodes
3. **Gemini 2.5 Flash** for evaluation — JSON response mode, temperature 0.3, calibrated scoring rubric (30-50 beginner, 60-75 good, 80+ excellent)
4. **All Spanish UI** — target market is LATAM sales teams
5. **5 roleplay types**: cierre (closing), llamada_fria (cold call), framing, objeciones (objections), general

## Voice System Flow

1. User selects roleplay type → system prompt loaded from `roleplay.ts`
2. PhoneUI opens WebSocket to Gemini Live via config from `/api/gemini/config`
3. Microphone captures at 16kHz mono, sends PCM chunks as base64
4. Gemini responds with audio + text, played via Web Audio API
5. On call end, transcript sent to `/api/evaluate` → Gemini 2.5 Flash scores it
6. Results displayed in FeedbackCard, session saved to Supabase

## What's Next / TODO

- [ ] Supabase project needs to be created and schema.sql executed
- [ ] Generate proper PWA icons (192x192 and 512x512 PNG from public/icon.svg)
- [ ] Deploy to Vercel (vercel.json already configured)
- [ ] Add badge award logic (currently badges are defined but not auto-awarded)
- [ ] Add ranking recalculation after each session
- [ ] Add instructor dashboard (role-based, RLS policies already support it)
- [ ] Add session replay (transcript is saved, could add audio recording)
- [ ] Rate limiting on API routes
- [ ] E2E tests with Playwright

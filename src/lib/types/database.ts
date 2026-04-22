export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type RoleplayType = 'cierre' | 'llamada_fria' | 'framing' | 'general' | 'objeciones'
export type UserRole = 'alumno' | 'instructor' | 'admin'
export type Difficulty = 'basico' | 'intermedio' | 'avanzado'

export interface TranscriptEntry {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface FeedbackScores {
  apertura: number
  descubrimiento: number
  presentacion: number
  objeciones: number
  cierre: number
  tono: number
  feedback_positivo: string
  feedback_mejora: string
  momento_critico: string | null
}

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          name: string
          role: UserRole
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id: string
          email: string
          name: string
          role?: UserRole
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string
          role?: UserRole
          avatar_url?: string | null
          created_at?: string
        }
      }
      sessions: {
        Row: {
          id: string
          user_id: string
          type: RoleplayType
          scenario: string | null
          score: number | null
          duration: number | null
          transcript: TranscriptEntry[]
          feedback: FeedbackScores | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: RoleplayType
          scenario?: string | null
          score?: number | null
          duration?: number | null
          transcript?: TranscriptEntry[]
          feedback?: FeedbackScores | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: RoleplayType
          scenario?: string | null
          score?: number | null
          duration?: number | null
          transcript?: TranscriptEntry[]
          feedback?: FeedbackScores | null
          created_at?: string
        }
      }
      knowledge_base: {
        Row: {
          id: string
          category: string
          scenario_text: string
          difficulty: Difficulty
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          category: string
          scenario_text: string
          difficulty: Difficulty
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          category?: string
          scenario_text?: string
          difficulty?: Difficulty
          metadata?: Json
          created_at?: string
        }
      }
      rankings: {
        Row: {
          user_id: string
          total_score: number
          avg_score: number
          sessions_count: number
          rank: number
          badges: string[]
          updated_at: string
        }
        Insert: {
          user_id: string
          total_score?: number
          avg_score?: number
          sessions_count?: number
          rank?: number
          badges?: string[]
          updated_at?: string
        }
        Update: {
          user_id?: string
          total_score?: number
          avg_score?: number
          sessions_count?: number
          rank?: number
          badges?: string[]
          updated_at?: string
        }
      }
      methodology: {
        Row: {
          id: string
          name: string
          description: string
          evaluation_criteria: Json
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description: string
          evaluation_criteria?: Json
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          evaluation_criteria?: Json
          created_at?: string
        }
      }
    }
  }
}

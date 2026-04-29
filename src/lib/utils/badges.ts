export interface Badge {
  id: string
  name: string
  description: string
  icon: string
  color: string
}

export const BADGES: Badge[] = [
  { id: 'first_call', name: 'Primera Llamada', description: 'Completaste tu primera sesión de roleplay', icon: '📞', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { id: 'streak_3', name: 'Racha de 3', description: '3 días consecutivos de práctica', icon: '🔥', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  { id: 'streak_7', name: 'Semana Imparable', description: '7 días consecutivos de práctica', icon: '⚡', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  { id: 'score_80', name: 'Closer Pro', description: 'Obtuviste 80+ en una sesión', icon: '⭐', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { id: 'score_90', name: 'Closer Elite', description: 'Obtuviste 90+ en una sesión', icon: '💎', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { id: 'sessions_10', name: 'Dedicado', description: 'Completaste 10 sesiones', icon: '🎯', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  { id: 'sessions_50', name: 'Veterano', description: 'Completaste 50 sesiones', icon: '🏅', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { id: 'all_types', name: 'Versátil', description: 'Practicaste todos los tipos de roleplay', icon: '🌟', color: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
  { id: 'improvement', name: 'En Ascenso', description: 'Mejoraste tu puntuación 3 sesiones seguidas', icon: '📈', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { id: 'perfect_close', name: 'Cierre Perfecto', description: '90+ en la categoría de cierre', icon: '🤝', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
]

export function getBadgeById(id: string): Badge | undefined {
  return BADGES.find((b) => b.id === id)
}

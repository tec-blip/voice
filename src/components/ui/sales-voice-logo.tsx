/**
 * SalesVoiceLogo
 *
 * Logo inline en SVG (no depende del archivo public/icon.svg) para poder
 * aplicar animaciones CSS sin restricciones de img src.
 *
 * Props:
 *   size     — tamaño en px del logo (default 56)
 *   animated — muestra ondas de audio pulsantes (default true)
 *   className — clase extra para el contenedor
 */

interface SalesVoiceLogoProps {
  size?: number
  animated?: boolean
  className?: string
}

export function SalesVoiceLogo({ size = 56, animated = true, className = '' }: SalesVoiceLogoProps) {
  // La S ocupa un viewBox de -5 -5 110 120 → aspect ratio ≈ 100:110
  const width = size
  const height = Math.round(size * 1.1)

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width, height }}
    >
      {/* Ondas de audio — solo se muestran si animated=true */}
      {animated && (
        <>
          <style>{`
            @keyframes sv-wave {
              0%   { transform: scale(1);    opacity: 0.45; }
              100% { transform: scale(2.0);  opacity: 0;    }
            }
            .sv-wave {
              position: absolute;
              inset: 0;
              border-radius: 50%;
              border: 2px solid #C8001A;
              animation: sv-wave 2.4s ease-out infinite;
              transform-origin: center;
            }
            .sv-wave-2 { animation-delay: 0.8s; }
            .sv-wave-3 { animation-delay: 1.6s; }
          `}</style>
          <span className="sv-wave" />
          <span className="sv-wave sv-wave-2" />
          <span className="sv-wave sv-wave-3" />
        </>
      )}

      {/* S geométrica en SVG inline */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="-5 -5 110 120"
        width={width}
        height={height}
        style={{ position: 'relative', zIndex: 1 }}
        aria-label="Sales Voice"
      >
        <rect x="-5" y="-5" width="110" height="120" fill="#0a0a0a" rx="14"/>
        <path
          d="M 72,14 C 8,14 8,55 50,55 C 92,55 92,96 28,96"
          fill="none"
          stroke="#C8001A"
          strokeWidth="26"
          strokeLinecap="butt"
        />
      </svg>
    </div>
  )
}

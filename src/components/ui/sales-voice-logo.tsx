/**
 * SalesVoiceLogo
 *
 * Isotipo exacto de Sales Hacking (dos paths originales) con fill rojo #C8001A.
 * Opcional: animación de barras de audio tipo ecualizador, muy sutil.
 *
 * Props:
 *   size     — altura en px del isotipo (default 56). Ancho se calcula automático
 *              manteniendo el aspect ratio 620:712 del original.
 *   animated — muestra barras de audio animadas debajo (default true)
 *   className — clase extra para el contenedor
 */

interface SalesVoiceLogoProps {
  size?: number
  animated?: boolean
  className?: string
}

// Barras del ecualizador: cada una tiene su propia duración y delay
// para que el movimiento sea orgánico y no sincronizado.
const BARS = [
  { dur: '0.9s', delay: '0.0s', maxH: 10 },
  { dur: '1.1s', delay: '0.2s', maxH: 16 },
  { dur: '0.7s', delay: '0.5s', maxH: 12 },
  { dur: '1.3s', delay: '0.1s', maxH: 8  },
  { dur: '0.8s', delay: '0.4s', maxH: 14 },
]

export function SalesVoiceLogo({ size = 56, animated = true, className = '' }: SalesVoiceLogoProps) {
  // Mantiene el aspect ratio original 620:712
  const height = size
  const width  = Math.round(size * (620 / 712))

  return (
    <div className={`flex flex-col items-center gap-1.5 ${className}`}>
      {/* Isotipo SVG — paths exactos del ISOTIPO_ROJO original */}
      <svg
        version="1.0"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 620 712"
        width={width}
        height={height}
        aria-label="Sales Voice"
      >
        <g
          transform="translate(0,712) scale(0.1,-0.1)"
          fill="#C8001A"
          stroke="none"
        >
          <path d="M1752 7109 c-430 -36 -840 -223 -1155 -528 -343 -332 -548 -775 -589
-1269 -36 -450 115 -941 405 -1311 91 -117 1428 -1651 1447 -1661 30 -16 1525
-9 1525 7 0 12 -417 496 -1434 1663 -570 654 -652 753 -702 852 -95 187 -99
415 -12 623 84 200 264 365 478 437 l70 23 1538 3 c1290 2 1538 5 1535 16 -2
11 -931 1088 -983 1139 -15 16 -96 17 -1018 16 -551 -1 -1048 -6 -1105 -10z"/>
          <path d="M2810 4788 c0 -13 408 -486 1459 -1692 306 -351 578 -669 605 -705
124 -168 178 -375 143 -556 -69 -366 -334 -617 -682 -646 -60 -5 -759 -9
-1552 -9 -1201 0 -1443 -2 -1443 -13 0 -8 225 -272 499 -588 l499 -574 1038 0
c1145 1 1127 0 1380 65 793 205 1365 899 1435 1739 31 372 -66 788 -260 1112
-80 135 -131 202 -303 400 -78 90 -380 439 -671 774 -291 336 -549 631 -572
658 l-42 47 -767 0 c-606 0 -766 -3 -766 -12z"/>
        </g>
      </svg>

      {/* Barras de audio — solo si animated=true */}
      {animated && (
        <>
          <style>{`
            @keyframes sv-bar {
              0%, 100% { transform: scaleY(0.2); }
              50%       { transform: scaleY(1);   }
            }
          `}</style>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '3px',
              height: '18px',
              opacity: 0.55,
            }}
          >
            {BARS.map((b, i) => (
              <div
                key={i}
                style={{
                  width: '3px',
                  height: `${b.maxH}px`,
                  background: '#C8001A',
                  borderRadius: '2px',
                  transformOrigin: 'bottom',
                  animation: `sv-bar ${b.dur} ease-in-out infinite`,
                  animationDelay: b.delay,
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

import React from 'react';

/**
 * Emblema central tipo "marca a tinta": una plántula creciendo dentro de un
 * círculo dibujado a mano, con hojas verdes. Estilo cuaderno de campo.
 */
export const AuthLogoEmblem: React.FC = () => (
  <svg width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden>
    {/* Círculo exterior con stroke "manual" */}
    <circle
      cx="60" cy="60" r="52"
      stroke="#1c2421" strokeWidth="2.5" fill="#fafaf5"
      strokeDasharray="0.6 1.2" strokeLinecap="round"
    />
    <circle cx="60" cy="60" r="48" stroke="#1c2421" strokeWidth="1.2" fill="none" opacity="0.45" />

    {/* Suelo (línea horizontal) */}
    <line x1="28" y1="86" x2="92" y2="86" stroke="#1c2421" strokeWidth="2" strokeLinecap="round" />
    <line x1="32" y1="89" x2="88" y2="89" stroke="#1c2421" strokeWidth="1" strokeLinecap="round" strokeDasharray="1.5 2.5" opacity="0.5" />

    {/* Tallo curvo */}
    <path
      d="M60 86 C 60 70, 56 60, 60 46 C 64 36, 60 28, 60 24"
      stroke="#1c2421" strokeWidth="2.4" fill="none" strokeLinecap="round"
    />

    {/* Hojas (oval) */}
    <path
      d="M60 58 C 48 56, 38 48, 36 38 C 44 38, 56 44, 60 56"
      fill="#5fae45" stroke="#1c2421" strokeWidth="1.8" strokeLinejoin="round"
    />
    <path
      d="M60 48 C 72 46, 82 38, 84 28 C 76 28, 64 34, 60 46"
      fill="#7ec25a" stroke="#1c2421" strokeWidth="1.8" strokeLinejoin="round"
    />
    <path
      d="M60 38 C 52 36, 46 30, 46 22 C 54 22, 60 28, 60 36"
      fill="#5fae45" stroke="#1c2421" strokeWidth="1.6" strokeLinejoin="round"
    />

    {/* Brote pequeño arriba */}
    <circle cx="60" cy="22" r="3" fill="#1c2421" />
  </svg>
);

/**
 * Decoración esquina sup-izquierda: lupa con hojita
 */
export const DecoMagnifier: React.FC = () => (
  <svg width="90" height="90" viewBox="0 0 90 90" fill="none" aria-hidden>
    <circle cx="34" cy="34" r="22" stroke="#1c2421" strokeWidth="2.2" fill="#fff" />
    <circle cx="34" cy="34" r="17" stroke="#1c2421" strokeWidth="1" fill="none" opacity="0.4" />
    <line x1="50" y1="50" x2="78" y2="78" stroke="#1c2421" strokeWidth="3.5" strokeLinecap="round" />
    <line x1="56" y1="50" x2="74" y2="68" stroke="#fafaf5" strokeWidth="1" />
    {/* Hojita dentro de la lupa */}
    <path d="M34 30 C 28 28, 24 24, 24 20 C 30 20, 34 24, 34 28" fill="#5fae45" stroke="#1c2421" strokeWidth="1.3" />
    <path d="M34 30 C 40 28, 44 24, 44 20 C 38 20, 34 24, 34 28" fill="#7ec25a" stroke="#1c2421" strokeWidth="1.3" />
    <line x1="34" y1="30" x2="34" y2="42" stroke="#1c2421" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

/**
 * Decoración esquina inf-derecha: matraz/probeta con líquido verde
 */
export const DecoFlask: React.FC = () => (
  <svg width="80" height="100" viewBox="0 0 80 100" fill="none" aria-hidden>
    {/* Cuello del matraz */}
    <rect x="28" y="6" width="24" height="22" stroke="#1c2421" strokeWidth="2.2" fill="#fff" rx="2" />
    <line x1="28" y1="14" x2="52" y2="14" stroke="#1c2421" strokeWidth="1" opacity="0.4" strokeDasharray="2 2" />
    {/* Cuerpo del matraz */}
    <path
      d="M28 26 L 16 80 Q 14 92 28 92 L 52 92 Q 66 92 64 80 L 52 26 Z"
      stroke="#1c2421" strokeWidth="2.4" fill="#fff" strokeLinejoin="round"
    />
    {/* Líquido verde */}
    <path
      d="M22 60 L 18 80 Q 16 92 28 92 L 52 92 Q 64 92 62 80 L 58 60 Z"
      fill="#a5d977" stroke="#1c2421" strokeWidth="1.5" strokeLinejoin="round" opacity="0.85"
    />
    {/* Burbujas */}
    <circle cx="32" cy="76" r="3" fill="#fafaf5" stroke="#1c2421" strokeWidth="1" />
    <circle cx="46" cy="72" r="2" fill="#fafaf5" stroke="#1c2421" strokeWidth="1" />
    <circle cx="42" cy="84" r="2.5" fill="#fafaf5" stroke="#1c2421" strokeWidth="1" />
    {/* Marcas de medición */}
    <line x1="60" y1="50" x2="63" y2="50" stroke="#1c2421" strokeWidth="1" />
    <line x1="60" y1="58" x2="63" y2="58" stroke="#1c2421" strokeWidth="1" />
    <line x1="60" y1="66" x2="63" y2="66" stroke="#1c2421" strokeWidth="1" />
  </svg>
);

/**
 * Decoración esquina sup-derecha: gota de agua
 */
export const DecoDrop: React.FC = () => (
  <svg width="60" height="80" viewBox="0 0 60 80" fill="none" aria-hidden>
    <path
      d="M30 8 C 22 24, 8 38, 8 54 C 8 66, 18 74, 30 74 C 42 74, 52 66, 52 54 C 52 38, 38 24, 30 8 Z"
      fill="#7ec3e8" stroke="#1c2421" strokeWidth="2.2" strokeLinejoin="round"
    />
    {/* Brillo */}
    <path d="M22 36 C 18 42, 16 50, 18 58" stroke="#fafaf5" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.7" />
  </svg>
);

/**
 * Decoración esquina inf-izquierda: hojas sueltas
 */
export const DecoLeaves: React.FC = () => (
  <svg width="100" height="80" viewBox="0 0 100 80" fill="none" aria-hidden>
    {/* Hoja grande */}
    <path
      d="M20 50 C 10 40, 12 22, 30 16 C 48 22, 50 40, 40 50 Z"
      fill="#5fae45" stroke="#1c2421" strokeWidth="2" strokeLinejoin="round"
    />
    <line x1="22" y1="48" x2="38" y2="22" stroke="#1c2421" strokeWidth="1.2" strokeLinecap="round" />
    {/* Hoja pequeña */}
    <path
      d="M58 62 C 52 56, 54 44, 64 42 C 74 46, 74 56, 68 62 Z"
      fill="#7ec25a" stroke="#1c2421" strokeWidth="2" strokeLinejoin="round"
    />
    <line x1="59" y1="60" x2="68" y2="45" stroke="#1c2421" strokeWidth="1.1" strokeLinecap="round" />
    {/* Brote/baya */}
    <circle cx="80" cy="34" r="6" fill="#e57373" stroke="#1c2421" strokeWidth="1.8" />
    <path d="M80 28 C 78 24, 82 22, 80 28" stroke="#1c2421" strokeWidth="1.4" fill="none" strokeLinecap="round" />
  </svg>
);

/**
 * Marca de "anotaciones" tipo cuaderno: línea con flecha apuntando al logo
 */
export const DecoArrow: React.FC<{ flip?: boolean }> = ({ flip }) => (
  <svg
    width="120" height="50"
    viewBox="0 0 120 50"
    fill="none"
    aria-hidden
    style={flip ? { transform: 'scaleX(-1)' } : undefined}
  >
    <path
      d="M10 25 Q 50 5, 90 25"
      stroke="#1c2421" strokeWidth="2" fill="none" strokeLinecap="round"
      strokeDasharray="2 3"
    />
    <path
      d="M86 22 L 95 25 L 86 30"
      stroke="#1c2421" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

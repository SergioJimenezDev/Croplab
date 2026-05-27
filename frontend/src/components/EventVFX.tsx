import React, { useEffect, useId, useRef } from 'react';
import { tsParticles } from '@tsparticles/engine';
import type { Container, ISourceOptions } from '@tsparticles/engine';
import { loadSlim } from '@tsparticles/slim';
import { TipoEvento } from '../types';

// VFXEffect amplía TipoEvento con efectos "virtuales" que sólo viven en el
// frontend (no son tipos válidos para el backend). 'derribar_ovni' por ejemplo
// es la animación local del cañón anti-OVNI: el evento real que se persiste
// sigue siendo 'instalacion_malla'.
export type VFXEffect = TipoEvento | 'derribar_ovni';

interface EventVFXProps {
  effect: VFXEffect | null;
  /**
   * Duración en ms tras la cual se llama a onFinish.
   * - número (ej 4000) → desaparece tras N ms (flash).
   * - null → bucle infinito; las partículas siguen hasta que cambie `effect` desde fuera.
   */
  durationMs?: number | null;
  onFinish?: () => void;
}

let engineReadyPromise: Promise<void> | null = null;

const ensureEngine = (): Promise<void> => {
  if (!engineReadyPromise) {
    engineReadyPromise = loadSlim(tsParticles).then(() => undefined);
  }
  return engineReadyPromise;
};

const baseOptions = {
  fullScreen: { enable: false },
  detectRetina: true,
  fpsLimit: 60,
  background: { color: { value: 'transparent' } },
  interactivity: {
    detectsOn: 'window' as const,
    events: {
      onHover: { enable: false },
      onClick: { enable: false },
      resize: { enable: true }
    }
  },
  pauseOnBlur: false,
  pauseOnOutsideViewport: false
};

// ============================================================
// Presets reutilizables
// ============================================================

type Range = { min: number; max: number };

interface FallingOpts {
  count?: number;
  colors: string | string[];
  shape?: 'circle' | 'line' | 'square' | 'triangle';
  size?: Range;
  speed?: Range;
  opacity?: number | Range;
  straight?: boolean;
  wobble?: boolean;
}

const falling = ({
  count = 150,
  colors,
  shape = 'circle',
  size = { min: 3, max: 7 },
  speed = { min: 18, max: 28 },
  opacity = 0.85,
  straight = true,
  wobble = false
}: FallingOpts): ISourceOptions => ({
  ...baseOptions,
  particles: {
    number: { value: count, density: { enable: true, width: 1920, height: 1080 } },
    color: { value: colors },
    shape: { type: shape },
    opacity: { value: opacity },
    size: { value: size },
    move: {
      enable: true,
      direction: 'bottom',
      speed,
      straight,
      outModes: { default: 'out' }
    },
    ...(wobble ? { wobble: { enable: true, distance: 12, speed: { min: 4, max: 10 } } as any } : {})
  }
});

interface RisingOpts {
  count?: number;
  colors: string | string[];
  size?: Range;
  speed?: Range;
}

const rising = ({ count = 90, colors, size = { min: 3, max: 7 }, speed = { min: 1.5, max: 4 } }: RisingOpts): ISourceOptions => ({
  ...baseOptions,
  particles: {
    number: { value: count, density: { enable: true, width: 1920, height: 1080 } },
    color: { value: colors },
    shape: { type: 'circle' },
    opacity: { value: { min: 0.4, max: 0.85 } },
    size: { value: size },
    move: {
      enable: true,
      direction: 'top',
      speed,
      straight: false,
      outModes: { default: 'out' }
    }
  }
});

interface SwarmOpts {
  count?: number;
  colors: string | string[];
  shape?: 'circle' | 'triangle' | 'square';
  size?: Range;
  speed?: Range;
}

const swarm = ({ count = 180, colors, shape = 'circle', size = { min: 2, max: 5 }, speed = { min: 2, max: 6 } }: SwarmOpts): ISourceOptions => ({
  ...baseOptions,
  particles: {
    number: { value: count, density: { enable: true, width: 1920, height: 1080 } },
    color: { value: colors },
    shape: { type: shape },
    opacity: { value: { min: 0.5, max: 0.95 } },
    size: { value: size },
    move: {
      enable: true,
      direction: 'none',
      speed,
      straight: false,
      random: true,
      outModes: { default: 'bounce' }
    }
  }
});

interface SideWindOpts {
  count?: number;
  colors: string | string[];
  shape?: 'line' | 'circle';
  size?: Range;
  speed?: Range;
}

const sideWind = ({ count = 120, colors, shape = 'line', size = { min: 6, max: 14 }, speed = { min: 20, max: 35 } }: SideWindOpts): ISourceOptions => ({
  ...baseOptions,
  particles: {
    number: { value: count, density: { enable: true, width: 1920, height: 1080 } },
    color: { value: colors },
    shape: { type: shape },
    stroke: shape === 'line' ? { width: 1, color: { value: Array.isArray(colors) ? colors[0] : colors } } : undefined,
    opacity: { value: 0.7 },
    size: { value: size },
    move: {
      enable: true,
      direction: 'right',
      speed,
      straight: true,
      outModes: { default: 'out' }
    }
  }
});

// ============================================================
// Configs por evento
// ============================================================

const configs: Partial<Record<VFXEffect, ISourceOptions>> = {
  // === Climáticos clásicos ===
  granizo: falling({ count: 140, colors: ['#dbe9f7', '#ffffff', '#b8d2ec'], size: { min: 3, max: 7 }, speed: { min: 18, max: 28 } }),
  nevada: falling({ count: 200, colors: '#ffffff', size: { min: 1.5, max: 4 }, speed: { min: 1.2, max: 3.5 }, opacity: { min: 0.5, max: 0.95 }, straight: false, wobble: true }),
  lluvia_torrencial: falling({ count: 280, colors: ['#5fa8d3', '#4790c2', '#7fc1e8'], shape: 'line', size: { min: 10, max: 18 }, speed: { min: 26, max: 38 } }),
  lluvia_acida: falling({ count: 260, colors: ['#b6e23a', '#82b51d', '#d9f37b'], shape: 'line', size: { min: 8, max: 16 }, speed: { min: 22, max: 34 }, opacity: 0.7 }),
  sequia: falling({ count: 70, colors: ['#d4a857', '#c9924b', '#e2c97a'], shape: 'triangle', size: { min: 1, max: 3 }, speed: { min: 0.5, max: 1.5 }, opacity: { min: 0.3, max: 0.6 }, straight: false }),
  helada: falling({ count: 110, colors: ['#a8d4ec', '#e1f0fb', '#ffffff'], shape: 'triangle', size: { min: 1.5, max: 3.5 }, speed: { min: 0.4, max: 1.2 }, opacity: { min: 0.5, max: 0.9 }, straight: false }),
  ola_calor: rising({ count: 80, colors: ['#ff8a3d', '#ffb066', '#ffd06b'], size: { min: 3, max: 7 }, speed: { min: 1.5, max: 4 } }),
  viento_fuerte: sideWind({ count: 110, colors: ['#e0e0e0', '#cfcfcf'], shape: 'line', size: { min: 8, max: 16 }, speed: { min: 30, max: 50 } }),

  // === Catástrofes ===
  terremoto: rising({ count: 130, colors: ['#7a5a3a', '#9b7a52', '#5a4126'], size: { min: 2, max: 5 }, speed: { min: 1, max: 3 } }),
  tornado: swarm({ count: 220, colors: ['#888', '#a8a8a8', '#666'], shape: 'circle', size: { min: 2, max: 5 }, speed: { min: 6, max: 14 } }),
  inundacion: rising({ count: 120, colors: ['#4a90c2', '#6bb0d8', '#2e6f93'], size: { min: 3, max: 8 }, speed: { min: 0.8, max: 2.2 } }),
  rayo_caido: falling({ count: 60, colors: ['#fff8a8', '#ffe04d', '#ffffff'], shape: 'line', size: { min: 12, max: 22 }, speed: { min: 40, max: 60 }, opacity: 0.9 }),
  incendio_proximo: rising({ count: 160, colors: ['#ff5722', '#ff8a3d', '#ffc371', '#742d12'], size: { min: 2, max: 6 }, speed: { min: 1.8, max: 4.5 } }),
  niebla_persistente: swarm({ count: 60, colors: ['#e8e8e8', '#f4f4f4', '#d9d9d9'], shape: 'circle', size: { min: 20, max: 50 }, speed: { min: 0.3, max: 1 } }),
  polvo_sahariano: sideWind({ count: 130, colors: ['#d4a857', '#b58146', '#e2c97a'], shape: 'circle', size: { min: 2, max: 5 }, speed: { min: 6, max: 14 } }),

  // === Suelo ===
  erosion_suelo: falling({ count: 120, colors: ['#8b5a2b', '#a5713a', '#6e4520'], shape: 'circle', size: { min: 2, max: 4 }, speed: { min: 4, max: 9 }, opacity: { min: 0.4, max: 0.8 }, straight: false }),
  salinizacion: rising({ count: 80, colors: ['#ffffff', '#f0f0f0', '#cfdbe0'], size: { min: 2, max: 5 }, speed: { min: 0.6, max: 1.6 } }),
  acidificacion_suelo: rising({ count: 100, colors: ['#9bc24c', '#76a82e', '#c9e679'], size: { min: 3, max: 7 }, speed: { min: 1, max: 3 } }),

  // === Plagas / enfermedades específicas ===
  plaga: swarm({ count: 160, colors: ['#3b2e1d', '#5b4423', '#1c1208'], size: { min: 2, max: 4 }, speed: { min: 3, max: 7 } }),
  enfermedad: rising({ count: 100, colors: ['#c4b14b', '#d3c46a', '#8a7724'], size: { min: 3, max: 6 }, speed: { min: 0.8, max: 2 } }),
  malas_hierbas: rising({ count: 90, colors: ['#3d8a2a', '#5fae45', '#76c25b'], size: { min: 2, max: 5 }, speed: { min: 0.6, max: 1.8 } }),
  roya: falling({ count: 130, colors: ['#c4632b', '#a04a17', '#e07f3c'], size: { min: 2, max: 4 }, speed: { min: 2, max: 5 }, opacity: { min: 0.5, max: 0.85 }, straight: false }),
  mildiu: rising({ count: 110, colors: ['#7a8a90', '#9aaab0', '#bcc8cf'], size: { min: 2, max: 6 }, speed: { min: 0.5, max: 1.5 } }),
  oidio: falling({ count: 150, colors: '#ffffff', size: { min: 1, max: 3 }, speed: { min: 1, max: 3 }, opacity: { min: 0.4, max: 0.8 }, straight: false }),
  virus_mosaico: swarm({ count: 200, colors: ['#d4c14b', '#5fae45', '#7a8a90', '#c4632b'], size: { min: 2, max: 5 }, speed: { min: 3, max: 8 } }),
  pulgones: swarm({ count: 220, colors: ['#5fae45', '#76c25b', '#9bc24c'], size: { min: 1.5, max: 3 }, speed: { min: 2, max: 5 } }),
  arana_roja: swarm({ count: 200, colors: ['#c1272d', '#e54852', '#7a1116'], size: { min: 1.5, max: 3 }, speed: { min: 4, max: 9 } }),
  caracoles: swarm({ count: 60, colors: ['#8b5a2b', '#a5713a', '#5b3a14'], size: { min: 4, max: 8 }, speed: { min: 0.4, max: 1.2 } }),
  nematodos: rising({ count: 90, colors: ['#a07a4f', '#7a5a35', '#bd9460'], size: { min: 2, max: 4 }, speed: { min: 1, max: 2.5 } }),
  aves_plaga: swarm({ count: 35, colors: ['#202020', '#3a3a3a', '#1a1a1a'], shape: 'triangle', size: { min: 6, max: 12 }, speed: { min: 6, max: 14 } }),
  jabalies: rising({ count: 90, colors: ['#5b3a14', '#7a4a1a', '#3d2810'], size: { min: 3, max: 7 }, speed: { min: 1, max: 2.8 } }),
  langostas: swarm({ count: 280, colors: ['#7a8c2a', '#a5b045', '#5f6f1a'], shape: 'triangle', size: { min: 3, max: 6 }, speed: { min: 7, max: 14 } }),

  // === Técnicos / subrealistas ===
  apagon_riego: swarm({ count: 70, colors: ['#ffcc33', '#fff066'], size: { min: 2, max: 5 }, speed: { min: 1, max: 3 } }),
  contaminacion_quimica: rising({ count: 120, colors: ['#7fff00', '#76c25b', '#3d8a2a', '#c4ec5f'], size: { min: 4, max: 9 }, speed: { min: 1.5, max: 3.5 } }),
  marabunta_hormigas: swarm({ count: 320, colors: ['#1a1208', '#3b2e1d', '#000000'], size: { min: 1.5, max: 2.8 }, speed: { min: 4, max: 9 } }),
  ola_radiacion_uv: rising({ count: 150, colors: ['#fff066', '#ffe34a', '#ffffff', '#ffeb99'], size: { min: 2, max: 5 }, speed: { min: 2, max: 5 } }),

  // === Acciones de manejo ===
  riego: falling({ count: 200, colors: ['#4a90c2', '#6bb0d8', '#9bd0ed'], shape: 'line', size: { min: 6, max: 12 }, speed: { min: 12, max: 22 } }),
  fertilizacion: rising({ count: 110, colors: ['#5fae45', '#3d8a2a', '#a5713a'], size: { min: 3, max: 6 }, speed: { min: 1.2, max: 3 } }),
  tratamiento_fitosanitario: rising({ count: 130, colors: ['#cfd8dc', '#90a4ae', '#eceff1'], size: { min: 4, max: 8 }, speed: { min: 1, max: 2.8 } }),
  poda: falling({ count: 80, colors: ['#5b3a14', '#7a4a1a', '#a07a4f'], shape: 'triangle', size: { min: 3, max: 6 }, speed: { min: 2, max: 5 }, opacity: { min: 0.5, max: 0.9 }, straight: false }),
  cosecha: falling({ count: 120, colors: ['#d4a857', '#e2c97a', '#c98c2c', '#f0c050'], shape: 'square', size: { min: 3, max: 6 }, speed: { min: 4, max: 9 }, opacity: 0.9, straight: false, wobble: true }),
  mulching: falling({ count: 100, colors: ['#8b5a2b', '#a5713a', '#5b3a14', '#76512a'], shape: 'triangle', size: { min: 3, max: 7 }, speed: { min: 1.5, max: 4 }, opacity: { min: 0.5, max: 0.9 }, straight: false, wobble: true }),
  control_biologico: swarm({ count: 80, colors: ['#c1272d', '#e54852', '#1a1a1a'], size: { min: 3, max: 5 }, speed: { min: 1.5, max: 4 } }),
  enmienda_calcica: falling({ count: 180, colors: '#ffffff', size: { min: 1, max: 2.5 }, speed: { min: 1.5, max: 4 }, opacity: { min: 0.5, max: 0.9 }, straight: false }),
  instalacion_malla: swarm({ count: 50, colors: ['#aaaaaa', '#cccccc', '#888888'], shape: 'square', size: { min: 3, max: 6 }, speed: { min: 0.5, max: 1.5 } }),
  compostaje: rising({ count: 130, colors: ['#5b3a14', '#5fae45', '#a07a4f', '#76512a'], size: { min: 3, max: 6 }, speed: { min: 1, max: 2.5 } }),
  aireacion_suelo: rising({ count: 160, colors: ['#bccfdc', '#dfe7ec', '#a8bcc8'], size: { min: 2, max: 5 }, speed: { min: 1.5, max: 4 } }),

  // === Destrucción total — capas de partículas a juego con el 3D ===
  meteorito: rising({ count: 200, colors: ['#ff6418', '#ffba50', '#ff2010', '#3a1a05'], size: { min: 3, max: 8 }, speed: { min: 4, max: 9 } }),
  bomba_nuclear: rising({ count: 260, colors: ['#fff0a0', '#ff8a18', '#3aff66', '#1a0a05'], size: { min: 3, max: 9 }, speed: { min: 3, max: 8 } }),
  zombies: rising({ count: 140, colors: ['#7aff8a', '#3a4a1a', '#5a0a08', '#1a0303'], size: { min: 2, max: 5 }, speed: { min: 1, max: 3 } }),

  otro: swarm({ count: 60, colors: ['#999999'], size: { min: 2, max: 4 }, speed: { min: 1, max: 3 } })
};

// ============================================================
// Tintes por evento
// ============================================================

const tintStyles: Partial<Record<VFXEffect, React.CSSProperties>> = {
  granizo: { background: 'linear-gradient(180deg, rgba(150,180,210,0.10), rgba(120,150,200,0.18))' },
  nevada: { background: 'linear-gradient(180deg, rgba(255,255,255,0.10), rgba(200,220,240,0.18))' },
  lluvia_torrencial: { background: 'linear-gradient(180deg, rgba(70,120,160,0.18), rgba(40,80,120,0.28))' },
  lluvia_acida: { background: 'radial-gradient(circle at 50% 30%, rgba(180,220,40,0.10), rgba(80,120,10,0.28))' },
  sequia: { background: 'radial-gradient(circle at 50% 40%, rgba(255,200,80,0.12), rgba(180,120,40,0.25))' },
  helada: { background: 'linear-gradient(180deg, rgba(190,220,235,0.18), rgba(140,180,210,0.22))' },
  ola_calor: { background: 'radial-gradient(circle at 50% 60%, rgba(255,140,60,0.18), rgba(180,40,10,0.20))' },
  viento_fuerte: { background: 'linear-gradient(90deg, rgba(230,230,230,0.08), rgba(180,180,180,0.18))' },

  terremoto: { background: 'radial-gradient(circle at 50% 50%, rgba(120,80,40,0.12), rgba(60,30,10,0.32))' },
  tornado: { background: 'radial-gradient(circle at 50% 50%, rgba(100,100,100,0.18), rgba(40,40,40,0.30))' },
  inundacion: { background: 'linear-gradient(180deg, rgba(50,110,160,0.20), rgba(20,60,100,0.35))' },
  rayo_caido: { background: 'radial-gradient(circle at 50% 30%, rgba(255,240,150,0.22), rgba(30,30,80,0.20))' },
  incendio_proximo: { background: 'radial-gradient(circle at 50% 70%, rgba(255,90,30,0.22), rgba(120,20,10,0.32))' },
  niebla_persistente: { background: 'rgba(230,230,230,0.45)' },
  polvo_sahariano: { background: 'linear-gradient(180deg, rgba(220,160,80,0.16), rgba(160,100,40,0.28))' },

  erosion_suelo: { background: 'linear-gradient(180deg, rgba(140,100,60,0.10), rgba(90,60,30,0.20))' },
  salinizacion: { background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.10), rgba(180,200,210,0.20))' },
  acidificacion_suelo: { background: 'radial-gradient(circle at 50% 50%, rgba(120,180,80,0.12), rgba(60,100,30,0.22))' },

  plaga: { background: 'radial-gradient(circle at 50% 50%, rgba(80,50,20,0.08), rgba(30,20,5,0.22))' },
  enfermedad: { background: 'radial-gradient(circle at 50% 50%, rgba(200,180,60,0.12), rgba(120,100,30,0.22))' },
  malas_hierbas: { background: 'radial-gradient(circle at 50% 50%, rgba(100,170,60,0.10), rgba(60,100,30,0.18))' },
  roya: { background: 'radial-gradient(circle at 50% 50%, rgba(190,90,40,0.14), rgba(110,40,15,0.22))' },
  mildiu: { background: 'radial-gradient(circle at 50% 50%, rgba(140,160,170,0.18), rgba(90,110,120,0.22))' },
  oidio: { background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.18), rgba(220,220,220,0.20))' },
  virus_mosaico: { background: 'radial-gradient(circle at 50% 50%, rgba(180,150,60,0.14), rgba(100,80,30,0.22))' },
  pulgones: { background: 'radial-gradient(circle at 50% 50%, rgba(100,180,80,0.10), rgba(50,100,30,0.18))' },
  arana_roja: { background: 'radial-gradient(circle at 50% 50%, rgba(190,40,40,0.14), rgba(100,10,10,0.22))' },
  caracoles: { background: 'radial-gradient(circle at 50% 50%, rgba(120,90,50,0.10), rgba(60,40,15,0.18))' },
  nematodos: { background: 'radial-gradient(circle at 50% 50%, rgba(140,100,60,0.12), rgba(80,55,30,0.22))' },
  aves_plaga: { background: 'radial-gradient(circle at 50% 30%, rgba(50,50,50,0.12), rgba(20,20,20,0.22))' },
  jabalies: { background: 'radial-gradient(circle at 50% 50%, rgba(110,70,30,0.16), rgba(60,30,10,0.28))' },
  langostas: { background: 'radial-gradient(circle at 50% 50%, rgba(150,170,60,0.14), rgba(80,90,20,0.26))' },

  apagon_riego: { background: 'radial-gradient(circle at 50% 50%, rgba(255,210,80,0.12), rgba(0,0,0,0.35))' },
  contaminacion_quimica: { background: 'radial-gradient(circle at 50% 50%, rgba(140,220,40,0.18), rgba(60,100,10,0.30))' },
  marabunta_hormigas: { background: 'radial-gradient(circle at 50% 50%, rgba(40,30,10,0.10), rgba(20,15,5,0.28))' },
  ola_radiacion_uv: { background: 'radial-gradient(circle at 50% 30%, rgba(255,250,150,0.22), rgba(180,140,30,0.22))' },

  riego: { background: 'linear-gradient(180deg, rgba(80,150,200,0.10), rgba(50,100,160,0.18))' },
  fertilizacion: { background: 'radial-gradient(circle at 50% 60%, rgba(120,180,80,0.10), rgba(70,110,40,0.18))' },
  tratamiento_fitosanitario: { background: 'radial-gradient(circle at 50% 50%, rgba(220,230,235,0.18), rgba(150,170,180,0.22))' },
  poda: { background: 'radial-gradient(circle at 50% 60%, rgba(140,90,40,0.10), rgba(70,40,15,0.18))' },
  cosecha: { background: 'radial-gradient(circle at 50% 50%, rgba(240,200,80,0.16), rgba(180,130,30,0.20))' },
  mulching: { background: 'linear-gradient(180deg, rgba(140,90,40,0.10), rgba(80,50,20,0.22))' },
  control_biologico: { background: 'radial-gradient(circle at 50% 50%, rgba(220,80,80,0.10), rgba(120,30,30,0.18))' },
  enmienda_calcica: { background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.18), rgba(220,220,220,0.20))' },
  instalacion_malla: { background: 'radial-gradient(circle at 50% 50%, rgba(180,180,180,0.14), rgba(120,120,120,0.20))' },
  compostaje: { background: 'radial-gradient(circle at 50% 60%, rgba(120,160,80,0.12), rgba(80,60,30,0.22))' },
  aireacion_suelo: { background: 'radial-gradient(circle at 50% 50%, rgba(180,210,225,0.16), rgba(120,150,170,0.20))' },

  // === Destrucción total — tintes apocalípticos ===
  meteorito: { background: 'radial-gradient(circle at 50% 30%, rgba(255,140,40,0.30), rgba(80,15,5,0.55))' },
  bomba_nuclear: { background: 'radial-gradient(circle at 50% 60%, rgba(255,230,120,0.35), rgba(60,180,80,0.20)), radial-gradient(circle at 50% 80%, rgba(20,5,5,0.55), rgba(0,0,0,0.0))' },
  zombies: { background: 'radial-gradient(circle at 50% 70%, rgba(80,180,80,0.20), rgba(20,10,5,0.55))' },

  otro: { background: 'rgba(120,120,120,0.10)' }
};

// El overlay de partículas va POR DEBAJO del HUD de la simulación:
//   z-index 0  → .sim-v2-scene (Canvas 3D)
//   z-index 1  → este overlay de partículas (se queda sobre la escena pero bajo la UI)
//   z-index ≥8 → toda la UI/HUD del simulador (stats, dock, paneles, header…)
// Antes estaba en 2000 y tapaba botones, alertas y panel lateral.
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 1
};

const kickResize = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('resize'));
};

export const EventVFX: React.FC<EventVFXProps> = ({ effect, durationMs = 4000, onFinish }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<Container | null>(null);
  const onFinishRef = useRef(onFinish);
  const rawId = useId();
  const elementId = `vfx-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    if (!effect) return;
    const options = configs[effect];
    if (!options) {
      if (durationMs == null) return;
      const t = window.setTimeout(() => onFinishRef.current?.(), durationMs);
      return () => window.clearTimeout(t);
    }

    let cancelled = false;
    let resizeTimer1: number | undefined;
    let resizeTimer2: number | undefined;
    let finishTimer: number | undefined;
    let rafId: number | undefined;

    const start = async () => {
      await ensureEngine();
      if (cancelled || !containerRef.current) return;

      rafId = window.requestAnimationFrame(async () => {
        if (cancelled || !containerRef.current) return;
        try {
          const instance = await tsParticles.load({
            id: elementId,
            element: containerRef.current,
            options
          });
          if (cancelled) {
            instance?.destroy();
            return;
          }
          instanceRef.current = instance ?? null;
          instance?.refresh();
          resizeTimer1 = window.setTimeout(kickResize, 0);
          resizeTimer2 = window.setTimeout(kickResize, 80);
        } catch (err) {
          console.error('EventVFX: error inicializando partículas', err);
        }
      });
    };

    start();

    if (durationMs != null) {
      finishTimer = window.setTimeout(() => {
        onFinishRef.current?.();
      }, durationMs);
    }

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      if (resizeTimer1) window.clearTimeout(resizeTimer1);
      if (resizeTimer2) window.clearTimeout(resizeTimer2);
      if (finishTimer) window.clearTimeout(finishTimer);
      if (instanceRef.current) {
        instanceRef.current.destroy();
        instanceRef.current = null;
      }
    };
  }, [effect, durationMs, elementId]);

  if (!effect) return null;

  return (
    <div style={{ ...overlayStyle, ...(tintStyles[effect] ?? {}) }} aria-hidden>
      <div
        ref={containerRef}
        id={elementId}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default EventVFX;

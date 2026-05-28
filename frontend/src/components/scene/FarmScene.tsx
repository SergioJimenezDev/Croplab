import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { Simulacion, EtapaFenologica, TipoCultivo, TipoSuelo } from '../../types';

// PRNG determinista (mulberry32) — produce el mismo aleatorio para la misma seed
const makeRng = (seed: number) => {
  let s = (seed | 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Banderita con emoji que se clava sobre la parcela cuando hay un evento activo del sistema. */
export interface EventoBanderita {
  /** Identificador estable para no recolocar la banderita en cada frame. */
  id: number | string;
  emoji: string;
  /** Color del paño de la banderita (papel). Por defecto crema. */
  color?: string;
}

// Conjunto vacío reutilizable — evita crear un Set nuevo en cada render
// cuando el prop vfxEvents no se pasa (fallback estable para useMemo deps).
const EMPTY_VFX_SET: Set<string> = new Set();

// Tiempos aproximados (en segundos, dentro del flash de 6 s) en los que cae
// cada uno de los 5 rayos del componente Lightning. Coinciden a grandes
// rasgos con su `startTime` (i/N * slot + jitter). Las plantas usan estos
// instantes para pulsar el zarandeo cada vez que cae un rayo, en lugar de
// reaccionar solo al primero.
const LIGHTNING_BOLT_TIMES = [0.15, 1.30, 2.45, 3.60, 4.80];

interface FarmSceneProps {
  simulacion: Simulacion;
  /** Efecto VFX más reciente (para HUD / shake de pantalla). Usar `vfxEvents`
      para activar los modelos 3D — ya soporta varios simultáneos. */
  vfxEvent?: string | null;
  /** Conjunto de TODOS los efectos activos: flashes en curso + evento
      persistente (UV) + aftermaths. La escena 3D los muestra en paralelo. */
  vfxEvents?: Set<string>;
  /** Eventos cuyo VFX está en "fade-out" porque el jugador acaba de aplicar
      la acción correctora. Los componentes correspondientes (Fire, etc.) lo
      usan para reducir progresivamente su intensidad en vez de cortar de golpe. */
  extinguishingEvents?: Set<string>;
  /** Clima ambiental — cambia los doodles dibujados en las paredes del cubo de papel. */
  clima?: 'normal' | 'caluroso' | 'lluvioso' | 'frio';
  /** Eventos activos sin resolver — se materializan como banderitas clavadas en el suelo. */
  eventosActivos?: EventoBanderita[];
  /** Si hay al menos una `instalacion_malla` aplicada, mostramos el espantapájaros. */
  hasMallas?: boolean;
}

// ============================================================
// Helpers de color y crecimiento
// ============================================================

const sueloColorBase = (tipo: TipoSuelo): THREE.Color => {
  switch (tipo) {
    case 'arenoso':          return new THREE.Color('#d4b483');
    case 'franco_arenoso':   return new THREE.Color('#b38a55');
    case 'franco':           return new THREE.Color('#8a5a35');
    case 'franco_arcilloso': return new THREE.Color('#6e4a30');
    case 'arcilloso':        return new THREE.Color('#5a3a25');
    default:                 return new THREE.Color('#8a5a35');
  }
};

const follajeColor = (salud: number, cultivo: TipoCultivo) => {
  const t = Math.max(0, Math.min(1, salud / 100));
  let healthy = new THREE.Color('#4caf50');
  if (cultivo === 'tomate' || cultivo === 'pimiento') healthy = new THREE.Color('#3a8c2f');
  if (cultivo === 'maiz') healthy = new THREE.Color('#6ab74a');
  if (cultivo === 'trigo' || cultivo === 'cebada') healthy = new THREE.Color('#b4a850');
  if (cultivo === 'olivo' || cultivo === 'vid') healthy = new THREE.Color('#587d3e');
  if (cultivo === 'girasol') healthy = new THREE.Color('#5fae45');
  const sick = new THREE.Color('#7a5a2b');
  return sick.lerp(healthy, t);
};

const frutoColor = (cultivo: TipoCultivo): string => {
  switch (cultivo) {
    case 'tomate': return '#e53935';
    case 'pimiento': return '#ff7043';
    case 'zanahoria': return '#f57c00';
    case 'maiz': return '#fdd835';
    case 'girasol': return '#ffd54f';
    case 'judia':
    case 'guisante': return '#4caf50';
    case 'trigo':
    case 'cebada':
    case 'colza': return '#d4a857';
    case 'arroz': return '#efe3a8';
    case 'soja': return '#dcdca8';
    case 'vid': return '#6a1b9a';
    case 'olivo': return '#3a5727';
    case 'lechuga': return '#9ccc65';
    default: return '#ff7043';
  }
};

const alturaPorEtapa = (etapa: EtapaFenologica): number => {
  switch (etapa) {
    case 'germinacion': return 0.18;
    case 'emergencia': return 0.35;
    case 'vegetativo': return 0.7;
    case 'floracion': return 0.9;
    case 'fructificacion': return 1.0;
    case 'maduracion': return 1.05;
    case 'cosecha': return 1.1;
    default: return 0.5;
  }
};

const mostrarFrutos = (etapa: EtapaFenologica) =>
  etapa === 'fructificacion' || etapa === 'maduracion' || etapa === 'cosecha';
const mostrarFlores = (etapa: EtapaFenologica) =>
  etapa === 'floracion';

// ============================================================
// Terreno
// ============================================================

interface TerrainProps {
  humedad: number;
  tipoSuelo: TipoSuelo;
  size: number;
}

// Tile base de "papel cuadriculado" en CanvasTexture. Se genera UNA vez y luego se
// clona por cada superficie con su propio `repeat`, así todas las caras del cubo de
// papel comparten la imagen pero pueden ajustar la densidad de cuadritos para no
// deformarse cuando la cara tiene un aspect ratio distinto.
// Colores y separaciones alineados con el CSS del body (index.css: --paper-bg,
// --paper-grid, --paper-grid-strong).
const PAPER_TILE_UNITS = 5;       // unidades de mundo por tile (1 tile = 16 cuadritos finos)
const PAPER_BG = '#fafaf5';

const basePaperTexture: THREE.CanvasTexture | null = (() => {
  if (typeof document === 'undefined') return null; // SSR safe
  const tile = 256;
  const c = document.createElement('canvas');
  c.width = tile;
  c.height = tile;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = PAPER_BG;
  ctx.fillRect(0, 0, tile, tile);
  ctx.strokeStyle = 'rgba(110, 140, 110, 0.30)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= tile; i += 16) {
    ctx.beginPath(); ctx.moveTo(i + 0.5, 0); ctx.lineTo(i + 0.5, tile); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i + 0.5); ctx.lineTo(tile, i + 0.5); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(110, 140, 110, 0.55)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= tile; i += 80) {
    ctx.beginPath(); ctx.moveTo(i + 0.5, 0); ctx.lineTo(i + 0.5, tile); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i + 0.5); ctx.lineTo(tile, i + 0.5); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
})();

/** Devuelve una textura "papel" con la repetición justa para una superficie del
 *  tamaño dado, así los cuadritos miden lo mismo en todas las caras de la habitación. */
const paperTextureFor = (widthUnits: number, heightUnits: number): THREE.Texture | null => {
  if (!basePaperTexture) return null;
  const tex = basePaperTexture.clone();
  tex.needsUpdate = true;
  tex.repeat.set(widthUnits / PAPER_TILE_UNITS, heightUnits / PAPER_TILE_UNITS);
  return tex;
};

// ============================================================
// Doodles a mano alzada (sol, nubes, gotas, termómetro, copo)
// ============================================================

const INK = '#3a4a3a';
const INK_WARM = '#c08820';
const INK_COLD = '#3a6a9a';

/** Dibuja un círculo a "mano alzada" con leve jitter, opcionalmente relleno. */
const sketchCircle = (
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  fill?: string
) => {
  const N = 20;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = r * (1 + Math.sin(i * 2.3 + cx) * 0.05);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.stroke();
};

const drawSun = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
  ctx.save();
  ctx.strokeStyle = INK_WARM;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  sketchCircle(ctx, cx, cy, r);
  // Rayos
  const rays = 9;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * r * 1.35;
    const y1 = cy + Math.sin(a) * r * 1.35;
    const x2 = cx + Math.cos(a) * r * 1.85;
    const y2 = cy + Math.sin(a) * r * 1.85;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  // Carita opcional (puntos)
  ctx.fillStyle = INK_WARM;
  ctx.beginPath(); ctx.arc(cx - r * 0.32, cy - r * 0.1, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + r * 0.32, cy - r * 0.1, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
};

const drawCloud = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#fafaf5';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  // Una nube = 4 burbujas
  const bumps = [
    { x: -r * 0.7, y: r * 0.1, r: r * 0.45 },
    { x: -r * 0.2, y: -r * 0.25, r: r * 0.55 },
    { x: r * 0.35, y: -r * 0.15, r: r * 0.5 },
    { x: r * 0.75, y: r * 0.1, r: r * 0.4 }
  ];
  ctx.beginPath();
  bumps.forEach(b => {
    ctx.moveTo(cx + b.x + b.r, cy + b.y);
    ctx.arc(cx + b.x, cy + b.y, b.r, 0, Math.PI * 2);
  });
  ctx.fill();
  ctx.stroke();
  // Línea base ondulada
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.0, cy + r * 0.45);
  ctx.quadraticCurveTo(cx, cy + r * 0.6, cx + r * 1.05, cy + r * 0.45);
  ctx.stroke();
  ctx.restore();
};

const drawRaindrop = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
  ctx.save();
  ctx.strokeStyle = INK_COLD;
  ctx.fillStyle = 'rgba(80, 140, 200, 0.18)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  // Forma de gota: punta arriba, cuerpo redondo abajo
  ctx.moveTo(cx, cy - r);
  ctx.bezierCurveTo(cx + r * 0.95, cy - r * 0.1, cx + r * 0.85, cy + r * 0.7, cx, cy + r * 0.85);
  ctx.bezierCurveTo(cx - r * 0.85, cy + r * 0.7, cx - r * 0.95, cy - r * 0.1, cx, cy - r);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const drawSnowflake = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
  ctx.save();
  ctx.strokeStyle = INK_COLD;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  const arms = 6;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    // mini bifurcaciones cerca de la punta
    const bx = cx + Math.cos(a) * r * 0.7;
    const by = cy + Math.sin(a) * r * 0.7;
    const a1 = a + 0.5, a2 = a - 0.5;
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(a1) * r * 0.25, by + Math.sin(a1) * r * 0.25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(a2) * r * 0.25, by + Math.sin(a2) * r * 0.25); ctx.stroke();
  }
  ctx.restore();
};

const drawThermometer = (
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fillPct: number // 0 (frío) .. 1 (caliente)
) => {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  const tubeW = size * 0.22;
  const tubeH = size * 1.4;
  const bulbR = size * 0.32;
  // Tubo (rectángulo redondeado)
  const x = cx - tubeW / 2, y = cy - tubeH / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + tubeW / 2);
  ctx.arc(x + tubeW / 2, y + tubeW / 2, tubeW / 2, Math.PI, 0);
  ctx.lineTo(x + tubeW, y + tubeH);
  ctx.lineTo(x, y + tubeH);
  ctx.closePath();
  ctx.stroke();
  // Líquido dentro (rojo si caliente, azul si frío)
  const liqColor = fillPct > 0.5 ? '#d94545' : '#4a8ec8';
  ctx.fillStyle = liqColor;
  const liqHeight = (tubeH - tubeW / 2 - bulbR * 0.4) * Math.max(0.1, Math.min(1, fillPct));
  ctx.fillRect(x + 2, y + tubeH - liqHeight - bulbR * 0.4, tubeW - 4, liqHeight);
  // Bulbo
  ctx.beginPath();
  ctx.arc(cx, cy + tubeH / 2 + bulbR * 0.5, bulbR, 0, Math.PI * 2);
  ctx.fillStyle = liqColor;
  ctx.fill();
  ctx.stroke();
  // Marcas en el tubo
  for (let i = 1; i <= 4; i++) {
    const yy = y + (i / 5) * tubeH;
    ctx.beginPath(); ctx.moveTo(x - 3, yy); ctx.lineTo(x, yy); ctx.stroke();
  }
  ctx.restore();
};

type Clima = 'normal' | 'caluroso' | 'lluvioso' | 'frio';

/** PRNG mulberry32 a partir de seed entero — para posicionar doodles de forma estable. */
const seedRng = (seed: number) => {
  let s = (seed | 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Pinta la cuadrícula de papel en el canvas dado. */
const paintGrid = (ctx: CanvasRenderingContext2D, w: number, h: number, fineStep = 16, thickStep = 80) => {
  ctx.fillStyle = PAPER_BG;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(110, 140, 110, 0.30)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= w; i += fineStep) {
    ctx.beginPath(); ctx.moveTo(i + 0.5, 0); ctx.lineTo(i + 0.5, h); ctx.stroke();
  }
  for (let i = 0; i <= h; i += fineStep) {
    ctx.beginPath(); ctx.moveTo(0, i + 0.5); ctx.lineTo(w, i + 0.5); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(110, 140, 110, 0.55)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= w; i += thickStep) {
    ctx.beginPath(); ctx.moveTo(i + 0.5, 0); ctx.lineTo(i + 0.5, h); ctx.stroke();
  }
  for (let i = 0; i <= h; i += thickStep) {
    ctx.beginPath(); ctx.moveTo(0, i + 0.5); ctx.lineTo(w, i + 0.5); ctx.stroke();
  }
};

/** Crea una textura de PARED con cuadrícula + doodles que cambian según el clima.
 *  Una textura distinta por seed/clima → cada pared del cubo puede tener doodles distintos. */
const createWallDoodleTexture = (
  widthUnits: number,
  heightUnits: number,
  clima: Clima,
  seed: number
): THREE.Texture | null => {
  if (typeof document === 'undefined') return null;
  // Canvas grande sin repetición — cubre la pared entera de una sola pasada
  const px = 10; // px por unidad de mundo
  const w = Math.max(256, Math.round(widthUnits * px));
  const h = Math.max(256, Math.round(heightUnits * px));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  paintGrid(ctx, w, h);

  // Decidir qué doodles pintar según el clima.
  // Importante: la cámara orbital mira desde y≈7 hacia el origen con FOV 45º,
  // así que la mitad ALTA de la pared (cy bajo en canvas) queda fuera del frustum.
  // Confinamos los doodles a la franja media-baja [40%, 80%] de la altura para
  // que se vean siempre dentro del encuadre habitual del jugador.
  const rng = seedRng(seed);
  const yMin = h * 0.40;
  const yMax = h * 0.80;
  const place = (n: number, drawer: (cx: number, cy: number, r: number) => void, rMin: number, rMax: number, customYMax?: number) => {
    const top = customYMax !== undefined ? customYMax : yMax;
    for (let i = 0; i < n; i++) {
      const cx = 40 + rng() * (w - 80);
      const cy = yMin + rng() * (top - yMin);
      const r = rMin + rng() * (rMax - rMin);
      drawer(cx, cy, r);
    }
  };

  // El termómetro lo anclamos también dentro de la franja visible, no en la esquina alta.
  const thermoY = h * 0.55;

  switch (clima) {
    case 'caluroso':
      place(2, (x, y, r) => drawSun(ctx, x, y, r), 28, 42);
      place(1, (x, y, r) => drawCloud(ctx, x, y, r), 22, 30);
      drawThermometer(ctx, w - 70, thermoY, 30, 0.85);
      break;
    case 'lluvioso':
      place(3, (x, y, r) => drawCloud(ctx, x, y, r), 28, 40);
      place(8, (x, y, r) => drawRaindrop(ctx, x, y, r), 7, 12);
      drawThermometer(ctx, w - 70, thermoY, 28, 0.45);
      break;
    case 'frio':
      place(2, (x, y, r) => drawCloud(ctx, x, y, r), 25, 35);
      place(7, (x, y, r) => drawSnowflake(ctx, x, y, r), 10, 16);
      drawThermometer(ctx, w - 70, thermoY, 28, 0.15);
      break;
    default: // normal
      place(1, (x, y, r) => drawSun(ctx, x, y, r), 30, 40);
      place(2, (x, y, r) => drawCloud(ctx, x, y, r), 26, 36);
      place(2, (x, y, r) => drawRaindrop(ctx, x, y, r), 6, 10);
      drawThermometer(ctx, w - 70, thermoY, 28, 0.55);
      break;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  return tex;
};

/** Crea una textura de SUELO con cuadrícula + reglas dibujadas en los 4 bordes,
 *  como una cinta métrica anotada a mano. Los números van de 0 a `marksTo`. */
const createFloorRulerTexture = (sizeUnits: number, marksTo = 10): THREE.Texture | null => {
  if (typeof document === 'undefined') return null;
  const px = 12; // mayor densidad → reglas legibles
  const w = Math.max(512, Math.round(sizeUnits * px));
  const h = w;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  paintGrid(ctx, w, h);

  // Banda exterior color crema (la "regla")
  const band = Math.round(w * 0.045);
  ctx.fillStyle = 'rgba(238, 220, 160, 0.55)';
  ctx.fillRect(0, 0, w, band);
  ctx.fillRect(0, h - band, w, band);
  ctx.fillRect(0, 0, band, h);
  ctx.fillRect(w - band, 0, band, h);

  // Líneas interior y exterior de la banda
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.strokeRect(band - 0.5, band - 0.5, w - band * 2 + 1, h - band * 2 + 1);

  // Marcas tipo regla en los 4 bordes
  const N = marksTo; // número de marcas grandes
  ctx.font = `bold ${Math.round(band * 0.55)}px 'Caveat', cursive`;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const isMajor = true;
    const len = isMajor ? band * 0.55 : band * 0.3;
    // Borde superior
    let x = band + t * (w - band * 2);
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x, band); ctx.lineTo(x, band - len); ctx.stroke();
    ctx.fillText(`${i}`, x, band * 0.32);
    // Borde inferior
    ctx.beginPath(); ctx.moveTo(x, h - band); ctx.lineTo(x, h - band + len); ctx.stroke();
    ctx.fillText(`${i}`, x, h - band * 0.32);
    // Borde izquierdo
    let y = band + t * (h - band * 2);
    ctx.beginPath(); ctx.moveTo(band, y); ctx.lineTo(band - len, y); ctx.stroke();
    ctx.save(); ctx.translate(band * 0.32, y); ctx.rotate(-Math.PI / 2); ctx.fillText(`${i}`, 0, 0); ctx.restore();
    // Borde derecho
    ctx.beginPath(); ctx.moveTo(w - band, y); ctx.lineTo(w - band + len, y); ctx.stroke();
    ctx.save(); ctx.translate(w - band * 0.32, y); ctx.rotate(Math.PI / 2); ctx.fillText(`${i}`, 0, 0); ctx.restore();
  }
  // Marquitas finas intermedias (cada décimo)
  ctx.lineWidth = 0.8;
  const minorN = N * 5;
  for (let i = 0; i <= minorN; i++) {
    if (i % 5 === 0) continue;
    const t = i / minorN;
    const len = band * 0.25;
    const x = band + t * (w - band * 2);
    ctx.beginPath(); ctx.moveTo(x, band); ctx.lineTo(x, band - len); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, h - band); ctx.lineTo(x, h - band + len); ctx.stroke();
    const y = band + t * (h - band * 2);
    ctx.beginPath(); ctx.moveTo(band, y); ctx.lineTo(band - len, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w - band, y); ctx.lineTo(w - band + len, y); ctx.stroke();
  }

  // Etiqueta "ha" en una esquina como anotación
  ctx.font = `italic ${Math.round(band * 0.5)}px 'Caveat', cursive`;
  ctx.fillStyle = INK_WARM;
  ctx.textAlign = 'left';
  ctx.fillText('hectáreas →', band + 4, band * 1.6);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  return tex;
};

/** Crea una textura simple de "papel + cuadrícula" para una emoji-banderita. */
const createEmojiFlagTexture = (emoji: string, bgColor = '#fff4cc'): THREE.Texture | null => {
  if (typeof document === 'undefined') return null;
  const w = 128, h = 96;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);
  // Borde a mano
  ctx.strokeStyle = '#1c2421';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, w - 4, h - 4);
  // Emoji centrado
  ctx.font = `${Math.round(h * 0.62)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
};

const Terrain: React.FC<TerrainProps> = ({ humedad, tipoSuelo, size }) => {
  const wetness = Math.max(0, Math.min(1, humedad / 100));
  const baseColor = useMemo(() => sueloColorBase(tipoSuelo), [tipoSuelo]);
  // Suelo húmedo: oscurece y aumenta saturación. Lerp suave por 0..1.
  const color = useMemo(() => {
    const wet = baseColor.clone().multiplyScalar(0.45);
    return baseColor.clone().lerp(wet, wetness * 0.75);
  }, [baseColor, wetness]);

  // === Suelo con noise multi-octava + vertex colors variados ===
  // El multi-octava combina ondulaciones largas (lomas suaves) con ruido fino
  // (pequeños baches), produciendo un terreno mucho menos plástico que el
  // ruido uniforme original. Cada vértice también lleva un tono ligeramente
  // distinto para romper la uniformidad del color base.
  const geometry = useMemo(() => {
    const seg = 56;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    const pos = g.attributes.position;
    const rng = makeRng(98765);
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const lowFreq = Math.sin(x * 0.8 + 1.3) * Math.cos(y * 0.7 - 0.4) * 0.08;
      const midFreq = Math.sin(x * 2.1 - 0.6) * Math.cos(y * 1.9 + 1.4) * 0.035;
      const grain   = (rng() - 0.5) * 0.04;
      pos.setZ(i, lowFreq + midFreq + grain);
      const cVar = 0.82 + rng() * 0.36;
      const c = color.clone().multiplyScalar(cVar);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [size, color]);

  // === Caballones: lomos de tierra sobre los que crece el cultivo ===
  // Cada caballón es un trapecio alargado a lo largo del eje X con un surco
  // ligeramente hundido al lado, que crea sombra natural por contraste de color.
  const caballones = useMemo(() => {
    const lines: number[] = [];
    const step = 0.85;
    for (let z = -size / 2 + step * 0.6; z < size / 2 - 0.2; z += step) lines.push(z);
    return lines;
  }, [size]);

  // === Piedras dispersas — dodecaedros pequeños rotados aleatoriamente ===
  const stones = useMemo(() => {
    const rng = makeRng(13371);
    return Array.from({ length: 26 }).map(() => ({
      x: (rng() - 0.5) * (size - 0.8),
      z: (rng() - 0.5) * (size - 0.8),
      r: 0.04 + rng() * 0.09,
      rotX: rng() * Math.PI,
      rotY: rng() * Math.PI,
      rotZ: rng() * Math.PI,
      shade: 0.5 + rng() * 0.4
    }));
  }, [size]);

  // === Terrones de tierra removida — pequeños bloques deformes ===
  const clods = useMemo(() => {
    const rng = makeRng(13373);
    return Array.from({ length: 20 }).map(() => ({
      x: (rng() - 0.5) * (size - 0.8),
      z: (rng() - 0.5) * (size - 0.8),
      sx: 0.07 + rng() * 0.11,
      sy: 0.035 + rng() * 0.045,
      sz: 0.07 + rng() * 0.11,
      rotY: rng() * Math.PI,
      shade: 0.7 + rng() * 0.45
    }));
  }, [size]);

  // === Charcas — solo aparecen cuando la humedad pasa de ~60% ===
  const puddles = useMemo(() => {
    const rng = makeRng(13372);
    return Array.from({ length: 7 }).map(() => ({
      x: (rng() - 0.5) * (size - 1.5),
      z: (rng() - 0.5) * (size - 1.5),
      r: 0.18 + rng() * 0.25,
      tilt: (rng() - 0.5) * 0.12
    }));
  }, [size]);
  const puddleOpacity = Math.max(0, (wetness - 0.55) / 0.35);

  // === Bordes de madera: dos tablones por lado, ligeramente teñidos distintos ===
  const planks = useMemo(() => {
    const rng = makeRng(2424);
    return Array.from({ length: 4 }).map(() => ({
      tone1: 0.85 + rng() * 0.3,
      tone2: 0.75 + rng() * 0.3
    }));
  }, []);
  const woodBase = new THREE.Color('#5a3a18');

  return (
    <group>
      {/* Suelo base con vertex colors y ligero metalness cuando está mojado */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          roughness={0.95 - wetness * 0.25}
          metalness={wetness * 0.12}
        />
      </mesh>

      {/* Caballones (lomos de tierra) + surcos a su lado para crear surcado en relieve */}
      {caballones.map((z, i) => (
        <group key={`caba-${i}`} position={[0, 0, z]}>
          {/* Lomo trapezoidal, ligeramente más claro */}
          <mesh position={[0, 0.045, 0]} receiveShadow castShadow>
            <boxGeometry args={[size - 0.5, 0.09, 0.24]} />
            <meshStandardMaterial color={color.clone().multiplyScalar(1.08)} roughness={0.95} />
          </mesh>
          {/* Surco hundido (más oscuro = sombra natural) al sur del lomo */}
          <mesh position={[0, 0.008, 0.32]} receiveShadow>
            <boxGeometry args={[size - 0.5, 0.012, 0.36]} />
            <meshStandardMaterial color={color.clone().multiplyScalar(0.6)} roughness={0.95} />
          </mesh>
        </group>
      ))}

      {/* Piedras dispersas */}
      {stones.map((s, i) => (
        <mesh
          key={`stone-${i}`}
          position={[s.x, s.r * 0.55, s.z]}
          rotation={[s.rotX, s.rotY, s.rotZ]}
          castShadow
          receiveShadow
        >
          <dodecahedronGeometry args={[s.r, 0]} />
          <meshStandardMaterial
            color={new THREE.Color('#8c857a').multiplyScalar(s.shade)}
            roughness={0.85}
          />
        </mesh>
      ))}

      {/* Terrones de tierra removida */}
      {clods.map((c, i) => (
        <mesh
          key={`clod-${i}`}
          position={[c.x, c.sy * 0.5, c.z]}
          rotation={[0, c.rotY, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[c.sx, c.sy, c.sz]} />
          <meshStandardMaterial color={color.clone().multiplyScalar(c.shade)} roughness={0.95} />
        </mesh>
      ))}

      {/* Charcas — discos brillantes en zonas bajas cuando humedad > 60% */}
      {puddleOpacity > 0 && puddles.map((p, i) => (
        <mesh
          key={`puddle-${i}`}
          position={[p.x, 0.014, p.z]}
          rotation={[-Math.PI / 2, p.tilt, 0]}
        >
          <circleGeometry args={[p.r, 18]} />
          <meshStandardMaterial
            color="#2a3a48"
            transparent
            opacity={puddleOpacity * 0.65}
            roughness={0.12}
            metalness={0.35}
          />
        </mesh>
      ))}

      {/* === BORDES de madera: dos tablones apilados por lado === */}
      {/* Tablón inferior (más grueso, más oscuro) + superior (más estrecho, más claro) */}
      {[
        { axis: 'x' as const, z:  size / 2 - 0.045, idx: 0 },
        { axis: 'x' as const, z: -size / 2 + 0.045, idx: 1 },
        { axis: 'z' as const, x:  size / 2 - 0.045, idx: 2 },
        { axis: 'z' as const, x: -size / 2 + 0.045, idx: 3 }
      ].map((b) => {
        const dim: [number, number, number] = b.axis === 'x'
          ? [size, 0.09, 0.09]
          : [0.09, 0.09, size];
        const dimTop: [number, number, number] = b.axis === 'x'
          ? [size + 0.04, 0.05, 0.075]
          : [0.075, 0.05, size + 0.04];
        const pos: [number, number, number] = b.axis === 'x' ? [0, 0.05, b.z!] : [b.x!, 0.05, 0];
        const posTop: [number, number, number] = b.axis === 'x' ? [0, 0.13, b.z!] : [b.x!, 0.13, 0];
        return (
          <group key={`border-${b.idx}`}>
            <mesh position={pos} castShadow receiveShadow>
              <boxGeometry args={dim} />
              <meshStandardMaterial
                color={woodBase.clone().multiplyScalar(planks[b.idx].tone1 * 0.85)}
                roughness={0.92}
              />
            </mesh>
            <mesh position={posTop} castShadow receiveShadow>
              <boxGeometry args={dimTop} />
              <meshStandardMaterial
                color={woodBase.clone().multiplyScalar(planks[b.idx].tone2)}
                roughness={0.9}
              />
            </mesh>
          </group>
        );
      })}

      {/* Postes de esquina más altos — dan sensación de marco */}
      {[
        [ size / 2 - 0.05,  size / 2 - 0.05],
        [ size / 2 - 0.05, -size / 2 + 0.05],
        [-size / 2 + 0.05,  size / 2 - 0.05],
        [-size / 2 + 0.05, -size / 2 + 0.05]
      ].map(([x, z], i) => (
        <group key={`corner-${i}`} position={[x, 0, z]}>
          {/* Poste central */}
          <mesh position={[0, 0.20, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.16, 0.40, 0.16]} />
            <meshStandardMaterial color={woodBase.clone().multiplyScalar(0.7)} roughness={0.95} />
          </mesh>
          {/* Tapa superior (más oscura, como punta quemada) */}
          <mesh position={[0, 0.42, 0]} castShadow>
            <boxGeometry args={[0.19, 0.04, 0.19]} />
            <meshStandardMaterial color="#2a1810" roughness={0.95} />
          </mesh>
        </group>
      ))}
      {/* El suelo "papel cuadriculado" alrededor de la parcela lo dibuja el componente
          <PaperRoom> (suelo + paredes + techo), así toda la escena queda dentro de un
          cubo de papel uniforme. */}
    </group>
  );
};

// ============================================================
// Planta
// ============================================================

interface PlantProps {
  etapa: EtapaFenologica;
  salud: number;
  alturaCm: number;
  cultivo: TipoCultivo;
  position: [number, number, number];
  scale?: number;
  seed: number;
  /** Set con TODOS los eventos catastróficos activos (pueden coexistir varios).
      Las plantas COMBINAN sus transformaciones — ej. tornado + lluvia torrencial
      a la vez producen zarandeo violento + sacudida moderada simultáneamente. */
  vfxEvents?: Set<string>;
}

// Familias visuales por cultivo
type PlantArchetype = 'cereal' | 'arbusto' | 'roseta' | 'arbol' | 'girasol' | 'tuberculo';

const archetype = (cultivo: TipoCultivo): PlantArchetype => {
  switch (cultivo) {
    case 'trigo': case 'cebada': case 'arroz': case 'maiz':
      return 'cereal';
    case 'tomate': case 'pimiento': case 'judia': case 'guisante': case 'soja':
      return 'arbusto';
    case 'lechuga':
      return 'roseta';
    case 'olivo': case 'vid':
      return 'arbol';
    case 'girasol': case 'colza':
      return 'girasol';
    case 'zanahoria':
      return 'tuberculo';
    default:
      return 'arbusto';
  }
};

const Plant: React.FC<PlantProps> = ({ etapa, salud, alturaCm, cultivo, position, scale = 1, seed, vfxEvents }) => {
  // Conjunto local para uso en memos/useFrame. Empty Set como fallback estable.
  const vfxSet = vfxEvents ?? EMPTY_VFX_SET;
  const groupRef = useRef<THREE.Group>(null);
  // Pivote intermedio para que las plantas se DOBLEN (efecto "hombro caído")
  // en lugar de inclinarse rígidas desde la base. Repartimos la rotación entre
  // baseRef (ligera inclinación) y tipPivotRef (curvatura del tercio superior).
  const tipPivotRef = useRef<THREE.Group>(null);
  const swayPhase = useMemo(() => {
    const rng = makeRng(Math.round(seed * 1000));
    return rng() * Math.PI * 2;
  }, [seed]);

  // === VARIABILIDAD INDIVIDUAL ===
  // Cada planta tiene su propio "ruido" estable derivado del seed. Eso significa que
  // dentro de un mismo campo unas plantas estarán más sanas/altas/desarrolladas que otras,
  // como en una parcela real.
  const variacion = useMemo(() => {
    const rng = makeRng(Math.round(seed * 1000) + 71);
    return {
      saludOffset: (rng() - 0.5) * 30,        // ±15 de salud
      alturaFactor: 0.78 + rng() * 0.42,       // 0.78 .. 1.20 (variación de tamaño)
      hue: (rng() - 0.5) * 0.18,               // sesgo de tono (más amarillenta o más verde)
      crecimiento: 0.85 + rng() * 0.3,         // unas crecen un poco más rápido que otras
      seca: rng() < 0.18                       // ~18% de plantas son "más débiles" de origen
    };
  }, [seed]);

  // Salud percibida individual (la global ± offset, clamp 0..100)
  const saludIndividual = Math.max(0, Math.min(100, salud + variacion.saludOffset));

  const arche = archetype(cultivo);
  const factorEtapa = alturaPorEtapa(etapa);
  const altura = Math.max(0.12, Math.min(2.6, (alturaCm / 100) * 1.4 + 0.25)) * factorEtapa * variacion.alturaFactor * variacion.crecimiento;

  // Tamaño general del follaje crece con etapa, también con variación individual
  const follajeFactor = factorEtapa * variacion.crecimiento;

  // Color base con sesgo individual: algunas plantas más amarillentas (variacion.hue + lerp con marrón/seca)
  const baseColor = useMemo(() => {
    const c = follajeColor(saludIndividual, cultivo);
    // Sesgo individual de tono
    if (variacion.hue > 0) {
      c.lerp(new THREE.Color('#d4a857'), Math.min(0.35, variacion.hue));
    } else {
      c.lerp(new THREE.Color('#2c5e1f'), Math.min(0.25, -variacion.hue));
    }
    // Plantas "débiles" naturalmente: tono más apagado
    if (variacion.seca) c.lerp(new THREE.Color('#7a5a2b'), 0.3);
    return c;
  }, [saludIndividual, cultivo, variacion]);
  const colorFruto = useMemo(() => frutoColor(cultivo), [cultivo]);

  // Estado de enfermedad / madurez visual basado en la SALUD INDIVIDUAL.
  //   nivel 0 (salud >= 75)  → erguida
  //   nivel 1 (50 ≤ salud < 75) → ligeramente caída
  //   nivel 2 (25 ≤ salud < 50) → bastante caída
  //   nivel 3 (salud < 25)   → muy caída (casi tumbada)
  const droopLevel = saludIndividual >= 75 ? 0 : saludIndividual >= 50 ? 1 : saludIndividual >= 25 ? 2 : 3;
  const droopAmount = [0, 0.22, 0.55, 0.95][droopLevel];
  const enferma = droopLevel >= 1;        // se inclinan + aparecen manchas leves
  const muyEnferma = droopLevel >= 2;     // color amarillento, más manchas
  const droop = droopAmount;              // alias para compatibilidad

  // Color amarillento adicional en hojas si está enferma o en cosecha.
  // Algunos desastres tiñen el follaje (fuego → calcinado, lluvia ácida → blanqueado).
  const colorHoja = useMemo(() => {
    const c = baseColor.clone();
    if (muyEnferma) c.lerp(new THREE.Color('#7a5a2b'), 0.4);
    if (etapa === 'cosecha' && arche === 'cereal') c.lerp(new THREE.Color('#d4a857'), 0.6);
    // Prioridad: efectos más destructivos primero (los tintes son lerp, no
    // additivos, así que el primer match se aplica). Si quieres mezclarlos
    // visualmente cambia los if a if encadenados (acumulativos).
    if (vfxSet.has('bomba_nuclear')) c.lerp(new THREE.Color('#0a0805'), 0.92);
    else if (vfxSet.has('meteorito')) c.lerp(new THREE.Color('#1a0a04'), 0.85);
    else if (vfxSet.has('incendio_proximo')) c.lerp(new THREE.Color('#1a0905'), 0.78);
    else if (vfxSet.has('zombies')) c.lerp(new THREE.Color('#2a1a08'), 0.65);
    else if (vfxSet.has('lluvia_acida')) c.lerp(new THREE.Color('#4a4a18'), 0.55);
    else if (vfxSet.has('helada') || vfxSet.has('nevada')) c.lerp(new THREE.Color('#b4c8d0'), 0.30);
    return c;
  }, [baseColor, muyEnferma, etapa, arche, vfxSet]);

  // Tronco/tallo color por arquetipo
  const tronco = arche === 'arbol' ? '#6b4a2a' : arche === 'arbusto' ? '#5a8a3a' : '#4d7c2e';

  // === Parámetros estables aleatorios ===
  const hojasParams = useMemo(() => {
    const rng = makeRng(Math.round(seed * 1000) + 1);
    return Array.from({ length: 16 }).map(() => ({
      angleJitter: (rng() - 0.5) * 0.5,
      sizeMul: 0.85 + rng() * 0.3,
      tiltJitter: rng() * 0.2,
      manchaY: rng(),
      manchaX: (rng() - 0.5) * 0.5,
      ramaTilt: 0.25 + rng() * 0.3
    }));
  }, [seed]);

  const frutosParams = useMemo(() => {
    const rng = makeRng(Math.round(seed * 1000) + 2);
    return Array.from({ length: 8 }).map(() => ({
      yJitter: (rng() - 0.5) * 0.25,
      angleJitter: (rng() - 0.5) * 0.4,
      sizeMul: 0.85 + rng() * 0.3
    }));
  }, [seed]);

  // Cronómetro POR evento: cada evento del Set guarda su propio t0 para que las
  // rampas/desplomes/achicharrados arranquen desde cero cuando aparece. Eventos
  // que dejan de estar activos se borran del Map.
  const vfxStartsRef = useRef<Map<string, number>>(new Map());

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.getElapsedTime();

    // Sincroniza el Map con los eventos activos del Set
    const active = vfxSet;
    for (const ev of Array.from(vfxStartsRef.current.keys())) {
      if (!active.has(ev)) vfxStartsRef.current.delete(ev);
    }
    for (const ev of active) {
      if (!vfxStartsRef.current.has(ev)) vfxStartsRef.current.set(ev, t);
    }

    // Postura base — sway suave + droop por mala salud (aplicada UNA vez)
    const tilt = droopAmount * 0.75;
    const swayBase = Math.sin(t * 0.8 + swayPhase) * (0.04 + droopAmount * 0.05);
    let rotZ = swayBase - tilt;
    let rotX = Math.cos(t * 0.6 + swayPhase) * 0.025 + tilt * 0.35;
    let scaleY = 1;
    let offsetY = 0;

    // Variación por planta para que no se muevan todas igual
    const phase2 = swayPhase + seed * 0.73;
    const bendDir = ((seed * 1.37) % 1) * 2 - 1; // -1..1, dirección de doblez única

    // Para cada evento activo, aplicamos su DELTA sobre la baseline. Si varios
    // están activos, sus contribuciones se SUMAN (rotaciones, offsetY) o se
    // toma el MÍNIMO (scaleY → el aplastamiento más agresivo manda).
    const applyEventDelta = (event: string, tVfx: number) => {
      switch (event) {
        case 'tornado': {
          // El tornado dura 4 s; el zarandeo se apaga junto con el modelo 3D.
          const shake = Math.max(0, Math.min(1, (4.0 - tVfx) / 0.3));
          if (shake <= 0) break;
          const ramp = Math.min(1, tVfx / 0.3);
          const amp = ramp * shake;
          rotZ += (Math.sin(t * 22 + swayPhase) * 0.55 + Math.sin(t * 14 + phase2) * 0.25) * amp;
          rotX += (Math.cos(t * 19 + phase2) * 0.45 + Math.sin(t * 28 + swayPhase) * 0.18) * amp;
          offsetY += Math.abs(Math.sin(t * 18 + phase2)) * 0.04 * amp;
          break;
        }
        case 'incendio_proximo': {
          const burn = Math.min(1, tVfx / 1.5);
          const tremor = Math.sin(t * 24 + swayPhase) * 0.07 * burn;
          rotZ += -burn * 0.55 * (1 + bendDir * 0.3) + tremor;
          rotX += burn * 0.25 * bendDir;
          scaleY = Math.min(scaleY, 1 - burn * 0.4);
          break;
        }
        case 'inundacion': {
          const flood = Math.min(1, tVfx / 0.5);
          // Cancela parcialmente el sway/tilt natural mientras la planta queda flotando
          rotZ += -swayBase * flood + flood * bendDir * 0.25;
          rotX += flood * 1.2 * (0.85 + Math.abs(bendDir) * 0.3) - tilt * 0.35 * flood;
          scaleY = Math.min(scaleY, 1 - flood * 0.45);
          offsetY += -flood * 0.04;
          break;
        }
        case 'granizo': {
          rotZ += Math.sin(t * 32 + swayPhase) * 0.22 + bendDir * 0.08;
          rotX += Math.cos(t * 28 + phase2) * 0.18;
          scaleY = Math.min(scaleY, 0.96);
          break;
        }
        case 'viento_fuerte': {
          const gust = 0.35 + Math.sin(t * 4 + swayPhase) * 0.12;
          rotX += gust;
          rotZ += Math.sin(t * 6 + swayPhase) * 0.05;
          break;
        }
        case 'terremoto': {
          rotZ += Math.sin(t * 40 + swayPhase) * 0.08;
          rotX += Math.cos(t * 38 + phase2) * 0.06;
          offsetY += Math.abs(Math.sin(t * 26 + swayPhase)) * 0.025;
          break;
        }
        case 'rayo_caido': {
          // Pulso por cada bolt: cada vez que cae un rayo (≈ cada 1.15 s) la
          // planta da un susto. Antes solo reaccionaba al primero porque la
          // expresión exp(-tVfx*4) se apagaba en menos de 1 s y los rayos
          // siguientes ya no la afectaban.
          let startle = 0;
          for (const bt of LIGHTNING_BOLT_TIMES) {
            const dt = tVfx - bt;
            if (dt < 0 || dt > 0.9) continue;
            // Pico justo al caer y decae en ~0.6 s
            startle += Math.exp(-dt * 6) * 0.5;
          }
          if (startle > 0) {
            // Jitter por planta para que no salten todas exactamente igual
            const offset = swayPhase * 0.5 + seed * 0.27;
            rotZ += Math.sin(t * 42 + offset) * startle;
            rotX += Math.cos(t * 36 + phase2) * startle * 0.7;
            offsetY += Math.abs(Math.sin(t * 30 + offset)) * startle * 0.03;
          }
          break;
        }
        case 'nevada':
        case 'helada': {
          const weight = Math.min(1, tVfx / 1.0);
          rotZ += -swayBase * weight - weight * 0.25 * (1 + bendDir * 0.2);
          scaleY = Math.min(scaleY, 1 - weight * 0.08);
          break;
        }
        case 'lluvia_torrencial': {
          rotZ += Math.sin(t * 14 + swayPhase) * 0.10;
          rotX += Math.cos(t * 11 + phase2) * 0.08;
          break;
        }
        case 'langostas':
        case 'jabalies':
        case 'pulgones':
        case 'arana_roja':
        case 'caracoles': {
          rotZ += Math.sin(t * 11 + swayPhase) * 0.08;
          rotX += Math.cos(t * 9 + phase2) * 0.05;
          break;
        }
        case 'meteorito': {
          // Meteorito dura 8 s; tras eso, el zarandeo se apaga pero la planta queda
          // destruida (los términos basados en `collapse` son permanentes).
          const shake = Math.max(0, Math.min(1, (8.0 - tVfx) / 0.3));
          const ramp = Math.min(1, tVfx / 0.4) * shake;
          const collapse = Math.min(1, tVfx / 3.0);
          const pulseT = (tVfx % 0.7) / 0.7;
          const pulse = Math.exp(-pulseT * 9) * 0.55 * ramp;
          rotZ += -collapse * 1.05 * (1 + bendDir * 0.4)
            + Math.sin(t * 34 + swayPhase) * 0.6 * ramp
            + Math.sin(t * 21 + phase2) * 0.3 * ramp
            + bendDir * pulse;
          rotX += collapse * 0.45 * bendDir
            + Math.cos(t * 27 + phase2) * 0.48 * ramp
            + Math.sin(t * 39 + swayPhase) * 0.22 * ramp;
          scaleY = Math.min(scaleY, 1 - collapse * 0.6);
          offsetY += Math.abs(Math.sin(t * 24 + phase2)) * 0.09 * ramp - collapse * 0.05;
          break;
        }
        case 'bomba_nuclear': {
          // Bomba dura 9 s; tras eso, el zarandeo se apaga pero `blast`/`incin`
          // permanecen → planta queda achicharrada y aplastada en su sitio.
          const shake = Math.max(0, Math.min(1, (9.0 - tVfx) / 0.3));
          const blast = Math.min(1, tVfx / 0.3);
          const incin = Math.min(1, Math.max(0, (tVfx - 0.2) / 1.4));
          const tremor = Math.sin(t * 48 + swayPhase) * 0.55 * (1 - incin * 0.4) * shake;
          const tremor2 = Math.cos(t * 33 + phase2) * 0.4 * (1 - incin * 0.4) * shake;
          rotZ += -blast * 1.55 * (1 + bendDir * 0.5) - incin * 0.4 + tremor + bendDir * 0.35;
          rotX += blast * 1.15 * bendDir + tremor2 + incin * 0.3 * bendDir;
          scaleY = Math.min(scaleY, 1 - blast * 0.25 - incin * 0.55);
          offsetY += -blast * 0.04 - incin * 0.06;
          break;
        }
        case 'zombies': {
          // Zombies dura 9 s; tras eso se apaga el zarandeo y solo queda `trample`
          // (planta pisoteada y aplastada en el sitio).
          const shake = Math.max(0, Math.min(1, (9.0 - tVfx) / 0.3));
          const stomp = Math.sin(t * 7 + phase2 * 7.3) * Math.sin(t * 13 + swayPhase * 3.7);
          const violence = 0.75 * stomp * shake;
          const trample = Math.min(1, tVfx / 2.5);
          rotZ += -trample * 0.95 * (1 + bendDir * 0.35)
            + violence
            + Math.sin(t * 19 + swayPhase) * 0.35 * (1 - trample * 0.3) * shake;
          rotX += Math.cos(t * 15 + phase2) * 0.45 * shake
            + violence * 0.75
            + trample * 0.4 * bendDir;
          scaleY = Math.min(scaleY, 1 - trample * 0.6);
          offsetY += Math.abs(Math.sin(t * 14 + phase2)) * 0.06 * (1 - trample * 0.5) * shake - trample * 0.02;
          break;
        }
        default:
          break;
      }
    };

    for (const event of active) {
      const t0 = vfxStartsRef.current.get(event);
      if (t0 == null) continue;
      applyEventDelta(event, t - t0);
    }

    // Reparto de la rotación entre dos pivotes para conseguir doblado realista:
    //  - baseRef (en el suelo): aporta una ligera inclinación de toda la planta.
    //  - tipPivotRef (~30% de la altura): aporta la mayor parte del giro, de modo
    //    que el follaje superior cae como si el tallo "cediera". Las sumas no
    //    llegan al 100% del rotZ/rotX original a propósito: la curva queda más
    //    natural que una vara rígida girando un ángulo total grande.
    const baseFactor = 0.25;
    const tipFactor = 0.7;
    groupRef.current.rotation.z = rotZ * baseFactor;
    groupRef.current.rotation.x = rotX * baseFactor;
    groupRef.current.scale.y = scaleY;
    // position[1] viene del JSX (0.05), añadimos offset por desastre encima.
    groupRef.current.position.y = position[1] + offsetY;
    if (tipPivotRef.current) {
      tipPivotRef.current.rotation.z = rotZ * tipFactor;
      tipPivotRef.current.rotation.x = rotX * tipFactor;
    }
  });

  // === Cálculos derivados de cada arquetipo ===

  // Número de hojas según etapa
  const numHojas = etapa === 'germinacion' ? 2
    : etapa === 'emergencia' ? 4
    : etapa === 'vegetativo' ? 8
    : etapa === 'floracion' ? 10
    : etapa === 'fructificacion' || etapa === 'maduracion' ? 12
    : etapa === 'cosecha' ? 10 : 6;

  // Tamaño de fruto crece con etapa
  const frutoSizeFactor = etapa === 'fructificacion' ? 0.7
    : etapa === 'maduracion' ? 1.0
    : etapa === 'cosecha' ? 1.1 : 0;

  // Cuántos frutos
  const numFrutos = (arche === 'arbusto' || arche === 'arbol') && mostrarFrutos(etapa)
    ? (etapa === 'fructificacion' ? 4 : 6)
    : 0;

  // Manchas de enfermedad
  const numManchas = enferma ? (muyEnferma ? 3 : 1) : 0;

  // === Render por arquetipo ===

  // Durante un incendio o lluvia de meteoritos las hojas/tallos brillan con
  // tono ascua. Bomba nuclear: brillo verdoso-amarillento de radiación.
  const isBurning = vfxSet.has('incendio_proximo') || vfxSet.has('meteorito');
  const isNuked = vfxSet.has('bomba_nuclear');
  const burnEmissive = isNuked ? '#9eff4a' : (isBurning ? '#ff5418' : '#000000');
  const burnEmissiveIntensity = isNuked ? 0.7 : (isBurning ? 0.55 : 0);

  // Hoja: elipsoide aplanado en forma de lágrima, optionally con manchas
  const Hoja = ({ size, color }: { size: number; color: THREE.Color }) => (
    <group>
      <mesh castShadow scale={[size * 0.45, size * 0.08, size * 1.1]}>
        <sphereGeometry args={[1, 8, 5]} />
        <meshStandardMaterial
          color={color}
          roughness={0.7}
          side={THREE.DoubleSide}
          emissive={burnEmissive}
          emissiveIntensity={burnEmissiveIntensity}
        />
      </mesh>
      {/* Vena central */}
      <mesh position={[0, size * 0.04, 0]} scale={[size * 0.02, size * 0.02, size * 0.95]}>
        <cylinderGeometry args={[1, 1, 1, 4]} />
        <meshStandardMaterial
          color={color.clone().multiplyScalar(0.7)}
          roughness={0.8}
          emissive={burnEmissive}
          emissiveIntensity={burnEmissiveIntensity * 0.6}
        />
      </mesh>
    </group>
  );

  // Manchas marrones para enfermedad (sobre la hoja)
  const Manchas = ({ size, n, params }: { size: number; n: number; params: typeof hojasParams[0] }) => (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <mesh
          key={i}
          position={[(params.manchaX) * size * 0.3, size * 0.085, params.manchaY * size * 0.4 + i * size * 0.18]}
          scale={[size * 0.07, size * 0.005, size * 0.07]}
        >
          <sphereGeometry args={[1, 6, 4]} />
          <meshStandardMaterial color="#5a3a18" roughness={0.9} />
        </mesh>
      ))}
    </>
  );

  // Altura del pivote de doblado: ~40% de la altura total. Solo la geometría
  // que va DENTRO de tipPivotRef rota como tercio superior; lo demás queda
  // anclado en el grupo base. Cada arquetipo monta su propio tipPivotRef
  // envolviendo únicamente la parte alta (tallo superior + follaje alto +
  // espigas/flores/frutos), de manera que la planta se "dobla" en lugar de
  // tumbarse rígida.
  const tipPivotY = altura * 0.4;
  const upperShift: [number, number, number] = [0, -tipPivotY, 0];
  const tipPivotPos: [number, number, number] = [0, tipPivotY, 0];

  return (
    <group ref={groupRef} position={position} scale={scale}>
      {/* ============ CEREAL (trigo/maíz/arroz/cebada) ============ */}
      {arche === 'cereal' && (
        <>
          {/* Tallo INFERIOR (anclado, va con groupRef) — radio interpolado en el corte */}
          <mesh castShadow position={[0, tipPivotY / 2, 0]}>
            <cylinderGeometry args={[0.04 + (0.025 - 0.04) * (tipPivotY / altura), 0.04, tipPivotY, 6]} />
            <meshStandardMaterial color={tronco} roughness={0.85} />
          </mesh>
          {/* Hojas inferiores (y < pivote) */}
          {hojasParams.slice(0, numHojas).map((p, i) => {
            const y = (i / numHojas) * altura * 0.85 + altura * 0.1;
            if (y >= tipPivotY) return null;
            const ang = (i * 137.5 * Math.PI) / 180 + seed + p.angleJitter;
            const len = follajeFactor * 0.55 * p.sizeMul;
            const droopHoja = 0.05 + droopAmount * 0.55;
            return (
              <group key={`lo-${i}`} position={[Math.cos(ang) * 0.04, y, Math.sin(ang) * 0.04]} rotation={[droopHoja + p.tiltJitter, ang, -0.4 + droopHoja]}>
                <mesh castShadow scale={[len * 0.08, len * 0.02, len]}>
                  <sphereGeometry args={[1, 6, 4]} />
                  <meshStandardMaterial color={colorHoja} roughness={0.75} side={THREE.DoubleSide} />
                </mesh>
                {numManchas > 0 && <Manchas size={len} n={numManchas} params={p} />}
              </group>
            );
          })}

          {/* PARTE SUPERIOR — gira con tipPivotRef ⇒ la planta se DOBLA en el pivote */}
          <group ref={tipPivotRef} position={tipPivotPos}>
            <group position={upperShift}>
              {/* Tallo SUPERIOR */}
              <mesh castShadow position={[0, (tipPivotY + altura) / 2, 0]}>
                <cylinderGeometry args={[0.025, 0.04 + (0.025 - 0.04) * (tipPivotY / altura), altura - tipPivotY, 6]} />
                <meshStandardMaterial color={tronco} roughness={0.85} />
              </mesh>
              {/* Hojas superiores (y >= pivote) */}
              {hojasParams.slice(0, numHojas).map((p, i) => {
                const y = (i / numHojas) * altura * 0.85 + altura * 0.1;
                if (y < tipPivotY) return null;
                const ang = (i * 137.5 * Math.PI) / 180 + seed + p.angleJitter;
                const len = follajeFactor * 0.55 * p.sizeMul;
                const droopHoja = 0.05 + droopAmount * 0.55;
                return (
                  <group key={`up-${i}`} position={[Math.cos(ang) * 0.04, y, Math.sin(ang) * 0.04]} rotation={[droopHoja + p.tiltJitter, ang, -0.4 + droopHoja]}>
                    <mesh castShadow scale={[len * 0.08, len * 0.02, len]}>
                      <sphereGeometry args={[1, 6, 4]} />
                      <meshStandardMaterial color={colorHoja} roughness={0.75} side={THREE.DoubleSide} />
                    </mesh>
                    {numManchas > 0 && <Manchas size={len} n={numManchas} params={p} />}
                  </group>
                );
              })}
              {/* Espiga/mazorca al final si está espigado */}
              {(etapa === 'floracion' || etapa === 'fructificacion' || etapa === 'maduracion' || etapa === 'cosecha') && (
                cultivo === 'maiz' ? (
                  <mesh castShadow position={[0.12, altura * 0.6, 0]} rotation={[0, 0, -0.3]}>
                    <cylinderGeometry args={[0.06, 0.05, 0.25, 8]} />
                    <meshStandardMaterial color={etapa === 'cosecha' || etapa === 'maduracion' ? '#fdd835' : '#cfe28a'} roughness={0.6} />
                  </mesh>
                ) : (
                  <group position={[0, altura * 1.02, 0]}>
                    <mesh castShadow scale={[0.06, 0.25, 0.06]}>
                      <sphereGeometry args={[1, 6, 6]} />
                      <meshStandardMaterial color={etapa === 'cosecha' || etapa === 'maduracion' ? '#d4a857' : '#9fb555'} roughness={0.85} />
                    </mesh>
                    {Array.from({ length: 8 }).map((_, k) => (
                      <mesh key={k} position={[0, 0.15 + k * 0.02, 0]} rotation={[0, k, 0.6]} scale={[0.005, 0.12, 0.005]}>
                        <cylinderGeometry args={[1, 1, 1, 4]} />
                        <meshStandardMaterial color={etapa === 'cosecha' ? '#c98c2c' : '#a0b045'} />
                      </mesh>
                    ))}
                  </group>
                )
              )}
            </group>
          </group>
        </>
      )}

      {/* ============ ARBUSTO (tomate, pimiento, judía, guisante, soja) ============ */}
      {arche === 'arbusto' && (
        <>
          {/* Tallo INFERIOR */}
          <mesh castShadow position={[0, tipPivotY / 2, 0]}>
            <cylinderGeometry args={[0.05 + (0.03 - 0.05) * (tipPivotY / altura), 0.05, tipPivotY, 6]} />
            <meshStandardMaterial color={tronco} roughness={0.85} />
          </mesh>
          {/* Ramas y hojas inferiores */}
          {hojasParams.slice(0, numHojas).map((p, i) => {
            const yT = i / Math.max(numHojas - 1, 1);
            const y = altura * (0.2 + yT * 0.75);
            if (y >= tipPivotY) return null;
            const ang = (i * 137.5 * Math.PI) / 180 + seed + p.angleJitter;
            const ramaLen = 0.12 + follajeFactor * 0.15 * p.sizeMul;
            const hojaSize = follajeFactor * 0.32 * p.sizeMul;
            const tiltDroop = p.ramaTilt + droopAmount * 0.85 + p.tiltJitter;
            return (
              <group key={`lo-${i}`} position={[0, y, 0]} rotation={[0, ang, 0]}>
                <mesh position={[ramaLen / 2, 0, 0]} rotation={[0, 0, -tiltDroop]}>
                  <cylinderGeometry args={[0.01, 0.012, ramaLen, 4]} />
                  <meshStandardMaterial color={tronco} roughness={0.85} />
                </mesh>
                <group position={[ramaLen, -tiltDroop * 0.05, 0]} rotation={[0, 0, -tiltDroop]}>
                  <Hoja size={hojaSize} color={colorHoja} />
                  {numManchas > 0 && <Manchas size={hojaSize} n={numManchas} params={p} />}
                </group>
              </group>
            );
          })}

          {/* PARTE SUPERIOR — se dobla */}
          <group ref={tipPivotRef} position={tipPivotPos}>
            <group position={upperShift}>
              {/* Tallo SUPERIOR */}
              <mesh castShadow position={[0, (tipPivotY + altura) / 2, 0]}>
                <cylinderGeometry args={[0.03, 0.05 + (0.03 - 0.05) * (tipPivotY / altura), altura - tipPivotY, 6]} />
                <meshStandardMaterial color={tronco} roughness={0.85} />
              </mesh>
              {/* Ramas y hojas superiores */}
              {hojasParams.slice(0, numHojas).map((p, i) => {
                const yT = i / Math.max(numHojas - 1, 1);
                const y = altura * (0.2 + yT * 0.75);
                if (y < tipPivotY) return null;
                const ang = (i * 137.5 * Math.PI) / 180 + seed + p.angleJitter;
                const ramaLen = 0.12 + follajeFactor * 0.15 * p.sizeMul;
                const hojaSize = follajeFactor * 0.32 * p.sizeMul;
                const tiltDroop = p.ramaTilt + droopAmount * 0.85 + p.tiltJitter;
                return (
                  <group key={`up-${i}`} position={[0, y, 0]} rotation={[0, ang, 0]}>
                    <mesh position={[ramaLen / 2, 0, 0]} rotation={[0, 0, -tiltDroop]}>
                      <cylinderGeometry args={[0.01, 0.012, ramaLen, 4]} />
                      <meshStandardMaterial color={tronco} roughness={0.85} />
                    </mesh>
                    <group position={[ramaLen, -tiltDroop * 0.05, 0]} rotation={[0, 0, -tiltDroop]}>
                      <Hoja size={hojaSize} color={colorHoja} />
                      {numManchas > 0 && <Manchas size={hojaSize} n={numManchas} params={p} />}
                    </group>
                  </group>
                );
              })}
              {/* Frutos colgantes (van con la parte superior) */}
              {frutosParams.slice(0, numFrutos).map((p, i) => {
                const ang = (i * 360 / numFrutos) * (Math.PI / 180) + seed + p.angleJitter;
                const y = altura * (0.5 + p.yJitter);
                const r = 0.18;
                const size = 0.06 * frutoSizeFactor * p.sizeMul;
                const scaleArr: [number, number, number] = cultivo === 'pimiento' ? [1, 1.6, 1]
                  : (cultivo === 'judia' || cultivo === 'guisante') ? [0.7, 0.7, 2.2]
                  : [1, 1, 1];
                return (
                  <mesh key={i} castShadow position={[Math.cos(ang) * r, y, Math.sin(ang) * r]} scale={scaleArr}>
                    <sphereGeometry args={[size, 8, 6]} />
                    <meshStandardMaterial color={etapa === 'fructificacion' ? '#7faa50' : colorFruto} roughness={0.4} />
                  </mesh>
                );
              })}
            </group>
          </group>
        </>
      )}

      {/* ============ ROSETA (lechuga) ============ */}
      {arche === 'roseta' && (
        <>
          {/* No hay tallo visible — hojas en roseta desde el suelo */}
          {hojasParams.slice(0, numHojas + 4).map((p, i) => {
            const N = numHojas + 4;
            const ang = (i * 360 / N) * (Math.PI / 180);
            const len = follajeFactor * 0.42 * p.sizeMul;
            const tilt = 0.5 + droopAmount * 0.55;
            return (
              <group key={i} position={[0, follajeFactor * 0.05, 0]} rotation={[tilt, ang, 0]}>
                <mesh castShadow scale={[len * 0.45, len * 0.06, len]}>
                  <sphereGeometry args={[1, 8, 5]} />
                  <meshStandardMaterial color={colorHoja} roughness={0.6} side={THREE.DoubleSide} />
                </mesh>
                {numManchas > 0 && <Manchas size={len} n={numManchas} params={p} />}
              </group>
            );
          })}
          {/* Cogollo central */}
          {follajeFactor > 0.5 && (
            <mesh castShadow position={[0, follajeFactor * 0.12, 0]} scale={[follajeFactor * 0.25, follajeFactor * 0.18, follajeFactor * 0.25]}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshStandardMaterial color={colorHoja.clone().lerp(new THREE.Color('#fff'), 0.15)} roughness={0.6} />
            </mesh>
          )}
        </>
      )}

      {/* ============ ÁRBOL (olivo, vid) ============ */}
      {arche === 'arbol' && (
        <>
          {/* Tronco grueso — queda RÍGIDO (un olivo no se dobla por el tallo) */}
          <mesh castShadow position={[0, altura * 0.3, 0]}>
            <cylinderGeometry args={[0.07, 0.1, altura * 0.6, 8]} />
            <meshStandardMaterial color="#5a3a14" roughness={0.95} />
          </mesh>

          {/* COPA + ramas + frutos — pivotan justo encima del tronco */}
          <group ref={tipPivotRef} position={[0, altura * 0.6, 0]}>
            <group position={[0, -altura * 0.6, 0]}>
              <mesh castShadow position={[0, altura * 0.75, 0]} scale={[follajeFactor * 0.55, follajeFactor * 0.4, follajeFactor * 0.55]}>
                <sphereGeometry args={[1, 10, 8]} />
                <meshStandardMaterial color={colorHoja} roughness={0.8} />
              </mesh>
              {hojasParams.slice(0, 4).map((p, i) => {
                const ang = (i * 90 * Math.PI) / 180 + seed;
                return (
                  <mesh key={i} castShadow position={[Math.cos(ang) * follajeFactor * 0.35, altura * 0.7, Math.sin(ang) * follajeFactor * 0.35]} scale={[follajeFactor * 0.22, follajeFactor * 0.2, follajeFactor * 0.22]}>
                    <sphereGeometry args={[1, 8, 6]} />
                    <meshStandardMaterial color={colorHoja.clone().multiplyScalar(0.9)} roughness={0.85} />
                  </mesh>
                );
              })}
              {frutosParams.slice(0, numFrutos).map((p, i) => {
                const ang = (i * 360 / Math.max(numFrutos, 1)) * (Math.PI / 180) + seed;
                const r = follajeFactor * 0.4;
                const y = altura * (0.7 + p.yJitter * 0.4);
                const size = 0.045 * frutoSizeFactor * p.sizeMul;
                return (
                  <mesh key={i} castShadow position={[Math.cos(ang) * r, y, Math.sin(ang) * r]}>
                    <sphereGeometry args={[size, 6, 6]} />
                    <meshStandardMaterial color={colorFruto} roughness={0.5} />
                  </mesh>
                );
              })}
            </group>
          </group>
        </>
      )}

      {/* ============ GIRASOL / COLZA ============ */}
      {arche === 'girasol' && (
        <>
          {/* Tallo INFERIOR */}
          <mesh castShadow position={[0, tipPivotY / 2, 0]}>
            <cylinderGeometry args={[0.06 + (0.035 - 0.06) * (tipPivotY / altura), 0.06, tipPivotY, 6]} />
            <meshStandardMaterial color="#4d7c2e" roughness={0.85} />
          </mesh>
          {/* Hojas inferiores */}
          {hojasParams.slice(0, Math.min(numHojas, 6)).map((p, i) => {
            const y = (i / 6) * altura * 0.7 + altura * 0.15;
            if (y >= tipPivotY) return null;
            const ang = (i * 137.5 * Math.PI) / 180 + seed;
            const len = follajeFactor * 0.45 * p.sizeMul;
            const tilt = 0.25 + droopAmount * 0.6 + p.tiltJitter;
            return (
              <group key={`lo-${i}`} position={[0, y, 0]} rotation={[0, ang, 0]}>
                <group position={[len * 0.4, 0, 0]} rotation={[0, 0, -tilt]}>
                  <Hoja size={len} color={colorHoja} />
                  {numManchas > 0 && <Manchas size={len} n={numManchas} params={p} />}
                </group>
              </group>
            );
          })}

          {/* PARTE SUPERIOR — flor + tallo alto, se dobla */}
          <group ref={tipPivotRef} position={tipPivotPos}>
            <group position={upperShift}>
              <mesh castShadow position={[0, (tipPivotY + altura) / 2, 0]}>
                <cylinderGeometry args={[0.035, 0.06 + (0.035 - 0.06) * (tipPivotY / altura), altura - tipPivotY, 6]} />
                <meshStandardMaterial color="#4d7c2e" roughness={0.85} />
              </mesh>
              {hojasParams.slice(0, Math.min(numHojas, 6)).map((p, i) => {
                const y = (i / 6) * altura * 0.7 + altura * 0.15;
                if (y < tipPivotY) return null;
                const ang = (i * 137.5 * Math.PI) / 180 + seed;
                const len = follajeFactor * 0.45 * p.sizeMul;
                const tilt = 0.25 + droopAmount * 0.6 + p.tiltJitter;
                return (
                  <group key={`up-${i}`} position={[0, y, 0]} rotation={[0, ang, 0]}>
                    <group position={[len * 0.4, 0, 0]} rotation={[0, 0, -tilt]}>
                      <Hoja size={len} color={colorHoja} />
                      {numManchas > 0 && <Manchas size={len} n={numManchas} params={p} />}
                    </group>
                  </group>
                );
              })}
              {(etapa === 'floracion' || etapa === 'fructificacion' || etapa === 'maduracion' || etapa === 'cosecha') && (
                <group position={[0, altura, 0]} rotation={[etapa === 'cosecha' ? 0.6 : -0.2, 0, 0]}>
                  <mesh castShadow>
                    <sphereGeometry args={[0.13, 12, 10]} />
                    <meshStandardMaterial color={cultivo === 'colza' ? '#f6d54a' : '#5a3a14'} roughness={0.85} />
                  </mesh>
                  {Array.from({ length: cultivo === 'colza' ? 8 : 14 }).map((_, k) => {
                    const a = (k * 360 / (cultivo === 'colza' ? 8 : 14)) * Math.PI / 180;
                    return (
                      <mesh key={k} position={[Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18]} rotation={[0, -a, 0]} scale={[0.13, 0.02, 0.06]}>
                        <sphereGeometry args={[1, 6, 4]} />
                        <meshStandardMaterial color={cultivo === 'colza' ? '#f9e065' : '#ffd54f'} emissive="#ffd54f" emissiveIntensity={0.15} roughness={0.5} side={THREE.DoubleSide} />
                      </mesh>
                    );
                  })}
                </group>
              )}
            </group>
          </group>
        </>
      )}

      {/* ============ TUBÉRCULO (zanahoria) ============ */}
      {arche === 'tuberculo' && (
        <>
          {/* Roseta de hojas pequeñas, plumosas */}
          {hojasParams.slice(0, numHojas + 2).map((p, i) => {
            const N = numHojas + 2;
            const ang = (i * 360 / N) * (Math.PI / 180);
            const len = follajeFactor * 0.42 * p.sizeMul;
            const tilt = 0.15 + droopAmount * 0.5 + p.tiltJitter;
            return (
              <group key={i} position={[0, follajeFactor * 0.03, 0]} rotation={[tilt, ang, 0]}>
                <mesh castShadow scale={[len * 0.15, len * 0.04, len * 0.95]}>
                  <sphereGeometry args={[1, 6, 4]} />
                  <meshStandardMaterial color={colorHoja} roughness={0.7} side={THREE.DoubleSide} />
                </mesh>
                {numManchas > 0 && <Manchas size={len} n={numManchas} params={p} />}
              </group>
            );
          })}
          {/* Parte de la zanahoria visible saliendo del suelo */}
          {follajeFactor > 0.4 && (
            <mesh castShadow position={[0, 0.02, 0]} scale={[follajeFactor * 0.08, follajeFactor * 0.08, follajeFactor * 0.08]}>
              <coneGeometry args={[1, 1.5, 8]} />
              <meshStandardMaterial color="#ff8a3d" roughness={0.6} />
            </mesh>
          )}
        </>
      )}

      {/* Hojas marchitas al suelo si la salud es crítica (nivel 3) */}
      {droopLevel >= 3 && Array.from({ length: 3 }).map((_, i) => {
        const ang = (i * 120 * Math.PI) / 180 + seed;
        return (
          <mesh key={`fall-${i}`} position={[Math.cos(ang) * 0.25, 0.01, Math.sin(ang) * 0.25]} rotation={[Math.PI / 2, 0, ang]} scale={[follajeFactor * 0.18, 0.005, follajeFactor * 0.1]}>
            <sphereGeometry args={[1, 6, 4]} />
            <meshStandardMaterial color="#7a5a2b" roughness={0.95} />
          </mesh>
        );
      })}
    </group>
  );
};

// ============================================================
// Tsunami — ola de barrel (rompiendo en curva) que cruza la parcela.
//
// La geometría del cuerpo de agua es una `ExtrudeGeometry` construida a partir
// de un `Shape` 2D que dibuja el perfil característico de un tsunami rompiendo:
// pared trasera alta y vertical, cresta ondulada en lo más alto, labio curvado
// hacia delante formando el "tubo" (barrel) y caída frontal al suelo. La forma
// se extruye 18 m a lo ancho para cubrir toda la parcela.
//
// Por encima de la geometría sólida se montan capas de foam volumétrico, spray
// parabólico, escombros arrastrados y un anillo de cascada cayendo del labio.
// Tras pasar la ola, queda la lámina de inundación con ondas concéntricas hasta
// que el jugador avance día o aplique aireación.
// ============================================================

interface TsunamiWaveProps {
  active: boolean;
  durationSec?: number;
}

// Construye el perfil 2D del tsunami (mirando desde el lateral, hacia +X).
// Coordenadas locales antes de la extrusión:
//   shape.x = profundidad de la ola (forward/back); valores positivos = delante
//   shape.y = altura
// Tras `g.rotateY(Math.PI / 2)` la extrusión se reorienta para que la ola sea
// ancha en el eje X de la escena y la "profundidad" del perfil viva en Z.
const buildTsunamiProfile = (): THREE.Shape => {
  const s = new THREE.Shape();
  // Empezamos en la base trasera (zona donde la ola "nace")
  s.moveTo(-2.4, 0);
  // Sube por la pared trasera con leve panza
  s.bezierCurveTo(-2.3, 1.2, -2.0, 2.2, -1.4, 2.9);
  // Subida final a la cresta
  s.bezierCurveTo(-0.9, 3.3, -0.4, 3.55, 0.1, 3.6);
  // El labio se proyecta hacia delante (forma de gancho del barrel)
  s.bezierCurveTo(0.7, 3.6, 1.2, 3.35, 1.45, 2.85);
  s.bezierCurveTo(1.6, 2.45, 1.55, 2.05, 1.25, 1.85);
  // Punta del labio mirando hacia atrás y abajo — cierra el barrel
  s.bezierCurveTo(1.0, 1.7, 0.7, 1.85, 0.55, 2.05);
  // Caída desde dentro del barrel hacia el suelo
  s.bezierCurveTo(0.4, 1.55, 0.55, 0.95, 0.7, 0.55);
  s.bezierCurveTo(0.6, 0.25, 0.3, 0.05, -0.1, 0);
  s.lineTo(-2.4, 0);
  return s;
};

const TsunamiWave: React.FC<TsunamiWaveProps> = ({ active, durationSec = 5 }) => {
  const wallRef = useRef<THREE.Group>(null);
  const floodRef = useRef<THREE.Mesh>(null);
  const sprayRef = useRef<THREE.Group>(null);
  const debrisRef = useRef<THREE.Group>(null);
  const cascadeRef = useRef<THREE.Group>(null);
  const foamRefs = useRef<(THREE.Mesh | null)[]>([]);
  const baseFoamRefs = useRef<(THREE.Mesh | null)[]>([]);
  const rippleRefs = useRef<(THREE.Mesh | null)[]>([]);
  const crestRef = useRef<THREE.Group>(null);
  const startTimeRef = useRef<number | null>(null);

  const WAVE_WIDTH = 18;       // ancho de la ola a lo largo de X
  const TRAVEL_START = -16;     // z donde la ola empieza fuera de cámara
  const TRAVEL_END = 16;        // z donde la ola se va del campo
  const BREAK_PHASE = 0.92;     // fracción de duración antes de empezar a disolver

  // === Geometría del cuerpo de agua (perfil extruido) ===
  // La forma `buildTsunamiProfile()` se extruye con bisel suave para evitar
  // bordes de papel. Tras extruir, rotamos para que el ancho viva en X y el
  // perfil en YZ.
  const waveBodyGeometry = useMemo(() => {
    const shape = buildTsunamiProfile();
    const geom = new THREE.ExtrudeGeometry(shape, {
      steps: 36,
      depth: WAVE_WIDTH,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 3,
      curveSegments: 22
    });
    // Centramos la extrusión sobre el eje X y rotamos para que la depth (Z
    // local de la geom) se convierta en el eje X de la escena.
    geom.translate(0, 0, -WAVE_WIDTH / 2);
    geom.rotateY(Math.PI / 2);
    geom.computeVertexNormals();
    return geom;
  }, []);

  // Segunda capa de agua un poco más pequeña, montada por encima del cuerpo
  // principal — produce la sensación de "cresta interior" con tono más claro.
  const innerCrestGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    // Versión recortada del perfil: solo la parte alta + el labio
    shape.moveTo(-1.4, 1.8);
    shape.bezierCurveTo(-1.0, 2.4, -0.5, 3.0, 0.0, 3.25);
    shape.bezierCurveTo(0.6, 3.3, 1.05, 3.05, 1.25, 2.65);
    shape.bezierCurveTo(1.35, 2.3, 1.25, 2.0, 1.0, 1.85);
    shape.bezierCurveTo(0.7, 1.75, 0.4, 1.95, 0.3, 2.15);
    shape.bezierCurveTo(0.15, 1.95, 0.0, 1.8, -0.2, 1.8);
    shape.lineTo(-1.4, 1.8);
    const g = new THREE.ExtrudeGeometry(shape, {
      steps: 24,
      depth: WAVE_WIDTH - 0.4,
      bevelEnabled: false,
      curveSegments: 18
    });
    g.translate(0, 0, -(WAVE_WIDTH - 0.4) / 2);
    g.rotateY(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  }, []);

  // Burbujas de espuma en la cresta (volumétrica, con bobbing individual)
  const foamPositions = useMemo(() => {
    const rng = makeRng(424242);
    return Array.from({ length: 110 }).map(() => {
      const x = (rng() - 0.5) * (WAVE_WIDTH - 1.5);
      // La espuma se concentra en la cresta (y ≈ 3.4) y en el labio frontal
      const onLip = rng() < 0.55;
      const y = onLip ? 3.4 + (rng() - 0.5) * 0.35 : 2.9 + rng() * 0.5;
      const z = onLip ? 0.6 + (rng() - 0.5) * 0.45 : -0.6 + rng() * 0.9;
      return {
        x, y, z,
        size: 0.13 + rng() * 0.34,
        wobblePhase: rng() * Math.PI * 2,
        wobbleSpeed: 2.5 + rng() * 3.5,
        tint: rng()
      };
    });
  }, []);

  // Espuma "whitewater" en la base — la zona donde la ola rompe sobre el suelo
  const baseFoamPositions = useMemo(() => {
    const rng = makeRng(31415);
    return Array.from({ length: 75 }).map(() => ({
      x: (rng() - 0.5) * (WAVE_WIDTH - 0.5),
      y: 0.06 + rng() * 0.5,
      z: 0.4 + rng() * 1.3,
      size: 0.12 + rng() * 0.22,
      churnPhase: rng() * Math.PI * 2,
      churnSpeed: 3 + rng() * 4
    }));
  }, []);

  // Spray con trayectoria parabólica — sale del labio (z≈1.3, y≈3.3) y cae al
  // frente. Cada gota tiene su propio ciclo y altura.
  const sprayDrops = useMemo(() => {
    const rng = makeRng(999111);
    return Array.from({ length: 150 }).map(() => ({
      x: (rng() - 0.5) * (WAVE_WIDTH - 0.8),
      launchHeight: 1.6 + rng() * 3.2,
      forwardReach: 1.0 + rng() * 3.8,
      size: 0.035 + rng() * 0.11,
      cycleOffset: rng(),
      cycleDur: 0.55 + rng() * 1.2
    }));
  }, []);

  // Cascada cayendo verticalmente desde el labio — chorros largos de agua que
  // van del labio (y≈2.5) al suelo. Da la sensación de la "cortina" que cae
  // del barrel.
  const cascadeDrops = useMemo(() => {
    const rng = makeRng(606060);
    return Array.from({ length: 90 }).map(() => ({
      x: (rng() - 0.5) * (WAVE_WIDTH - 1.0),
      zBase: 0.9 + (rng() - 0.5) * 0.4,
      size: 0.04 + rng() * 0.08,
      length: 0.18 + rng() * 0.45,
      delay: rng() * 1.5,
      cycleDur: 0.45 + rng() * 0.6
    }));
  }, []);

  // Escombros flotando dentro de la pared (troncos, ramas)
  const debris = useMemo(() => {
    const rng = makeRng(77777);
    return Array.from({ length: 22 }).map(() => ({
      x: (rng() - 0.5) * (WAVE_WIDTH - 1.5),
      y: 0.5 + rng() * 1.6,
      z: -0.3 + (rng() - 0.5) * 0.6,
      sx: 0.12 + rng() * 0.32,
      sy: 0.05 + rng() * 0.09,
      sz: 0.18 + rng() * 0.45,
      rotY: rng() * Math.PI * 2,
      bouncePhase: rng() * Math.PI * 2,
      bounceSpeed: 3 + rng() * 4,
      colorIdx: Math.floor(rng() * 3)
    }));
  }, []);

  // Bumps a lo largo de la cresta para que el labio no sea una línea recta.
  // Son esferas un poco oscuras (mismo tono que el agua interior) que añaden
  // volumen a la cresta superior cuando se ven desde el lateral.
  const crestBumps = useMemo(() => {
    const rng = makeRng(20202);
    const N = 24;
    return Array.from({ length: N }).map((_, i) => ({
      x: -(WAVE_WIDTH / 2 - 0.6) + (i / (N - 1)) * (WAVE_WIDTH - 1.2),
      yBase: 3.5 + Math.sin(i * 0.7) * 0.16 + (rng() - 0.5) * 0.2,
      zBase: 0.15 + (rng() - 0.5) * 0.15,
      wobblePhase: rng() * Math.PI * 2,
      wobbleSpeed: 1.8 + rng() * 2.4,
      size: 0.32 + rng() * 0.22
    }));
  }, []);

  useFrame((state) => {
    if (!active) {
      startTimeRef.current = null;
      if (wallRef.current) {
        wallRef.current.position.z = TRAVEL_START;
        wallRef.current.visible = false;
      }
      if (sprayRef.current) sprayRef.current.visible = false;
      if (floodRef.current) (floodRef.current.material as THREE.MeshStandardMaterial).opacity = 0;
      rippleRefs.current.forEach(r => {
        if (r) (r.material as THREE.MeshStandardMaterial).opacity = 0;
      });
      return;
    }
    if (startTimeRef.current == null) {
      startTimeRef.current = state.clock.elapsedTime;
    }
    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const t = Math.min(elapsed / durationSec, 1.0);
    const ct = state.clock.elapsedTime;

    // === Movimiento de la pared ===
    // La ola entra de fondo, cruza la parcela y sale por delante. En el último
    // 8 % de la duración (a partir de BREAK_PHASE) hacemos que se "disuelva":
    // baja de altura y pierde opacidad hasta desaparecer, dejando solo la
    // inundación de fondo.
    const breakT = Math.max(0, (t - BREAK_PHASE) / (1 - BREAK_PHASE));
    const visibleFade = 1 - breakT;
    const waveZ = TRAVEL_START + t * (TRAVEL_END - TRAVEL_START);

    if (wallRef.current) {
      wallRef.current.visible = visibleFade > 0.02;
      wallRef.current.position.z = waveZ;
      // El cuerpo se aplana en vertical durante la disolución
      wallRef.current.scale.y = 1 - breakT * 0.55;
      // Pequeña inclinación + balanceo suave para insinuar el cabeceo de la ola
      wallRef.current.rotation.x = -0.06 + Math.sin(ct * 2.0) * 0.025;
      wallRef.current.rotation.z = Math.sin(ct * 3.0) * 0.018;
    }
    if (sprayRef.current) {
      sprayRef.current.visible = visibleFade > 0.05;
      sprayRef.current.position.z = waveZ;
    }
    if (cascadeRef.current) {
      cascadeRef.current.visible = visibleFade > 0.05;
      cascadeRef.current.position.z = waveZ;
    }

    // === Cresta superior: bumps con bobbing individual ===
    if (crestRef.current) {
      crestRef.current.children.forEach((c, i) => {
        const b = crestBumps[i];
        if (!b) return;
        c.position.y = b.yBase + Math.sin(ct * b.wobbleSpeed + b.wobblePhase) * 0.12;
        const s = (1 + Math.sin(ct * b.wobbleSpeed * 1.3 + b.wobblePhase) * 0.07) * visibleFade;
        c.scale.set(s, s, s);
      });
    }

    // === Espuma cresta (volumétrica) — bobbing y desvanecimiento ===
    foamRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const f = foamPositions[i];
      if (!f) return;
      mesh.position.y = f.y + Math.sin(ct * f.wobbleSpeed + f.wobblePhase) * 0.13;
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.opacity = 0.96 * visibleFade;
    });

    // === Whitewater base — churning ===
    baseFoamRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const f = baseFoamPositions[i];
      if (!f) return;
      const churn = Math.sin(ct * f.churnSpeed + f.churnPhase);
      mesh.position.y = f.y + churn * 0.08;
      const s = 1 + churn * 0.18;
      mesh.scale.set(s, s, s);
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.opacity = (0.85 + churn * 0.1) * visibleFade;
    });

    // === Inundación de fondo ===
    // Sube en los primeros 0.4 (=40% de la duración), se queda a tope mientras
    // la ola cruza, y permanece en el aftermath para que el jugador vea el
    // resultado hasta que avance día.
    if (floodRef.current) {
      const flood = Math.min(1, t / 0.4);
      const mat = floodRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = flood * 0.85;
      floodRef.current.position.y = 0.04 + flood * 0.38;
    }

    // === Ondas concéntricas sobre la inundación ===
    rippleRefs.current.forEach((mesh, idx) => {
      if (!mesh) return;
      const ripT = ((ct * 0.45 + idx * 0.2) % 1);
      const s = 0.5 + ripT * 14;
      mesh.scale.set(s, 1, s);
      const fadeIn = Math.min(1, t * 2);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, (1 - ripT) * 0.55 * fadeIn);
    });

    // === Spray parabólico — sigue a la ola ===
    if (sprayRef.current && visibleFade > 0.02) {
      sprayRef.current.children.forEach((c, i) => {
        const d = sprayDrops[i];
        if (!d) return;
        const cycT = (((ct + d.cycleOffset * d.cycleDur) / d.cycleDur) % 1);
        // Parábola desde el labio hacia delante; pico en cycT=0.5
        const y = d.launchHeight * 4 * cycT * (1 - cycT) + 2.3;
        const zOff = 1.0 + d.forwardReach * cycT;
        c.position.set(d.x, y, zOff);
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - cycT) * 0.85 * visibleFade;
      });
    }

    // === Cascada del labio — chorros verticales cayendo ===
    if (cascadeRef.current && visibleFade > 0.02) {
      cascadeRef.current.children.forEach((c, i) => {
        const d = cascadeDrops[i];
        if (!d) return;
        const cycT = (((ct + d.delay) / d.cycleDur) % 1);
        // La gota nace en el labio (y ≈ 2.5) y cae al suelo (y ≈ 0)
        const y = 2.5 - cycT * 2.4;
        c.position.set(d.x, y, d.zBase);
        c.scale.y = 1 + cycT * 1.6; // se estira mientras cae
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - cycT * 0.4) * 0.78 * visibleFade;
      });
    }

    // === Escombros — bobbing y rotación ===
    if (debrisRef.current) {
      debrisRef.current.children.forEach((c, i) => {
        const d = debris[i];
        if (!d) return;
        c.position.y = d.y + Math.sin(ct * d.bounceSpeed + d.bouncePhase) * 0.09;
        c.rotation.x = ct * 0.5 + d.bouncePhase;
        c.rotation.y = d.rotY + ct * 0.3;
        const child = c as THREE.Mesh;
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat) mat.opacity = visibleFade;
        mat.transparent = true;
      });
    }
  });

  if (!active) return null;

  return (
    <group>
      {/* Lámina de agua inundando el terreno tras la ola */}
      <mesh ref={floodRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial
          color="#0d3a60"
          transparent
          opacity={0}
          roughness={0.12}
          metalness={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Ondas concéntricas sobre la inundación */}
      {[0, 1, 2, 3, 4].map(i => (
        <mesh
          key={`rp-${i}`}
          ref={(el) => { rippleRefs.current[i] = el; }}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.075, 0]}
          scale={[0.5, 1, 0.5]}
        >
          <ringGeometry args={[0.68, 0.78, 40]} />
          <meshStandardMaterial color="#bee0f7" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}

      {/* Cuerpo de la ola — pared que cruza la parcela */}
      <group ref={wallRef} position={[0, 0, TRAVEL_START]}>
        {/* Cuerpo principal: extrusión del perfil 2D */}
        <mesh geometry={waveBodyGeometry} castShadow receiveShadow>
          <meshStandardMaterial
            color="#1d5e94"
            roughness={0.08}
            metalness={0.7}
            transparent
            opacity={0.92}
            side={THREE.DoubleSide}
            envMapIntensity={0.9}
          />
        </mesh>

        {/* Cresta interior — tono más claro, montada sobre la principal */}
        <mesh geometry={innerCrestGeometry}>
          <meshStandardMaterial
            color="#3a8ec1"
            roughness={0.1}
            metalness={0.55}
            transparent
            opacity={0.72}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Interior oscuro del barrel (la sombra del tubo de agua que se ve
            cuando rompe). Mesh negro-azulado pequeño, montado dentro del hueco
            del labio. */}
        <mesh position={[0, 2.55, 1.0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.55, 0.55, WAVE_WIDTH - 1.2, 18, 1, true]} />
          <meshStandardMaterial
            color="#0a2840"
            roughness={0.7}
            metalness={0.2}
            side={THREE.BackSide}
            transparent
            opacity={0.85}
          />
        </mesh>

        {/* Bumps en la cresta — añaden volumen al filo superior */}
        <group ref={crestRef}>
          {crestBumps.map((b, i) => (
            <mesh key={`cr-${i}`} position={[b.x, b.yBase, b.zBase]} castShadow>
              <sphereGeometry args={[b.size, 14, 10]} />
              <meshStandardMaterial color="#4d97c8" roughness={0.1} metalness={0.55} transparent opacity={0.88} />
            </mesh>
          ))}
        </group>

        {/* Espuma volumétrica en la cresta */}
        {foamPositions.map((f, i) => (
          <mesh
            key={`fp-${i}`}
            ref={(el) => { foamRefs.current[i] = el; }}
            position={[f.x, f.y, f.z]}
            castShadow
          >
            <sphereGeometry args={[f.size, 10, 8]} />
            <meshStandardMaterial
              color={f.tint > 0.7 ? '#eaf4ff' : '#fdfeff'}
              emissive="#ffffff"
              emissiveIntensity={0.28}
              roughness={0.4}
              transparent
              opacity={0.96}
            />
          </mesh>
        ))}

        {/* Whitewater base — espuma agitada donde rompe la ola */}
        {baseFoamPositions.map((f, i) => (
          <mesh
            key={`bf-${i}`}
            ref={(el) => { baseFoamRefs.current[i] = el; }}
            position={[f.x, f.y, f.z]}
          >
            <sphereGeometry args={[f.size, 9, 7]} />
            <meshStandardMaterial
              color="#f4faff"
              emissive="#dbedff"
              emissiveIntensity={0.16}
              roughness={0.5}
              transparent
              opacity={0.9}
            />
          </mesh>
        ))}

        {/* Escombros flotando dentro de la pared (troncos, ramas, restos) */}
        <group ref={debrisRef}>
          {debris.map((d, i) => {
            const color = d.colorIdx === 0 ? '#3d2810' : d.colorIdx === 1 ? '#5a3a1a' : '#1c1208';
            return (
              <mesh key={`db-${i}`} position={[d.x, d.y, d.z]} rotation={[0, d.rotY, 0]} castShadow>
                <boxGeometry args={[d.sx, d.sy, d.sz]} />
                <meshStandardMaterial color={color} roughness={0.92} transparent />
              </mesh>
            );
          })}
        </group>
      </group>

      {/* Cascada — gotas verticales cayendo del labio */}
      <group ref={cascadeRef} position={[0, 0, TRAVEL_START]}>
        {cascadeDrops.map((d, i) => (
          <mesh key={`cd-${i}`}>
            <capsuleGeometry args={[d.size, d.length, 4, 6]} />
            <meshStandardMaterial
              color="#a7d2ee"
              emissive="#cfe7f9"
              emissiveIntensity={0.2}
              transparent
              opacity={0.78}
              roughness={0.25}
              metalness={0.4}
            />
          </mesh>
        ))}
      </group>

      {/* Spray parabólico — gotas saliendo hacia delante */}
      <group ref={sprayRef} position={[0, 0, TRAVEL_START]}>
        {sprayDrops.map((d, i) => (
          <mesh key={`sp-${i}`}>
            <sphereGeometry args={[d.size, 6, 5]} />
            <meshStandardMaterial
              color="#cfe5fa"
              emissive="#e8f4ff"
              emissiveIntensity={0.22}
              transparent
              opacity={0.85}
              roughness={0.3}
              metalness={0.5}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
};

// ============================================================
// Helper común: tiempo transcurrido desde que se activa el efecto
// ============================================================

const useEffectClock = (active: boolean) => {
  const startRef = useRef<number | null>(null);
  return (elapsed: number) => {
    if (!active) { startRef.current = null; return 0; }
    if (startRef.current == null) startRef.current = elapsed;
    return elapsed - startRef.current;
  };
};

// ============================================================
// Terremoto — grietas en el suelo + polvo subiendo + shake
// ============================================================

const Earthquake: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 5 }) => {
  const groupRef = useRef<THREE.Group>(null);
  const dustRef = useRef<THREE.Group>(null);
  const rocksRef = useRef<THREE.Group>(null);
  const crackRefs = useRef<(THREE.Group | null)[]>([]);
  const getElapsed = useEffectClock(active);

  // Grietas: ahora más numerosas y aparecen escalonadas a lo largo del primer
  // ~70% de la duración, "creciendo" desde escala 0 hasta 1.
  const grietas = useMemo(() => {
    const rng = makeRng(33001);
    const N = 14;
    return Array.from({ length: N }).map((_, i) => {
      const angle = rng() * Math.PI;
      const length = 3 + rng() * 4;
      const cx = (rng() - 0.5) * 7;
      const cz = (rng() - 0.5) * 7;
      const appearAt = (i / N) * 0.6 + rng() * 0.15;
      return {
        angle, length, cx, cz,
        segs: 4 + Math.floor(rng() * 4),
        thickness: 0.05 + rng() * 0.07,
        appearAt
      };
    });
  }, []);

  const polvo = useMemo(() => {
    const rng = makeRng(33002);
    return Array.from({ length: 65 }).map(() => ({
      x: (rng() - 0.5) * 9,
      z: (rng() - 0.5) * 9,
      delay: rng() * 1.6,
      size: 0.07 + rng() * 0.15,
      maxY: 1.4 + rng() * 2.1,
      drift: (rng() - 0.5) * 0.5
    }));
  }, []);

  // Pequeñas rocas/terrones que botan con la sacudida.
  const rocas = useMemo(() => {
    const rng = makeRng(33003);
    return Array.from({ length: 22 }).map(() => ({
      x: (rng() - 0.5) * 8,
      z: (rng() - 0.5) * 8,
      size: 0.05 + rng() * 0.11,
      bouncePhase: rng() * Math.PI * 2,
      bounceSpeed: 5 + rng() * 6,
      maxBounce: 0.18 + rng() * 0.3,
      delay: rng() * 0.5,
      colorIdx: Math.floor(rng() * 3)
    }));
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) {
      if (groupRef.current) { groupRef.current.position.set(0,0,0); groupRef.current.rotation.set(0,0,0); }
      return;
    }
    const p = Math.min(t / durationSec, 1);

    // Shake: dos frecuencias superpuestas (rápida + lenta) para un temblor más
    // creíble. Plena intensidad durante la mitad y decae suave en la cola.
    if (groupRef.current) {
      const intensity = p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.45);
      const f = state.clock.elapsedTime * 38;
      const f2 = state.clock.elapsedTime * 14;
      groupRef.current.position.x = (Math.sin(f) * 0.12 + Math.sin(f2 * 1.3) * 0.05) * intensity;
      groupRef.current.position.z = (Math.cos(f * 1.13) * 0.11 + Math.cos(f2 * 0.8) * 0.04) * intensity;
      groupRef.current.position.y = Math.abs(Math.sin(f * 0.9)) * 0.04 * intensity;
      groupRef.current.rotation.z = Math.sin(f * 0.65) * 0.022 * intensity;
      groupRef.current.rotation.x = Math.sin(f2 * 0.5) * 0.012 * intensity;
    }

    // Las grietas aparecen progresivamente (escala 0→1 en ~0.35s)
    crackRefs.current.forEach((g, i) => {
      if (!g) return;
      const crack = grietas[i];
      if (!crack) return;
      if (t < crack.appearAt) {
        g.scale.set(0, 1, 0);
      } else {
        const localT = (t - crack.appearAt) / 0.35;
        const s = Math.min(1, localT);
        g.scale.set(s, 1, s);
      }
    });

    // Polvo subiendo y desvaneciéndose
    if (dustRef.current) {
      dustRef.current.children.forEach((c, i) => {
        const d = polvo[i]; if (!d) return;
        const localT = Math.max(0, t - d.delay);
        const phase = (localT * 0.45) % 1;
        c.position.y = phase * d.maxY;
        c.position.x = d.x + d.drift * phase;
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - phase) * 0.75;
      });
    }

    // Rocas botando durante toda la sacudida
    if (rocksRef.current) {
      const intensity = p < 0.7 ? 1 : Math.max(0, 1 - (p - 0.7) / 0.3);
      rocksRef.current.children.forEach((c, i) => {
        const d = rocas[i]; if (!d) return;
        const localT = Math.max(0, t - d.delay);
        const y = Math.abs(Math.sin(localT * d.bounceSpeed + d.bouncePhase)) * d.maxBounce * intensity;
        c.position.y = y + 0.05;
        c.rotation.x = localT * 3 + d.bouncePhase;
        c.rotation.y = localT * 2 + d.bouncePhase * 0.7;
      });
    }
  });

  if (!active) return null;
  return (
    <group ref={groupRef}>
      {/* Grietas: cada grieta = varios segmentos en zigzag, crece con scale */}
      {grietas.map((g, gi) => (
        <group
          key={gi}
          ref={(el) => { crackRefs.current[gi] = el; }}
          position={[g.cx, 0.05, g.cz]}
          rotation={[0, g.angle, 0]}
          scale={[0, 1, 0]}
        >
          {Array.from({ length: g.segs }).map((_, si) => {
            const t = si / g.segs;
            const x = (t - 0.5) * g.length;
            const zigzag = ((si % 2 === 0) ? 1 : -1) * g.thickness * 1.6;
            return (
              <mesh key={si} position={[x, 0.005, zigzag]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[g.length / g.segs * 1.1, g.thickness * 2.4]} />
                <meshStandardMaterial color="#1a0d05" roughness={0.95} side={THREE.DoubleSide} />
              </mesh>
            );
          })}
        </group>
      ))}
      {/* Polvo */}
      <group ref={dustRef}>
        {polvo.map((d, i) => (
          <mesh key={i} position={[d.x, 0, d.z]}>
            <sphereGeometry args={[d.size, 6, 5]} />
            <meshStandardMaterial color="#9a7b54" transparent opacity={0} roughness={0.95} />
          </mesh>
        ))}
      </group>
      {/* Rocas / terrones que botan */}
      <group ref={rocksRef}>
        {rocas.map((r, i) => {
          const color = r.colorIdx === 0 ? '#6b4a26' : r.colorIdx === 1 ? '#8b5a2b' : '#5a3a1a';
          return (
            <mesh key={i} position={[r.x, 0.05, r.z]} castShadow>
              <boxGeometry args={[r.size, r.size * 0.7, r.size * 0.9]} />
              <meshStandardMaterial color={color} roughness={0.9} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
};

// ============================================================
// Tornado — vórtice cónico giratorio + escombros orbitando
// ============================================================

const Tornado: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 4 }) => {
  const vortexRef = useRef<THREE.Group>(null);
  const debrisRef = useRef<THREE.Group>(null);
  const getElapsed = useEffectClock(active);

  const debris = useMemo(() => {
    const rng = makeRng(44001);
    return Array.from({ length: 22 }).map(() => ({
      orbitR: 0.5 + rng() * 1.8,
      yBase: rng() * 4,
      speed: 1 + rng() * 2,
      size: 0.07 + rng() * 0.12,
      phase: rng() * Math.PI * 2
    }));
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;
    const p = Math.min(t / durationSec, 1);
    // Cuando el tornado ha terminado de pasar (p==1), ocultamos el vórtice y
    // los escombros para que no se quede parado al fondo de la parcela.
    const tornadoGone = p >= 1.0;
    if (vortexRef.current) vortexRef.current.visible = !tornadoGone;
    if (debrisRef.current) debrisRef.current.visible = !tornadoGone;
    if (tornadoGone) return;
    // El tornado se mueve de izquierda a derecha durante la duración
    const xPos = -5 + p * 10;
    if (vortexRef.current) {
      vortexRef.current.position.x = xPos;
      vortexRef.current.rotation.y = state.clock.elapsedTime * 6;
    }
    if (debrisRef.current) {
      debrisRef.current.position.x = xPos;
      debrisRef.current.children.forEach((c, i) => {
        const d = debris[i]; if (!d) return;
        const ang = state.clock.elapsedTime * d.speed + d.phase;
        c.position.x = Math.cos(ang) * d.orbitR;
        c.position.z = Math.sin(ang) * d.orbitR;
        const verticalLoop = (state.clock.elapsedTime * 0.7 + d.phase) % 1;
        c.position.y = d.yBase + verticalLoop * 0.8;
      });
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Vórtice: varios conos apilados girando */}
      <group ref={vortexRef} position={[-5, 0, 0]}>
        {Array.from({ length: 6 }).map((_, i) => {
          const y = i * 0.85;
          const rBot = 0.4 + i * 0.18;
          const rTop = 0.55 + i * 0.22;
          return (
            <mesh key={i} position={[0, y + 0.4, 0]}>
              <cylinderGeometry args={[rTop, rBot, 0.85, 16, 1, true]} />
              <meshStandardMaterial
                color={i < 2 ? '#3a3a3a' : i < 4 ? '#6a6a6a' : '#9a9aa0'}
                transparent
                opacity={0.55 + i * 0.04}
                side={THREE.DoubleSide}
                roughness={0.9}
              />
            </mesh>
          );
        })}
        {/* Punta superior más ancha y difusa */}
        <mesh position={[0, 5.5, 0]}>
          <sphereGeometry args={[1.5, 12, 8]} />
          <meshStandardMaterial color="#aaaab0" transparent opacity={0.35} />
        </mesh>
      </group>
      {/* Escombros */}
      <group ref={debrisRef} position={[-5, 0, 0]}>
        {debris.map((d, i) => (
          <mesh key={i}>
            <boxGeometry args={[d.size * 1.5, d.size, d.size]} />
            <meshStandardMaterial color="#5a3a14" roughness={0.85} />
          </mesh>
        ))}
      </group>
    </>
  );
};

// ============================================================
// Incendio próximo — sistema de fuego realista:
//   • Muro de llamas en el borde sur de la parcela (12 columnas solapadas
//     con troncos carbonizados, llamas multicapa y resplandor en el suelo).
//   • Brasas flotantes que suben en bucle y se desplazan con "viento".
//   • Humo denso multicapa que sale del muro y se eleva curvándose.
//   • 4 luces puntuales parpadeantes con flicker temporal individual.
//   • Resplandor anaranjado tenue que sube hasta el cielo.
//
// Diseño pensado para que, en aftermath, todo siga vivo indefinidamente:
//   las brasas y el humo son cíclicos, las llamas usan senos infinitos.
// ============================================================

const Fire: React.FC<{ active: boolean; durationSec?: number; extinguishing?: boolean }> = ({ active, durationSec = 4, extinguishing = false }) => {
  const flameInnerRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flameMidRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flameOuterRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flameHaloRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const embersRef = useRef<THREE.Group>(null);
  const smokeRef = useRef<THREE.Group>(null);
  const groundGlowRef = useRef<THREE.Mesh>(null);
  const fireLightRefs = useRef<(THREE.PointLight | null)[]>([]);
  const getElapsed = useEffectClock(active);
  // Cuando el jugador aplica riego sobre el incendio, Fire entra en modo
  // "extinguishing": las llamas, brasas y luces se reducen progresivamente
  // (en ~3.5 s) en lugar de cortarse de golpe. Se guarda el clock-time del
  // momento exacto en que empezó la extinción para calcular el avance.
  const extinguishStartRef = useRef<number | null>(null);
  const FADE_DURATION = 3.5;

  // === ~20 columnas de fuego: 16 en anillo perimetral + 4-5 dentro ===
  // El anillo rodea la parcela (radio ~4.8) con leve jitter; las internas
  // son focos dispersos dentro del cultivo. Cada llama tiene flicker propio.
  const flames = useMemo(() => {
    const rng = makeRng(55001);
    const PERIMETRO = 16;
    const INTERNAS = 5;
    const list: Array<{
      x: number; z: number; scale: number;
      flickerSpeed: number; flickerPhase: number;
      wobbleSpeed: number; wobblePhase: number;
      logRot: number;
    }> = [];
    // Anillo perimetral
    for (let i = 0; i < PERIMETRO; i++) {
      const ang = (i / PERIMETRO) * Math.PI * 2 + (rng() - 0.5) * 0.12;
      const r = 4.7 + (rng() - 0.5) * 0.6;
      list.push({
        x: Math.cos(ang) * r,
        z: Math.sin(ang) * r,
        scale: 0.85 + rng() * 0.85,
        flickerSpeed: 9 + rng() * 8,
        flickerPhase: rng() * Math.PI * 2,
        wobbleSpeed: 4 + rng() * 4,
        wobblePhase: rng() * Math.PI * 2,
        logRot: rng() * Math.PI * 2
      });
    }
    // Focos dispersos dentro de la parcela (zonas ya prendidas)
    for (let i = 0; i < INTERNAS; i++) {
      list.push({
        x: (rng() - 0.5) * 7.5,
        z: (rng() - 0.5) * 7.5,
        scale: 0.55 + rng() * 0.55,
        flickerSpeed: 10 + rng() * 8,
        flickerPhase: rng() * Math.PI * 2,
        wobbleSpeed: 5 + rng() * 4,
        wobblePhase: rng() * Math.PI * 2,
        logRot: rng() * Math.PI * 2
      });
    }
    return list;
  }, []);

  // === 6 luces puntuales: 4 en las esquinas + 2 al centro ===
  const fireLights = useMemo(() => {
    const rng = makeRng(55003);
    const positions: [number, number][] = [
      [ 4.2,  4.2], [-4.2,  4.2], [ 4.2, -4.2], [-4.2, -4.2], // 4 esquinas
      [ 1.8,  0.0], [-2.0,  1.4]                              // 2 internas
    ];
    return positions.map(([x, z]) => ({
      x, z,
      baseInt: 2.0 + rng() * 1.4,
      flickerSpeed: 11 + rng() * 8,
      phase: rng() * Math.PI * 2
    }));
  }, []);

  // === 80 brasas: distribuidas alrededor de cada llama ===
  // Cada brasa nace cerca de una llama aleatoria (perimetral o interna) y
  // sube en bucle con drift. Como las llamas rodean la parcela, las brasas
  // vuelan por todos lados, no solo desde un lado.
  const embers = useMemo(() => {
    const rng = makeRng(55004);
    return Array.from({ length: 80 }).map(() => {
      // Mezcla de orígenes: en anillo perimetral o dentro
      const inRing = rng() < 0.72;
      let x0: number, z0: number;
      if (inRing) {
        const ang = rng() * Math.PI * 2;
        const r = 4.4 + rng() * 0.7;
        x0 = Math.cos(ang) * r;
        z0 = Math.sin(ang) * r;
      } else {
        x0 = (rng() - 0.5) * 8;
        z0 = (rng() - 0.5) * 8;
      }
      // El drift radial empuja las brasas hacia fuera/dentro
      const driftAng = rng() * Math.PI * 2;
      return {
        x0, z0,
        drift: Math.cos(driftAng) * (0.4 + rng() * 1.8),
        driftZ: Math.sin(driftAng) * (0.4 + rng() * 1.8),
        rise: 1.4 + rng() * 1.6,
        maxY: 2.8 + rng() * 2.5,
        size: 0.035 + rng() * 0.05,
        cycleDur: 1.8 + rng() * 1.8,
        delay: rng() * 3.0,
        hueShift: rng()
      };
    });
  }, []);

  // === 32 puffs de humo distribuidos también en anillo + interior ===
  const smoke = useMemo(() => {
    const rng = makeRng(55002);
    return Array.from({ length: 32 }).map(() => {
      const inRing = rng() < 0.7;
      let x: number, z: number;
      if (inRing) {
        const ang = rng() * Math.PI * 2;
        const r = 4.5 + rng() * 0.8;
        x = Math.cos(ang) * r;
        z = Math.sin(ang) * r;
      } else {
        x = (rng() - 0.5) * 7.5;
        z = (rng() - 0.5) * 7.5;
      }
      const driftAng = rng() * Math.PI * 2;
      return {
        x, z,
        drift: Math.cos(driftAng) * (1.0 + rng() * 2.2),
        driftZ: Math.sin(driftAng) * (1.0 + rng() * 2.2),
        delay: rng() * 2.5,
        size: 0.42 + rng() * 0.7,
        cycleDur: 4.5 + rng() * 2.5,
        maxY: 5.5 + rng() * 3,
        shade: 0.18 + rng() * 0.22
      };
    });
  }, []);


  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) {
      // Apagar luces para no dejarlas encendidas si el componente se desactiva
      fireLightRefs.current.forEach(l => { if (l) l.intensity = 0; });
      extinguishStartRef.current = null;
      return;
    }
    const ct = state.clock.elapsedTime;

    // === Factor de extinción (riego apagando el fuego) ===
    // dim = 1 con fuego a tope, baja a 0 al final de la extinción.
    // steamBoost crece simétricamente para añadir más "vapor" al humo.
    if (extinguishing) {
      if (extinguishStartRef.current == null) extinguishStartRef.current = ct;
    } else {
      extinguishStartRef.current = null;
    }
    const fadeT = extinguishStartRef.current != null
      ? Math.min(1, (ct - extinguishStartRef.current) / FADE_DURATION)
      : 0;
    const dim = 1 - fadeT;          // 1 → 0
    const steamBoost = fadeT;        // 0 → 1 (humo se intensifica)

    // === Llamas: flicker rápido en scale.y, scale.x más sutil ===
    flames.forEach((f, i) => {
      const flick = Math.sin(ct * f.flickerSpeed + f.flickerPhase);
      const flick2 = Math.sin(ct * f.flickerSpeed * 1.7 + f.flickerPhase * 1.3);
      const sy = (1 + flick * 0.22 + flick2 * 0.08) * dim;
      const sx = (1 + flick2 * 0.10) * dim;
      const wob = Math.sin(ct * f.wobbleSpeed + f.wobblePhase) * 0.08;
      [flameInnerRefs, flameMidRefs, flameOuterRefs].forEach(group => {
        const m = group.current[i];
        if (m) {
          m.scale.set(sx, sy, sx);
          m.rotation.z = wob;
          m.visible = dim > 0.02;
        }
      });
      const halo = flameHaloRefs.current[i];
      if (halo) {
        halo.scale.set(sx * 1.2, sy * 0.85, sx * 1.2);
        const mat = halo.material as THREE.MeshStandardMaterial;
        mat.opacity = (0.42 + Math.sin(ct * f.flickerSpeed * 0.7 + f.flickerPhase) * 0.13) * dim;
        halo.visible = dim > 0.02;
      }
      const ring = glowRingRefs.current[i];
      if (ring) {
        const rs = 1 + Math.sin(ct * 4 + f.wobblePhase) * 0.12;
        ring.scale.set(rs, 1, rs);
        const mat = ring.material as THREE.MeshBasicMaterial;
        mat.opacity = (0.55 + Math.sin(ct * 6 + f.flickerPhase) * 0.18) * dim;
        ring.visible = dim > 0.02;
      }
    });

    // === Luces puntuales con flicker individual ===
    fireLights.forEach((fl, i) => {
      const light = fireLightRefs.current[i];
      if (!light) return;
      const flick = Math.sin(ct * fl.flickerSpeed + fl.phase);
      const flick2 = Math.sin(ct * fl.flickerSpeed * 0.6 + fl.phase * 2);
      light.intensity = fl.baseInt * (1 + flick * 0.35 + flick2 * 0.18) * dim;
    });

    // === Resplandor general del suelo: pulso lento ===
    if (groundGlowRef.current) {
      const mat = groundGlowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = (0.42 + Math.sin(ct * 2.5) * 0.10) * dim;
    }

    // === Brasas: cycle parabolic — sube, va perdiendo opacidad, reset ===
    if (embersRef.current) {
      embersRef.current.children.forEach((c, i) => {
        const e = embers[i]; if (!e) return;
        const cycleT = ((t + e.delay) % e.cycleDur) / e.cycleDur; // 0..1
        // Trayectoria: parábola Y, lineal X+Z con drift, con leve wobble
        const y = cycleT * e.maxY * (1.15 - cycleT * 0.35);
        const wobX = Math.sin(cycleT * 6 + i) * 0.18;
        const wobZ = Math.cos(cycleT * 5 + i) * 0.12;
        c.position.set(
          e.x0 + e.drift * cycleT + wobX,
          0.05 + y,
          e.z0 + e.driftZ * cycleT + wobZ
        );
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        // Fade in rápido, fade out lento; las brasas se enfrían arriba
        const fadeIn = Math.min(1, cycleT * 6);
        const fadeOut = Math.max(0, 1 - cycleT);
        mat.opacity = fadeIn * fadeOut * dim;
        // Las brasas viajan de amarillo brillante a rojo oscuro (se enfrían)
        const coolFactor = cycleT * (0.4 + e.hueShift * 0.4);
        mat.emissiveIntensity = 2.5 * (1 - cycleT * 0.6) * dim;
        const col = mat.color as THREE.Color;
        col.setRGB(1, 0.7 - coolFactor * 0.4, 0.2 - coolFactor * 0.18);
        const emCol = mat.emissive as THREE.Color;
        emCol.setRGB(1, 0.5 - coolFactor * 0.3, 0.1);
      });
    }

    // === Humo: cycle multicapa con curva ascendente y dispersión lateral ===
    if (smokeRef.current) {
      smokeRef.current.children.forEach((c, i) => {
        const s = smoke[i]; if (!s) return;
        const cycleT = ((t + s.delay) % s.cycleDur) / s.cycleDur;
        const y = cycleT * s.maxY;
        // Curva: el humo se curva hacia un lado al subir
        const curveX = Math.sin(cycleT * Math.PI * 0.6) * 0.6 + cycleT * s.drift;
        const curveZ = Math.cos(cycleT * Math.PI * 0.4) * 0.4 + cycleT * s.driftZ;
        c.position.set(s.x + curveX, 0.3 + y, s.z + curveZ);
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        const fadeIn = Math.min(1, cycleT * 3);
        const fadeOut = Math.max(0, 1 - cycleT * 0.95);
        // Al extinguirse, el humo se hace más denso (vapor blanco al apagarse).
        mat.opacity = fadeIn * fadeOut * 0.65 * (1 + steamBoost * 0.7);
        c.scale.setScalar(s.size * (1 + cycleT * 2.2) * (1 + steamBoost * 0.4));
        // El humo se oscurece al subir; en extinción tira a blanco-grisáceo (vapor).
        const baseShade = s.shade + cycleT * 0.25;
        const shade = baseShade * (1 - steamBoost) + (0.85 - cycleT * 0.15) * steamBoost;
        (mat.color as THREE.Color).setRGB(shade, shade * 0.97, shade * 0.94);
      });
    }
  });

  if (!active) return null;
  return (
    <>
      {/* === Anillo de resplandor que rodea toda la parcela === */}
      <mesh ref={groundGlowRef} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.6, 6.2, 48]} />
        <meshBasicMaterial color="#ff5a18" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* === COLUMNAS DE FUEGO (muro) === */}
      {flames.map((f, i) => (
        <group key={i} position={[f.x, 0, f.z]} scale={f.scale}>
          {/* Anillo de resplandor en el suelo bajo la llama */}
          <mesh
            ref={(el) => { glowRingRefs.current[i] = el; }}
            position={[0, 0.02, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry args={[0.18, 0.55, 24]} />
            <meshBasicMaterial color="#ff8a2a" transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>

          {/* Tronco carbonizado en la base */}
          <mesh position={[0, 0.06, 0]} rotation={[0, f.logRot, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 0.55, 8]} />
            <meshStandardMaterial color="#1a0805" roughness={0.95} emissive="#ff3a05" emissiveIntensity={0.4} />
          </mesh>
          {/* Brasas en la base del tronco */}
          <mesh position={[0, 0.06, 0]}>
            <sphereGeometry args={[0.22, 10, 8]} />
            <meshStandardMaterial color="#ff5018" emissive="#ff3000" emissiveIntensity={1.8} transparent opacity={0.9} />
          </mesh>

          {/* Halo (más grande, transparente) — da volumen al fuego */}
          <mesh
            ref={(el) => { flameHaloRefs.current[i] = el; }}
            position={[0, 0.6, 0]}
          >
            <sphereGeometry args={[0.5, 12, 10]} />
            <meshStandardMaterial
              color="#ff3a05"
              emissive="#ff3a05"
              emissiveIntensity={1.5}
              transparent
              opacity={0.45}
              depthWrite={false}
            />
          </mesh>

          {/* Capa exterior: roja-anaranjada, alargada */}
          <mesh
            ref={(el) => { flameOuterRefs.current[i] = el; }}
            position={[0, 0.55, 0]}
            castShadow
          >
            <coneGeometry args={[0.32, 1.1, 12]} />
            <meshStandardMaterial
              color="#ff4a10"
              emissive="#ff3a05"
              emissiveIntensity={1.6}
              roughness={0.4}
              transparent
              opacity={0.92}
            />
          </mesh>
          {/* Capa media: naranja brillante */}
          <mesh
            ref={(el) => { flameMidRefs.current[i] = el; }}
            position={[0, 0.45, 0]}
          >
            <coneGeometry args={[0.22, 0.9, 10]} />
            <meshStandardMaterial
              color="#ff8a18"
              emissive="#ff7a05"
              emissiveIntensity={2.2}
              transparent
              opacity={0.94}
            />
          </mesh>
          {/* Núcleo: amarillo casi blanco (la parte más caliente) */}
          <mesh
            ref={(el) => { flameInnerRefs.current[i] = el; }}
            position={[0, 0.35, 0]}
          >
            <coneGeometry args={[0.13, 0.65, 8]} />
            <meshStandardMaterial
              color="#ffea7a"
              emissive="#ffd54a"
              emissiveIntensity={3.0}
              transparent
              opacity={0.96}
            />
          </mesh>
        </group>
      ))}

      {/* === BRASAS FLOTANTES === */}
      <group ref={embersRef}>
        {embers.map((e, i) => (
          <mesh key={i} position={[e.x0, 0, e.z0]} scale={e.size}>
            <sphereGeometry args={[1, 6, 4]} />
            <meshStandardMaterial
              color="#ffb050"
              emissive="#ff7020"
              emissiveIntensity={2.5}
              transparent
              opacity={0}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* === HUMO MULTICAPA === */}
      <group ref={smokeRef}>
        {smoke.map((s, i) => (
          <mesh key={i} position={[s.x, 0, s.z]}>
            <sphereGeometry args={[s.size, 10, 8]} />
            <meshStandardMaterial
              color="#2a2520"
              transparent
              opacity={0}
              roughness={1}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* === LUCES PARPADEANTES === */}
      {fireLights.map((fl, i) => (
        <pointLight
          key={i}
          ref={(el) => { fireLightRefs.current[i] = el; }}
          position={[fl.x, 0.8, fl.z]}
          color="#ff7a3d"
          intensity={fl.baseInt}
          distance={11}
          decay={2}
        />
      ))}
      {/* Luz alta más sutil que tinta toda la escena de color caliente */}
      <pointLight position={[0, 6, 0]} intensity={0.9} color="#ff5018" distance={22} decay={2} />
    </>
  );
};

// ============================================================
// Rayo — zigzag desde el cielo + flash de luz
// ============================================================

const Lightning: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 6 }) => {
  const boltRefs = useRef<(THREE.Group | null)[]>([]);
  const flashRefs = useRef<(THREE.PointLight | null)[]>([]);
  const ambientFlashRef = useRef<THREE.AmbientLight>(null);
  // Pilares verticales, ondas de choque y chispas por rayo (visual de impacto
  // mucho más potente que un simple anillo).
  const pillarRefs = useRef<(THREE.Mesh | null)[]>([]);
  const shockwaveRefs = useRef<(THREE.Mesh | null)[][]>([]);
  const sparksRefs = useRef<(THREE.Group | null)[]>([]);
  const getElapsed = useEffectClock(active);

  // Varios rayos en distintas posiciones, cada uno con su trigger y vida propios.
  // Cada bolt tiene además ramas (forks) que salen del tronco principal.
  const bolts = useMemo(() => {
    const rng = makeRng(66001);
    const N = 5;
    return Array.from({ length: N }).map((_, i) => {
      const baseX = (rng() - 0.5) * 8;
      const baseZ = (rng() - 0.5) * 8;
      const segCount = 7 + Math.floor(rng() * 4);
      const segments: { x: number; y: number; z: number }[] = [];
      for (let j = 0; j <= segCount; j++) {
        segments.push({
          x: baseX + (rng() - 0.5) * 1.7,
          y: 9 - (j / segCount) * 9,
          z: baseZ + (rng() - 0.5) * 0.9
        });
      }
      const nForks = 1 + Math.floor(rng() * 3);
      const forks: { segments: { x: number; y: number; z: number }[] }[] = [];
      for (let f = 0; f < nForks; f++) {
        const startIdx = 2 + Math.floor(rng() * Math.max(1, segCount - 3));
        const start = segments[startIdx];
        const forkSegs = 2 + Math.floor(rng() * 2);
        const dirX = (rng() - 0.5) * 2.5;
        const dirZ = (rng() - 0.5) * 1.5;
        const forkPts: { x: number; y: number; z: number }[] = [start];
        for (let k = 1; k <= forkSegs; k++) {
          forkPts.push({
            x: start.x + dirX * (k / forkSegs) + (rng() - 0.5) * 0.4,
            y: Math.max(0.2, start.y - k * 0.85),
            z: start.z + dirZ * (k / forkSegs) + (rng() - 0.5) * 0.3
          });
        }
        forks.push({ segments: forkPts });
      }
      const lifetime = 0.5 + rng() * 0.35;
      const slot = Math.max(0, durationSec - lifetime - 0.2);
      const startTime = (i / N) * slot + rng() * 0.3;
      // Chispas: ~12 partículas que salen del punto de impacto cuando cae el
      // rayo. Cada chispa tiene su propio ángulo, velocidad y trayectoria
      // parabólica.
      const sparks = Array.from({ length: 12 }).map(() => ({
        angle: rng() * Math.PI * 2,
        speed: 1.4 + rng() * 2.6,
        heightBoost: 0.9 + rng() * 1.6,
        size: 0.045 + rng() * 0.07,
        delay: rng() * 0.08
      }));
      return { segments, forks, startTime, lifetime, sparks };
    });
  }, [durationSec]);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) {
      boltRefs.current.forEach(g => { if (g) g.visible = false; });
      flashRefs.current.forEach(l => { if (l) l.intensity = 0; });
      pillarRefs.current.forEach(p => { if (p) p.visible = false; });
      shockwaveRefs.current.forEach(arr => arr?.forEach(s => { if (s) s.visible = false; }));
      sparksRefs.current.forEach(g => { if (g) g.visible = false; });
      if (ambientFlashRef.current) ambientFlashRef.current.intensity = 0;
      return;
    }
    let maxLocal = 0;
    const ct = state.clock.elapsedTime;
    bolts.forEach((bolt, i) => {
      const localT = t - bolt.startTime;
      const visible = localT > 0 && localT < bolt.lifetime;
      const group = boltRefs.current[i];
      if (group) {
        group.visible = visible;
        if (visible) {
          // Flicker más nervioso para insinuar más energía
          const flickerPhase = ct * 95 + i * 9.7;
          const s = 1 + Math.sin(flickerPhase) * 0.16;
          group.scale.set(s, 1, s);
        }
      }
      const light = flashRefs.current[i];
      if (light) {
        if (visible) {
          const phase = localT / bolt.lifetime;
          // Pico inicial mucho más brillante (38 → 80% del decay queda > 10).
          const baseI = 38 * Math.pow(1 - phase, 0.65);
          light.intensity = Math.max(0, baseI + Math.sin(ct * 55) * 6);
          const intensitySignal = (1 - phase) * (localT < 0.1 ? localT / 0.1 : 1);
          if (intensitySignal > maxLocal) maxLocal = intensitySignal;
        } else {
          light.intensity = 0;
        }
      }
      // Pilar vertical de luz desde el impacto: se desvanece en el primer
      // ~70% de la vida del rayo y pulsa rápido.
      const pillar = pillarRefs.current[i];
      if (pillar) {
        if (visible) {
          const phase = localT / bolt.lifetime;
          const fade = Math.max(0, (0.7 - phase) / 0.7);
          pillar.visible = fade > 0.02;
          const mat = pillar.material as THREE.MeshStandardMaterial;
          mat.opacity = fade * 0.85;
          const pulse = 1 + Math.sin(ct * 40 + i) * 0.12;
          pillar.scale.set(pulse, 1, pulse);
        } else {
          pillar.visible = false;
        }
      }
      // 3 ondas de choque concéntricas escalonadas.
      const shockwaves = shockwaveRefs.current[i];
      if (shockwaves) {
        const phase = visible ? localT / bolt.lifetime : 1;
        [0, 0.18, 0.36].forEach((delay, k) => {
          const sw = shockwaves[k];
          if (!sw) return;
          const localPhase = (phase - delay) / Math.max(0.01, 1 - delay);
          if (!visible || localPhase <= 0 || localPhase >= 1) {
            sw.visible = false;
            return;
          }
          sw.visible = true;
          const scale = 0.6 + localPhase * 4.5;
          sw.scale.set(scale, 1, scale);
          const mat = sw.material as THREE.MeshStandardMaterial;
          mat.opacity = (1 - localPhase) * 0.78;
        });
      }
      // Chispas: cada partícula sigue una parábola desde el impacto.
      const sparkGroup = sparksRefs.current[i];
      if (sparkGroup) {
        if (!visible) {
          sparkGroup.visible = false;
        } else {
          sparkGroup.visible = true;
          sparkGroup.children.forEach((mesh, k) => {
            const sp = bolt.sparks[k];
            if (!sp) return;
            const sparkT = (localT - sp.delay) / Math.max(0.05, bolt.lifetime - sp.delay);
            if (sparkT < 0 || sparkT >= 1) {
              mesh.visible = false;
              return;
            }
            mesh.visible = true;
            const dist = sp.speed * sparkT * 1.6;
            mesh.position.x = Math.cos(sp.angle) * dist;
            mesh.position.z = Math.sin(sp.angle) * dist;
            // Parábola en Y — pico en sparkT=0.5
            mesh.position.y = 0.12 + sp.heightBoost * 4 * sparkT * (1 - sparkT);
            const mat = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
            mat.opacity = (1 - sparkT) * 0.95;
          });
        }
      }
    });
    // Flash ambiental mucho más fuerte (1.6 → 3.0)
    if (ambientFlashRef.current) {
      ambientFlashRef.current.intensity = maxLocal * 3.0;
    }
  });

  if (!active) return null;
  return (
    <>
      <ambientLight ref={ambientFlashRef} intensity={0} color="#e8efff" />
      {bolts.map((bolt, bi) => {
        const impact = bolt.segments[bolt.segments.length - 1];
        return (
          <group key={bi} ref={(el) => { boltRefs.current[bi] = el; }} visible={false}>
            {/* TRONCO principal: 3 capas (core blanco puro + glow azul + aura ancha) */}
            {bolt.segments.slice(0, -1).map((p, i) => {
              const q = bolt.segments[i + 1];
              const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
              const length = Math.sqrt(dx*dx + dy*dy + dz*dz);
              const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, mz = (p.z + q.z) / 2;
              const dir = new THREE.Vector3(dx, dy, dz).normalize();
              const yAxis = new THREE.Vector3(0, 1, 0);
              const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
              const euler = new THREE.Euler().setFromQuaternion(quat);
              return (
                <group key={i} position={[mx, my, mz]} rotation={[euler.x, euler.y, euler.z]}>
                  {/* Núcleo blanco super brillante */}
                  <mesh>
                    <cylinderGeometry args={[0.045, 0.045, length, 8]} />
                    <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={7.5} toneMapped={false} />
                  </mesh>
                  {/* Glow medio blanco-azulado */}
                  <mesh>
                    <cylinderGeometry args={[0.16, 0.16, length, 8]} />
                    <meshStandardMaterial color="#e8f1ff" emissive="#cfe1ff" emissiveIntensity={3.2} transparent opacity={0.7} toneMapped={false} />
                  </mesh>
                  {/* Aura ancha de plasma azul */}
                  <mesh>
                    <cylinderGeometry args={[0.36, 0.36, length, 8]} />
                    <meshStandardMaterial color="#9bbfff" emissive="#7faaff" emissiveIntensity={1.6} transparent opacity={0.28} depthWrite={false} toneMapped={false} />
                  </mesh>
                </group>
              );
            })}
            {/* RAMAS (forks) — 3 capas también, más delgadas */}
            {bolt.forks.flatMap((fork, fi) => (
              fork.segments.slice(0, -1).map((p, i) => {
                const q = fork.segments[i + 1];
                const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
                const length = Math.sqrt(dx*dx + dy*dy + dz*dz);
                const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, mz = (p.z + q.z) / 2;
                const dir = new THREE.Vector3(dx, dy, dz).normalize();
                const yAxis = new THREE.Vector3(0, 1, 0);
                const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
                const euler = new THREE.Euler().setFromQuaternion(quat);
                return (
                  <group key={`f${fi}-${i}`} position={[mx, my, mz]} rotation={[euler.x, euler.y, euler.z]}>
                    <mesh>
                      <cylinderGeometry args={[0.028, 0.028, length, 6]} />
                      <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={5.5} toneMapped={false} />
                    </mesh>
                    <mesh>
                      <cylinderGeometry args={[0.10, 0.10, length, 6]} />
                      <meshStandardMaterial color="#e8f1ff" emissive="#cfe1ff" emissiveIntensity={2.4} transparent opacity={0.55} toneMapped={false} />
                    </mesh>
                    <mesh>
                      <cylinderGeometry args={[0.22, 0.22, length, 6]} />
                      <meshStandardMaterial color="#9bbfff" emissive="#7faaff" emissiveIntensity={1.0} transparent opacity={0.22} depthWrite={false} toneMapped={false} />
                    </mesh>
                  </group>
                );
              })
            ))}

            {/* PILAR vertical de luz desde el impacto */}
            <mesh
              ref={(el) => { pillarRefs.current[bi] = el; }}
              position={[impact.x, 4.5, impact.z]}
            >
              <cylinderGeometry args={[0.55, 0.32, 9, 18, 1, true]} />
              <meshStandardMaterial
                color="#e8f1ff"
                emissive="#bcd6ff"
                emissiveIntensity={2.4}
                transparent
                opacity={0}
                depthWrite={false}
                side={THREE.DoubleSide}
                toneMapped={false}
              />
            </mesh>

            {/* ONDAS DE CHOQUE: 3 anillos que se expanden y desvanecen */}
            {[0, 1, 2].map(k => (
              <mesh
                key={`sw-${k}`}
                ref={(el) => {
                  if (!shockwaveRefs.current[bi]) shockwaveRefs.current[bi] = [];
                  shockwaveRefs.current[bi][k] = el;
                }}
                position={[impact.x, 0.02 + k * 0.005, impact.z]}
                rotation={[-Math.PI / 2, 0, 0]}
                scale={[1, 1, 1]}
              >
                <ringGeometry args={[0.5, 0.7, 36]} />
                <meshStandardMaterial
                  color="#ffffff"
                  emissive="#cfe1ff"
                  emissiveIntensity={2.5}
                  transparent
                  opacity={0}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            ))}

            {/* CHISPAS: partículas saliendo del impacto en trayectoria parabólica */}
            <group ref={(el) => { sparksRefs.current[bi] = el; }} position={[impact.x, 0, impact.z]}>
              {bolt.sparks.map((sp, k) => (
                <mesh key={k} position={[0, 0.1, 0]}>
                  <sphereGeometry args={[sp.size, 7, 6]} />
                  <meshStandardMaterial
                    color="#ffffff"
                    emissive="#ffe9a8"
                    emissiveIntensity={3.0}
                    transparent
                    opacity={0}
                    toneMapped={false}
                  />
                </mesh>
              ))}
            </group>

            {/* Brillo radial en el suelo — más grande */}
            <mesh position={[impact.x, 0.01, impact.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0, 1.3, 32]} />
              <meshStandardMaterial color="#ffffff" emissive="#fff8a8" emissiveIntensity={3.8} transparent opacity={0.92} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
            {/* Halo exterior — más ancho y brillante */}
            <mesh position={[impact.x, 0.011, impact.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[1.3, 2.0, 32]} />
              <meshStandardMaterial color="#fff8a8" emissive="#fff066" emissiveIntensity={2.2} transparent opacity={0.55} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>

            {/* Punto de luz por rayo — distancia y intensidad mayores */}
            <pointLight
              ref={(el) => { flashRefs.current[bi] = el; }}
              position={[bolt.segments[0].x, 7, bolt.segments[0].z]}
              intensity={0}
              color="#e8efff"
              distance={48}
              decay={1.8}
            />
          </group>
        );
      })}
    </>
  );
};

// ============================================================
// Lluvia ácida — nubes tóxicas 3D + gotas verdes con trail + charcos.
// Mismo patrón visual que HeavyRain pero teñido en verde tóxico, con
// salpicaduras al impactar y charco de ácido en el suelo.
// ============================================================

const AcidRain: React.FC<{ active: boolean }> = ({ active }) => {
  const dropsRef = useRef<THREE.Group>(null);
  const cloudsRef = useRef<THREE.Group>(null);
  const puddleRef = useRef<THREE.Mesh>(null);
  const splashesRef = useRef<THREE.Group>(null);
  const bubblesRef = useRef<THREE.Group>(null);

  // === 5 nubes tóxicas 3D — cluster de puffs verdes con base oscura ===
  const CLOUD_Y = 6.8;
  const clouds = useMemo(() => {
    const rng = makeRng(77100);
    const N = 5;
    return Array.from({ length: N }).map((_, i) => {
      const inner = i % 2 === 0;
      const ang = (i / N) * Math.PI * 2 + (rng() - 0.5) * 0.4;
      const r = inner ? 0.5 + rng() * 1.7 : 2.8 + rng() * 1.6;
      const cx = Math.cos(ang) * r;
      const cz = Math.sin(ang) * r;
      const cy = CLOUD_Y + (rng() - 0.5) * 0.7;
      const numPuffs = 7 + Math.floor(rng() * 4);
      const puffs = Array.from({ length: numPuffs }).map(() => {
        const a = rng() * Math.PI * 2;
        const d = rng() * 1.1;
        return {
          x: Math.cos(a) * d,
          y: (rng() - 0.5) * 0.32,
          z: Math.sin(a) * d * 0.78,
          size: 0.85 + rng() * 0.55,
          tint: rng()
        };
      });
      return {
        cx, cz, cy,
        driftPhase: rng() * Math.PI * 2,
        driftSpeed: 0.10 + rng() * 0.18,
        driftAmpX: 0.35 + rng() * 0.55,
        driftAmpZ: 0.25 + rng() * 0.4,
        puffs
      };
    });
  }, []);

  // === 130 gotas verdes con trail ===
  const drops = useMemo(() => {
    const rng = makeRng(77001);
    return Array.from({ length: 130 }).map((_, i) => ({
      cloudIdx: i % 5,
      offsetX: (rng() - 0.5) * 2.0,
      offsetZ: (rng() - 0.5) * 1.7,
      speed: 0.9 + rng() * 0.6,
      phase: rng(),
      size: 0.035 + rng() * 0.05,
      length: 0.3 + rng() * 0.45
    }));
  }, []);

  // === Salpicaduras: 18 anillos efímeros que crecen cuando impacta una gota ===
  const splashes = useMemo(() => {
    const rng = makeRng(77200);
    return Array.from({ length: 18 }).map(() => ({
      x: (rng() - 0.5) * 9,
      z: (rng() - 0.5) * 9,
      delay: rng() * 1.4,
      cycleDur: 0.7 + rng() * 0.4
    }));
  }, []);

  // === Burbujas de gas que suben desde el charco ===
  const bubbles = useMemo(() => {
    const rng = makeRng(77300);
    return Array.from({ length: 28 }).map(() => ({
      x: (rng() - 0.5) * 8,
      z: (rng() - 0.5) * 8,
      delay: rng() * 2.5,
      speed: 0.4 + rng() * 0.5,
      size: 0.06 + rng() * 0.1,
      maxY: 1.2 + rng() * 1.2
    }));
  }, []);

  // Posiciones actuales de las nubes — reusable para no allocar en useFrame
  const cloudWorldXZ = useRef<Float32Array>(new Float32Array(clouds.length * 2));

  useFrame((state) => {
    if (!active) return;
    const ct = state.clock.elapsedTime;

    // Drift de nubes
    if (cloudsRef.current) {
      cloudsRef.current.children.forEach((g, i) => {
        const c = clouds[i]; if (!c) return;
        const dx = Math.sin(ct * c.driftSpeed + c.driftPhase) * c.driftAmpX;
        const dz = Math.cos(ct * c.driftSpeed * 0.7 + c.driftPhase) * c.driftAmpZ;
        const x = c.cx + dx;
        const z = c.cz + dz;
        g.position.set(x, c.cy, z);
        cloudWorldXZ.current[i * 2] = x;
        cloudWorldXZ.current[i * 2 + 1] = z;
      });
    } else {
      clouds.forEach((c, i) => {
        cloudWorldXZ.current[i * 2] = c.cx;
        cloudWorldXZ.current[i * 2 + 1] = c.cz;
      });
    }

    // Gotas caen desde sus nubes
    if (dropsRef.current) {
      dropsRef.current.children.forEach((mesh, i) => {
        const d = drops[i]; if (!d) return;
        const c = clouds[d.cloudIdx]; if (!c) return;
        const cx = cloudWorldXZ.current[d.cloudIdx * 2];
        const cz = cloudWorldXZ.current[d.cloudIdx * 2 + 1];
        const yStart = c.cy - 0.45;
        const phase = ((ct * d.speed + d.phase) % 1);
        const y = yStart - phase * yStart;
        mesh.position.set(cx + d.offsetX, y, cz + d.offsetZ);
      });
    }

    // Charco verde que crece despacio y se mantiene
    if (puddleRef.current) {
      const p = Math.min(ct * 0.15, 1);
      const mat = puddleRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = p * 0.65;
      puddleRef.current.scale.setScalar(0.5 + p * 0.55);
    }

    // Salpicaduras — anillos crecen y desaparecen
    if (splashesRef.current) {
      splashesRef.current.children.forEach((c, i) => {
        const s = splashes[i]; if (!s) return;
        const phase = (((ct + s.delay) / s.cycleDur) % 1);
        const scale = 0.2 + phase * 1.4;
        c.scale.set(scale, 1, scale);
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - phase) * 0.55;
      });
    }

    // Burbujas de gas suben del charco
    if (bubblesRef.current) {
      bubblesRef.current.children.forEach((c, i) => {
        const b = bubbles[i]; if (!b) return;
        const phase = (((ct + b.delay) * b.speed) % 1);
        c.position.y = 0.1 + phase * b.maxY;
        const s = 1 - phase * 0.3;
        c.scale.set(s, s, s);
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - phase) * 0.6;
      });
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Cielo verdoso oscuro por encima */}
      <mesh position={[0, 9, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshBasicMaterial color="#3e4d28" transparent opacity={0.42} />
      </mesh>

      {/* Niebla tóxica verde difusa */}
      <mesh position={[0, 2.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[16, 16]} />
        <meshStandardMaterial color="#a8c252" transparent opacity={0.10} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* NUBES TÓXICAS — clusters de puffs verdes */}
      <group ref={cloudsRef}>
        {clouds.map((c, i) => (
          <group key={i} position={[c.cx, c.cy, c.cz]}>
            {c.puffs.map((p, j) => (
              <mesh key={j} position={[p.x, p.y, p.z]} scale={p.size} castShadow>
                <sphereGeometry args={[1, 12, 10]} />
                <meshStandardMaterial
                  color={p.tint > 0.6 ? '#869c3a' : '#6a7f24'}
                  emissive="#3a4e10"
                  emissiveIntensity={0.18}
                  roughness={0.92}
                  transparent
                  opacity={0.92}
                />
              </mesh>
            ))}
            {/* Base más oscura y tóxica */}
            <mesh position={[0, -0.32, 0]} scale={[1.45, 0.45, 1.1]}>
              <sphereGeometry args={[1, 12, 8]} />
              <meshStandardMaterial
                color="#3d4a18"
                roughness={1}
                transparent
                opacity={0.9}
              />
            </mesh>
          </group>
        ))}
      </group>

      {/* Gotas verdes alargadas con emissive */}
      <group ref={dropsRef}>
        {drops.map((d, i) => (
          <mesh key={i} position={[0, 0, 0]} scale={[d.size, d.length, d.size]}>
            <cylinderGeometry args={[1, 1, 1, 5]} />
            <meshStandardMaterial
              color="#aede2a"
              emissive="#a8d028"
              emissiveIntensity={0.45}
              transparent
              opacity={0.88}
            />
          </mesh>
        ))}
      </group>

      {/* Salpicaduras al impactar (anillos verdes) */}
      <group ref={splashesRef}>
        {splashes.map((s, i) => (
          <mesh key={i} position={[s.x, 0.07, s.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.18, 0.28, 16]} />
            <meshStandardMaterial
              color="#bce03c"
              emissive="#9bc822"
              emissiveIntensity={0.4}
              transparent
              opacity={0.5}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* Burbujas de gas tóxico */}
      <group ref={bubblesRef}>
        {bubbles.map((b, i) => (
          <mesh key={i} position={[b.x, 0.1, b.z]}>
            <sphereGeometry args={[b.size, 8, 6]} />
            <meshStandardMaterial
              color="#cfe860"
              emissive="#a8d028"
              emissiveIntensity={0.3}
              transparent
              opacity={0.55}
            />
          </mesh>
        ))}
      </group>

      {/* Charco ácido verde brillante */}
      <mesh ref={puddleRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} scale={0.5}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial
          color="#6e9418"
          emissive="#558a10"
          emissiveIntensity={0.2}
          transparent
          opacity={0}
          roughness={0.15}
          metalness={0.5}
        />
      </mesh>
    </>
  );
};

// ============================================================
// Nevada — copos 3D, manto blanco, montículos de nieve, polvo de nieve
// rasante y brillo helado. Mantenemos la firma original para no romper
// el llamador de FarmScene.
// ============================================================

const Snowfall: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 4 }) => {
  const bigFlakesRef = useRef<THREE.Group>(null);
  const smallFlakesRef = useRef<THREE.Group>(null);
  const driftRef = useRef<THREE.Group>(null);
  const groundRef = useRef<THREE.Mesh>(null);
  const moundsRef = useRef<THREE.Group>(null);
  const getElapsed = useEffectClock(active);

  // === Copos grandes (cristales hexagonales) ===
  const bigFlakes = useMemo(() => {
    const rng = makeRng(88001);
    return Array.from({ length: 90 }).map(() => ({
      x: (rng() - 0.5) * 14,
      z: (rng() - 0.5) * 14,
      yMax: 6.5 + rng() * 3,
      speed: 0.18 + rng() * 0.18,
      phase: rng(),
      sway: rng() * Math.PI * 2,
      swayAmp: 0.2 + rng() * 0.5,
      size: 0.08 + rng() * 0.09,
      spinSpeed: 0.6 + rng() * 1.1
    }));
  }, []);

  // === Copos pequeños (muchos más, simplemente puntos blancos) ===
  const smallFlakes = useMemo(() => {
    const rng = makeRng(88002);
    return Array.from({ length: 200 }).map(() => ({
      x: (rng() - 0.5) * 16,
      z: (rng() - 0.5) * 16,
      yMax: 7 + rng() * 3,
      speed: 0.3 + rng() * 0.3,
      phase: rng(),
      sway: rng() * Math.PI * 2,
      swayAmp: 0.12 + rng() * 0.25,
      size: 0.03 + rng() * 0.045
    }));
  }, []);

  // === Polvo de nieve rasante (cerca del suelo, baja altitud) ===
  const driftFlakes = useMemo(() => {
    const rng = makeRng(88003);
    return Array.from({ length: 70 }).map(() => ({
      x: (rng() - 0.5) * 12,
      z: (rng() - 0.5) * 12,
      yMax: 0.3 + rng() * 1.4,
      driftSpeed: 0.4 + rng() * 0.5,
      driftPhase: rng() * Math.PI * 2,
      size: 0.04 + rng() * 0.07,
      cyclePhase: rng()
    }));
  }, []);

  // === Montículos de nieve acumulada — 9 montículos de tamaño variable
  // distribuidos por el suelo, no demasiado cerca del centro para no tapar
  // las plantas centrales. ===
  const mounds = useMemo(() => {
    const rng = makeRng(88004);
    const positions: Array<{ x: number; z: number; r: number; h: number; tilt: number }> = [];
    const N = 11;
    let tries = 0;
    while (positions.length < N && tries < 200) {
      tries++;
      const x = (rng() - 0.5) * 8.5;
      const z = (rng() - 0.5) * 8.5;
      // No demasiado cerca del centro (donde están las plantas)
      if (Math.hypot(x, z) < 1.6) continue;
      // No solaparse con otros montículos
      if (positions.some(p => Math.hypot(p.x - x, p.z - z) < 1.4)) continue;
      const r = 0.55 + rng() * 0.85;
      const h = 0.25 + rng() * 0.35;
      positions.push({ x, z, r, h, tilt: rng() * Math.PI * 2 });
    }
    return positions;
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;
    const ct = state.clock.elapsedTime;

    // Copos grandes — caen, oscilan y giran
    if (bigFlakesRef.current) {
      bigFlakesRef.current.children.forEach((c, i) => {
        const f = bigFlakes[i]; if (!f) return;
        const phase = ((ct * f.speed + f.phase) % 1);
        c.position.y = f.yMax - phase * f.yMax;
        c.position.x = f.x + Math.sin(ct * 0.8 + f.sway) * f.swayAmp;
        c.position.z = f.z + Math.cos(ct * 0.6 + f.sway * 1.3) * (f.swayAmp * 0.6);
        c.rotation.z = ct * f.spinSpeed;
        c.rotation.x = Math.sin(ct * 0.5 + f.sway) * 0.4;
      });
    }
    // Copos pequeños — caen más rápido y rectos
    if (smallFlakesRef.current) {
      smallFlakesRef.current.children.forEach((c, i) => {
        const f = smallFlakes[i]; if (!f) return;
        const phase = ((ct * f.speed + f.phase) % 1);
        c.position.y = f.yMax - phase * f.yMax;
        c.position.x = f.x + Math.sin(ct * 1.5 + f.sway) * f.swayAmp;
      });
    }
    // Polvo de nieve rasante — drift horizontal con cycling vertical
    if (driftRef.current) {
      driftRef.current.children.forEach((c, i) => {
        const f = driftFlakes[i]; if (!f) return;
        const phase = ((ct * 0.25 + f.cyclePhase) % 1);
        c.position.y = 0.12 + (1 - phase) * f.yMax;
        c.position.x = f.x + Math.sin(ct * f.driftSpeed + f.driftPhase) * 0.9;
        c.position.z = f.z + Math.cos(ct * f.driftSpeed * 0.8 + f.driftPhase) * 0.7;
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - phase) * 0.7;
      });
    }
    // Manto blanco sube opacidad progresivamente y se queda
    if (groundRef.current) {
      const p = Math.min(t / durationSec, 1);
      const mat = groundRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.min(p * 1.8, 0.85);
    }
    // Montículos: crecen en escala mientras dura el evento
    if (moundsRef.current) {
      const p = Math.min(t / durationSec, 1);
      moundsRef.current.children.forEach((c, i) => {
        const m = mounds[i]; if (!m) return;
        const sc = Math.max(0.001, p);
        c.scale.set(sc, sc, sc);
      });
    }
  });

  if (!active) return null;

  return (
    <>
      {/* Manto de nieve uniforme sobre el terreno */}
      <mesh ref={groundRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial
          color="#f8fcff"
          emissive="#cfe0ec"
          emissiveIntensity={0.18}
          transparent
          opacity={0}
          roughness={0.85}
        />
      </mesh>

      {/* Montículos de nieve — domos blancos brillantes */}
      <group ref={moundsRef}>
        {mounds.map((m, i) => (
          <group key={i} position={[m.x, 0, m.z]} rotation={[0, m.tilt, 0]} scale={0.001}>
            {/* Domo principal */}
            <mesh position={[0, m.h * 0.4, 0]} castShadow receiveShadow>
              <sphereGeometry args={[m.r, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.1]} />
              <meshStandardMaterial
                color="#fbfeff"
                emissive="#dbe9f4"
                emissiveIntensity={0.18}
                roughness={0.7}
                metalness={0.05}
              />
            </mesh>
            {/* Cumbre brillante (más reflectante en la parte alta) */}
            <mesh position={[0, m.h * 0.85, 0]} castShadow>
              <sphereGeometry args={[m.r * 0.55, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.3]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive="#e8f1f9"
                emissiveIntensity={0.32}
                roughness={0.55}
                metalness={0.1}
              />
            </mesh>
            {/* Base ensanchada — falda del montículo que se funde con el suelo */}
            <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[m.r * 1.25, 22]} />
              <meshStandardMaterial color="#f3f9ff" roughness={0.95} opacity={0.85} transparent />
            </mesh>
          </group>
        ))}
      </group>

      {/* Copos grandes (cristales) */}
      <group ref={bigFlakesRef}>
        {bigFlakes.map((f, i) => (
          <group key={i} position={[f.x, f.yMax, f.z]} scale={f.size}>
            {/* Estrella de 6 puntas: 3 cajas finas cruzadas */}
            <mesh rotation={[0, 0, 0]} castShadow>
              <boxGeometry args={[2.2, 0.18, 0.18]} />
              <meshStandardMaterial color="#ffffff" emissive="#e7f1fc" emissiveIntensity={0.45} roughness={0.3} metalness={0.4} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 3]}>
              <boxGeometry args={[2.2, 0.18, 0.18]} />
              <meshStandardMaterial color="#ffffff" emissive="#e7f1fc" emissiveIntensity={0.45} roughness={0.3} metalness={0.4} />
            </mesh>
            <mesh rotation={[0, 0, -Math.PI / 3]}>
              <boxGeometry args={[2.2, 0.18, 0.18]} />
              <meshStandardMaterial color="#ffffff" emissive="#e7f1fc" emissiveIntensity={0.45} roughness={0.3} metalness={0.4} />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.4, 8, 6]} />
              <meshStandardMaterial color="#ffffff" emissive="#dbe9f4" emissiveIntensity={0.55} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Copos pequeños (puntos blancos numerosos) */}
      <group ref={smallFlakesRef}>
        {smallFlakes.map((f, i) => (
          <mesh key={i} position={[f.x, f.yMax, f.z]} scale={f.size}>
            <sphereGeometry args={[1, 6, 5]} />
            <meshStandardMaterial color="#ffffff" emissive="#dceaff" emissiveIntensity={0.35} />
          </mesh>
        ))}
      </group>

      {/* Polvo de nieve rasante (drift horizontal cerca del suelo) */}
      <group ref={driftRef}>
        {driftFlakes.map((f, i) => (
          <mesh key={i} position={[f.x, 0.4, f.z]} scale={f.size}>
            <sphereGeometry args={[1, 6, 5]} />
            <meshStandardMaterial color="#ffffff" emissive="#cfe0ec" emissiveIntensity={0.3} transparent opacity={0.6} />
          </mesh>
        ))}
      </group>
    </>
  );
};

// ============================================================
// Helada — manto de hielo sobre el suelo, cristales de escarcha sobre los
// cultivos (no aquí — lo aplica CropField vía tinte), cubitos de hielo
// cayendo y un pingüino caminando por la parcela. Vapor frío bajo.
// ============================================================

const Frost: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 4 }) => {
  const iceGroundRef = useRef<THREE.Mesh>(null);
  const cubesRef = useRef<THREE.Group>(null);
  const vaporRef = useRef<THREE.Group>(null);
  const penguinRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftWingRef = useRef<THREE.Mesh>(null);
  const rightWingRef = useRef<THREE.Mesh>(null);
  const getElapsed = useEffectClock(active);

  // === Cubitos de hielo cayendo del cielo ===
  const cubes = useMemo(() => {
    const rng = makeRng(99201);
    return Array.from({ length: 28 }).map(() => ({
      x: (rng() - 0.5) * 12,
      z: (rng() - 0.5) * 12,
      yMax: 6 + rng() * 3,
      speed: 0.55 + rng() * 0.5,
      phase: rng(),
      size: 0.14 + rng() * 0.18,
      spinSpeed: 1.0 + rng() * 1.8,
      tumble: rng()
    }));
  }, []);

  // === Cristales de escarcha clavados en el suelo (estáticos) ===
  const crystals = useMemo(() => {
    const rng = makeRng(99202);
    const N = 28;
    const list: Array<{ x: number; z: number; rot: number; h: number; w: number; tilt: number }> = [];
    let tries = 0;
    while (list.length < N && tries < 200) {
      tries++;
      const x = (rng() - 0.5) * 8.5;
      const z = (rng() - 0.5) * 8.5;
      if (Math.hypot(x, z) < 1.4) continue;
      if (list.some(p => Math.hypot(p.x - x, p.z - z) < 0.7)) continue;
      list.push({
        x, z,
        rot: rng() * Math.PI * 2,
        h: 0.35 + rng() * 0.45,
        w: 0.08 + rng() * 0.07,
        tilt: (rng() - 0.5) * 0.4
      });
    }
    return list;
  }, []);

  // === Partículas de vapor frío a baja altura ===
  const vapor = useMemo(() => {
    const rng = makeRng(99203);
    return Array.from({ length: 35 }).map(() => ({
      x: (rng() - 0.5) * 10,
      z: (rng() - 0.5) * 10,
      yMax: 0.6 + rng() * 0.9,
      delay: rng() * 1.8,
      speed: 0.4 + rng() * 0.4,
      size: 0.32 + rng() * 0.35
    }));
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;
    const ct = state.clock.elapsedTime;

    // Hielo en el suelo: sube opacity y se queda
    if (iceGroundRef.current) {
      const p = Math.min(t / durationSec, 1);
      const mat = iceGroundRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.min(p * 1.6, 0.78);
    }

    // Cubitos cayendo con rotación
    if (cubesRef.current) {
      cubesRef.current.children.forEach((c, i) => {
        const cb = cubes[i]; if (!cb) return;
        const phase = ((ct * cb.speed + cb.phase) % 1);
        c.position.y = cb.yMax - phase * cb.yMax;
        c.rotation.x = ct * cb.spinSpeed + cb.tumble;
        c.rotation.y = ct * cb.spinSpeed * 0.7;
        c.rotation.z = ct * cb.spinSpeed * 0.4;
      });
    }

    // Vapor frío subiendo
    if (vaporRef.current) {
      vaporRef.current.children.forEach((c, i) => {
        const v = vapor[i]; if (!v) return;
        const phase = (((ct + v.delay) * v.speed) % 1);
        c.position.y = 0.15 + phase * v.yMax;
        const s = 0.5 + phase * 1.2;
        c.scale.setScalar(s);
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - phase) * 0.55;
      });
    }

    // === Pingüino: camina en círculo por el borde de la parcela ===
    if (penguinRef.current) {
      // Período largo (más calmado). Camina en círculo de radio 3.2.
      const T = 16;
      const angle = (ct / T) * Math.PI * 2;
      const r = 3.2;
      const px = Math.cos(angle) * r;
      const pz = Math.sin(angle) * r;
      penguinRef.current.position.set(px, 0, pz);
      // Mira en la dirección del movimiento (tangencial)
      penguinRef.current.rotation.y = -angle + Math.PI / 2;
      // Pequeño bobbing del cuerpo al caminar
      if (bodyRef.current) {
        const step = Math.sin(ct * 4.0);
        bodyRef.current.position.y = 0.05 + Math.abs(step) * 0.05;
        bodyRef.current.rotation.z = step * 0.08;
      }
      // Patas alternándose
      const stepCycle = Math.sin(ct * 4.0);
      if (leftLegRef.current)  leftLegRef.current.rotation.x  =  stepCycle * 0.6;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -stepCycle * 0.6;
      // Aletas batiendo suavemente
      const flap = Math.sin(ct * 3.0) * 0.35;
      if (leftWingRef.current)  leftWingRef.current.rotation.z  =  Math.PI / 2.2 + flap;
      if (rightWingRef.current) rightWingRef.current.rotation.z = -Math.PI / 2.2 - flap;
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Capa de hielo brillante sobre el terreno (translúcida, metálica) */}
      <mesh ref={iceGroundRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial
          color="#c9e3f0"
          emissive="#a0c4d8"
          emissiveIntensity={0.22}
          transparent
          opacity={0}
          roughness={0.15}
          metalness={0.65}
        />
      </mesh>

      {/* Cristales de escarcha clavados en el suelo */}
      <group>
        {crystals.map((c, i) => (
          <group key={i} position={[c.x, 0.08, c.z]} rotation={[c.tilt, c.rot, 0]}>
            <mesh castShadow>
              <coneGeometry args={[c.w, c.h, 6]} />
              <meshStandardMaterial
                color="#e8f4fb"
                emissive="#c5dde8"
                emissiveIntensity={0.4}
                roughness={0.2}
                metalness={0.55}
                transparent
                opacity={0.88}
              />
            </mesh>
            {/* Punta brillante */}
            <mesh position={[0, c.h * 0.55, 0]}>
              <coneGeometry args={[c.w * 0.45, c.h * 0.5, 6]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive="#dbe9f4"
                emissiveIntensity={0.6}
                roughness={0.1}
                metalness={0.7}
                transparent
                opacity={0.9}
              />
            </mesh>
          </group>
        ))}
      </group>

      {/* Cubitos de hielo cayendo */}
      <group ref={cubesRef}>
        {cubes.map((cb, i) => (
          <mesh key={i} position={[cb.x, cb.yMax, cb.z]} scale={cb.size} castShadow>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial
              color="#c9e3f0"
              emissive="#a0c4d8"
              emissiveIntensity={0.22}
              roughness={0.1}
              metalness={0.55}
              transparent
              opacity={0.86}
            />
          </mesh>
        ))}
      </group>

      {/* Vapor frío a baja altura */}
      <group ref={vaporRef}>
        {vapor.map((v, i) => (
          <mesh key={i} position={[v.x, 0.15, v.z]} scale={v.size}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshStandardMaterial color="#e8f3f9" transparent opacity={0.4} roughness={1} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* === Pingüino === */}
      <group ref={penguinRef} position={[3.2, 0, 0]}>
        <group ref={bodyRef}>
          {/* Cuerpo principal (gordito, negro) */}
          <mesh position={[0, 0.55, 0]} castShadow>
            <sphereGeometry args={[0.5, 18, 14]} />
            <meshStandardMaterial color="#1f2a35" roughness={0.7} />
          </mesh>
          {/* Barriga blanca */}
          <mesh position={[0, 0.5, 0.18]} scale={[0.85, 0.95, 0.6]} castShadow>
            <sphereGeometry args={[0.4, 16, 12]} />
            <meshStandardMaterial color="#fafefe" roughness={0.65} />
          </mesh>
          {/* Cabeza */}
          <mesh position={[0, 1.0, 0]} castShadow>
            <sphereGeometry args={[0.32, 16, 12]} />
            <meshStandardMaterial color="#1f2a35" roughness={0.7} />
          </mesh>
          {/* Cara blanca */}
          <mesh position={[0, 1.0, 0.15]} scale={[0.9, 0.9, 0.6]} castShadow>
            <sphereGeometry args={[0.22, 14, 10]} />
            <meshStandardMaterial color="#fafefe" roughness={0.6} />
          </mesh>
          {/* Ojos */}
          <mesh position={[-0.11, 1.05, 0.27]}>
            <sphereGeometry args={[0.045, 8, 6]} />
            <meshStandardMaterial color="#0a0a10" />
          </mesh>
          <mesh position={[0.11, 1.05, 0.27]}>
            <sphereGeometry args={[0.045, 8, 6]} />
            <meshStandardMaterial color="#0a0a10" />
          </mesh>
          {/* Pico naranja */}
          <mesh position={[0, 0.96, 0.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <coneGeometry args={[0.08, 0.18, 4]} />
            <meshStandardMaterial color="#ffa733" emissive="#cc7a10" emissiveIntensity={0.2} roughness={0.4} />
          </mesh>
          {/* Aletas */}
          <mesh ref={leftWingRef} position={[-0.42, 0.6, 0]} rotation={[0, 0, Math.PI / 2.2]} castShadow>
            <capsuleGeometry args={[0.12, 0.4, 4, 6]} />
            <meshStandardMaterial color="#1f2a35" roughness={0.7} />
          </mesh>
          <mesh ref={rightWingRef} position={[0.42, 0.6, 0]} rotation={[0, 0, -Math.PI / 2.2]} castShadow>
            <capsuleGeometry args={[0.12, 0.4, 4, 6]} />
            <meshStandardMaterial color="#1f2a35" roughness={0.7} />
          </mesh>
          {/* Patas */}
          <group ref={leftLegRef} position={[-0.15, 0.1, 0]}>
            <mesh position={[0, 0, 0.12]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <boxGeometry args={[0.13, 0.22, 0.08]} />
              <meshStandardMaterial color="#ffa733" emissive="#cc7a10" emissiveIntensity={0.15} roughness={0.55} />
            </mesh>
          </group>
          <group ref={rightLegRef} position={[0.15, 0.1, 0]}>
            <mesh position={[0, 0, 0.12]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <boxGeometry args={[0.13, 0.22, 0.08]} />
              <meshStandardMaterial color="#ffa733" emissive="#cc7a10" emissiveIntensity={0.15} roughness={0.55} />
            </mesh>
          </group>
        </group>
      </group>
    </>
  );
};

// ============================================================
// Calima sahariana — neblina naranja, cactus saguaro en los bordes,
// tumbleweed (planta rodadora del oeste) atravesando la parcela, polvo
// volando en horizontal.
// ============================================================

const Calima: React.FC<{ active: boolean }> = ({ active }) => {
  const fogRef = useRef<THREE.Mesh>(null);
  const dustRef = useRef<THREE.Group>(null);
  const tumbleRef = useRef<THREE.Group>(null);
  const sunRef = useRef<THREE.Mesh>(null);

  // Cactus saguaro distribuidos en los bordes de la parcela (no en el centro)
  const cacti = useMemo(() => {
    const rng = makeRng(70101);
    const positions: Array<{ x: number; z: number; rot: number; h: number; arms: Array<{ side: 1 | -1; y: number; len: number }> }> = [];
    const candidates: Array<[number, number]> = [
      [-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5],
      [0, -5], [-5, 0], [5, 0], [0, 5],
      [-4, -2], [3.8, 2.2]
    ];
    candidates.forEach(([x, z]) => {
      const jx = x + (rng() - 0.5) * 0.6;
      const jz = z + (rng() - 0.5) * 0.6;
      const h = 1.4 + rng() * 0.9;
      const armCount = Math.floor(rng() * 3);
      const arms = Array.from({ length: armCount }).map(() => ({
        side: (rng() < 0.5 ? -1 : 1) as 1 | -1,
        y: h * (0.45 + rng() * 0.3),
        len: h * (0.3 + rng() * 0.2)
      }));
      positions.push({ x: jx, z: jz, rot: rng() * Math.PI * 2, h, arms });
    });
    return positions;
  }, []);

  // Partículas de polvo volando horizontalmente
  const dust = useMemo(() => {
    const rng = makeRng(70102);
    return Array.from({ length: 100 }).map(() => ({
      yBase: 0.4 + rng() * 4.5,
      zBase: (rng() - 0.5) * 9,
      speed: 0.6 + rng() * 0.8,
      phase: rng(),
      size: 0.05 + rng() * 0.08,
      drift: rng() * Math.PI * 2
    }));
  }, []);

  // Tumbleweeds — esferas marrones rodando por el suelo
  const tumbleweeds = useMemo(() => {
    const rng = makeRng(70103);
    return Array.from({ length: 3 }).map((_, i) => ({
      zOff: (rng() - 0.5) * 4,
      delay: i * 2.5 + rng() * 1.2,
      speed: 1.6 + rng() * 0.5,
      size: 0.4 + rng() * 0.18
    }));
  }, []);

  useFrame((state) => {
    if (!active) return;
    const ct = state.clock.elapsedTime;

    // Niebla naranja girando muy suavemente
    if (fogRef.current) {
      fogRef.current.rotation.z = ct * 0.04;
    }
    // Sol "abrasador" con leve pulso
    if (sunRef.current) {
      const pulse = 1 + Math.sin(ct * 1.5) * 0.04;
      sunRef.current.scale.setScalar(pulse);
    }

    // Polvo volando horizontalmente
    if (dustRef.current) {
      dustRef.current.children.forEach((c, i) => {
        const d = dust[i]; if (!d) return;
        const phase = ((ct * d.speed + d.phase) % 1);
        // De izquierda (-10) a derecha (+10)
        const x = -10 + phase * 20;
        const y = d.yBase + Math.sin(ct * 1.2 + d.drift) * 0.15;
        const z = d.zBase + Math.cos(ct * 0.8 + d.drift) * 0.2;
        c.position.set(x, y, z);
      });
    }

    // Tumbleweeds rodando — de oeste a este por el suelo de la parcela
    if (tumbleRef.current) {
      tumbleRef.current.children.forEach((c, i) => {
        const tw = tumbleweeds[i]; if (!tw) return;
        // Cicla cada ~10 s, con delay para no salir todos a la vez
        const cycle = (((ct + tw.delay) * 0.1) % 1);
        // Atraviesa de x=-8 a x=8
        const x = -8 + cycle * 16;
        // Pequeño rebote al rodar
        const y = tw.size + Math.abs(Math.sin(ct * tw.speed * 1.5)) * 0.08;
        c.position.set(x, y, tw.zOff);
        // Rota mientras rueda
        c.rotation.x = ct * tw.speed * 1.8;
        c.rotation.z = ct * tw.speed * 0.4;
      });
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Niebla naranja sobre la parcela */}
      <mesh ref={fogRef} position={[0, 3.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial
          color="#d18a3c"
          transparent
          opacity={0.32}
          side={THREE.DoubleSide}
          depthWrite={false}
          emissive="#a8551a"
          emissiveIntensity={0.15}
        />
      </mesh>
      {/* Segunda capa más alta y difusa */}
      <mesh position={[0, 5.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[22, 22]} />
        <meshStandardMaterial color="#e8a05a" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Sol rojizo en lo alto, tras la calima */}
      <mesh ref={sunRef} position={[6, 8, -4]}>
        <sphereGeometry args={[1.1, 24, 16]} />
        <meshStandardMaterial color="#ff9533" emissive="#ff5a18" emissiveIntensity={0.85} transparent opacity={0.9} />
      </mesh>

      {/* Cactus saguaro */}
      {cacti.map((c, i) => (
        <group key={`cct-${i}`} position={[c.x, 0, c.z]} rotation={[0, c.rot, 0]}>
          {/* Tronco principal con surcos sugeridos vía geometría cilíndrica */}
          <mesh position={[0, c.h / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.22, 0.28, c.h, 12, 1]} />
            <meshStandardMaterial color="#3a6e2c" roughness={0.85} />
          </mesh>
          {/* Cúpula superior */}
          <mesh position={[0, c.h, 0]} castShadow>
            <sphereGeometry args={[0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#3a6e2c" roughness={0.85} />
          </mesh>
          {/* Líneas de surcos (toroides finos) — opcional, dan textura */}
          {[0.25, 0.55, 0.85].map((p, k) => (
            <mesh key={k} position={[0, c.h * p, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.24, 0.012, 4, 14]} />
              <meshStandardMaterial color="#284e1e" roughness={0.9} />
            </mesh>
          ))}
          {/* Brazos del saguaro */}
          {c.arms.map((arm, j) => (
            <group key={j} position={[arm.side * 0.22, arm.y, 0]}>
              {/* Brazo horizontal */}
              <mesh position={[arm.side * arm.len * 0.5, 0, 0]} rotation={[0, 0, -arm.side * Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.13, 0.15, arm.len, 10]} />
                <meshStandardMaterial color="#3a6e2c" roughness={0.85} />
              </mesh>
              {/* Brazo vertical (parte que sube) */}
              <mesh position={[arm.side * arm.len, arm.len * 0.4, 0]} castShadow>
                <cylinderGeometry args={[0.13, 0.13, arm.len * 0.8, 10]} />
                <meshStandardMaterial color="#3a6e2c" roughness={0.85} />
              </mesh>
              {/* Punta del brazo */}
              <mesh position={[arm.side * arm.len, arm.len * 0.8 + 0.05, 0]}>
                <sphereGeometry args={[0.13, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color="#3a6e2c" roughness={0.85} />
              </mesh>
            </group>
          ))}
        </group>
      ))}

      {/* Tumbleweeds — esferas trenzadas que ruedan */}
      <group ref={tumbleRef}>
        {tumbleweeds.map((tw, i) => (
          <group key={`tw-${i}`} position={[-8, tw.size, tw.zOff]}>
            {/* Cuerpo esférico irregular (composición de 3 esferas) */}
            <mesh castShadow>
              <icosahedronGeometry args={[tw.size, 1]} />
              <meshStandardMaterial color="#7a5230" roughness={0.95} flatShading />
            </mesh>
            <mesh scale={0.78} rotation={[0.4, 0.7, 0.2]}>
              <icosahedronGeometry args={[tw.size, 1]} />
              <meshStandardMaterial color="#8a6238" roughness={0.95} flatShading transparent opacity={0.85} />
            </mesh>
            <mesh scale={0.55} rotation={[0.7, -0.4, 0.5]}>
              <icosahedronGeometry args={[tw.size, 1]} />
              <meshStandardMaterial color="#634520" roughness={0.95} flatShading transparent opacity={0.8} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Polvo volando horizontalmente */}
      <group ref={dustRef}>
        {dust.map((d, i) => (
          <mesh key={i} position={[0, d.yBase, d.zBase]} scale={d.size}>
            <sphereGeometry args={[1, 6, 5]} />
            <meshStandardMaterial color="#c9883e" emissive="#a85e15" emissiveIntensity={0.15} transparent opacity={0.55} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </>
  );
};

// ============================================================
// Sequía — grietas profundas en el suelo, suelo cuarteado, sol abrasador
// con halo, ondas de calor (heat shimmer) y polvo amarillento subiendo.
// ============================================================

const Drought: React.FC<{ active: boolean }> = ({ active }) => {
  const sunRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const shimmerRef = useRef<THREE.Group>(null);
  const dustRef = useRef<THREE.Group>(null);

  // Grietas en el suelo — segmentos rectos distribuidos por la parcela
  const cracks = useMemo(() => {
    const rng = makeRng(60101);
    const list: Array<{ x: number; z: number; angle: number; length: number; segs: number; thickness: number }> = [];
    const N = 18;
    for (let i = 0; i < N; i++) {
      list.push({
        x: (rng() - 0.5) * 8,
        z: (rng() - 0.5) * 8,
        angle: rng() * Math.PI,
        length: 1.8 + rng() * 2.5,
        segs: 5 + Math.floor(rng() * 4),
        thickness: 0.05 + rng() * 0.06
      });
    }
    return list;
  }, []);

  // Heat shimmer — capas semi-transparentes que ondulan
  const shimmerLayers = useMemo(() => {
    const rng = makeRng(60102);
    return Array.from({ length: 7 }).map(() => ({
      y: 0.3 + rng() * 1.6,
      phase: rng() * Math.PI * 2,
      speed: 0.6 + rng() * 0.8
    }));
  }, []);

  // Polvo subiendo del suelo (corrientes calientes)
  const dustParticles = useMemo(() => {
    const rng = makeRng(60103);
    return Array.from({ length: 45 }).map(() => ({
      x: (rng() - 0.5) * 9,
      z: (rng() - 0.5) * 9,
      yMax: 1.5 + rng() * 2,
      delay: rng() * 2,
      speed: 0.3 + rng() * 0.35,
      size: 0.06 + rng() * 0.08
    }));
  }, []);

  useFrame((state) => {
    if (!active) return;
    const ct = state.clock.elapsedTime;

    // Sol pulsando + halo girando
    if (sunRef.current) {
      const pulse = 1 + Math.sin(ct * 1.2) * 0.05;
      sunRef.current.scale.setScalar(pulse);
    }
    if (haloRef.current) {
      haloRef.current.rotation.z = ct * 0.25;
      const pulse = 1 + Math.sin(ct * 1.0) * 0.08;
      haloRef.current.scale.set(pulse, pulse, 1);
    }

    // Shimmer ondula horizontalmente
    if (shimmerRef.current) {
      shimmerRef.current.children.forEach((c, i) => {
        const s = shimmerLayers[i]; if (!s) return;
        c.position.x = Math.sin(ct * s.speed + s.phase) * 0.18;
        c.position.z = Math.cos(ct * s.speed * 0.8 + s.phase) * 0.18;
      });
    }

    // Polvo subiendo
    if (dustRef.current) {
      dustRef.current.children.forEach((c, i) => {
        const d = dustParticles[i]; if (!d) return;
        const phase = (((ct + d.delay) * d.speed) % 1);
        c.position.y = 0.15 + phase * d.yMax;
        const scale = 1 + phase * 0.8;
        c.scale.setScalar(scale);
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - phase) * 0.5;
      });
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Tinte de calor amarillento sobre la parcela */}
      <mesh position={[0, 4.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#e8c25a" transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Sol con halo */}
      <mesh ref={haloRef} position={[5.5, 8, -3]}>
        <ringGeometry args={[1.5, 2.4, 32]} />
        <meshBasicMaterial color="#ffcc55" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={sunRef} position={[5.5, 8, -3]}>
        <sphereGeometry args={[1.3, 24, 18]} />
        <meshStandardMaterial color="#ffe88a" emissive="#ffb028" emissiveIntensity={1.0} />
      </mesh>

      {/* Grietas en el suelo (líneas oscuras hechas con cajas alargadas) */}
      {cracks.map((c, i) => {
        const segLen = c.length / c.segs;
        return (
          <group key={`cr-${i}`} position={[c.x, 0.04, c.z]} rotation={[0, c.angle, 0]}>
            {Array.from({ length: c.segs }).map((_, k) => {
              const offset = (k - c.segs / 2 + 0.5) * segLen;
              const jitter = ((k * 0.37) % 1 - 0.5) * 0.18;
              return (
                <mesh key={k} position={[offset, 0, jitter]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[segLen * 0.92, c.thickness]} />
                  <meshStandardMaterial color="#1f1208" roughness={1} side={THREE.DoubleSide} />
                </mesh>
              );
            })}
            {/* Sombra/profundidad: una segunda capa más oscura más estrecha */}
            <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[c.length * 0.7, c.thickness * 0.5]} />
              <meshStandardMaterial color="#000000" roughness={1} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}

      {/* Capa de suelo cuarteado (textura sugerida con manchas amarillentas) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#a47030" transparent opacity={0.45} roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {/* Heat shimmer — capas ondulantes encima del suelo */}
      <group ref={shimmerRef}>
        {shimmerLayers.map((l, i) => (
          <mesh key={i} position={[0, l.y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[11, 11]} />
            <meshStandardMaterial color="#ffe7a8" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* Polvo caliente subiendo */}
      <group ref={dustRef}>
        {dustParticles.map((d, i) => (
          <mesh key={i} position={[d.x, 0.15, d.z]} scale={d.size}>
            <sphereGeometry args={[1, 6, 5]} />
            <meshStandardMaterial color="#c9a548" emissive="#a87a25" emissiveIntensity={0.18} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </>
  );
};

// ============================================================
// Niebla densa — bruma volumétrica baja
// ============================================================

const FogVolume: React.FC<{ active: boolean }> = ({ active }) => {
  const layersRef = useRef<THREE.Group>(null);
  const layers = useMemo(() => {
    const rng = makeRng(99001);
    return Array.from({ length: 10 }).map((_, i) => ({
      y: 0.5 + i * 0.4 + rng() * 0.2,
      driftPhase: rng() * Math.PI * 2,
      driftSpeed: 0.1 + rng() * 0.15,
      size: 12 + rng() * 4
    }));
  }, []);

  useFrame((state) => {
    if (!active || !layersRef.current) return;
    layersRef.current.children.forEach((c, i) => {
      const l = layers[i]; if (!l) return;
      c.position.x = Math.sin(state.clock.elapsedTime * l.driftSpeed + l.driftPhase) * 1.5;
      c.position.z = Math.cos(state.clock.elapsedTime * l.driftSpeed * 0.7 + l.driftPhase) * 1.2;
    });
  });

  if (!active) return null;
  return (
    <group ref={layersRef}>
      {layers.map((l, i) => (
        <mesh key={i} position={[0, l.y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[l.size, l.size]} />
          <meshStandardMaterial color="#e8edef" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
};

// ============================================================
// Lluvia torrencial — cortinas + encharcamiento
// ============================================================

const HeavyRain: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 4 }) => {
  const dropsRef = useRef<THREE.Group>(null);
  const puddleRef = useRef<THREE.Mesh>(null);
  const cloudsRef = useRef<THREE.Group>(null);
  const getElapsed = useEffectClock(active);

  // === 6 nubes 3D: cada una es un cluster de esferas (puffs) con base más
  // oscura. Distribuidas en un patrón vagamente circular sobre la parcela. ===
  const CLOUD_Y = 6.5;
  const clouds = useMemo(() => {
    const rng = makeRng(11102);
    const N = 6;
    return Array.from({ length: N }).map((_, i) => {
      // Alterna nubes cerca del centro con nubes en anillo exterior
      const inner = i % 2 === 0;
      const ang = (i / N) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const r = inner ? 0.3 + rng() * 1.8 : 3.0 + rng() * 1.8;
      const cx = Math.cos(ang) * r;
      const cz = Math.sin(ang) * r;
      const cy = CLOUD_Y + (rng() - 0.5) * 0.9;
      const numPuffs = 6 + Math.floor(rng() * 4);
      const puffs = Array.from({ length: numPuffs }).map(() => {
        const a = rng() * Math.PI * 2;
        const d = rng() * 1.0;
        return {
          x: Math.cos(a) * d,
          y: (rng() - 0.5) * 0.32,
          z: Math.sin(a) * d * 0.75,
          size: 0.85 + rng() * 0.6
        };
      });
      return {
        cx, cz, cy,
        driftPhase: rng() * Math.PI * 2,
        driftSpeed: 0.12 + rng() * 0.18,
        driftAmpX: 0.3 + rng() * 0.5,
        driftAmpZ: 0.2 + rng() * 0.35,
        puffs
      };
    });
  }, []);

  // === 180 gotas, repartidas entre las nubes (~30 por nube) ===
  // Cada gota cae desde la POSICIÓN ACTUAL de su nube + offset aleatorio.
  const drops = useMemo(() => {
    const rng = makeRng(11101);
    const N = 180;
    return Array.from({ length: N }).map((_, i) => ({
      cloudIdx: i % 6,
      offsetX: (rng() - 0.5) * 1.9,
      offsetZ: (rng() - 0.5) * 1.6,
      speed: 1.5 + rng() * 0.9,
      phase: rng(),
      length: 0.4 + rng() * 0.5
    }));
  }, []);

  // Buffer reusable de posiciones actuales por nube — evita allocs en useFrame.
  const cloudWorldXZ = useRef<Float32Array>(new Float32Array(clouds.length * 2));

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;
    const ct = state.clock.elapsedTime;

    // Calcular y aplicar drift de cada nube. Guardamos sus posiciones XZ en el
    // buffer para que las gotas las usen sin recalcular.
    if (cloudsRef.current) {
      cloudsRef.current.children.forEach((g, i) => {
        const c = clouds[i]; if (!c) return;
        const dx = Math.sin(ct * c.driftSpeed + c.driftPhase) * c.driftAmpX;
        const dz = Math.cos(ct * c.driftSpeed * 0.7 + c.driftPhase) * c.driftAmpZ;
        const x = c.cx + dx;
        const z = c.cz + dz;
        g.position.set(x, c.cy, z);
        cloudWorldXZ.current[i * 2] = x;
        cloudWorldXZ.current[i * 2 + 1] = z;
      });
    } else {
      // Si la ref no está lista, usamos posiciones base
      clouds.forEach((c, i) => {
        cloudWorldXZ.current[i * 2] = c.cx;
        cloudWorldXZ.current[i * 2 + 1] = c.cz;
      });
    }

    // Gotas: cada una cae desde la posición actual de su nube
    if (dropsRef.current) {
      dropsRef.current.children.forEach((mesh, i) => {
        const d = drops[i]; if (!d) return;
        const c = clouds[d.cloudIdx]; if (!c) return;
        const cx = cloudWorldXZ.current[d.cloudIdx * 2];
        const cz = cloudWorldXZ.current[d.cloudIdx * 2 + 1];
        const yStart = c.cy - 0.45;          // base de la nube
        const phase = ((ct * d.speed + d.phase) % 1);
        const y = yStart - phase * yStart;   // cae de yStart → 0
        mesh.position.set(cx + d.offsetX, y, cz + d.offsetZ);
      });
    }

    // Charco que crece poco a poco
    if (puddleRef.current) {
      const p = Math.min(t / durationSec, 1);
      const mat = puddleRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = p * 0.7;
      puddleRef.current.scale.setScalar(0.5 + p * 0.5);
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Cielo más oscuro */}
      <mesh position={[0, 9, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshBasicMaterial color="#4a5560" transparent opacity={0.4} />
      </mesh>

      {/* NUBES — clusters de esferas con base más oscura */}
      <group ref={cloudsRef}>
        {clouds.map((c, i) => (
          <group key={i} position={[c.cx, c.cy, c.cz]}>
            {/* Puffs principales (gris medio claro) */}
            {c.puffs.map((p, j) => (
              <mesh key={j} position={[p.x, p.y, p.z]} scale={p.size} castShadow>
                <sphereGeometry args={[1, 12, 10]} />
                <meshStandardMaterial
                  color="#6a747f"
                  roughness={0.95}
                  transparent
                  opacity={0.92}
                />
              </mesh>
            ))}
            {/* Base aplastada y más oscura (sombra natural bajo la nube) */}
            <mesh position={[0, -0.32, 0]} scale={[1.4, 0.45, 1.05]}>
              <sphereGeometry args={[1, 12, 8]} />
              <meshStandardMaterial
                color="#3a4250"
                roughness={1}
                transparent
                opacity={0.88}
              />
            </mesh>
          </group>
        ))}
      </group>

      {/* Gotas alargadas */}
      <group ref={dropsRef}>
        {drops.map((d, i) => (
          <mesh key={i} position={[0, 0, 0]} scale={[0.025, d.length, 0.025]}>
            <cylinderGeometry args={[1, 1, 1, 4]} />
            <meshStandardMaterial color="#7fbedf" transparent opacity={0.8} />
          </mesh>
        ))}
      </group>

      {/* Encharcamiento en el suelo */}
      <mesh ref={puddleRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} scale={0.5}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#2a4a6a" transparent opacity={0} roughness={0.1} metalness={0.7} />
      </mesh>
    </>
  );
};

// ============================================================
// OVNI + Radiación UV — un platillo entra desde la izquierda,
// sobrevuela la parcela y dispara un haz UV verdoso/violeta sobre
// el cultivo, con anillos pulsantes en el suelo. Tras una pausa,
// sale por la derecha.
// ============================================================

const UFORadiation: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 7 }) => {
  const ufoRef = useRef<THREE.Group>(null);
  const discRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const beamGlowRef = useRef<THREE.Mesh>(null);
  const ringsRef = useRef<THREE.Group>(null);
  const motesRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const getElapsed = useEffectClock(active);

  const portholes = useMemo(() => {
    return Array.from({ length: 8 }).map((_, i) => {
      const ang = (i / 8) * Math.PI * 2;
      return { x: Math.cos(ang) * 1.05, z: Math.sin(ang) * 1.05 };
    });
  }, []);

  // Pequeños iconitos UV (rayos) que caen por el haz hacia el suelo
  const motes = useMemo(() => {
    const rng = makeRng(123001);
    return Array.from({ length: 22 }).map(() => ({
      x: (rng() - 0.5) * 1.1,
      z: (rng() - 0.5) * 1.1,
      yPhase: rng(),
      speed: 0.7 + rng() * 0.8,
      size: 0.05 + rng() * 0.08
    }));
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;

    // El OVNI entra UNA vez desde la izquierda y se queda estacionado de forma
    // indefinida hasta que el jugador lo derribe con el cañón. La coreografía
    // del haz va en su propio ciclo, independiente de la entrada.
    const entryDuration = Math.min(1.6, durationSec * 0.25);
    let x: number;
    if (t < entryDuration) {
      const k = t / entryDuration;
      x = -9 + k * 9;
    } else {
      // Bamboleo lento mientras está parado
      x = 0 + Math.sin(state.clock.elapsedTime * 0.6) * 0.35;
    }
    const y = 5.5 + Math.sin(state.clock.elapsedTime * 1.6) * 0.18;

    if (ufoRef.current) {
      ufoRef.current.position.set(x, y, 0);
      ufoRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.2) * 0.07;
    }
    if (discRef.current) {
      discRef.current.rotation.y = state.clock.elapsedTime * 2.5;
    }

    // Haz UV: pulsa cada ~4 s mientras el OVNI esté parado.
    //   on  [0.15 → 0.65]: disparo (crece y se cierra)
    //   off [0.65 → 1.15]: descansa medio segundo y vuelve a empezar
    let beamScale = 0;
    if (t >= entryDuration) {
      const beamCycle = 4.0;
      const phase = ((t - entryDuration) / beamCycle) % 1;
      if (phase > 0.15 && phase < 0.65) {
        const progress = (phase - 0.15) / 0.5;
        beamScale = Math.sin(progress * Math.PI);
      }
    }
    const beamActive = beamScale > 0;

    if (beamRef.current) {
      const mat = beamRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = beamScale * 0.7;
      beamRef.current.position.x = x;
      beamRef.current.scale.x = beamScale;
      beamRef.current.scale.z = beamScale;
    }
    if (beamGlowRef.current) {
      const mat = beamGlowRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = beamScale * 0.25;
      beamGlowRef.current.position.x = x;
      beamGlowRef.current.scale.x = beamScale * 1.6;
      beamGlowRef.current.scale.z = beamScale * 1.6;
    }
    if (lightRef.current) {
      lightRef.current.position.set(x, 0.5, 0);
      lightRef.current.intensity = beamScale * 2.5;
    }

    // Anillos pulsantes en el suelo (sólo mientras dispara)
    if (ringsRef.current) {
      ringsRef.current.position.x = x;
      ringsRef.current.visible = beamActive;
      ringsRef.current.children.forEach((c, i) => {
        const localPhase = (state.clock.elapsedTime * 0.8 + i * 0.33) % 1;
        c.scale.setScalar(0.4 + localPhase * 3);
        const mat = ((c as THREE.Mesh).material) as THREE.MeshBasicMaterial;
        mat.opacity = beamScale * (1 - localPhase) * 0.6;
      });
    }

    // Partículas dentro del haz
    if (motesRef.current) {
      motesRef.current.children.forEach((c, idx) => {
        const m = motes[idx]; if (!m) return;
        const phase = ((state.clock.elapsedTime * m.speed + m.yPhase) % 1);
        c.position.x = x + m.x;
        c.position.z = m.z;
        c.position.y = 5 - phase * 5;
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = beamScale * (1 - phase) * 0.9;
      });
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Platillo: cuerpo + cúpula + ojos de buey + halo inferior */}
      <group ref={ufoRef} position={[-9, 5.5, 0]}>
        {/* Disco principal */}
        <mesh ref={discRef} castShadow>
          <cylinderGeometry args={[1.4, 1.0, 0.32, 24]} />
          <meshStandardMaterial color="#9aa6b0" metalness={0.85} roughness={0.25} />
        </mesh>
        {/* Banda inferior brillante */}
        <mesh position={[0, -0.18, 0]}>
          <cylinderGeometry args={[1.0, 0.85, 0.12, 24]} />
          <meshStandardMaterial color="#1a1f24" metalness={0.7} roughness={0.3} />
        </mesh>
        {/* Cúpula superior tipo cristal verde */}
        <mesh position={[0, 0.28, 0]}>
          <sphereGeometry args={[0.7, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color="#5fffb5"
            emissive="#5fffb5"
            emissiveIntensity={0.35}
            transparent
            opacity={0.65}
            metalness={0.2}
            roughness={0.1}
          />
        </mesh>
        {/* Ojos de buey luminosos */}
        {portholes.map((p, i) => (
          <mesh key={i} position={[p.x, -0.05, p.z]} scale={0.15}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshStandardMaterial color="#caffd6" emissive="#9bff8a" emissiveIntensity={1.4} />
          </mesh>
        ))}
        {/* Anillo brillante alrededor del platillo */}
        <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.45, 1.6, 32]} />
          <meshBasicMaterial color="#a6ff9b" transparent opacity={0.55} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Haz UV (cono ancho y suave) */}
      <mesh ref={beamRef} position={[-9, 0, 0]} rotation={[Math.PI, 0, 0]} scale={0}>
        <coneGeometry args={[1.6, 5.2, 24, 1, true]} />
        <meshStandardMaterial
          color="#9bff8a"
          emissive="#9bff8a"
          emissiveIntensity={1.0}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Halo exterior del haz, más ancho y menos opaco */}
      <mesh ref={beamGlowRef} position={[-9, 0, 0]} rotation={[Math.PI, 0, 0]} scale={0}>
        <coneGeometry args={[2.4, 5.2, 24, 1, true]} />
        <meshStandardMaterial
          color="#caffb8"
          emissive="#caffb8"
          emissiveIntensity={0.6}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Partículas dentro del haz */}
      <group ref={motesRef}>
        {motes.map((m, i) => (
          <mesh key={i} position={[0, 5, 0]} scale={m.size}>
            <sphereGeometry args={[1, 6, 4]} />
            <meshStandardMaterial
              color="#daffb8"
              emissive="#9bff8a"
              emissiveIntensity={1.4}
              transparent
              opacity={0}
            />
          </mesh>
        ))}
      </group>

      {/* Anillos pulsantes en el suelo */}
      <group ref={ringsRef} position={[-9, 0.05, 0]}>
        {Array.from({ length: 3 }).map((_, i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.9, 1.0, 32]} />
            <meshBasicMaterial color="#9bff8a" transparent opacity={0} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>

      {/* Luz verdosa que ilumina la parcela durante el disparo */}
      <pointLight ref={lightRef} position={[0, 0.5, 0]} color="#9bff8a" distance={10} decay={2} intensity={0} />
    </>
  );
};

// ============================================================
// DERRIBAR OVNI 🎯 — coreografía irreal en ~7 s:
//   t=0.0 → 1.2   OVNI entra desde la izquierda; un cañón anti-aéreo
//                emerge del suelo (sale desde y=-2 hasta y=0).
//   t=1.2 → 2.0  Cañón apunta al OVNI; la boca del cañón se carga con
//                un glow cian creciente.
//   t=2.0 → 2.5  ¡DISPARO! Muzzle flash + proyectil glowing hacia el OVNI,
//                con su propia estela de partículas.
//   t=2.5 → 2.65 Impacto: flash blanco, fireball naranja, onda de choque
//                (anillo) y esquirlas saliendo en todas direcciones.
//   t=2.65 → 4.5 El OVNI cae girando, envuelto en fuego y dejando estela.
//   t=4.5 → 4.7  Impacto en el suelo: explosión secundaria + cráter +
//                onda de choque + escombros volando.
//   t=4.7 → 7.0  Columna de humo elevándose. Restos echando humo en suelo.
// ============================================================

const UFOShootDown: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 7 }) => {
  const ufoRef = useRef<THREE.Group>(null);
  const ufoBodyRef = useRef<THREE.Group>(null);   // sub-grupo para el spin de la caída
  const cannonGroupRef = useRef<THREE.Group>(null);
  const cannonHeadRef = useRef<THREE.Group>(null);
  const muzzleGlowRef = useRef<THREE.Mesh>(null);
  const muzzleFlashRef = useRef<THREE.Mesh>(null);
  const projectileRef = useRef<THREE.Group>(null);
  const projectileTrailRef = useRef<THREE.Group>(null);
  const impactFlashRef = useRef<THREE.Mesh>(null);
  const impactFireballRef = useRef<THREE.Mesh>(null);
  const impactShockRef = useRef<THREE.Mesh>(null);
  const shrapnelRef = useRef<THREE.Group>(null);
  const fireTrailRef = useRef<THREE.Group>(null);
  const ufoFireRef = useRef<THREE.Mesh>(null);
  const groundFlashRef = useRef<THREE.Mesh>(null);
  const groundFireRef = useRef<THREE.Mesh>(null);
  const groundShockRef = useRef<THREE.Mesh>(null);
  const groundShock2Ref = useRef<THREE.Mesh>(null);
  const debrisRef = useRef<THREE.Group>(null);
  const smokeColumnRef = useRef<THREE.Group>(null);
  const craterRef = useRef<THREE.Mesh>(null);
  const muzzleLightRef = useRef<THREE.PointLight>(null);
  const explosionLightRef = useRef<THREE.PointLight>(null);
  const fireLightRef = useRef<THREE.PointLight>(null);
  const getElapsed = useEffectClock(active);

  // === Posiciones clave ===
  const PARK_X = 0, PARK_Y = 5.5;
  const CANNON_BASE_X = 0, CANNON_BASE_Z = -3;
  // Punto de impacto en el suelo (dentro de la parcela, ligeramente desplazado).
  const CRASH_X = 1.5, CRASH_Z = 1.0;

  // === Datos aleatorios pre-calculados (estables entre renders) ===
  const shrapnel = useMemo(() => {
    const rng = makeRng(770001);
    return Array.from({ length: 28 }).map(() => ({
      vx: (rng() - 0.5) * 8,
      vy: 2 + rng() * 4,
      vz: (rng() - 0.5) * 8,
      size: 0.05 + rng() * 0.13,
      spin: (rng() - 0.5) * 12
    }));
  }, []);
  const debris = useMemo(() => {
    const rng = makeRng(770002);
    return Array.from({ length: 22 }).map(() => ({
      vx: (rng() - 0.5) * 6,
      vy: 1.5 + rng() * 3.5,
      vz: (rng() - 0.5) * 6,
      size: 0.07 + rng() * 0.2,
      spin: (rng() - 0.5) * 10
    }));
  }, []);
  const smokeColumn = useMemo(() => {
    const rng = makeRng(770003);
    return Array.from({ length: 22 }).map(() => ({
      x: (rng() - 0.5) * 0.7,
      z: (rng() - 0.5) * 0.7,
      rise: 0.6 + rng() * 1.6,
      delay: rng() * 1.2,
      size: 0.4 + rng() * 0.7
    }));
  }, []);
  const fireTrail = useMemo(() => {
    const rng = makeRng(770004);
    return Array.from({ length: 16 }).map((_, i) => ({
      lag: i * 0.045,
      jitter: (rng() - 0.5) * 0.25,
      jitterZ: (rng() - 0.5) * 0.25,
      size: 0.22 + rng() * 0.12
    }));
  }, []);
  const projectileTrail = useMemo(() => {
    return Array.from({ length: 8 }).map((_, i) => ({
      lag: i * 0.025,
      size: 0.14 - i * 0.012
    }));
  }, []);
  // Ojos de buey del OVNI (mismos que UFORadiation)
  const portholes = useMemo(() => {
    return Array.from({ length: 8 }).map((_, i) => {
      const ang = (i / 8) * Math.PI * 2;
      return { x: Math.cos(ang) * 1.05, z: Math.sin(ang) * 1.05 };
    });
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;

    // El OVNI YA está parado cuando arranca esta coreografía (venimos de
    // UFORadiation, que lo tenía sobrevolando la parcela). Por eso no hay fase
    // de entrada: el cañón emerge bajo el OVNI ya estacionado.
    const T_AIM = 1.5, T_FIRE = 2.5, T_IMPACT = 2.65, T_CRASH = 4.5, T_GROUND = 4.7;

    // === POSICIÓN del OVNI ===
    let ufoX: number, ufoY: number, ufoZ: number;
    let ufoYaw = 0, ufoTiltZ = 0, ufoTiltX = 0;

    if (t < T_IMPACT) {
      // Sobrevuelo idéntico al de UFORadiation para que la transición sea sin saltos
      ufoX = PARK_X + Math.sin(state.clock.elapsedTime * 1.6) * 0.2;
      ufoY = PARK_Y + Math.sin(state.clock.elapsedTime * 1.6) * 0.18;
      ufoZ = 0;
    } else if (t < T_CRASH) {
      // Caída en arco cuadrático con drift horizontal hacia CRASH_X / CRASH_Z
      const k = Math.min(1, (t - T_IMPACT) / (T_CRASH - T_IMPACT));
      ufoX = PARK_X + (CRASH_X - PARK_X) * k;
      ufoY = PARK_Y + (0.2 - PARK_Y) * (k * k);
      ufoZ = 0 + CRASH_Z * k;
      ufoTiltZ = 0.4 + k * 1.4;
      ufoTiltX = 0.3 + k * 0.9;
      ufoYaw = (t - T_IMPACT) * 14;
    } else {
      // Tumbado en el cráter, asentándose
      const k = Math.min(1, (t - T_CRASH) / 0.4);
      ufoX = CRASH_X;
      ufoY = 0.2 - k * 0.1;
      ufoZ = CRASH_Z;
      ufoTiltZ = 1.6;
      ufoTiltX = 1.1;
      ufoYaw = (T_CRASH - T_IMPACT) * 14;
    }

    if (ufoRef.current) {
      ufoRef.current.position.set(ufoX, ufoY, ufoZ);
    }
    if (ufoBodyRef.current) {
      ufoBodyRef.current.rotation.set(ufoTiltX, ufoYaw, ufoTiltZ);
    }

    // === CAÑÓN ===
    // Sube desde y=-2 hasta y=0 en el primer segundo
    const cannonY = t < 1.0 ? -2 + t * 2 : 0;
    if (cannonGroupRef.current) {
      cannonGroupRef.current.position.y = cannonY;
    }

    // Cabezal apunta al OVNI. Barrel local en +Z; rot.y=yaw, rot.x=-pitch.
    if (cannonHeadRef.current) {
      const dx = ufoX - CANNON_BASE_X;
      const dy = ufoY - (cannonY + 0.5);
      const dz = ufoZ - CANNON_BASE_Z;
      const horiz = Math.sqrt(dx * dx + dz * dz);
      const yaw = Math.atan2(dx, dz);
      const pitch = Math.atan2(dy, horiz);
      cannonHeadRef.current.rotation.x = -pitch;
      cannonHeadRef.current.rotation.y = yaw;
    }

    // Glow de carga en la boca del cañón
    if (muzzleGlowRef.current) {
      const mat = muzzleGlowRef.current.material as THREE.MeshStandardMaterial;
      const charge = t >= T_AIM && t < T_FIRE ? (t - T_AIM) / (T_FIRE - T_AIM) : 0;
      mat.emissiveIntensity = 0.3 + charge * 4;
      const pulse = 1 + Math.sin(t * 28) * 0.15 * charge;
      muzzleGlowRef.current.scale.setScalar((0.5 + charge * 0.9) * pulse);
    }

    // Muzzle flash justo al disparar
    if (muzzleFlashRef.current) {
      const mat = muzzleFlashRef.current.material as THREE.MeshStandardMaterial;
      const fireT = t - T_FIRE;
      const flash = fireT >= 0 && fireT < 0.18 ? 1 - fireT / 0.18 : 0;
      mat.opacity = flash;
      muzzleFlashRef.current.scale.setScalar(0.3 + flash * 2.2);
    }
    if (muzzleLightRef.current) {
      const fireT = t - T_FIRE;
      const flash = fireT >= 0 && fireT < 0.25 ? 1 - fireT / 0.25 : 0;
      muzzleLightRef.current.position.set(CANNON_BASE_X, cannonY + 1.0, CANNON_BASE_Z);
      muzzleLightRef.current.intensity = flash * 6;
    }

    // Proyectil: desde el cañón al OVNI durante T_FIRE → T_IMPACT
    const SRC_X = CANNON_BASE_X, SRC_Y = cannonY + 1.0, SRC_Z = CANNON_BASE_Z;
    if (projectileRef.current) {
      const visible = t >= T_FIRE && t < T_IMPACT;
      projectileRef.current.visible = visible;
      if (visible) {
        const k = (t - T_FIRE) / (T_IMPACT - T_FIRE);
        projectileRef.current.position.set(
          SRC_X + (ufoX - SRC_X) * k,
          SRC_Y + (ufoY - SRC_Y) * k,
          SRC_Z + (ufoZ - SRC_Z) * k
        );
        projectileRef.current.rotation.z = state.clock.elapsedTime * 30;
      }
    }
    if (projectileTrailRef.current) {
      const visible = t >= T_FIRE && t < T_IMPACT + 0.15;
      projectileTrailRef.current.visible = visible;
      projectileTrailRef.current.children.forEach((c, idx) => {
        const tr = projectileTrail[idx]; if (!tr) return;
        const k = Math.min(1, Math.max(0, (t - T_FIRE - tr.lag) / (T_IMPACT - T_FIRE)));
        c.position.set(
          SRC_X + (ufoX - SRC_X) * k,
          SRC_Y + (ufoY - SRC_Y) * k,
          SRC_Z + (ufoZ - SRC_Z) * k
        );
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = visible ? Math.max(0, 0.9 - idx * 0.1) : 0;
      });
    }

    // === EXPLOSIÓN EN EL OVNI ===
    const setExplosion = (
      ref: React.RefObject<THREE.Mesh | null>,
      lifespan: number,
      startScale: number,
      endScale: number,
      maxOpacity: number
    ) => {
      if (!ref.current) return;
      const ht = t - T_IMPACT;
      const mat = ref.current.material as THREE.MeshStandardMaterial;
      if (ht >= 0 && ht < lifespan) {
        ref.current.position.set(ufoX, ufoY, ufoZ);
        const k = ht / lifespan;
        ref.current.scale.setScalar(startScale + (endScale - startScale) * k);
        mat.opacity = (1 - k) * maxOpacity;
      } else {
        mat.opacity = 0;
      }
    };
    setExplosion(impactFlashRef, 0.3, 0.5, 7, 1.0);
    setExplosion(impactFireballRef, 0.7, 1.0, 4.5, 0.9);
    if (impactShockRef.current) {
      const ht = t - T_IMPACT;
      const mat = impactShockRef.current.material as THREE.MeshBasicMaterial;
      if (ht >= 0 && ht < 0.9) {
        impactShockRef.current.position.set(ufoX, ufoY, ufoZ);
        const k = ht / 0.9;
        impactShockRef.current.scale.setScalar(0.4 + k * 12);
        mat.opacity = (1 - k) * 0.75;
      } else {
        mat.opacity = 0;
      }
    }
    if (shrapnelRef.current) {
      const ht = t - T_IMPACT;
      const visible = ht >= 0 && ht < 1.6;
      shrapnelRef.current.visible = visible;
      shrapnelRef.current.position.set(ufoX, ufoY, ufoZ);
      shrapnelRef.current.children.forEach((c, idx) => {
        const s = shrapnel[idx]; if (!s) return;
        c.position.set(
          s.vx * ht,
          s.vy * ht - 0.5 * 9.8 * ht * ht * 0.3,
          s.vz * ht
        );
        c.rotation.y = ht * s.spin;
        c.rotation.x = ht * s.spin * 0.7;
        const mat = ((c as THREE.Mesh).material) as THREE.MeshStandardMaterial;
        mat.opacity = Math.max(0, 1 - ht / 1.6);
      });
    }
    if (explosionLightRef.current) {
      const ht = t - T_IMPACT;
      const visible = ht >= 0 && ht < 0.8;
      explosionLightRef.current.position.set(ufoX, ufoY, ufoZ);
      explosionLightRef.current.intensity = visible ? Math.max(0, 1 - ht / 0.8) * 18 : 0;
    }

    // === FUEGO DURANTE LA CAÍDA ===
    const isFalling = t >= T_IMPACT && t < T_CRASH;
    if (ufoFireRef.current) {
      ufoFireRef.current.visible = isFalling;
      if (isFalling) {
        ufoFireRef.current.position.set(ufoX, ufoY - 0.3, ufoZ);
        const flicker = 0.7 + Math.sin(state.clock.elapsedTime * 25) * 0.3;
        ufoFireRef.current.scale.setScalar(0.9 + flicker * 0.5);
      }
    }
    if (fireTrailRef.current) {
      const visible = isFalling;
      fireTrailRef.current.visible = visible || (t >= T_CRASH && t < T_CRASH + 0.4);
      fireTrailRef.current.children.forEach((c, idx) => {
        const ft = fireTrail[idx]; if (!ft) return;
        const tLag = Math.max(0, Math.min(T_CRASH - T_IMPACT, t - T_IMPACT - ft.lag));
        const k = tLag / (T_CRASH - T_IMPACT);
        const tx = PARK_X + (CRASH_X - PARK_X) * k;
        const ty = PARK_Y + (0.2 - PARK_Y) * (k * k);
        const tz = 0 + CRASH_Z * k;
        c.position.set(tx + ft.jitter, ty + 0.2, tz + ft.jitterZ);
        const mat = ((c as THREE.Mesh).material) as THREE.MeshStandardMaterial;
        const dist = idx * 0.06;
        mat.opacity = isFalling ? Math.max(0, 0.85 - dist) : 0;
        c.scale.setScalar(ft.size * (1 - idx * 0.035));
      });
    }

    // === IMPACTO EN SUELO ===
    if (groundFlashRef.current) {
      const gt = t - T_CRASH;
      const mat = groundFlashRef.current.material as THREE.MeshStandardMaterial;
      if (gt >= 0 && gt < 0.35) {
        const k = gt / 0.35;
        groundFlashRef.current.scale.setScalar(0.5 + k * 9);
        mat.opacity = 1 - k;
      } else {
        mat.opacity = 0;
      }
    }
    if (groundFireRef.current) {
      const gt = t - T_CRASH;
      const mat = groundFireRef.current.material as THREE.MeshStandardMaterial;
      if (gt >= 0 && gt < 1.4) {
        groundFireRef.current.position.y = 0.5 + gt * 0.7;
        const k = gt / 1.4;
        groundFireRef.current.scale.setScalar(1.5 + k * 4.5);
        mat.opacity = (1 - k) * 0.9;
      } else {
        mat.opacity = 0;
      }
    }
    if (groundShockRef.current) {
      const gt = t - T_CRASH;
      const mat = groundShockRef.current.material as THREE.MeshBasicMaterial;
      if (gt >= 0 && gt < 1.6) {
        const k = gt / 1.6;
        groundShockRef.current.scale.setScalar(0.5 + k * 16);
        mat.opacity = (1 - k) * 0.8;
      } else {
        mat.opacity = 0;
      }
    }
    if (groundShock2Ref.current) {
      const gt = t - T_CRASH - 0.15;
      const mat = groundShock2Ref.current.material as THREE.MeshBasicMaterial;
      if (gt >= 0 && gt < 1.4) {
        const k = gt / 1.4;
        groundShock2Ref.current.scale.setScalar(0.4 + k * 12);
        mat.opacity = (1 - k) * 0.5;
      } else {
        mat.opacity = 0;
      }
    }
    if (debrisRef.current) {
      const gt = t - T_CRASH;
      const visible = gt >= 0 && gt < 3.0;
      debrisRef.current.visible = visible;
      debrisRef.current.children.forEach((c, idx) => {
        const d = debris[idx]; if (!d) return;
        c.position.set(
          d.vx * gt,
          Math.max(0, d.vy * gt - 0.5 * 9.8 * gt * gt * 0.4),
          d.vz * gt
        );
        c.rotation.y = gt * d.spin;
        c.rotation.x = gt * d.spin * 0.6;
      });
    }
    if (smokeColumnRef.current) {
      const gt = t - T_GROUND;
      const visible = gt >= 0;
      smokeColumnRef.current.visible = visible;
      // Humo cíclico: cada partícula sube ~3.5 s, se desvanece y reaparece desde
      // abajo. Cada una tiene su propio desfase (s.delay) para que no se vea un
      // ritmo uniforme. Así el OVNI estrellado sigue echando humo INDEFINIDAMENTE
      // mientras el componente esté activo (incluido en aftermath).
      const cycleDur = 3.5;
      smokeColumnRef.current.children.forEach((c, idx) => {
        const s = smokeColumn[idx]; if (!s) return;
        const cycleT = ((Math.max(0, gt) + s.delay) % cycleDur);
        const k = cycleT / cycleDur; // 0..1 en el ciclo
        const y = 0.3 + cycleT * s.rise;
        c.position.set(
          s.x + Math.sin(cycleT * 0.7 + idx) * 0.18,
          y,
          s.z + Math.cos(cycleT * 0.55 + idx) * 0.18
        );
        const mat = ((c as THREE.Mesh).material) as THREE.MeshStandardMaterial;
        const fadeIn = Math.min(1, k * 4);   // 0 → 1 en el primer 25% del ciclo
        const fadeOut = Math.max(0, 1 - k);   // 1 → 0 lineal
        mat.opacity = fadeIn * fadeOut * 0.55;
        c.scale.setScalar(s.size * (1 + k * 0.7));
      });
    }
    if (craterRef.current) {
      const mat = craterRef.current.material as THREE.MeshBasicMaterial;
      const gt = t - T_CRASH;
      mat.opacity = gt >= 0 ? Math.min(1, gt * 4) * 0.85 : 0;
    }
    if (fireLightRef.current) {
      if (isFalling) {
        fireLightRef.current.position.set(ufoX, ufoY, ufoZ);
        fireLightRef.current.intensity = 4 + Math.sin(state.clock.elapsedTime * 18) * 1.5;
      } else if (t >= T_CRASH && t < T_CRASH + 2.5) {
        fireLightRef.current.position.set(CRASH_X, 0.6, CRASH_Z);
        const fade = Math.max(0, 1 - (t - T_CRASH) / 2.5);
        fireLightRef.current.intensity = (4 + Math.sin(state.clock.elapsedTime * 18) * 1.5) * fade;
      } else if (t >= T_CRASH + 2.5) {
        // Brasas — luz tenue parpadeante bajo el OVNI estrellado, INDEFINIDA
        // (para que durante el aftermath siga viéndose el resplandor del fuego)
        fireLightRef.current.position.set(CRASH_X, 0.4, CRASH_Z);
        fireLightRef.current.intensity = 0.9 + Math.sin(state.clock.elapsedTime * 8) * 0.4;
      } else {
        fireLightRef.current.intensity = 0;
      }
    }
  });

  if (!active) return null;
  return (
    <>
      {/* ============ OVNI ============ */}
      <group ref={ufoRef} position={[PARK_X, PARK_Y, 0]}>
        <group ref={ufoBodyRef}>
          <mesh castShadow>
            <cylinderGeometry args={[1.4, 1.0, 0.32, 24]} />
            <meshStandardMaterial color="#9aa6b0" metalness={0.85} roughness={0.25} />
          </mesh>
          <mesh position={[0, -0.18, 0]}>
            <cylinderGeometry args={[1.0, 0.85, 0.12, 24]} />
            <meshStandardMaterial color="#1a1f24" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.28, 0]}>
            <sphereGeometry args={[0.7, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#5fffb5" emissive="#5fffb5" emissiveIntensity={0.35} transparent opacity={0.65} metalness={0.2} roughness={0.1} />
          </mesh>
          {portholes.map((p, i) => (
            <mesh key={i} position={[p.x, -0.05, p.z]} scale={0.15}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshStandardMaterial color="#caffd6" emissive="#9bff8a" emissiveIntensity={1.4} />
            </mesh>
          ))}
          <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.45, 1.6, 32]} />
            <meshBasicMaterial color="#a6ff9b" transparent opacity={0.55} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>

      {/* Fuego que envuelve al OVNI durante la caída */}
      <mesh ref={ufoFireRef} visible={false}>
        <sphereGeometry args={[1.1, 12, 10]} />
        <meshStandardMaterial color="#ff8a18" emissive="#ff3a05" emissiveIntensity={2.2} transparent opacity={0.85} depthWrite={false} />
      </mesh>

      {/* Estela de fuego de la caída */}
      <group ref={fireTrailRef}>
        {fireTrail.map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshStandardMaterial color={i < 5 ? '#ffe178' : '#ff5a18'} emissive={i < 5 ? '#ffe178' : '#ff3a05'} emissiveIntensity={1.8} transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* ============ CAÑÓN ============ */}
      <group ref={cannonGroupRef} position={[CANNON_BASE_X, -2, CANNON_BASE_Z]}>
        {/* Base hexagonal */}
        <mesh castShadow position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.55, 0.7, 0.3, 6]} />
          <meshStandardMaterial color="#3a4248" metalness={0.7} roughness={0.4} />
        </mesh>
        {/* Patas */}
        {Array.from({ length: 4 }).map((_, i) => {
          const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
          return (
            <mesh key={i} castShadow position={[Math.cos(ang) * 0.55, 0.18, Math.sin(ang) * 0.55]} rotation={[0, -ang, Math.cos(ang) * 0.35]}>
              <cylinderGeometry args={[0.05, 0.08, 0.45, 6]} />
              <meshStandardMaterial color="#2a3035" metalness={0.6} roughness={0.5} />
            </mesh>
          );
        })}
        {/* Yugo */}
        <mesh castShadow position={[0, 0.42, 0]}>
          <sphereGeometry args={[0.32, 12, 10]} />
          <meshStandardMaterial color="#4a525a" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Cabezal pivotante */}
        <group ref={cannonHeadRef} position={[0, 0.5, 0]}>
          <mesh castShadow position={[0, 0.05, 0]}>
            <boxGeometry args={[0.42, 0.36, 0.55]} />
            <meshStandardMaterial color="#4a525a" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Barril (apuntando +Z local) */}
          <mesh castShadow position={[0, 0.05, 0.62]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.1, 0.13, 1.1, 12]} />
            <meshStandardMaterial color="#2a3035" metalness={0.85} roughness={0.25} />
          </mesh>
          {/* Brida */}
          <mesh position={[0, 0.05, 1.05]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.16, 0.16, 0.12, 12]} />
            <meshStandardMaterial color="#5a626a" metalness={0.9} roughness={0.2} />
          </mesh>
          {/* Glow de carga */}
          <mesh ref={muzzleGlowRef} position={[0, 0.05, 1.18]}>
            <sphereGeometry args={[0.13, 12, 10]} />
            <meshStandardMaterial color="#a8efff" emissive="#5fc8ff" emissiveIntensity={0.3} transparent opacity={0.85} depthWrite={false} />
          </mesh>
          {/* Muzzle flash */}
          <mesh ref={muzzleFlashRef} position={[0, 0.05, 1.3]}>
            <sphereGeometry args={[0.22, 12, 10]} />
            <meshStandardMaterial color="#ffffff" emissive="#caffff" emissiveIntensity={3.0} transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      </group>

      {/* ============ PROYECTIL ============ */}
      <group ref={projectileRef} visible={false}>
        <mesh>
          <sphereGeometry args={[0.15, 12, 10]} />
          <meshStandardMaterial color="#ffffff" emissive="#aaffff" emissiveIntensity={3} />
        </mesh>
        <mesh scale={1.9}>
          <sphereGeometry args={[0.15, 10, 8]} />
          <meshStandardMaterial color="#5fc8ff" emissive="#5fc8ff" emissiveIntensity={1.5} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      </group>
      <group ref={projectileTrailRef}>
        {projectileTrail.map((tr, i) => (
          <mesh key={i} scale={tr.size}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshStandardMaterial color="#aaffff" emissive="#5fc8ff" emissiveIntensity={2} transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* ============ EXPLOSIÓN EN EL OVNI ============ */}
      <mesh ref={impactFlashRef}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={3} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={impactFireballRef}>
        <sphereGeometry args={[0.8, 14, 10]} />
        <meshStandardMaterial color="#ff7a1a" emissive="#ff3a05" emissiveIntensity={2.5} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={impactShockRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.7, 0.9, 32]} />
        <meshBasicMaterial color="#ffe178" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <group ref={shrapnelRef} visible={false}>
        {shrapnel.map((s, i) => (
          <mesh key={i} scale={s.size}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#9aa6b0" emissive="#ff5018" emissiveIntensity={0.5} transparent opacity={1} />
          </mesh>
        ))}
      </group>

      {/* ============ IMPACTO EN EL SUELO ============ */}
      <mesh ref={groundFlashRef} position={[CRASH_X, 0.3, CRASH_Z]}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={3.5} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={groundFireRef} position={[CRASH_X, 0.5, CRASH_Z]}>
        <sphereGeometry args={[1.2, 16, 12]} />
        <meshStandardMaterial color="#ff7a1a" emissive="#ff3a05" emissiveIntensity={2.5} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={groundShockRef} position={[CRASH_X, 0.05, CRASH_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.7, 0.9, 32]} />
        <meshBasicMaterial color="#ffd54f" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={groundShock2Ref} position={[CRASH_X, 0.04, CRASH_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.7, 32]} />
        <meshBasicMaterial color="#ff7a1a" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={craterRef} position={[CRASH_X, 0.01, CRASH_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, 1.4, 28]} />
        <meshBasicMaterial color="#1a0805" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <group ref={debrisRef} position={[CRASH_X, 0, CRASH_Z]} visible={false}>
        {debris.map((d, i) => (
          <mesh key={i} scale={d.size}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#3a4248" emissive="#ff5018" emissiveIntensity={0.4} />
          </mesh>
        ))}
      </group>
      <group ref={smokeColumnRef} position={[CRASH_X, 0, CRASH_Z]} visible={false}>
        {smokeColumn.map((_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[1, 10, 8]} />
            <meshStandardMaterial color="#3a3530" emissive="#1a1410" emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* Luces dinámicas */}
      <pointLight ref={muzzleLightRef} position={[CANNON_BASE_X, 1, CANNON_BASE_Z]} color="#aaffff" distance={9} decay={2} intensity={0} />
      <pointLight ref={explosionLightRef} position={[0, 5, 0]} color="#ff8a18" distance={18} decay={2} intensity={0} />
      <pointLight ref={fireLightRef} position={[0, 2, 0]} color="#ff5a18" distance={12} decay={2} intensity={0} />
    </>
  );
};

// ============================================================
// Bichitos — enjambre 3D que salta/se arrastra por la parcela.
// Variantes según el tipo de plaga:
//   - 'pulgones'           → puntitos verdes pequeños, saltitos suaves
//   - 'arana_roja'         → arañas rojas con 8 patitas, saltos cortos
//   - 'caracoles'          → caracoles marrones lentos, apenas saltan
//   - 'langostas'          → langostas grandes verdes/amarillas, saltos altos
//   - 'marabunta_hormigas' → hormigas negras en fila india
//   - 'plaga' (genérico)   → bichos marrón-rojizos saltando aleatorio
// ============================================================

type BugKind = 'pulgones' | 'arana_roja' | 'caracoles' | 'langostas' | 'marabunta_hormigas' | 'plaga';

interface BugSwarmProps {
  active: boolean;
  kind: BugKind;
  durationSec?: number;
}

const BUG_PRESETS: Record<BugKind, {
  count: number;
  color: string;
  accent: string;
  bodySize: number;       // radio del cuerpo en unidades de escena
  hopHeight: number;      // altura del saltito
  hopSpeed: number;       // saltos por segundo
  travelSpeed: number;    // velocidad de desplazamiento horizontal
  legs: number;           // pares de patitas (0 = caracol)
  shellHump?: boolean;    // concha (caracoles)
  antennae?: boolean;     // antenas (hormigas / langostas)
  wings?: boolean;        // alas (langostas)
}> = {
  pulgones:           { count: 28, color: '#7fc25a', accent: '#3f7a2a', bodySize: 0.07, hopHeight: 0.15, hopSpeed: 2.5, travelSpeed: 0.4,  legs: 3, antennae: true },
  arana_roja:         { count: 16, color: '#c83a3a', accent: '#7a1f1f', bodySize: 0.10, hopHeight: 0.18, hopSpeed: 1.7, travelSpeed: 0.55, legs: 4 },
  caracoles:          { count: 10, color: '#8a6a3f', accent: '#5a4020', bodySize: 0.18, hopHeight: 0.03, hopSpeed: 0.5, travelSpeed: 0.15, legs: 0, shellHump: true, antennae: true },
  langostas:          { count: 14, color: '#a8b835', accent: '#d4c14a', bodySize: 0.18, hopHeight: 0.85, hopSpeed: 1.2, travelSpeed: 0.8,  legs: 3, antennae: true, wings: true },
  marabunta_hormigas: { count: 32, color: '#1c1c1c', accent: '#3a2a14', bodySize: 0.08, hopHeight: 0.08, hopSpeed: 3.0, travelSpeed: 0.6,  legs: 3, antennae: true },
  plaga:              { count: 22, color: '#8a4a2a', accent: '#c25a2a', bodySize: 0.12, hopHeight: 0.35, hopSpeed: 1.8, travelSpeed: 0.5,  legs: 3, antennae: true }
};

const BugSwarm: React.FC<BugSwarmProps> = ({ active, kind }) => {
  const groupRef = useRef<THREE.Group>(null);
  const getElapsed = useEffectClock(active);
  const preset = BUG_PRESETS[kind];

  const bugs = useMemo(() => {
    // Seed distinta por tipo para que no se vean idénticos al cambiar de plaga
    const seedBase = ({
      pulgones: 201,
      arana_roja: 202,
      caracoles: 203,
      langostas: 204,
      marabunta_hormigas: 205,
      plaga: 206
    } as Record<BugKind, number>)[kind] ?? 200;
    const rng = makeRng(seedBase * 1000 + preset.count);

    // Para hormigas: hacemos una fila india con un camino sinuoso compartido
    if (kind === 'marabunta_hormigas') {
      return Array.from({ length: preset.count }).map((_, i) => ({
        kind: 'ant' as const,
        offset: i * 0.32,
        phase: rng() * Math.PI * 2,
        scale: 0.85 + rng() * 0.3
      }));
    }

    return Array.from({ length: preset.count }).map(() => ({
      kind: 'free' as const,
      x0: (rng() - 0.5) * 8,
      z0: (rng() - 0.5) * 8,
      driftX: (rng() - 0.5) * 2,
      driftZ: (rng() - 0.5) * 2,
      hopPhase: rng() * Math.PI * 2,
      yawPhase: rng() * Math.PI * 2,
      scale: 0.8 + rng() * 0.5,
      hopJitter: 0.7 + rng() * 0.6
    }));
  }, [kind, preset.count]);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active || !groupRef.current) return;
    // Solo aparición progresiva — mientras el evento siga activo los bichos se quedan.
    const lifeMix = Math.min(t / 0.4, 1);

    groupRef.current.children.forEach((bugGroup, i) => {
      const b = bugs[i] as any; if (!b) return;

      if (b.kind === 'ant') {
        // Camino compartido: dos vueltas a una elipse en torno al centro
        const speed = preset.travelSpeed;
        const u = (state.clock.elapsedTime * speed - b.offset) % (Math.PI * 2);
        const x = Math.cos(u) * 3.6 + Math.sin(u * 2) * 0.4;
        const z = Math.sin(u) * 2.8 + Math.cos(u * 3) * 0.3;
        // Yaw apuntando a la tangente del camino
        const tx = -Math.sin(u) * 3.6 + Math.cos(u * 2) * 0.8;
        const tz = Math.cos(u) * 2.8 - Math.sin(u * 3) * 0.9;
        bugGroup.position.x = x;
        bugGroup.position.z = z;
        bugGroup.position.y = Math.abs(Math.sin(state.clock.elapsedTime * preset.hopSpeed + b.phase)) * preset.hopHeight;
        bugGroup.rotation.y = Math.atan2(tx, tz);
        bugGroup.scale.setScalar(b.scale * lifeMix);
        return;
      }

      // Bichos "free": deriva suave + saltitos
      const driftT = state.clock.elapsedTime * preset.travelSpeed * 0.35;
      const x = b.x0 + Math.sin(driftT + b.yawPhase) * b.driftX;
      const z = b.z0 + Math.cos(driftT + b.yawPhase * 1.3) * b.driftZ;
      const hop = Math.abs(Math.sin(state.clock.elapsedTime * preset.hopSpeed * b.hopJitter + b.hopPhase));
      bugGroup.position.set(x, hop * preset.hopHeight, z);
      bugGroup.rotation.y = Math.sin(driftT * 0.9 + b.yawPhase) * 0.6;
      bugGroup.scale.setScalar(b.scale * lifeMix);
    });
  });

  if (!active) return null;

  // Patitas (segmentos) que sobresalen del cuerpo. Render condicional según preset.legs.
  const renderLegs = (size: number) => {
    if (preset.legs <= 0) return null;
    const items: React.ReactElement[] = [];
    for (let i = 0; i < preset.legs; i++) {
      const ang = (i / preset.legs) * Math.PI;
      const lx = Math.cos(ang) * size * 1.1;
      const lz = Math.sin(ang) * size * 0.4;
      const legLen = size * 1.3;
      items.push(
        <mesh key={`L${i}`} position={[lx, -size * 0.2, lz]} rotation={[0, 0, Math.PI / 2.2]}>
          <cylinderGeometry args={[size * 0.06, size * 0.06, legLen, 4]} />
          <meshStandardMaterial color={preset.accent} />
        </mesh>
      );
      items.push(
        <mesh key={`R${i}`} position={[-lx, -size * 0.2, lz]} rotation={[0, 0, -Math.PI / 2.2]}>
          <cylinderGeometry args={[size * 0.06, size * 0.06, legLen, 4]} />
          <meshStandardMaterial color={preset.accent} />
        </mesh>
      );
    }
    return items;
  };

  return (
    <group ref={groupRef}>
      {bugs.map((_, i) => {
        const size = preset.bodySize;
        return (
          <group key={i} position={[0, 0, 0]}>
            {/* Cuerpo principal (elipsoide) */}
            <mesh castShadow>
              <sphereGeometry args={[size, 10, 8]} />
              <meshStandardMaterial color={preset.color} roughness={0.55} />
            </mesh>
            {/* Cabeza más oscura */}
            <mesh position={[0, 0, size * 0.95]}>
              <sphereGeometry args={[size * 0.7, 10, 8]} />
              <meshStandardMaterial color={preset.accent} roughness={0.6} />
            </mesh>

            {/* Concha en caracoles */}
            {preset.shellHump && (
              <mesh position={[0, size * 0.55, -size * 0.1]}>
                <sphereGeometry args={[size * 1.05, 12, 10]} />
                <meshStandardMaterial color="#c08a4d" roughness={0.45} />
              </mesh>
            )}

            {/* Antenas */}
            {preset.antennae && (
              <>
                <mesh position={[size * 0.25, size * 0.7, size * 1.1]} rotation={[0.3, 0.2, 0]}>
                  <cylinderGeometry args={[size * 0.04, size * 0.04, size * 1.1, 4]} />
                  <meshStandardMaterial color={preset.accent} />
                </mesh>
                <mesh position={[-size * 0.25, size * 0.7, size * 1.1]} rotation={[0.3, -0.2, 0]}>
                  <cylinderGeometry args={[size * 0.04, size * 0.04, size * 1.1, 4]} />
                  <meshStandardMaterial color={preset.accent} />
                </mesh>
              </>
            )}

            {/* Alas (langostas): planas y semitransparentes */}
            {preset.wings && (
              <>
                <mesh position={[size * 0.55, size * 0.25, -size * 0.1]} rotation={[0, 0, -0.4]}>
                  <planeGeometry args={[size * 1.4, size * 0.7]} />
                  <meshStandardMaterial color="#e5d27a" transparent opacity={0.55} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[-size * 0.55, size * 0.25, -size * 0.1]} rotation={[0, 0, 0.4]}>
                  <planeGeometry args={[size * 1.4, size * 0.7]} />
                  <meshStandardMaterial color="#e5d27a" transparent opacity={0.55} side={THREE.DoubleSide} />
                </mesh>
              </>
            )}

            {renderLegs(size)}
          </group>
        );
      })}
    </group>
  );
};

// ============================================================
// Jabalíes 🐗 — manada realista. Cada jabalí tiene cuerpo de barril,
// cabeza alargada con hocico, colmillos blancos, orejas triangulares,
// crin oscura, cola corta y 4 patas que se animan con un walk-cycle
// simple. Hozan el suelo (bajan la cabeza, lanzan polvo) y de vez
// en cuando arrancan a correr de un punto a otro.
// ============================================================

interface BoarSpec {
  pathSeed: number;
  size: number;
  speed: number;
  phase: number;
  rootPhase: number;
}

const Boar: React.FC<{ spec: BoarSpec }> = ({ spec }) => {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const legRefs = useRef<(THREE.Mesh | null)[]>([]);
  const dustRef = useRef<THREE.Group>(null);

  const dust = useMemo(() => {
    const rng = makeRng(spec.pathSeed * 7 + 13);
    return Array.from({ length: 6 }).map(() => ({
      angle: rng() * Math.PI * 2,
      radius: 0.15 + rng() * 0.25,
      delay: rng() * 0.7,
      size: 0.06 + rng() * 0.05
    }));
  }, [spec.pathSeed]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!groupRef.current) return;

    // Camino: elipse irregular alrededor de la parcela (entre fuera y el
    // borde del cultivo) más jitter sinusoidal.
    const u = (t * spec.speed + spec.phase) % (Math.PI * 2);
    const rngOffset = spec.pathSeed * 0.0001;
    const rx = 4.5 + Math.sin(u * 1.7 + rngOffset) * 0.6;
    const rz = 3.6 + Math.cos(u * 1.3 + rngOffset) * 0.7;
    const x = Math.cos(u) * rx;
    const z = Math.sin(u) * rz;

    // Velocidad instantánea para ajustar yaw y walk-cycle
    const tx = -Math.sin(u) * rx;
    const tz = Math.cos(u) * rz;
    const yaw = Math.atan2(tx, tz);

    // "Hozar" ocasional: cada ~6 s baja la cabeza y se queda quieto 1 s
    const rootCycle = ((t + spec.rootPhase) % 6) / 6; // 0–1
    const rooting = rootCycle > 0.55 && rootCycle < 0.72;
    const rootStrength = rooting ? Math.sin(((rootCycle - 0.55) / 0.17) * Math.PI) : 0;

    // Sprint corto: cada ~9 s acelera (lo simulamos como bob extra)
    const sprintCycle = ((t + spec.rootPhase * 1.7) % 9) / 9;
    const sprinting = sprintCycle > 0.30 && sprintCycle < 0.45;
    const sprintK = sprinting ? Math.sin(((sprintCycle - 0.30) / 0.15) * Math.PI) : 0;

    const moveSpeed = 1 + sprintK * 1.8 - rootStrength * 0.95;

    groupRef.current.position.set(x, 0, z);
    groupRef.current.rotation.y = yaw;
    // El cuerpo "rebota" un poquito al andar y se hunde al hozar
    const bob = Math.abs(Math.sin(t * 9 * moveSpeed + spec.phase)) * 0.04;
    groupRef.current.position.y = 0.05 + bob - rootStrength * 0.02;

    // Walk-cycle de las 4 patas: pares cruzados (DEL-TR / DEL-TI)
    legRefs.current.forEach((leg, i) => {
      if (!leg) return;
      // i=0 DEL-IZQ, 1 DEL-DER, 2 TR-IZQ, 3 TR-DER
      const crossPair = (i === 0 || i === 3) ? 0 : Math.PI;
      leg.rotation.x = Math.sin(t * 9 * moveSpeed + spec.phase + crossPair) * 0.55 - rootStrength * 0.1;
    });

    // Cabeza: baja al hozar
    if (headRef.current) {
      headRef.current.rotation.x = 0.15 + rootStrength * 0.75;
      headRef.current.position.y = 0.5 - rootStrength * 0.18;
    }

    // Polvo al hozar: partículas que suben y se desvanecen
    if (dustRef.current) {
      dustRef.current.visible = rootStrength > 0.05;
      dustRef.current.children.forEach((c, i) => {
        const d = dust[i]; if (!d) return;
        const local = Math.max(0, rootCycle - 0.55 + d.delay * 0.05);
        const phase = Math.min(1, local * 6);
        c.position.set(
          Math.cos(d.angle) * d.radius * (1 + phase * 1.5),
          phase * 0.5,
          Math.sin(d.angle) * d.radius * (1 + phase * 1.5)
        );
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - phase) * 0.55 * rootStrength;
      });
    }
  });

  const s = spec.size;
  // Colores del jabalí: cuerpo gris-marrón con crin más oscura
  const bodyColor = '#3a2a1f';
  const bellyColor = '#5a4533';
  const accent = '#1a0f08';
  const tusk = '#f4ead5';

  return (
    <group ref={groupRef} scale={s}>
      {/* Cuerpo (barril alargado) */}
      <mesh castShadow position={[0, 0.45, 0]} scale={[0.45, 0.38, 0.75]}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial color={bodyColor} roughness={0.85} />
      </mesh>
      {/* Vientre más claro */}
      <mesh position={[0, 0.30, 0]} scale={[0.42, 0.18, 0.7]}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color={bellyColor} roughness={0.9} />
      </mesh>
      {/* Crin oscura encima del lomo (cresta) */}
      <mesh position={[0, 0.78, -0.05]} scale={[0.05, 0.12, 0.55]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={accent} roughness={0.95} />
      </mesh>

      {/* Cabeza: cuerpo + hocico cilíndrico */}
      <group ref={headRef} position={[0, 0.5, 0.55]}>
        <mesh castShadow scale={[0.32, 0.32, 0.36]}>
          <sphereGeometry args={[1, 12, 9]} />
          <meshStandardMaterial color={bodyColor} roughness={0.85} />
        </mesh>
        {/* Hocico saliente */}
        <mesh position={[0, -0.08, 0.34]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.16, 0.18, 0.30, 12]} />
          <meshStandardMaterial color={accent} roughness={0.9} />
        </mesh>
        {/* Hoyitos nariz */}
        <mesh position={[0.06, -0.05, 0.50]} scale={0.035}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshStandardMaterial color="#000" />
        </mesh>
        <mesh position={[-0.06, -0.05, 0.50]} scale={0.035}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshStandardMaterial color="#000" />
        </mesh>
        {/* Colmillos (dos cilindros blancos saliendo del hocico) */}
        <mesh position={[0.11, -0.13, 0.42]} rotation={[-0.4, 0.2, 0]}>
          <coneGeometry args={[0.025, 0.18, 8]} />
          <meshStandardMaterial color={tusk} roughness={0.4} />
        </mesh>
        <mesh position={[-0.11, -0.13, 0.42]} rotation={[-0.4, -0.2, 0]}>
          <coneGeometry args={[0.025, 0.18, 8]} />
          <meshStandardMaterial color={tusk} roughness={0.4} />
        </mesh>
        {/* Ojos pequeños rojizos */}
        <mesh position={[0.12, 0.08, 0.22]} scale={0.04}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshStandardMaterial color="#1a0a0a" emissive="#6a1a1a" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[-0.12, 0.08, 0.22]} scale={0.04}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshStandardMaterial color="#1a0a0a" emissive="#6a1a1a" emissiveIntensity={0.6} />
        </mesh>
        {/* Orejas triangulares */}
        <mesh position={[0.18, 0.25, -0.02]} rotation={[0, 0, 0.4]}>
          <coneGeometry args={[0.08, 0.16, 4]} />
          <meshStandardMaterial color={accent} roughness={0.9} />
        </mesh>
        <mesh position={[-0.18, 0.25, -0.02]} rotation={[0, 0, -0.4]}>
          <coneGeometry args={[0.08, 0.16, 4]} />
          <meshStandardMaterial color={accent} roughness={0.9} />
        </mesh>
      </group>

      {/* 4 patas: cilindros con pequeño "hoof" más oscuro abajo.
          Pivote en lo alto para que la rotación X las balancee como columpio. */}
      {[
        { x:  0.20, z:  0.40, i: 0 },
        { x: -0.20, z:  0.40, i: 1 },
        { x:  0.20, z: -0.40, i: 2 },
        { x: -0.20, z: -0.40, i: 3 }
      ].map(({ x, z, i }) => (
        <group key={i} position={[x, 0.32, z]}>
          <mesh
            ref={(el) => { legRefs.current[i] = el; }}
            position={[0, -0.18, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.07, 0.08, 0.36, 8]} />
            <meshStandardMaterial color={bodyColor} roughness={0.85} />
          </mesh>
          {/* Pezuña */}
          <mesh position={[0, -0.38, 0]}>
            <cylinderGeometry args={[0.085, 0.085, 0.05, 8]} />
            <meshStandardMaterial color={accent} roughness={0.7} />
          </mesh>
        </group>
      ))}

      {/* Cola corta enroscada */}
      <mesh position={[0, 0.55, -0.78]} rotation={[0.3, 0, 0]}>
        <torusGeometry args={[0.08, 0.025, 6, 14, Math.PI * 1.4]} />
        <meshStandardMaterial color={accent} roughness={0.9} />
      </mesh>

      {/* Polvo al hozar */}
      <group ref={dustRef} position={[0, 0.05, 0.55]} visible={false}>
        {dust.map((d, i) => (
          <mesh key={i} scale={d.size}>
            <sphereGeometry args={[1, 6, 5]} />
            <meshStandardMaterial color="#a08560" transparent opacity={0} roughness={1} />
          </mesh>
        ))}
      </group>
    </group>
  );
};

const BoarHerd: React.FC<{ active: boolean }> = ({ active }) => {
  const boars = useMemo<BoarSpec[]>(() => {
    const rng = makeRng(771001);
    const N = 4;
    return Array.from({ length: N }).map((_, i) => ({
      pathSeed: 771001 + i * 137,
      size: 1.05 + rng() * 0.35,
      speed: 0.30 + rng() * 0.18,
      phase: (i / N) * Math.PI * 2 + rng() * 0.5,
      rootPhase: rng() * 6
    }));
  }, []);

  if (!active) return null;
  return (
    <>
      {boars.map((spec, i) => <Boar key={i} spec={spec} />)}
    </>
  );
};

// ============================================================
// LLUVIA DE METEORITOS ☄️ — 10 rocas ardientes cayendo en
// secuencia escalonada. Cada meteorito tiene su propio ciclo
// (caída → impacto → flash + onda + cráter + escombros + humo)
// y al terminar reaparece arriba para seguir cayendo. El campo
// se llena de cráteres y la pantalla tiembla y parpadea (CSS).
// ============================================================

interface MeteorSpec {
  startAng: number;     // ángulo desde donde entra (en el cielo)
  impactX: number;
  impactZ: number;
  fallSec: number;      // duración de la caída
  cycleSec: number;     // duración total del ciclo (caída + post)
  offsetSec: number;    // desfase para que no caigan todos a la vez
  size: number;
  craterR: number;
}

const SingleMeteor: React.FC<{ spec: MeteorSpec; tNow: number }> = ({ spec, tNow }) => {
  const meteorRef = useRef<THREE.Group>(null);
  const trailRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.PointLight>(null);
  const flashCoreRef = useRef<THREE.Mesh>(null);
  const shockRef = useRef<THREE.Mesh>(null);
  const craterRef = useRef<THREE.Mesh>(null);
  const debrisRef = useRef<THREE.Group>(null);
  const smokeRef = useRef<THREE.Group>(null);

  const debris = useMemo(() => {
    const rng = makeRng(881100 + Math.floor(spec.startAng * 1000));
    return Array.from({ length: 18 }).map(() => ({
      ang: rng() * Math.PI * 2,
      r: 0.4 + rng() * 3,
      vy: 2 + rng() * 5,
      gravity: 6 + rng() * 3,
      size: 0.07 + rng() * 0.14,
      spinPhase: rng() * Math.PI * 2
    }));
  }, [spec.startAng]);

  const smoke = useMemo(() => {
    const rng = makeRng(881200 + Math.floor(spec.startAng * 1000));
    return Array.from({ length: 10 }).map(() => ({
      ang: rng() * Math.PI * 2,
      r: rng() * 1.2,
      delay: rng() * 0.5,
      rise: 1.5 + rng() * 1.5,
      size: 0.22 + rng() * 0.32
    }));
  }, [spec.startAng]);

  useFrame((state) => {
    // Tiempo local del meteorito (ciclo modular)
    const local = ((tNow - spec.offsetSec) % spec.cycleSec + spec.cycleSec) % spec.cycleSec;
    const falling = local < spec.fallSec;

    // Origen alto: a 12 unidades en una dirección desde el impacto
    const dirX = Math.cos(spec.startAng);
    const dirZ = Math.sin(spec.startAng);
    const startX = spec.impactX - dirX * 10;
    const startZ = spec.impactZ - dirZ * 10;
    const startY = 11;

    if (meteorRef.current) {
      if (falling) {
        const k = local / spec.fallSec;
        meteorRef.current.visible = true;
        meteorRef.current.position.set(
          startX + (spec.impactX - startX) * k,
          startY + (0.2 - startY) * k,
          startZ + (spec.impactZ - startZ) * k
        );
        meteorRef.current.rotation.x = state.clock.elapsedTime * 8;
        meteorRef.current.rotation.y = state.clock.elapsedTime * 6;
      } else {
        meteorRef.current.visible = false;
      }
    }
    if (trailRef.current) {
      trailRef.current.visible = falling;
      if (falling) {
        const k = local / spec.fallSec;
        trailRef.current.position.set(
          startX + (spec.impactX - startX) * k,
          startY + (0.2 - startY) * k,
          startZ + (spec.impactZ - startZ) * k
        );
        // Orientar la estela hacia el origen (dirección opuesta a la caída)
        trailRef.current.lookAt(startX, startY, startZ);
      }
    }

    // Después del impacto
    const sinceImpact = falling ? -1 : local - spec.fallSec;
    if (flashRef.current) {
      flashRef.current.intensity = sinceImpact >= 0 ? 9 * Math.exp(-sinceImpact * 2.6) : 0;
      flashRef.current.position.set(spec.impactX, 1.2, spec.impactZ);
    }
    if (flashCoreRef.current) {
      flashCoreRef.current.visible = sinceImpact >= 0 && sinceImpact < 0.7;
      if (flashCoreRef.current.visible) {
        flashCoreRef.current.position.set(spec.impactX, 0.5, spec.impactZ);
        flashCoreRef.current.scale.setScalar(0.3 + sinceImpact * 3.8);
        const mat = flashCoreRef.current.material as THREE.MeshStandardMaterial;
        mat.opacity = Math.max(0, 1 - sinceImpact * 1.6);
      }
    }
    if (shockRef.current) {
      shockRef.current.visible = sinceImpact >= 0 && sinceImpact < 2.0;
      shockRef.current.position.set(spec.impactX, 0.08, spec.impactZ);
      if (shockRef.current.visible) {
        shockRef.current.scale.setScalar(0.3 + sinceImpact * 4.5);
        const mat = shockRef.current.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, 0.7 - sinceImpact * 0.4);
      }
    }
    if (craterRef.current) {
      // El cráter aparece y se queda hasta el final del ciclo
      craterRef.current.visible = !falling;
      craterRef.current.position.set(spec.impactX, 0.04, spec.impactZ);
      const mat = craterRef.current.material as THREE.MeshStandardMaterial;
      const fadeOut = local > spec.cycleSec - 0.4 ? Math.max(0, (spec.cycleSec - local) / 0.4) : 1;
      mat.opacity = !falling ? Math.min(1, sinceImpact * 5) * fadeOut : 0;
    }

    if (debrisRef.current) {
      debrisRef.current.visible = sinceImpact >= 0 && sinceImpact < 3;
      debrisRef.current.position.set(spec.impactX, 0, spec.impactZ);
      debrisRef.current.children.forEach((c, i) => {
        const d = debris[i]; if (!d) return;
        const u = Math.max(0, sinceImpact - 0.05);
        const y = d.vy * u - 0.5 * d.gravity * u * u;
        c.position.x = Math.cos(d.ang) * d.r * Math.min(1, u * 2);
        c.position.z = Math.sin(d.ang) * d.r * Math.min(1, u * 2);
        c.position.y = Math.max(0.1, y + 0.2);
        c.rotation.x = state.clock.elapsedTime * 5 + d.spinPhase;
        c.rotation.y = state.clock.elapsedTime * 4 + d.spinPhase;
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = Math.max(0, 1 - u / 2.5);
      });
    }

    if (smokeRef.current) {
      smokeRef.current.visible = !falling;
      smokeRef.current.position.set(spec.impactX, 0.05, spec.impactZ);
      smokeRef.current.children.forEach((c, i) => {
        const s = smoke[i]; if (!s) return;
        const u = Math.max(0, (sinceImpact - s.delay)) % 2.5;
        const phase = u / 2.5;
        c.position.set(
          Math.cos(s.ang) * s.r * (1 + phase * 0.5),
          phase * s.rise,
          Math.sin(s.ang) * s.r * (1 + phase * 0.5)
        );
        c.scale.setScalar(s.size * (0.5 + phase * 1.8));
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - phase) * 0.55;
      });
    }
  });

  return (
    <>
      <group ref={meteorRef} scale={spec.size}>
        <mesh castShadow>
          <dodecahedronGeometry args={[0.55, 0]} />
          <meshStandardMaterial color="#4a2814" emissive="#ff5018" emissiveIntensity={0.95} roughness={0.85} />
        </mesh>
        <mesh scale={0.7}>
          <dodecahedronGeometry args={[0.55, 0]} />
          <meshStandardMaterial color="#ff8c40" emissive="#ffba50" emissiveIntensity={1.4} />
        </mesh>
      </group>
      {/* Estela: cono apuntando hacia el origen (se reorienta cada frame) */}
      <group ref={trailRef}>
        <mesh position={[0, 0, 1.6]} scale={[0.45 * spec.size, 0.45 * spec.size, 2.8 * spec.size]}>
          <coneGeometry args={[1, 1, 10]} />
          <meshBasicMaterial color="#ff6418" transparent opacity={0.6} />
        </mesh>
        <mesh position={[0, 0, 0.9]} scale={[0.22 * spec.size, 0.22 * spec.size, 1.6 * spec.size]}>
          <coneGeometry args={[1, 1, 10]} />
          <meshBasicMaterial color="#ffd028" transparent opacity={0.8} />
        </mesh>
      </group>
      <mesh ref={flashCoreRef} visible={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#ffffff" emissive="#fff0a0" emissiveIntensity={2.8} transparent opacity={1} />
      </mesh>
      <pointLight ref={flashRef} color="#ffc060" intensity={0} distance={22} decay={2} />
      <mesh ref={shockRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.8, 1.0, 48]} />
        <meshBasicMaterial color="#ffe070" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={craterRef} rotation={[-Math.PI / 2, 0, 0]} visible={false} scale={spec.craterR}>
        <ringGeometry args={[0.4, 1.0, 24]} />
        <meshStandardMaterial color="#1a0a05" emissive="#5a1f08" emissiveIntensity={0.5} transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
      <group ref={debrisRef} visible={false}>
        {debris.map((d, i) => (
          <mesh key={i} scale={d.size}>
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#4a2814" emissive="#ff5018" emissiveIntensity={0.6} transparent opacity={1} />
          </mesh>
        ))}
      </group>
      <group ref={smokeRef} visible={false}>
        {smoke.map((s, i) => (
          <mesh key={i} scale={s.size}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshStandardMaterial color="#2a1a0a" transparent opacity={0} roughness={1} />
          </mesh>
        ))}
      </group>
    </>
  );
};

const Meteorite: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 8 }) => {
  const getElapsed = useEffectClock(active);
  const [tNow, setTNow] = React.useState(0);
  const [finished, setFinished] = React.useState(false);
  React.useEffect(() => {
    if (!active) {
      setFinished(false);
      setTNow(0);
    }
  }, [active]);

  // 10 meteoritos: puntos de impacto en círculos concéntricos sobre la parcela
  // (~10×10), ángulos de entrada variados y desfases para una cascada continua.
  const meteors = useMemo<MeteorSpec[]>(() => {
    const rng = makeRng(771771);
    const N = 10;
    return Array.from({ length: N }).map((_, i) => {
      const ringR = 1.5 + (i % 3) * 1.8;            // 1.5, 3.3, 5.1
      const ang  = (i / N) * Math.PI * 2 + rng() * 0.6;
      const impactX = Math.cos(ang) * ringR + (rng() - 0.5) * 0.6;
      const impactZ = Math.sin(ang) * ringR + (rng() - 0.5) * 0.6;
      return {
        startAng: rng() * Math.PI * 2,
        impactX,
        impactZ,
        fallSec: 0.7 + rng() * 0.4,        // ~0.7–1.1 s caída
        cycleSec: 2.2 + rng() * 0.8,       // ciclo ~2.2–3.0 s
        offsetSec: (i / N) * 1.8 + rng() * 0.3,
        size: 0.85 + rng() * 0.6,
        craterR: 0.7 + rng() * 0.45
      };
    });
  }, []);

  useFrame((state) => {
    if (!active) return;
    const t = getElapsed(state.clock.elapsedTime);
    if (t > durationSec) {
      if (!finished) setFinished(true);
      return;
    }
    setTNow(t);
  });

  // Al terminar la duración, deja de renderizarse el modelo 3D — el aftermath
  // queda en las plantas destruidas, pero no siguen cayendo más meteoritos.
  if (!active || finished) return null;
  return (
    <>
      {/* Luz ambiente naranja que pulsa con los impactos */}
      <ambientLight intensity={0.4} color="#ff6020" />
      {meteors.map((spec, i) => <SingleMeteor key={i} spec={spec} tNow={tNow} />)}
    </>
  );
};

// ============================================================
// BOMBA NUCLEAR ☢️ — flash cegador en pantalla completa,
// columna de fuego central, hongo atómico que se expande (tallo +
// sombrero + nube secundaria), onda de choque visible en el suelo,
// tierra calcinada negra y resplandor radiactivo verdoso residual.
// ============================================================

const NuclearBomb: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 9 }) => {
  const whiteoutRef = useRef<THREE.Mesh>(null);
  const whiteout2Ref = useRef<THREE.Mesh>(null);
  const fireballRef = useRef<THREE.Mesh>(null);
  const fireball2Ref = useRef<THREE.Mesh>(null);

  // TALLO — grupo y segmentos
  const stalkGroupRef = useRef<THREE.Group>(null);
  const stalkSegRefs = useRef<Array<THREE.Mesh | null>>([]);

  // SOMBRERO — grupo y piezas
  const capGroupRef = useRef<THREE.Group>(null);
  const capTopRef = useRef<THREE.Mesh>(null);
  const capBottomRef = useRef<THREE.Mesh>(null);
  const capTorusRef = useRef<THREE.Mesh>(null);
  const capPuffRefs = useRef<Array<THREE.Mesh | null>>([]);

  // Collar/skirt donde tallo se une al sombrero
  const skirtRef = useRef<THREE.Mesh>(null);

  // Base surge — polvo expandiéndose por el suelo
  const baseSurgeRef = useRef<THREE.Mesh>(null);
  const baseSurge2Ref = useRef<THREE.Mesh>(null);

  // Shock waves y suelo calcinado
  const shockRef = useRef<THREE.Mesh>(null);
  const shock2Ref = useRef<THREE.Mesh>(null);
  const shock3Ref = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const scorchRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const getElapsed = useEffectClock(active);

  // Cuando termina la duración, el hongo completo se desmonta para no quedarse
  // suspendido en el cielo durante el aftermath del evento.
  const [finished, setFinished] = React.useState(false);
  React.useEffect(() => {
    if (!active) setFinished(false);
  }, [active]);

  // Configuración del tallo: 6 segmentos para columna turbulenta
  const stalkSegmentCount = 6;

  // Distribución de puffs alrededor del sombrero — 3 anillos
  const puffSpecs = useMemo(() => {
    const out: { angle: number; r: number; y: number; size: number; tier: number; phaseOff: number }[] = [];
    const tiers = [
      { y: 0.55, r: 0.95, count: 8, size: 0.85 },  // anillo superior
      { y: 0.05, r: 1.25, count: 12, size: 1.05 }, // anillo ecuatorial
      { y: -0.35, r: 1.05, count: 9, size: 0.92 }, // anillo inferior (parte enrollada)
    ];
    tiers.forEach((tier, ti) => {
      for (let i = 0; i < tier.count; i++) {
        const angle = (i / tier.count) * Math.PI * 2 + ti * 0.27;
        const sizeJitter = 0.78 + ((i * 7 + ti * 13) % 11) / 22;
        out.push({
          angle,
          r: tier.r,
          y: tier.y,
          size: tier.size * sizeJitter,
          tier: ti,
          phaseOff: ((i * 31 + ti * 19) % 100) / 100,
        });
      }
    });
    return out;
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;
    if (t > durationSec) {
      if (!finished) setFinished(true);
      return;
    }
    const tNow = state.clock.elapsedTime;

    // ===== Whiteout PRIMARIO — cegador, satura 1.3 s y baja lentamente =====
    let wo: number;
    if (t < 0.05) wo = t / 0.05;
    else if (t < 1.4) wo = 1;
    else wo = Math.max(0, 1 - (t - 1.4) * 0.55);
    if (whiteoutRef.current) {
      const mat = whiteoutRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = wo;
      whiteoutRef.current.visible = wo > 0.01;
    }
    // ===== Whiteout SECUNDARIO =====
    let wo2 = 0;
    if (t > 1.6 && t < 2.8) {
      const k = (t - 1.6) / 1.2;
      wo2 = Math.sin(k * Math.PI) * 0.85;
    }
    if (whiteout2Ref.current) {
      const mat = whiteout2Ref.current.material as THREE.MeshBasicMaterial;
      mat.opacity = wo2;
      whiteout2Ref.current.visible = wo2 > 0.01;
    }

    // ===== BOLA DE FUEGO — expande en el suelo y luego sube integrándose en el hongo =====
    let fbY = 1.8;
    let fbScale = 0;
    let fbOp = 0;
    if (t < 1.2) {
      fbScale = Math.min(t * 3.0, 3.2);
      fbOp = 1;
    } else if (t < 2.6) {
      const k = (t - 1.2) / 1.4;
      fbScale = 3.2 + k * 0.6;
      fbY = 1.8 + k * 4.5;
      fbOp = Math.max(0, 1 - k * 1.3);
    }
    if (fireballRef.current) {
      fireballRef.current.visible = fbOp > 0.01;
      fireballRef.current.scale.setScalar(fbScale);
      fireballRef.current.position.y = fbY;
      const mat = fireballRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = fbOp;
      const hot = Math.max(0, 1 - t * 0.35);
      mat.emissiveIntensity = 1 + hot * 4.5;
    }
    if (fireball2Ref.current) {
      fireball2Ref.current.visible = fbOp > 0.01;
      fireball2Ref.current.scale.setScalar(Math.min(t * 1.6, 1.7));
      fireball2Ref.current.position.y = fbY;
      const mat = fireball2Ref.current.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, Math.min(fbOp + 0.1, 1) - t * 0.45);
      mat.emissiveIntensity = 3 + Math.min(t * 4, 1) * 3;
    }

    // ===== TALLO — sube como columna turbulenta de 6 segmentos =====
    // Crece de t=0.6 a t=3.5; altura máxima 8.0
    const stalkP = Math.min(1, Math.max(0, (t - 0.6) / 2.9));
    const stalkHeight = stalkP * 8.0;
    if (stalkGroupRef.current) {
      stalkGroupRef.current.visible = stalkP > 0.02;
    }
    const segH = stalkHeight / stalkSegmentCount;
    for (let i = 0; i < stalkSegmentCount; i++) {
      const seg = stalkSegRefs.current[i];
      if (!seg) continue;
      const segP = Math.min(1, Math.max(0, stalkP * stalkSegmentCount - i));
      seg.visible = segP > 0.05;
      seg.scale.set(1, segH + 0.001, 1);
      seg.position.y = i * segH + segH * 0.5;
      // Pequeño giro y oscilación lateral para sensación turbulenta
      seg.rotation.y = tNow * (0.25 - i * 0.025) + i * 0.7;
      seg.position.x = Math.sin(tNow * 0.6 + i * 0.9) * 0.06 * segP;
      seg.position.z = Math.cos(tNow * 0.55 + i * 1.1) * 0.06 * segP;
      const mat = seg.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = Math.max(0.1, 0.85 - i * 0.13 - t * 0.04);
      mat.opacity = Math.min(0.92, segP * 0.95);
    }

    // ===== SOMBRERO — emerge sobre el tallo, se ensancha mientras sube =====
    const capP = Math.min(1, Math.max(0, (t - 1.5) / 2.5));
    const capScale = 0.3 + capP * 2.0;
    const capY = stalkHeight + 0.3;
    if (capGroupRef.current) {
      capGroupRef.current.visible = capP > 0.02;
      capGroupRef.current.position.y = capY + Math.sin(tNow * 0.5) * 0.08;
      capGroupRef.current.scale.setScalar(capScale);
      capGroupRef.current.rotation.y = tNow * 0.12;
    }

    // Cúpula superior (esfera achatada)
    if (capTopRef.current) {
      const mat = capTopRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = Math.max(0.18, 0.85 - t * 0.07);
      mat.opacity = Math.min(0.92, capP * 1.1);
    }
    // Cúpula inferior (parte oscura enrollada)
    if (capBottomRef.current) {
      const mat = capBottomRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = Math.max(0.06, 0.5 - t * 0.05);
      mat.opacity = Math.min(0.88, capP * 1.05);
    }
    // Toro de borde — "labio" rodante característico del sombrero
    if (capTorusRef.current) {
      capTorusRef.current.rotation.z = tNow * 0.18;
      const mat = capTorusRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = Math.max(0.12, 0.7 - t * 0.06);
      mat.opacity = Math.min(0.88, capP * 1.05);
    }
    // Puffs de turbulencia alrededor del sombrero
    for (let i = 0; i < puffSpecs.length; i++) {
      const puff = capPuffRefs.current[i];
      const spec = puffSpecs[i];
      if (!puff || !spec) continue;
      const indiv = Math.min(1, capP * 1.25 + (i % 3) * 0.08);
      puff.visible = indiv > 0.1;
      const angle = spec.angle + tNow * 0.09;
      const radiusWobble = 1 + Math.sin(tNow * 0.8 + spec.phaseOff * 6.28) * 0.04;
      puff.position.x = Math.cos(angle) * spec.r * radiusWobble;
      puff.position.z = Math.sin(angle) * spec.r * radiusWobble;
      puff.position.y = spec.y + Math.sin(tNow * 0.7 + spec.phaseOff * 6.28) * 0.04;
      const pulse = 1 + Math.sin(tNow * 1.1 + spec.phaseOff * 6.28) * 0.06;
      puff.scale.setScalar(spec.size * indiv * pulse);
      const mat = puff.material as THREE.MeshStandardMaterial;
      const tierBrightness = spec.tier === 0 ? 0.45 : spec.tier === 1 ? 0.35 : 0.2;
      mat.emissiveIntensity = Math.max(0.05, tierBrightness - t * 0.04);
      mat.opacity = Math.min(0.78, indiv * 0.85);
    }

    // ===== SKIRT — collar donde tallo y sombrero se encuentran =====
    if (skirtRef.current) {
      const skirtP = Math.min(1, Math.max(0, (t - 1.8) / 1.5));
      skirtRef.current.visible = skirtP > 0.05;
      skirtRef.current.position.y = stalkHeight - 0.2;
      const skirtScale = (0.55 + skirtP * 0.5) * (0.8 + capScale * 0.4);
      skirtRef.current.scale.setScalar(skirtScale);
      skirtRef.current.rotation.z = tNow * 0.13;
      skirtRef.current.rotation.y = tNow * 0.08;
      const mat = skirtRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.min(0.72, skirtP * 0.85);
      mat.emissiveIntensity = Math.max(0.08, 0.45 - t * 0.04);
    }

    // ===== BASE SURGE — disco de polvo expandiéndose por el suelo =====
    if (baseSurgeRef.current) {
      baseSurgeRef.current.visible = t > 0.3;
      const surgeP = Math.min(1, (t - 0.3) / 3.5);
      baseSurgeRef.current.scale.set(1 + surgeP * 11, 1 + surgeP * 11, 1);
      const mat = baseSurgeRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, 0.6 - surgeP * 0.4);
    }
    if (baseSurge2Ref.current) {
      baseSurge2Ref.current.visible = t > 0.6;
      const surgeP2 = Math.min(1, (t - 0.6) / 4.5);
      baseSurge2Ref.current.scale.set(1 + surgeP2 * 8, 1 + surgeP2 * 8, 1);
      const mat = baseSurge2Ref.current.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, 0.5 - surgeP2 * 0.3);
    }

    // ===== TRES ondas de choque escalonadas =====
    [{ ref: shockRef, delay: 0.0, scaleK: 5.5, opMul: 0.95 },
     { ref: shock2Ref, delay: 0.35, scaleK: 4.5, opMul: 0.75 },
     { ref: shock3Ref, delay: 0.85, scaleK: 3.5, opMul: 0.6 }
    ].forEach(({ ref, delay, scaleK, opMul }) => {
      const tt = t - delay;
      if (!ref.current) return;
      ref.current.visible = tt > 0 && tt < 4;
      if (ref.current.visible) {
        ref.current.scale.setScalar(0.5 + tt * scaleK);
        const mat = ref.current.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, opMul - tt * 0.22);
      }
    });

    if (ringRef.current) {
      ringRef.current.visible = t > 0.5 && t < 6;
      ringRef.current.scale.setScalar(1 + t * 1.6);
      const mat = ringRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, 0.65 - t * 0.10);
    }

    // ===== Suelo calcinado con resplandor radiactivo =====
    if (scorchRef.current) {
      scorchRef.current.visible = t > 0.3;
      const mat = scorchRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.min(0.95, (t - 0.3) * 1.4);
      mat.emissiveIntensity = 0.4 + (0.5 + Math.sin(tNow * 4) * 0.3) * Math.min(1, t / 2);
    }

    // ===== Luz cegadora — pulsos múltiples =====
    if (lightRef.current) {
      const base = Math.max(0, 25 * Math.exp(-t * 0.55));
      const pulse = t < 2.5 ? Math.abs(Math.sin(tNow * 14)) * 8 : 0;
      lightRef.current.intensity = base + pulse;
    }

  });

  if (!active || finished) return null;
  return (
    <>
      {/* Whiteout PRIMARIO — plano blanco gigante delante de la cámara */}
      <mesh ref={whiteoutRef} position={[0, 4, 0]} scale={[60, 60, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Whiteout SECUNDARIO — segundo pulso amarillento */}
      <mesh ref={whiteout2Ref} position={[0, 4, 0]} scale={[60, 60, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#fff8c0" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Bola de fuego principal (sube y se integra en el hongo) */}
      <mesh ref={fireballRef} position={[0, 1.8, 0]} scale={0}>
        <sphereGeometry args={[1.4, 28, 22]} />
        <meshStandardMaterial color="#ffeb70" emissive="#ff7a18" emissiveIntensity={4} transparent opacity={1} />
      </mesh>
      {/* Núcleo blanco cegador (interior) */}
      <mesh ref={fireball2Ref} position={[0, 1.8, 0]} scale={0}>
        <sphereGeometry args={[1.4, 22, 18]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={5} transparent opacity={1} />
      </mesh>

      {/* Luz del estallido */}
      <pointLight ref={lightRef} position={[0, 4, 0]} color="#fff0a0" intensity={0} distance={45} decay={1.6} />
      <ambientLight intensity={0.6} color="#fff4c0" />

      {/* TALLO — 6 segmentos cilíndricos con ligero taper y giro */}
      <group ref={stalkGroupRef} position={[0, 0, 0]} visible={false}>
        {Array.from({ length: stalkSegmentCount }).map((_, i) => {
          const taperHi = 1.0 - (i + 1) / stalkSegmentCount * 0.28;
          const taperLo = 1.0 - i / stalkSegmentCount * 0.28;
          const tone = i % 2 === 0 ? '#9a7858' : '#876650';
          const emit = i % 2 === 0 ? '#ff5018' : '#d04018';
          return (
            <mesh
              key={i}
              ref={(el) => { stalkSegRefs.current[i] = el; }}
            >
              <cylinderGeometry args={[0.95 * taperHi, 1.18 * taperLo, 1, 22]} />
              <meshStandardMaterial color={tone} emissive={emit} emissiveIntensity={0.7} transparent opacity={0.9} roughness={1} />
            </mesh>
          );
        })}
      </group>

      {/* SOMBRERO — grupo con cúpulas, toro de borde y puffs de turbulencia */}
      <group ref={capGroupRef} position={[0, 6.5, 0]} visible={false}>
        {/* Cúpula superior — esfera achatada en Y */}
        <mesh ref={capTopRef} position={[0, 0.35, 0]} scale={[1.7, 1.05, 1.7]}>
          <sphereGeometry args={[1, 28, 20]} />
          <meshStandardMaterial color="#c8a070" emissive="#ff5818" emissiveIntensity={0.85} transparent opacity={0.9} roughness={0.95} />
        </mesh>
        {/* Cúpula inferior — semiesfera invertida, más oscura (parte enrollada) */}
        <mesh ref={capBottomRef} position={[0, -0.05, 0]} scale={[1.55, 0.8, 1.55]} rotation={[Math.PI, 0, 0]}>
          <sphereGeometry args={[1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#5a4030" emissive="#3a1808" emissiveIntensity={0.45} transparent opacity={0.86} roughness={1} side={THREE.DoubleSide} />
        </mesh>
        {/* Toro de borde — "labio" rodante */}
        <mesh ref={capTorusRef} position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.5, 0.52, 14, 36]} />
          <meshStandardMaterial color="#a07050" emissive="#ff4018" emissiveIntensity={0.65} transparent opacity={0.85} roughness={0.95} />
        </mesh>
        {/* Puffs de turbulencia alrededor del sombrero */}
        {puffSpecs.map((spec, i) => (
          <mesh
            key={i}
            ref={(el) => { capPuffRefs.current[i] = el; }}
            position={[Math.cos(spec.angle) * spec.r, spec.y, Math.sin(spec.angle) * spec.r]}
          >
            <sphereGeometry args={[0.55, 14, 10]} />
            <meshStandardMaterial
              color={spec.tier === 0 ? '#b08862' : spec.tier === 1 ? '#967450' : '#6a4830'}
              emissive={spec.tier === 0 ? '#ff7028' : spec.tier === 1 ? '#d04818' : '#601808'}
              emissiveIntensity={0.4}
              transparent
              opacity={0.7}
              roughness={1}
            />
          </mesh>
        ))}
      </group>

      {/* SKIRT — collar oscuro donde el tallo se une al sombrero */}
      <mesh ref={skirtRef} position={[0, 5.5, 0]} rotation={[Math.PI / 2, 0, 0]} visible={false}>
        <torusGeometry args={[1.6, 0.45, 12, 32]} />
        <meshStandardMaterial color="#6a5040" emissive="#a02818" emissiveIntensity={0.4} transparent opacity={0.7} roughness={1} />
      </mesh>

      {/* BASE SURGE — disco de polvo expandiéndose por el suelo */}
      <mesh ref={baseSurgeRef} position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.5, 2.5, 48]} />
        <meshStandardMaterial color="#8a6850" emissive="#603020" emissiveIntensity={0.25} transparent opacity={0.6} side={THREE.DoubleSide} roughness={1} />
      </mesh>
      <mesh ref={baseSurge2Ref} position={[0, 0.18, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.3, 1.8, 48]} />
        <meshStandardMaterial color="#6a5040" emissive="#401810" emissiveIntensity={0.2} transparent opacity={0.5} side={THREE.DoubleSide} roughness={1} />
      </mesh>

      {/* Tres ondas de choque escalonadas */}
      <mesh ref={shockRef} position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.7, 1.05, 48]} />
        <meshBasicMaterial color="#fff0a0" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={shock2Ref} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.7, 0.95, 48]} />
        <meshBasicMaterial color="#ffd070" transparent opacity={0.75} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={shock3Ref} position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.7, 0.9, 48]} />
        <meshBasicMaterial color="#ffa050" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ringRef} position={[0, 0.10, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.5, 1.8, 36]} />
        <meshStandardMaterial color="#b89870" transparent opacity={0.55} roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {/* Tierra calcinada con resplandor radiactivo */}
      <mesh ref={scorchRef} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[8, 56]} />
        <meshStandardMaterial color="#0a0a08" emissive="#3aff66" emissiveIntensity={0.3} transparent opacity={0} side={THREE.DoubleSide} roughness={1} />
      </mesh>
    </>
  );
};

// ============================================================
// ZOMBIES 🧟 — figuras grises-verdosas que emergen del suelo
// con una mano levantada, se yerguen hasta su altura completa y
// caminan tambaleándose hacia el centro. Bruma verdosa, manchas
// de sangre en el suelo y luz ominosa.
// ============================================================

interface ZombieSpec {
  startX: number;
  startZ: number;
  hue: 'pale' | 'rotten' | 'gray';
  size: number;
  emergeDelay: number;
  walkPhase: number;
  walkSpeed: number;
  armPhase: number;
}

const Zombie: React.FC<{ spec: ZombieSpec; tNow: number }> = ({ spec, tNow }) => {
  const groupRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Mesh>(null);
  const rightLegRef = useRef<THREE.Mesh>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);

  // Color base según hue
  const skin =
    spec.hue === 'pale' ? '#9aa090'
    : spec.hue === 'rotten' ? '#6a7a4a'
    : '#7a7a7a';
  const accent =
    spec.hue === 'pale' ? '#4a5040'
    : spec.hue === 'rotten' ? '#3a4a1a'
    : '#3a3a3a';
  const cloth = '#3a2818';

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;

    // Emergencia: 0–1.5 s subiendo desde y=-1.4 hasta y=0
    const since = Math.max(0, tNow - spec.emergeDelay);
    const emergeP = Math.min(1, since / 1.5);
    const emergeY = -1.4 + emergeP * 1.4;

    // Después de emerger, camina hacia el centro
    const walkSince = Math.max(0, since - 1.5);
    const sxNorm = Math.hypot(spec.startX, spec.startZ) || 1;
    const dirX = -spec.startX / sxNorm;
    const dirZ = -spec.startZ / sxNorm;
    const walkDist = walkSince * spec.walkSpeed;
    const px = spec.startX + dirX * walkDist;
    const pz = spec.startZ + dirZ * walkDist;
    // Lurch (bamboleo lateral)
    const lurch = Math.sin(t * 3 + spec.walkPhase) * 0.08;

    groupRef.current.position.set(px + lurch, emergeY, pz);
    groupRef.current.rotation.y = Math.atan2(dirX, dirZ);

    // Walk-cycle (solo cuando ya está fuera)
    const moving = walkSince > 0;
    const cycle = Math.sin(t * 4 + spec.walkPhase);
    if (leftLegRef.current && rightLegRef.current) {
      leftLegRef.current.rotation.x = moving ? cycle * 0.45 : 0;
      rightLegRef.current.rotation.x = moving ? -cycle * 0.45 : 0;
    }
    // Brazos extendidos hacia delante con leve oscilación
    if (leftArmRef.current && rightArmRef.current) {
      const baseArmX = -Math.PI / 2.4;
      leftArmRef.current.rotation.x = baseArmX + Math.sin(t * 2 + spec.armPhase) * 0.1;
      rightArmRef.current.rotation.x = baseArmX + Math.sin(t * 2 + spec.armPhase + 1) * 0.1;
    }
    // Torso se ladea según el lurch
    if (torsoRef.current) {
      torsoRef.current.rotation.z = lurch * 0.6;
      torsoRef.current.rotation.x = 0.12;
    }
  });

  const s = spec.size;

  return (
    <group ref={groupRef} scale={s}>
      {/* Sombra/mancha de tierra removida bajo el zombi */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.05, 0.35, 16]} />
        <meshBasicMaterial color="#1a0a08" transparent opacity={0.45} side={THREE.DoubleSide} />
      </mesh>

      {/* Piernas: dos cilindros con pivote arriba */}
      <group position={[0.13, 0.85, 0]}>
        <mesh ref={leftLegRef} position={[0, -0.42, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.10, 0.85, 8]} />
          <meshStandardMaterial color={cloth} roughness={0.9} />
        </mesh>
      </group>
      <group position={[-0.13, 0.85, 0]}>
        <mesh ref={rightLegRef} position={[0, -0.42, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.10, 0.85, 8]} />
          <meshStandardMaterial color={cloth} roughness={0.9} />
        </mesh>
      </group>

      {/* Torso (con pivote para inclinarse) */}
      <group ref={torsoRef} position={[0, 1.0, 0]}>
        <mesh castShadow scale={[0.35, 0.55, 0.22]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={cloth} roughness={0.9} />
        </mesh>
        {/* Camisa rota: parches más claros */}
        <mesh position={[0.05, -0.18, 0.12]} scale={[0.12, 0.18, 0.02]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#5a4030" roughness={0.95} />
        </mesh>

        {/* Cabeza — verdosa con ojos rojos y boca oscura */}
        <mesh position={[0, 0.50, 0]} scale={[0.18, 0.22, 0.20]} castShadow>
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial color={skin} roughness={0.85} />
        </mesh>
        {/* Ojos */}
        <mesh position={[0.06, 0.53, 0.18]} scale={0.025}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshStandardMaterial color="#ff2010" emissive="#ff3020" emissiveIntensity={1.2} />
        </mesh>
        <mesh position={[-0.06, 0.53, 0.18]} scale={0.025}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshStandardMaterial color="#ff2010" emissive="#ff3020" emissiveIntensity={1.2} />
        </mesh>
        {/* Boca oscura entreabierta */}
        <mesh position={[0, 0.42, 0.20]} scale={[0.07, 0.025, 0.01]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#1a0808" />
        </mesh>
        {/* Mancha de sangre en la barbilla */}
        <mesh position={[0, 0.38, 0.205]} scale={[0.04, 0.03, 0.01]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#5a0a08" emissive="#3a0606" emissiveIntensity={0.4} />
        </mesh>

        {/* Brazos extendidos al frente — pivote en hombro */}
        <group ref={leftArmRef} position={[0.18, 0.18, 0]} rotation={[0, 0, 0.1]}>
          <mesh position={[0, -0.32, 0.1]} castShadow>
            <cylinderGeometry args={[0.07, 0.06, 0.55, 8]} />
            <meshStandardMaterial color={accent} roughness={0.9} />
          </mesh>
          {/* Mano */}
          <mesh position={[0, -0.62, 0.2]} scale={0.07}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshStandardMaterial color={skin} roughness={0.9} />
          </mesh>
        </group>
        <group ref={rightArmRef} position={[-0.18, 0.18, 0]} rotation={[0, 0, -0.1]}>
          <mesh position={[0, -0.32, 0.1]} castShadow>
            <cylinderGeometry args={[0.07, 0.06, 0.55, 8]} />
            <meshStandardMaterial color={accent} roughness={0.9} />
          </mesh>
          <mesh position={[0, -0.62, 0.2]} scale={0.07}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshStandardMaterial color={skin} roughness={0.9} />
          </mesh>
        </group>
      </group>
    </group>
  );
};

const ZombieHorde: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 9 }) => {
  const fogRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const bloodRef = useRef<THREE.Group>(null);
  const getElapsed = useEffectClock(active);
  const [tNow, setTNow] = React.useState(0);

  const zombies = useMemo<ZombieSpec[]>(() => {
    const rng = makeRng(991001);
    const N = 12;
    const list: ZombieSpec[] = [];
    const hues: ZombieSpec['hue'][] = ['pale', 'rotten', 'gray'];
    for (let i = 0; i < N; i++) {
      // Distribución en círculo alrededor del centro a r=4..5
      const ang = (i / N) * Math.PI * 2 + rng() * 0.3;
      const r = 4 + rng() * 1.2;
      list.push({
        startX: Math.cos(ang) * r,
        startZ: Math.sin(ang) * r,
        hue: hues[i % 3],
        size: 0.9 + rng() * 0.3,
        emergeDelay: rng() * 2.5,
        walkPhase: rng() * Math.PI * 2,
        walkSpeed: 0.20 + rng() * 0.10,
        armPhase: rng() * Math.PI * 2
      });
    }
    return list;
  }, []);

  const blood = useMemo(() => {
    const rng = makeRng(991002);
    return Array.from({ length: 20 }).map(() => ({
      x: (rng() - 0.5) * 7,
      z: (rng() - 0.5) * 7,
      r: 0.15 + rng() * 0.3,
      delay: rng() * 4
    }));
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;
    setTNow(t);
    if (fogRef.current) {
      const mat = fogRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.min(0.4, t * 0.15);
      fogRef.current.rotation.z = state.clock.elapsedTime * 0.05;
    }
    if (lightRef.current) {
      // Pulso ominoso verdoso
      lightRef.current.intensity = 1.5 + Math.sin(state.clock.elapsedTime * 2) * 0.4;
    }
    if (bloodRef.current) {
      bloodRef.current.children.forEach((c, i) => {
        const b = blood[i]; if (!b) return;
        const u = Math.max(0, t - b.delay);
        const phase = Math.min(1, u * 1.2);
        c.scale.setScalar(phase);
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = phase * 0.85;
      });
    }
    void durationSec;
  });

  if (!active) return null;
  return (
    <>
      {/* Niebla verdosa baja */}
      <mesh ref={fogRef} position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial color="#6a8a4a" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Manchas de sangre en el suelo */}
      <group ref={bloodRef}>
        {blood.map((b, i) => (
          <mesh key={i} position={[b.x, 0.04, b.z]} rotation={[-Math.PI / 2, 0, 0]} scale={0}>
            <circleGeometry args={[b.r, 12]} />
            <meshStandardMaterial color="#3a0808" emissive="#1a0303" emissiveIntensity={0.3} transparent opacity={0} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>

      {/* Luz ominosa verdosa pulsante */}
      <pointLight ref={lightRef} position={[0, 3.5, 0]} color="#7aff8a" intensity={1.5} distance={15} decay={2} />

      {/* La horda */}
      {zombies.map((z, i) => <Zombie key={i} spec={z} tNow={tNow} />)}
    </>
  );
};

// ============================================================
// Campo (grid de plantas)
// ============================================================

const CropField: React.FC<FarmSceneProps> = ({ simulacion, vfxEvents }) => {
  const grid = useMemo(() => {
    const superficie = Number(simulacion.superficieHectareas) || 1;
    const dim = Math.max(4, Math.min(8, Math.round(3 + superficie)));
    const spacing = 8 / dim;
    // Seed estable basada en la simulación: misma siembra mientras no se cambie la simulación
    const baseSeed = (simulacion.idSimulacion ?? 1) * 1000;
    const rng = makeRng(baseSeed);
    const cells: Array<{ x: number; z: number; seed: number; scale: number }> = [];
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        const x = -4 + spacing / 2 + i * spacing;
        const z = -4 + spacing / 2 + j * spacing;
        cells.push({
          x: x + (rng() - 0.5) * spacing * 0.2,
          z: z + (rng() - 0.5) * spacing * 0.2,
          seed: rng() * 10,
          scale: 0.7 + rng() * 0.2
        });
      }
    }
    return cells;
  }, [simulacion.superficieHectareas, simulacion.idSimulacion]);

  return (
    <>
      {grid.map((cell, i) => (
        <Plant
          key={i}
          position={[cell.x, 0.05, cell.z]}
          etapa={simulacion.etapaFenologica}
          salud={simulacion.saludActual}
          alturaCm={simulacion.alturaActual}
          cultivo={simulacion.tipoCultivo}
          seed={cell.seed}
          scale={cell.scale}
          vfxEvents={vfxEvents}
        />
      ))}
    </>
  );
};

// ============================================================
// Escena completa
// ============================================================

// ============================================================
// Cubo de "papel cuadriculado" envolviendo toda la escena
// ============================================================

interface PaperRoomProps {
  /** Lado horizontal del cubo (X y Z). Debe ser bastante mayor que la parcela. */
  size: number;
  /** Altura del cubo (Y). El suelo está en y=0, el techo en y=height. */
  height: number;
  /** Marca de doodles atmosféricos para las paredes. */
  clima: 'normal' | 'caluroso' | 'lluvioso' | 'frio';
}

const PaperRoom: React.FC<PaperRoomProps> = ({ size, height, clima }) => {
  // Suelo: textura única con cuadrícula + REGLAS dibujadas en los 4 bordes.
  const floorTex = useMemo(() => createFloorRulerTexture(size), [size]);
  // Techo: cuadrícula simple, repetida.
  const ceilTex  = useMemo(() => paperTextureFor(size, size), [size]);
  // Cada pared tiene su propio set de doodles (mismo clima, seed distinto)
  // para que el cubo no se vea simétrico.
  const wallTexN = useMemo(() => createWallDoodleTexture(size, height, clima, 101), [size, height, clima]);
  const wallTexS = useMemo(() => createWallDoodleTexture(size, height, clima, 202), [size, height, clima]);
  const wallTexE = useMemo(() => createWallDoodleTexture(size, height, clima, 303), [size, height, clima]);
  const wallTexW = useMemo(() => createWallDoodleTexture(size, height, clima, 404), [size, height, clima]);

  const half = size / 2;

  const WallMesh: React.FC<{ position: [number, number, number]; rotationY: number; tex: THREE.Texture | null }> = ({ position, rotationY, tex }) => (
    <mesh position={position} rotation={[0, rotationY, 0]}>
      <planeGeometry args={[size, height]} />
      <meshStandardMaterial
        map={tex ?? undefined}
        color={tex ? '#ffffff' : PAPER_BG}
        roughness={1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );

  return (
    <group>
      {/* Suelo (con reglas en los bordes) */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial
          map={floorTex ?? undefined}
          color={floorTex ? '#ffffff' : PAPER_BG}
          roughness={1}
        />
      </mesh>
      {/* Techo (cuadrícula simple) */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, height, 0]}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial
          map={ceilTex ?? undefined}
          color={ceilTex ? '#ffffff' : PAPER_BG}
          roughness={1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Paredes con doodles de clima — cada una con seed propio */}
      <WallMesh position={[0, height / 2, -half]} rotationY={0}           tex={wallTexN} />
      <WallMesh position={[0, height / 2,  half]} rotationY={Math.PI}      tex={wallTexS} />
      <WallMesh position={[-half, height / 2, 0]} rotationY={Math.PI / 2}  tex={wallTexW} />
      <WallMesh position={[ half, height / 2, 0]} rotationY={-Math.PI / 2} tex={wallTexE} />
    </group>
  );
};

// ============================================================
// Banderitas 3D para eventos activos
// ============================================================

interface FlagProps {
  position: [number, number, number];
  emoji: string;
  color?: string;
  /** Pequeña rotación para que no todas miren igual. */
  rotationY?: number;
}

const Flag: React.FC<FlagProps> = ({ position, emoji, color = '#fff4cc', rotationY = 0 }) => {
  const tex = useMemo(() => createEmojiFlagTexture(emoji, color), [emoji, color]);
  const flagRef = useRef<THREE.Group>(null);

  // Pequeña oscilación del paño como bandera al viento
  useFrame((state) => {
    if (!flagRef.current) return;
    flagRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.6 + position[0] + position[2]) * 0.04;
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Palo */}
      <mesh castShadow position={[0, 0.95, 0]}>
        <cylinderGeometry args={[0.025, 0.03, 1.9, 6]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
      </mesh>
      {/* Punta del palo */}
      <mesh position={[0, 1.95, 0]}>
        <sphereGeometry args={[0.05, 6, 6]} />
        <meshStandardMaterial color="#1a1208" roughness={0.85} />
      </mesh>
      {/* Paño con emoji — anclado al palo en su lado izquierdo */}
      <group ref={flagRef} position={[0, 1.55, 0]}>
        <mesh castShadow position={[0.4, 0, 0]}>
          <planeGeometry args={[0.8, 0.6]} />
          <meshStandardMaterial
            map={tex ?? undefined}
            color={tex ? '#ffffff' : color}
            roughness={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
};

interface EventFlagsProps {
  eventos: EventoBanderita[];
  /** Lado de la parcela arada para anclar las banderitas dentro. */
  parcelSize: number;
}

const EventFlags: React.FC<EventFlagsProps> = ({ eventos, parcelSize }) => {
  // Posiciones estables por id del evento — no se mueven en cada frame, ni cambian si
  // se reordena la lista. Distribuimos en los bordes de la parcela para no tapar las plantas.
  const placed = useMemo(() => {
    return eventos.map((ev, i) => {
      const rng = seedRng(typeof ev.id === 'number' ? ev.id : i * 9173);
      // Ángulo y radio dentro del perímetro de la parcela
      const angle = rng() * Math.PI * 2;
      const r = parcelSize * (0.42 + rng() * 0.08);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const rotY = rng() * Math.PI * 2;
      return { ev, x, z, rotY };
    });
  }, [eventos, parcelSize]);

  return (
    <>
      {placed.map(({ ev, x, z, rotY }) => (
        <Flag
          key={ev.id}
          position={[x, 0, z]}
          emoji={ev.emoji}
          color={ev.color}
          rotationY={rotY}
        />
      ))}
    </>
  );
};

// ============================================================
// Aspersor 3D giratorio con arcos de gotas
// ============================================================

const Sprinkler: React.FC<{ active: boolean }> = ({ active }) => {
  const headRef = useRef<THREE.Group>(null);
  const dropsRef = useRef<THREE.Group>(null);

  // Distribución estable de "boquillas" alrededor (cada una emite gotas)
  const drops = useMemo(() => {
    const N = 48;
    return Array.from({ length: N }).map((_, i) => ({
      angle: (i / N) * Math.PI * 2 + (i % 3) * 0.18,
      // 3 grupos desfasados para que el surtidor no se vea sincrónico
      phase: (i % 3) / 3,
      distMax: 1.7 + (i % 5) * 0.18,
      yMax: 1.3 + ((i * 7) % 5) * 0.05,
      size: 0.04 + ((i * 11) % 5) * 0.008
    }));
  }, []);

  useFrame((state) => {
    if (!active) return;
    const t = state.clock.elapsedTime;
    if (headRef.current) headRef.current.rotation.y = t * 1.2;
    if (!dropsRef.current) return;
    dropsRef.current.children.forEach((c, i) => {
      const d = drops[i]; if (!d) return;
      const localT = ((t * 1.1) + d.phase) % 1; // 0..1
      const r = localT * d.distMax;
      // Trayectoria parabólica
      const y = 0.7 + Math.sin(localT * Math.PI) * d.yMax;
      c.position.x = Math.cos(d.angle) * r;
      c.position.y = y;
      c.position.z = Math.sin(d.angle) * r;
      const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.opacity = localT < 0.85 ? 0.9 : Math.max(0, 0.9 - (localT - 0.85) * 6);
    });
  });

  if (!active) return null;
  return (
    <group position={[0, 0, 0]}>
      {/* Base/pie del aspersor */}
      <mesh castShadow position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.07, 0.13, 0.5, 10]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.7} metalness={0.4} />
      </mesh>
      {/* Cabezal giratorio */}
      <group ref={headRef} position={[0, 0.6, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.12, 10, 8]} />
          <meshStandardMaterial color="#1f4f7a" roughness={0.4} metalness={0.6} />
        </mesh>
        {/* Dos boquillas opuestas */}
        <mesh position={[0.18, 0, 0]} rotation={[0, 0, -Math.PI / 6]}>
          <cylinderGeometry args={[0.025, 0.02, 0.18, 6]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[-0.18, 0, 0]} rotation={[0, 0, Math.PI / 6]}>
          <cylinderGeometry args={[0.025, 0.02, 0.18, 6]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      </group>
      {/* Gotas en arco */}
      <group ref={dropsRef}>
        {drops.map((d, i) => (
          <mesh key={i} scale={[d.size, d.size * 1.8, d.size]}>
            <sphereGeometry args={[1, 6, 5]} />
            <meshStandardMaterial
              color="#7fc1e8"
              emissive="#5fa8d3"
              emissiveIntensity={0.35}
              transparent
              opacity={0.9}
              roughness={0.2}
              metalness={0.5}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
};

// ============================================================
// Tractor que cruza la parcela al podar/fertilizar/airear
// ============================================================

const Tractor: React.FC<{ active: boolean }> = ({ active }) => {
  const ref = useRef<THREE.Group>(null);
  // ↓ Envolvemos cada rueda en un <group> y le ponemos un ref. Animamos la
  //   rotación.z del wrapper (rotación alrededor del eje Z mundial = el eje
  //   perpendicular al avance del tractor); dentro del wrapper el cilindro
  //   está rotado con X=PI/2 para tumbarse. Antes animábamos directamente
  //   rotation.x del cilindro, que ESCRIBÍA encima de la rotación inicial y
  //   hacía que las ruedas se desorientaran en lugar de girar como ruedas.
  const wheelsRef = useRef<THREE.Group[]>([]);
  const startRef = useRef<number | null>(null);
  const smokeRef = useRef<THREE.Mesh[]>([]);

  // Tractor avanza 14 unidades en 5 s → 2.8 ud/s. Las ruedas giran a una
  // velocidad angular acorde con su radio (ω = v / r). El signo negativo es
  // porque queremos que la parte de arriba de la rueda vaya hacia +X (el
  // sentido del movimiento), y la regla de mano derecha sobre Z hace lo
  // contrario.
  const SPEED_SMALL = -(2.8 / 0.22); // ruedas delanteras
  const SPEED_BIG   = -(2.8 / 0.38); // ruedas traseras

  useFrame((state) => {
    if (!active) {
      startRef.current = null;
      if (ref.current) ref.current.visible = false;
      return;
    }
    if (startRef.current == null) startRef.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - startRef.current;
    const dur = 5;
    const t = Math.min(elapsed / dur, 1);

    if (ref.current) {
      ref.current.visible = true;
      // Cruza la parcela por el centro de oeste a este (z=0). La parcela mide 10×10
      // centrada en el origen, así que entramos en x=-7 y salimos en x=7.
      ref.current.position.x = -7 + t * 14;
      ref.current.position.z = 0;
      // Ligero bamboleo vertical para que se note el motor
      ref.current.position.y = Math.abs(Math.sin(state.clock.elapsedTime * 12)) * 0.02;
    }
    wheelsRef.current.forEach((w, i) => {
      if (!w) return;
      const speed = i < 2 ? SPEED_SMALL : SPEED_BIG;
      w.rotation.z = elapsed * speed;
    });
    // Humo: rises and fades
    smokeRef.current.forEach((m, i) => {
      if (!m) return;
      const phase = ((state.clock.elapsedTime * 0.6) + i * 0.25) % 1;
      m.position.y = 1.5 + phase * 1.2;
      m.scale.setScalar(0.15 + phase * 0.35);
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.opacity = (1 - phase) * 0.55;
    });
  });

  if (!active) return null;
  return (
    <group ref={ref} position={[-7, 0, 0]}>
      {/* Sin rotación en Y → el tractor avanza "de frente" hacia +X (faros y
          ruedas pequeñas en X+0.5/+0.72; ruedas grandes en X-0.45). */}
      {/* Cuerpo principal */}
      <mesh castShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[1.4, 0.5, 0.8]} />
        <meshStandardMaterial color="#c62828" roughness={0.6} />
      </mesh>
      {/* Cabina */}
      <mesh castShadow position={[-0.15, 1.05, 0]}>
        <boxGeometry args={[0.7, 0.6, 0.7]} />
        <meshStandardMaterial color="#1565c0" roughness={0.6} />
      </mesh>
      {/* Ventana */}
      <mesh position={[-0.15, 1.1, 0.36]}>
        <planeGeometry args={[0.55, 0.4]} />
        <meshStandardMaterial color="#bbdcef" roughness={0.2} metalness={0.4} transparent opacity={0.7} />
      </mesh>
      {/* Chimenea */}
      <mesh position={[0.4, 1.05, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.5, 8]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
      {/* Ruedas delanteras (pequeñas). El wrapper <group> es el que rota en Z
          (eje horizontal perpendicular al avance); el cilindro dentro está
          tumbado con X=PI/2 para que su eje natural Y coincida con Z. */}
      <group ref={(g) => { if (g) wheelsRef.current[0] = g; }} position={[0.5, 0.25, 0.45]}>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 0.14, 14]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.85} />
        </mesh>
        {/* Tacos de la rueda — una franja diagonal blanca para que se note el giro */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.075]}>
          <ringGeometry args={[0.06, 0.18, 6]} />
          <meshStandardMaterial color="#444" side={THREE.DoubleSide} />
        </mesh>
      </group>
      <group ref={(g) => { if (g) wheelsRef.current[1] = g; }} position={[0.5, 0.25, -0.45]}>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 0.14, 14]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.85} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.075]}>
          <ringGeometry args={[0.06, 0.18, 6]} />
          <meshStandardMaterial color="#444" side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* Ruedas traseras (grandes) */}
      <group ref={(g) => { if (g) wheelsRef.current[2] = g; }} position={[-0.45, 0.38, 0.48]}>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.38, 0.38, 0.18, 16]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.85} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.095]}>
          <ringGeometry args={[0.10, 0.32, 6]} />
          <meshStandardMaterial color="#444" side={THREE.DoubleSide} />
        </mesh>
      </group>
      <group ref={(g) => { if (g) wheelsRef.current[3] = g; }} position={[-0.45, 0.38, -0.48]}>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.38, 0.38, 0.18, 16]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.85} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.095]}>
          <ringGeometry args={[0.10, 0.32, 6]} />
          <meshStandardMaterial color="#444" side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* Faros */}
      <mesh position={[0.72, 0.55, 0.25]}>
        <sphereGeometry args={[0.06, 6, 6]} />
        <meshStandardMaterial color="#ffec99" emissive="#ffec99" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0.72, 0.55, -0.25]}>
        <sphereGeometry args={[0.06, 6, 6]} />
        <meshStandardMaterial color="#ffec99" emissive="#ffec99" emissiveIntensity={0.6} />
      </mesh>
      {/* Humo (3 bolitas) */}
      {[0, 1, 2].map(i => (
        <mesh
          key={i}
          ref={(m) => { if (m) smokeRef.current[i] = m; }}
          position={[0.4, 1.5, 0]}
        >
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial color="#7a7a7a" transparent opacity={0.4} roughness={1} />
        </mesh>
      ))}
    </group>
  );
};

// ============================================================
// Espantapájaros (visible mientras hay mallas instaladas)
// ============================================================

const Scarecrow: React.FC<{ visible: boolean }> = ({ visible }) => {
  const ref = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);

  // Paja "estable" — la generamos una vez con seed fijo para que no salte cada frame.
  const strawBits = useMemo(() => {
    const rng = makeRng(909090);
    const groups = [
      { y: 1.62, rMin: 0.05, rMax: 0.13, count: 8 },   // cuello
      { y: 1.10, rMin: 0.28, rMax: 0.38, count: 6 },   // cintura (camisa abierta)
      { y: 1.32, rMin: 0.05, rMax: 0.12, count: 4 },   // pecho
      { y: 0.18, rMin: 0.10, rMax: 0.18, count: 5 },   // tobillos
    ];
    const out: { x: number; y: number; z: number; ax: number; az: number; len: number; tone: number }[] = [];
    groups.forEach(g => {
      for (let i = 0; i < g.count; i++) {
        const a = rng() * Math.PI * 2;
        const r = g.rMin + rng() * (g.rMax - g.rMin);
        out.push({
          x: Math.cos(a) * r,
          y: g.y + (rng() - 0.5) * 0.05,
          z: Math.sin(a) * r,
          ax: (rng() - 0.5) * 0.7,
          az: (rng() - 0.5) * 0.7,
          len: 0.14 + rng() * 0.11,
          tone: 0.85 + rng() * 0.3
        });
      }
    });
    // Paja en muñecas (extremos del brazo)
    [-0.58, 0.58].forEach(x => {
      for (let i = 0; i < 4; i++) {
        const a = rng() * Math.PI * 2;
        out.push({
          x: x + Math.cos(a) * 0.07,
          y: 1.36 + (rng() - 0.5) * 0.05,
          z: Math.sin(a) * 0.07,
          ax: (rng() - 0.5) * 0.9,
          az: (rng() - 0.5) * 0.9,
          len: 0.12 + rng() * 0.09,
          tone: 0.85 + rng() * 0.3
        });
      }
    });
    return out;
  }, []);

  // Parches de tela en la camisa (estables)
  const patches = useMemo(() => {
    const rng = makeRng(404040);
    return Array.from({ length: 4 }).map(() => ({
      x: (rng() - 0.5) * 0.45,
      y: 1.05 + rng() * 0.45,
      z: 0.105,
      rot: (rng() - 0.5) * 0.4,
      w: 0.10 + rng() * 0.08,
      h: 0.10 + rng() * 0.07,
      // Tonos beige/azul desgastados
      colorIdx: Math.floor(rng() * 3)
    }));
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    // Balanceo general (más cuerpo)
    ref.current.rotation.z = Math.sin(t * 0.55) * 0.05;
    ref.current.rotation.x = Math.cos(t * 0.4) * 0.025;
    // La cabeza cuelga un poco y oscila
    if (headRef.current) {
      headRef.current.rotation.z = Math.sin(t * 0.7 + 0.4) * 0.08;
      headRef.current.rotation.x = 0.18 + Math.cos(t * 0.35) * 0.03;
    }
  });

  if (!visible) return null;

  const trouser = '#3a4756';   // pantalones azul oscuro desgastado
  const shirt   = '#a83434';   // camisa roja descolorida
  const wood    = '#5a3a14';   // palo
  const hatCol  = '#3a2410';   // sombrero marrón oscuro
  const sack    = '#d4b070';   // cabeza saco
  const boot    = '#221610';   // botas

  const patchColors = ['#c5a06b', '#7a8aa0', '#9b6f3a'];

  return (
    <group ref={ref} position={[-3.6, 0, -3.6]}>
      {/* ===== Estructura interna de madera ===== */}
      {/* Palo vertical (un poco curvado / nudoso usando 3 segmentos) */}
      <mesh castShadow position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.05, 0.07, 0.7, 6]} />
        <meshStandardMaterial color={wood} roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0.01, 1.0, 0]} rotation={[0, 0, 0.02]}>
        <cylinderGeometry args={[0.04, 0.05, 0.65, 6]} />
        <meshStandardMaterial color="#623f17" roughness={0.95} />
      </mesh>
      {/* Brazo cruzado (más largo) */}
      <mesh castShadow position={[0, 1.36, 0]} rotation={[0, 0, Math.PI / 2 + 0.04]}>
        <cylinderGeometry args={[0.035, 0.035, 1.25, 6]} />
        <meshStandardMaterial color={wood} roughness={0.95} />
      </mesh>

      {/* ===== Pantalones ===== */}
      {/* Pernera izquierda */}
      <mesh castShadow position={[-0.13, 0.55, 0]}>
        <cylinderGeometry args={[0.10, 0.13, 0.8, 8]} />
        <meshStandardMaterial color={trouser} roughness={0.95} />
      </mesh>
      {/* Pernera derecha */}
      <mesh castShadow position={[0.13, 0.55, 0]}>
        <cylinderGeometry args={[0.10, 0.13, 0.8, 8]} />
        <meshStandardMaterial color={trouser} roughness={0.95} />
      </mesh>
      {/* Cinturón de cuerda */}
      <mesh castShadow position={[0, 0.94, 0]}>
        <torusGeometry args={[0.22, 0.025, 6, 18]} />
        <meshStandardMaterial color="#3a2410" roughness={0.95} />
      </mesh>
      {/* Botas */}
      <mesh castShadow position={[-0.13, 0.10, 0.05]}>
        <boxGeometry args={[0.22, 0.18, 0.30]} />
        <meshStandardMaterial color={boot} roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0.13, 0.10, 0.05]}>
        <boxGeometry args={[0.22, 0.18, 0.30]} />
        <meshStandardMaterial color={boot} roughness={0.95} />
      </mesh>

      {/* ===== Camisa (cuerpo) ===== */}
      {/* Torso ancho */}
      <mesh castShadow position={[0, 1.25, 0]}>
        <boxGeometry args={[0.62, 0.62, 0.22]} />
        <meshStandardMaterial color={shirt} roughness={0.9} />
      </mesh>
      {/* Mangas (cilindros a lo largo del brazo) */}
      <mesh castShadow position={[-0.36, 1.36, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.10, 0.11, 0.36, 8]} />
        <meshStandardMaterial color={shirt} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0.36, 1.36, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.10, 0.11, 0.36, 8]} />
        <meshStandardMaterial color={shirt} roughness={0.9} />
      </mesh>
      {/* Manos hechas con un nudo de tela claro al final de la manga */}
      <mesh castShadow position={[-0.58, 1.36, 0]}>
        <sphereGeometry args={[0.075, 8, 6]} />
        <meshStandardMaterial color="#caa67a" roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0.58, 1.36, 0]}>
        <sphereGeometry args={[0.075, 8, 6]} />
        <meshStandardMaterial color="#caa67a" roughness={0.95} />
      </mesh>

      {/* Parches de tela cosidos en la camisa */}
      {patches.map((p, i) => (
        <mesh key={`patch-${i}`} position={[p.x, p.y, p.z]} rotation={[0, 0, p.rot]}>
          <planeGeometry args={[p.w, p.h]} />
          <meshStandardMaterial color={patchColors[p.colorIdx]} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* Tirita cosida en la camisa (línea zigzag) */}
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh key={`st-${i}`} position={[-0.12 + i * 0.05, 1.18, 0.115]}>
          <boxGeometry args={[0.025, 0.012, 0.005]} />
          <meshStandardMaterial color="#1a1a1a" roughness={1} />
        </mesh>
      ))}

      {/* ===== Cabeza (saco de arpillera) ===== */}
      <group ref={headRef} position={[0, 1.86, 0]}>
        {/* Base de saco — esfera ligeramente aplastada */}
        <mesh castShadow scale={[1, 1.05, 1]}>
          <sphereGeometry args={[0.21, 14, 12]} />
          <meshStandardMaterial color={sack} roughness={0.95} />
        </mesh>
        {/* Cuerda atando el saco al cuello */}
        <mesh position={[0, -0.18, 0]}>
          <torusGeometry args={[0.13, 0.018, 6, 16]} />
          <meshStandardMaterial color="#3a2410" roughness={0.95} />
        </mesh>
        {/* Ojos tipo botón (anillo + centro) */}
        {[-0.07, 0.07].map((x, i) => (
          <group key={`eye-${i}`} position={[x, 0.03, 0.19]}>
            <mesh>
              <cylinderGeometry args={[0.035, 0.035, 0.005, 12]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.4} />
            </mesh>
            <mesh position={[0, 0, 0.005]}>
              <cylinderGeometry args={[0.012, 0.012, 0.006, 8]} />
              <meshStandardMaterial color="#fafaf5" roughness={0.4} />
            </mesh>
          </group>
        ))}
        {/* Nariz: pequeño bulto cosido */}
        <mesh position={[0, -0.02, 0.21]}>
          <sphereGeometry args={[0.025, 8, 6]} />
          <meshStandardMaterial color="#a8835a" roughness={0.95} />
        </mesh>
        {/* Boca cosida en cruz (línea horizontal + 4 puntadas) */}
        <mesh position={[0, -0.10, 0.198]} scale={[0.16, 0.012, 0.008]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
        {[-0.06, -0.02, 0.02, 0.06].map((dx, i) => (
          <mesh key={`tooth-${i}`} position={[dx, -0.10, 0.20]} scale={[0.005, 0.025, 0.008]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
        ))}
      </group>

      {/* ===== Sombrero de paja ===== */}
      <group position={[0, 2.10, 0]} rotation={[0.10, 0.15, -0.05]}>
        {/* Ala ancha y ligeramente caída */}
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.42, 0.42, 0.025, 24]} />
          <meshStandardMaterial color={hatCol} roughness={0.95} />
        </mesh>
        {/* Cinta del sombrero */}
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 0.045, 18]} />
          <meshStandardMaterial color="#7a1a1a" roughness={0.9} />
        </mesh>
        {/* Copa achatada con remate */}
        <mesh castShadow position={[0, 0.13, 0]}>
          <cylinderGeometry args={[0.22, 0.24, 0.20, 18]} />
          <meshStandardMaterial color={hatCol} roughness={0.95} />
        </mesh>
        <mesh castShadow position={[0, 0.24, 0]}>
          <cylinderGeometry args={[0.18, 0.22, 0.05, 16]} />
          <meshStandardMaterial color="#2a180b" roughness={0.95} />
        </mesh>
        {/* Pequeño rasgón en el ala */}
        <mesh position={[0.32, 0.005, 0.18]} rotation={[Math.PI / 2, 0.5, 0]}>
          <planeGeometry args={[0.10, 0.04]} />
          <meshStandardMaterial color="#1a0d05" side={THREE.DoubleSide} roughness={0.95} />
        </mesh>
      </group>

      {/* ===== Paja saliendo por todos lados ===== */}
      {strawBits.map((s, i) => (
        <mesh key={`straw-${i}`} position={[s.x, s.y, s.z]} rotation={[s.ax, 0, s.az]}>
          <cylinderGeometry args={[0.008, 0.004, s.len, 4]} />
          <meshStandardMaterial color={new THREE.Color('#d4a857').multiplyScalar(s.tone)} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
};

// ============================================================
// Vallado rústico alrededor del cultivo (acompaña al espantapájaros
// cuando el usuario aplica `instalacion_malla`). El lado de la cerca
// escala suavemente con la superficie de la parcela.
// ============================================================

interface FenceProps {
  visible: boolean;
  /** Hectáreas de la parcela — la valla se aleja un poco con más superficie. */
  superficie: number;
}

const Fence: React.FC<FenceProps> = ({ visible, superficie }) => {
  // Lado de la cerca: base 10 (igual que el terreno) + escala suave por hectárea,
  // con tope para no salirse del PaperRoom (size=40 → muros a ±20).
  const fenceLayout = useMemo(() => {
    const extra = Math.min(2.4, 0.08 * Math.max(0, superficie - 1));
    const side = 10 + extra;
    const half = side / 2;
    // Postes cada ~1.5 unidades (afecta densidad visual)
    const postsPerSide = Math.max(5, Math.round(side / 1.5) + 1);
    const step = side / (postsPerSide - 1);

    // Posiciones únicas de postes (evita duplicar las esquinas)
    const rng = makeRng(606060 + Math.floor(superficie * 7));
    const posts: { x: number; z: number; h: number; lean: number; tone: number }[] = [];
    for (let i = 0; i < postsPerSide; i++) {
      const offset = -half + i * step;
      // Sur y norte
      posts.push({ x: offset, z: -half, h: 1.15 + (rng() - 0.5) * 0.15, lean: (rng() - 0.5) * 0.05, tone: 0.85 + rng() * 0.3 });
      posts.push({ x: offset, z:  half, h: 1.15 + (rng() - 0.5) * 0.15, lean: (rng() - 0.5) * 0.05, tone: 0.85 + rng() * 0.3 });
      // Este y oeste — sin duplicar las esquinas (i==0 e i==postsPerSide-1)
      if (i > 0 && i < postsPerSide - 1) {
        posts.push({ x: -half, z: offset, h: 1.15 + (rng() - 0.5) * 0.15, lean: (rng() - 0.5) * 0.05, tone: 0.85 + rng() * 0.3 });
        posts.push({ x:  half, z: offset, h: 1.15 + (rng() - 0.5) * 0.15, lean: (rng() - 0.5) * 0.05, tone: 0.85 + rng() * 0.3 });
      }
    }
    return { side, half, posts };
  }, [superficie]);

  if (!visible) return null;
  const { side, half, posts } = fenceLayout;
  const railTopY = 0.95;
  const railMidY = 0.45;
  const railSize = 0.045;
  const baseWood = '#6b4a26';
  const darkWood = '#4a3017';

  // Helper: traviesa horizontal a lo largo de un lado.
  const Rail = ({ axis, y, z, x }: { axis: 'x' | 'z'; y: number; x?: number; z?: number }) => {
    if (axis === 'x') {
      return (
        <mesh position={[0, y, z!]}>
          <boxGeometry args={[side, railSize, railSize]} />
          <meshStandardMaterial color={baseWood} roughness={0.95} />
        </mesh>
      );
    }
    return (
      <mesh position={[x!, y, 0]}>
        <boxGeometry args={[railSize, railSize, side]} />
        <meshStandardMaterial color={baseWood} roughness={0.95} />
      </mesh>
    );
  };

  return (
    <group>
      {/* Postes */}
      {posts.map((p, i) => (
        <mesh
          key={`post-${i}`}
          castShadow
          position={[p.x, p.h / 2, p.z]}
          rotation={[p.lean, 0, p.lean * 0.7]}
        >
          <boxGeometry args={[0.10, p.h, 0.10]} />
          <meshStandardMaterial
            color={new THREE.Color(baseWood).multiplyScalar(p.tone)}
            roughness={0.95}
          />
        </mesh>
      ))}

      {/* Traviesas horizontales — dos alturas por lado */}
      <Rail axis="x" y={railTopY} z={-half} />
      <Rail axis="x" y={railTopY} z={ half} />
      <Rail axis="z" y={railTopY} x={-half} />
      <Rail axis="z" y={railTopY} x={ half} />
      <Rail axis="x" y={railMidY} z={-half} />
      <Rail axis="x" y={railMidY} z={ half} />
      <Rail axis="z" y={railMidY} x={-half} />
      <Rail axis="z" y={railMidY} x={ half} />

      {/* Tapas oscuras en los extremos de los postes de las esquinas
          (acabado más rústico, como si las puntas estuvieran quemadas) */}
      {[[-half, -half], [half, -half], [-half, half], [half, half]].map(([x, z], i) => (
        <mesh key={`cap-${i}`} position={[x, 1.18, z]}>
          <boxGeometry args={[0.13, 0.05, 0.13]} />
          <meshStandardMaterial color={darkWood} roughness={0.95} />
        </mesh>
      ))}

      {/* Puerta: en el sur (z = -half), centrada — abre un hueco de ~1.2u
          quitando la traviesa central y dejando dos postes más prominentes */}
      <mesh position={[-0.6, 0.95, -half]} rotation={[0, 0.05, 0]}>
        <boxGeometry args={[0.04, 0.85, 0.05]} />
        <meshStandardMaterial color={darkWood} roughness={0.95} />
      </mesh>
      <mesh position={[0.6, 0.95, -half]} rotation={[0, -0.05, 0]}>
        <boxGeometry args={[0.04, 0.85, 0.05]} />
        <meshStandardMaterial color={darkWood} roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.05, -half]}>
        <boxGeometry args={[1.2, 0.05, 0.05]} />
        <meshStandardMaterial color={darkWood} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.55, -half]}>
        <boxGeometry args={[1.2, 0.05, 0.05]} />
        <meshStandardMaterial color={darkWood} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.80, -half]} rotation={[0, 0, 0.4]}>
        <boxGeometry args={[1.4, 0.03, 0.05]} />
        <meshStandardMaterial color={darkWood} roughness={0.95} />
      </mesh>
    </group>
  );
};

// ============================================================
// Goteo de agua: pequeñas gotas que caen sobre la parcela tras un riego
// ============================================================

const LeafDrops: React.FC<{ active: boolean }> = ({ active }) => {
  const groupRef = useRef<THREE.Group>(null);
  const startRef = useRef<number | null>(null);

  const drops = useMemo(() => {
    const rng = makeRng(95124);
    return Array.from({ length: 40 }).map(() => ({
      x: (rng() - 0.5) * 9,
      z: (rng() - 0.5) * 9,
      yStart: 1.4 + rng() * 1.2,
      delay: rng() * 1.0,
      speed: 1.0 + rng() * 0.9,
      size: 0.035 + rng() * 0.035
    }));
  }, []);

  useFrame((state) => {
    if (!active) { startRef.current = null; return; }
    if (startRef.current == null) startRef.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - startRef.current;
    if (!groupRef.current) return;
    groupRef.current.children.forEach((c, i) => {
      const d = drops[i]; if (!d) return;
      const localT = Math.max(0, t - d.delay) * d.speed;
      const y = Math.max(0.05, d.yStart - localT);
      c.position.y = y;
      const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (y <= 0.06) {
        // Pequeña explosión: la gota se "aplasta" y se desvanece al tocar suelo
        const flatT = Math.min(1, (localT - (d.yStart - 0.06)) * 4);
        c.scale.set(d.size * (1 + flatT), d.size * (1 - flatT * 0.8), d.size * (1 + flatT));
        mat.opacity = Math.max(0, 0.85 - flatT * 0.85);
      } else {
        c.scale.set(d.size, d.size * 2.2, d.size);
        mat.opacity = 0.85;
      }
    });
  });

  if (!active) return null;
  return (
    <group ref={groupRef}>
      {drops.map((d, i) => (
        <mesh key={i} position={[d.x, d.yStart, d.z]} scale={[d.size, d.size * 2.2, d.size]}>
          <sphereGeometry args={[1, 6, 5]} />
          <meshStandardMaterial
            color="#7fc1e8"
            transparent
            opacity={0.85}
            roughness={0.15}
            metalness={0.5}
          />
        </mesh>
      ))}
    </group>
  );
};

// ============================================================
// Mancha de café estática en una esquina del suelo
// ============================================================

const coffeeStainTexture: THREE.CanvasTexture | null = (() => {
  if (typeof document === 'undefined') return null;
  const w = 256, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  // Aureola difusa
  const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.12, w / 2, h / 2, w * 0.48);
  grad.addColorStop(0, 'rgba(100, 60, 30, 0.34)');
  grad.addColorStop(0.7, 'rgba(100, 60, 30, 0.18)');
  grad.addColorStop(1, 'rgba(100, 60, 30, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // Anillo característico del café
  ctx.strokeStyle = 'rgba(70, 40, 18, 0.5)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.40, 0, Math.PI * 2);
  ctx.stroke();
  // Pequeñas salpicaduras
  const rng = seedRng(7777);
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const r = w * (0.48 + rng() * 0.12);
    const x = w / 2 + Math.cos(a) * r;
    const y = h / 2 + Math.sin(a) * r;
    const size = 2 + rng() * 7;
    ctx.fillStyle = `rgba(80, 45, 22, ${0.25 + rng() * 0.35})`;
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
  }
  // Mancha interior más oscura, ligeramente descentrada
  ctx.fillStyle = 'rgba(60, 30, 12, 0.32)';
  ctx.beginPath();
  ctx.ellipse(w / 2 + 10, h / 2 - 6, w * 0.28, h * 0.22, 0.3, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  return tex;
})();

const CoffeeStain: React.FC = () => {
  if (!coffeeStainTexture) return null;
  // Esquina noreste del suelo (lejos de la parcela 10×10 centrada)
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[12, 0.005, -13]}>
      <planeGeometry args={[4.5, 4.5]} />
      <meshStandardMaterial
        map={coffeeStainTexture}
        transparent
        opacity={0.7}
        depthWrite={false}
        roughness={1}
      />
    </mesh>
  );
};

export const FarmScene: React.FC<FarmSceneProps> = ({ simulacion, vfxEvent, vfxEvents, extinguishingEvents, clima = 'normal', eventosActivos = [], hasMallas = false }) => {
  // vfxEvents nunca debería ser undefined desde SimulationView, pero por
  // robustez (test, storybooks...) usamos un set vacío como fallback.
  const vfxSet = vfxEvents ?? new Set<string>();
  const extSet = extinguishingEvents ?? EMPTY_VFX_SET;
  const has = (e: string) => vfxSet.has(e);
  const isExtinguishing = (e: string) => extSet.has(e);
  // Antes el cielo y el pasto se oscurecían cuando la salud bajaba (efecto "nublado").
  // Con el look "papel cuadriculado" no hay cielo — mantenemos un mínimo de iluminación
  // dramática reduciendo solo la intensidad cuando la salud está muy mal.
  const malaSalud = simulacion.saludActual < 50;

  return (
    <Canvas
      shadows
      camera={{ position: [9, 7, 9], fov: 45 }}
      style={{ width: '100%', height: '100%', display: 'block' }}
      gl={{ antialias: true, alpha: false }}
    >
      {/* Fondo color "papel" — mismo tono que --paper-bg del body, así la escena
          parece dibujada sobre el mismo folio cuadriculado del resto de la app. */}
      <color attach="background" args={['#fafaf5']} />

      <Suspense fallback={null}>
        <ambientLight intensity={malaSalud ? 0.55 : 0.7} />
        <directionalLight
          position={[10, 15, 8]}
          intensity={malaSalud ? 1.0 : 1.4}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          color={malaSalud ? '#d4d8d0' : '#fff8e0'}
        />
        <hemisphereLight args={['#fafaf5', '#c4cdc0', 0.35]} />

        {/* Cubo de papel que envuelve toda la escena (suelo + paredes + techo).
            Tamaño generoso (60) y alto (36) para dejar margen amplio alrededor
            de la parcela (10×10) y que la cámara pueda alejarse hasta
            maxDistance=30 sin tocar las paredes. */}
        <PaperRoom size={60} height={36} clima={clima} />

        <Terrain humedad={simulacion.humedadSueloActual} tipoSuelo={simulacion.tipoSuelo} size={10} />
        <CropField simulacion={simulacion} vfxEvents={vfxSet} />

        {/* Banderitas clavadas alrededor de la parcela para cada evento activo */}
        <EventFlags eventos={eventosActivos} parcelSize={10} />

        {/* Mancha de café decorativa en una esquina del cubo */}
        <CoffeeStain />

        {/* Vallado rústico + espantapájaros — ambos aparecen mientras haya al
            menos una `instalacion_malla` aplicada. La cerca se escala con la
            superficie en hectáreas, así parcelas grandes la ven un poco más
            lejos del centro. */}
        <Fence visible={hasMallas} superficie={Number(simulacion.superficieHectareas) || 1} />
        <Scarecrow visible={hasMallas} />

        {/* Aspersor + goteo: aparecen 4s al aplicar un riego (flashVFX === 'riego') */}
        <Sprinkler  active={has('riego')} />
        <LeafDrops  active={has('riego')} />

        {/* Tractor: cruza la parcela al aplicar poda / fertilización / aireación */}
        <Tractor active={has('poda') || has('fertilizacion') || has('aireacion_suelo')} />

        {/* Modelos 3D específicos por evento — cada uno se monta solo cuando su VFX está activo.
            vfxEvents es un Set: varios pueden estar a la vez (ovni + tractor + fuego...). */}
        <TsunamiWave active={has('inundacion')} durationSec={5} />
        <Earthquake active={has('terremoto')} durationSec={5} />
        <Tornado active={has('tornado')} durationSec={4} />
        <Fire active={has('incendio_proximo')} durationSec={4} extinguishing={isExtinguishing('incendio_proximo')} />
        <Lightning active={has('rayo_caido')} durationSec={6} />
        <AcidRain active={has('lluvia_acida')} />
        <Snowfall active={has('nevada')} durationSec={4} />
        <Frost active={has('helada')} durationSec={4} />
        <Calima active={has('polvo_sahariano')} />
        <Drought active={has('sequia')} />
        <FogVolume active={has('niebla_persistente')} />
        <HeavyRain active={has('lluvia_torrencial')} durationSec={4} />
        <UFORadiation active={has('ola_radiacion_uv')} durationSec={7} />
        <UFOShootDown active={has('derribar_ovni')} durationSec={7} />

        {/* Enjambres de bichitos — uno por tipo de plaga, con su estilo propio */}
        <BugSwarm active={has('plaga')}              kind="plaga"              durationSec={5} />
        <BugSwarm active={has('pulgones')}           kind="pulgones"           durationSec={5} />
        <BugSwarm active={has('arana_roja')}         kind="arana_roja"         durationSec={5} />
        <BugSwarm active={has('caracoles')}          kind="caracoles"          durationSec={5} />
        <BugSwarm active={has('langostas')}          kind="langostas"          durationSec={5} />
        <BugSwarm active={has('marabunta_hormigas')} kind="marabunta_hormigas" durationSec={5} />

        {/* Manada de jabalíes (modelo realista con walk-cycle y comportamiento) */}
        <BoarHerd active={has('jabalies')} />

        {/* DESTRUCCIÓN TOTAL — coreografías catastróficas */}
        <Meteorite   active={has('meteorito')}     durationSec={8} />
        <NuclearBomb active={has('bomba_nuclear')} durationSec={9} />
        <ZombieHorde active={has('zombies')}       durationSec={9} />

        <ContactShadows position={[0, 0.01, 0]} opacity={0.35} blur={2.5} far={10} resolution={512} />

        <OrbitControls
          enablePan={false}
          enableZoom={true}
          // minDistance bajo → permite acercarse mucho a una planta concreta.
          minDistance={2.5}
          // maxDistance generoso para vista panorámica. Mantenemos un colchón
          // respecto a las paredes del PaperRoom (size=60 → muros a ±30).
          maxDistance={30}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.1}
          autoRotate={false}
        />
      </Suspense>
    </Canvas>
  );
};

// Solo re-render cuando cambien las propiedades visualmente relevantes
const sameBanderitas = (a: EventoBanderita[] = [], b: EventoBanderita[] = []) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].emoji !== b[i].emoji) return false;
  }
  return true;
};

// Compara dos Set<string> por contenido. Devuelve true si tienen el mismo
// tamaño y los mismos elementos (orden irrelevante).
const sameVfxSet = (a?: Set<string>, b?: Set<string>) => {
  const sa = a ?? EMPTY_VFX_SET;
  const sb = b ?? EMPTY_VFX_SET;
  if (sa === sb) return true;
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
};

const MemoFarmScene = React.memo(FarmScene, (prev, next) => {
  const a = prev.simulacion;
  const b = next.simulacion;
  return (
    prev.vfxEvent === next.vfxEvent &&
    sameVfxSet(prev.vfxEvents, next.vfxEvents) &&
    sameVfxSet(prev.extinguishingEvents, next.extinguishingEvents) &&
    prev.clima === next.clima &&
    prev.hasMallas === next.hasMallas &&
    sameBanderitas(prev.eventosActivos, next.eventosActivos) &&
    a.idSimulacion === b.idSimulacion &&
    a.saludActual === b.saludActual &&
    a.humedadSueloActual === b.humedadSueloActual &&
    a.alturaActual === b.alturaActual &&
    a.etapaFenologica === b.etapaFenologica &&
    a.tipoCultivo === b.tipoCultivo &&
    a.tipoSuelo === b.tipoSuelo &&
    a.superficieHectareas === b.superficieHectareas
  );
});

export default MemoFarmScene;

import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sky, Cloud, Clouds, Environment, ContactShadows, Stars } from '@react-three/drei';
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

interface FarmSceneProps {
  simulacion: Simulacion;
  /** Si está activo un VFX (efecto visual de evento), pásalo para que la escena reaccione
      con objetos 3D extra (p. ej. el modelo de tsunami para inundación). */
  vfxEvent?: string | null;
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

const Terrain: React.FC<TerrainProps> = ({ humedad, tipoSuelo, size }) => {
  const color = useMemo(() => {
    const base = sueloColorBase(tipoSuelo);
    const t = Math.max(0, Math.min(1, humedad / 100));
    const wet = base.clone().multiplyScalar(0.5);
    return base.clone().lerp(wet, t * 0.7);
  }, [humedad, tipoSuelo]);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(size, size, 24, 24);
    const pos = g.attributes.position;
    const rng = makeRng(98765);
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, (rng() - 0.5) * 0.06);
    }
    g.computeVertexNormals();
    return g;
  }, [size]);

  const surcos = useMemo(() => {
    const lines: number[] = [];
    const step = 0.6;
    for (let i = -size / 2 + step; i < size / 2; i += step) lines.push(i);
    return lines;
  }, [size]);

  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} geometry={geometry}>
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      {surcos.map((z, i) => (
        <mesh key={i} position={[0, 0.02, z]} receiveShadow>
          <boxGeometry args={[size - 0.4, 0.04, 0.08]} />
          <meshStandardMaterial color={color.clone().multiplyScalar(0.75)} roughness={0.9} />
        </mesh>
      ))}
      {/* Bordes */}
      <mesh position={[0, 0.06, size / 2 - 0.04]}>
        <boxGeometry args={[size, 0.12, 0.06]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.06, -size / 2 + 0.04]}>
        <boxGeometry args={[size, 0.12, 0.06]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
      </mesh>
      <mesh position={[size / 2 - 0.04, 0.06, 0]}>
        <boxGeometry args={[0.06, 0.12, size]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
      </mesh>
      <mesh position={[-size / 2 + 0.04, 0.06, 0]}>
        <boxGeometry args={[0.06, 0.12, size]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
      </mesh>
      {/* Pasto alrededor */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[size * 3, size * 3]} />
        <meshStandardMaterial color="#3d6b2a" roughness={0.95} />
      </mesh>
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

const Plant: React.FC<PlantProps> = ({ etapa, salud, alturaCm, cultivo, position, scale = 1, seed }) => {
  const groupRef = useRef<THREE.Group>(null);
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

  // Color amarillento adicional en hojas si está enferma o en cosecha
  const colorHoja = useMemo(() => {
    const c = baseColor.clone();
    if (muyEnferma) c.lerp(new THREE.Color('#7a5a2b'), 0.4);
    if (etapa === 'cosecha' && arche === 'cereal') c.lerp(new THREE.Color('#d4a857'), 0.6);
    return c;
  }, [baseColor, muyEnferma, etapa, arche]);

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

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.getElapsedTime();
    // Mientras menos salud, más se desploma la planta entera (en X y Z)
    const tilt = droopAmount * 0.75;
    const sway = Math.sin(t * 0.8 + swayPhase) * (0.04 + droopAmount * 0.05);
    groupRef.current.rotation.z = sway - tilt;
    groupRef.current.rotation.x = Math.cos(t * 0.6 + swayPhase) * 0.025 + tilt * 0.35;
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

  // Hoja: elipsoide aplanado en forma de lágrima, optionally con manchas
  const Hoja = ({ size, color }: { size: number; color: THREE.Color }) => (
    <group>
      <mesh castShadow scale={[size * 0.45, size * 0.08, size * 1.1]}>
        <sphereGeometry args={[1, 8, 5]} />
        <meshStandardMaterial color={color} roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      {/* Vena central */}
      <mesh position={[0, size * 0.04, 0]} scale={[size * 0.02, size * 0.02, size * 0.95]}>
        <cylinderGeometry args={[1, 1, 1, 4]} />
        <meshStandardMaterial color={color.clone().multiplyScalar(0.7)} roughness={0.8} />
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

  return (
    <group ref={groupRef} position={position} scale={scale}>
      {/* ============ CEREAL (trigo/maíz/arroz/cebada) ============ */}
      {arche === 'cereal' && (
        <>
          {/* Tallo principal */}
          <mesh castShadow position={[0, altura / 2, 0]}>
            <cylinderGeometry args={[0.025, 0.04, altura, 6]} />
            <meshStandardMaterial color={tronco} roughness={0.85} />
          </mesh>
          {/* Hojas largas verticales */}
          {hojasParams.slice(0, numHojas).map((p, i) => {
            const ang = (i * 137.5 * Math.PI) / 180 + seed + p.angleJitter;
            const y = (i / numHojas) * altura * 0.85 + altura * 0.1;
            const len = follajeFactor * 0.55 * p.sizeMul;
            const droopHoja = 0.05 + droopAmount * 0.55;
            return (
              <group key={i} position={[Math.cos(ang) * 0.04, y, Math.sin(ang) * 0.04]} rotation={[droopHoja + p.tiltJitter, ang, -0.4 + droopHoja]}>
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
              // Mazorca de maíz
              <mesh castShadow position={[0.12, altura * 0.6, 0]} rotation={[0, 0, -0.3]}>
                <cylinderGeometry args={[0.06, 0.05, 0.25, 8]} />
                <meshStandardMaterial color={etapa === 'cosecha' || etapa === 'maduracion' ? '#fdd835' : '#cfe28a'} roughness={0.6} />
              </mesh>
            ) : (
              // Espiga de trigo/cebada/arroz
              <group position={[0, altura * 1.02, 0]}>
                <mesh castShadow scale={[0.06, 0.25, 0.06]}>
                  <sphereGeometry args={[1, 6, 6]} />
                  <meshStandardMaterial color={etapa === 'cosecha' || etapa === 'maduracion' ? '#d4a857' : '#9fb555'} roughness={0.85} />
                </mesh>
                {/* Aristas (pelos de la espiga) */}
                {Array.from({ length: 8 }).map((_, k) => (
                  <mesh key={k} position={[0, 0.15 + k * 0.02, 0]} rotation={[0, k, 0.6]} scale={[0.005, 0.12, 0.005]}>
                    <cylinderGeometry args={[1, 1, 1, 4]} />
                    <meshStandardMaterial color={etapa === 'cosecha' ? '#c98c2c' : '#a0b045'} />
                  </mesh>
                ))}
              </group>
            )
          )}
        </>
      )}

      {/* ============ ARBUSTO (tomate, pimiento, judía, guisante, soja) ============ */}
      {arche === 'arbusto' && (
        <>
          {/* Tallo */}
          <mesh castShadow position={[0, altura / 2, 0]}>
            <cylinderGeometry args={[0.03, 0.05, altura, 6]} />
            <meshStandardMaterial color={tronco} roughness={0.85} />
          </mesh>
          {/* Ramas y hojas */}
          {hojasParams.slice(0, numHojas).map((p, i) => {
            const ang = (i * 137.5 * Math.PI) / 180 + seed + p.angleJitter;
            const yT = i / Math.max(numHojas - 1, 1);
            const y = altura * (0.2 + yT * 0.75);
            const ramaLen = 0.12 + follajeFactor * 0.15 * p.sizeMul;
            const hojaSize = follajeFactor * 0.32 * p.sizeMul;
            const tiltDroop = p.ramaTilt + droopAmount * 0.85 + p.tiltJitter;
            return (
              <group key={i} position={[0, y, 0]} rotation={[0, ang, 0]}>
                {/* Pecíolo / rama */}
                <mesh position={[ramaLen / 2, 0, 0]} rotation={[0, 0, -tiltDroop]}>
                  <cylinderGeometry args={[0.01, 0.012, ramaLen, 4]} />
                  <meshStandardMaterial color={tronco} roughness={0.85} />
                </mesh>
                {/* Hoja al final de la rama */}
                <group position={[ramaLen, -tiltDroop * 0.05, 0]} rotation={[0, 0, -tiltDroop]}>
                  <Hoja size={hojaSize} color={colorHoja} />
                  {numManchas > 0 && <Manchas size={hojaSize} n={numManchas} params={p} />}
                </group>
              </group>
            );
          })}
          {/* Frutos colgantes */}
          {frutosParams.slice(0, numFrutos).map((p, i) => {
            const ang = (i * 360 / numFrutos) * (Math.PI / 180) + seed + p.angleJitter;
            const y = altura * (0.5 + p.yJitter);
            const r = 0.18;
            const size = 0.06 * frutoSizeFactor * p.sizeMul;
            // Tomate redondo, pimiento alargado, judía vaina
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
          {/* Tronco grueso */}
          <mesh castShadow position={[0, altura * 0.3, 0]}>
            <cylinderGeometry args={[0.07, 0.1, altura * 0.6, 8]} />
            <meshStandardMaterial color="#5a3a14" roughness={0.95} />
          </mesh>
          {/* Copa: bola de follaje */}
          <mesh castShadow position={[0, altura * 0.75, 0]} scale={[follajeFactor * 0.55, follajeFactor * 0.4, follajeFactor * 0.55]}>
            <sphereGeometry args={[1, 10, 8]} />
            <meshStandardMaterial color={colorHoja} roughness={0.8} />
          </mesh>
          {/* Ramas internas más pequeñas */}
          {hojasParams.slice(0, 4).map((p, i) => {
            const ang = (i * 90 * Math.PI) / 180 + seed;
            return (
              <mesh key={i} castShadow position={[Math.cos(ang) * follajeFactor * 0.35, altura * 0.7, Math.sin(ang) * follajeFactor * 0.35]} scale={[follajeFactor * 0.22, follajeFactor * 0.2, follajeFactor * 0.22]}>
                <sphereGeometry args={[1, 8, 6]} />
                <meshStandardMaterial color={colorHoja.clone().multiplyScalar(0.9)} roughness={0.85} />
              </mesh>
            );
          })}
          {/* Frutos esparcidos en la copa */}
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
        </>
      )}

      {/* ============ GIRASOL / COLZA ============ */}
      {arche === 'girasol' && (
        <>
          {/* Tallo alto */}
          <mesh castShadow position={[0, altura / 2, 0]}>
            <cylinderGeometry args={[0.035, 0.06, altura, 6]} />
            <meshStandardMaterial color="#4d7c2e" roughness={0.85} />
          </mesh>
          {/* Hojas grandes */}
          {hojasParams.slice(0, Math.min(numHojas, 6)).map((p, i) => {
            const ang = (i * 137.5 * Math.PI) / 180 + seed;
            const y = (i / 6) * altura * 0.7 + altura * 0.15;
            const len = follajeFactor * 0.45 * p.sizeMul;
            const tilt = 0.25 + droopAmount * 0.6 + p.tiltJitter;
            return (
              <group key={i} position={[0, y, 0]} rotation={[0, ang, 0]}>
                <group position={[len * 0.4, 0, 0]} rotation={[0, 0, -tilt]}>
                  <Hoja size={len} color={colorHoja} />
                  {numManchas > 0 && <Manchas size={len} n={numManchas} params={p} />}
                </group>
              </group>
            );
          })}
          {/* Flor grande tipo girasol al final */}
          {(etapa === 'floracion' || etapa === 'fructificacion' || etapa === 'maduracion' || etapa === 'cosecha') && (
            <group position={[0, altura, 0]} rotation={[etapa === 'cosecha' ? 0.6 : -0.2, 0, 0]}>
              {/* Disco central marrón */}
              <mesh castShadow>
                <sphereGeometry args={[0.13, 12, 10]} />
                <meshStandardMaterial color={cultivo === 'colza' ? '#f6d54a' : '#5a3a14'} roughness={0.85} />
              </mesh>
              {/* Pétalos */}
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
// Tsunami / Inundación — pared de agua que cruza la parcela
// ============================================================

interface TsunamiWaveProps {
  active: boolean;
  durationSec?: number;
}

const TsunamiWave: React.FC<TsunamiWaveProps> = ({ active, durationSec = 4 }) => {
  const wallRef = useRef<THREE.Group>(null);
  const floodRef = useRef<THREE.Mesh>(null);
  const splashRef = useRef<THREE.Group>(null);
  const startTimeRef = useRef<number | null>(null);

  // Espuma estable en la cresta (no se regenera en cada frame)
  const foamPositions = useMemo(() => {
    const rng = makeRng(424242);
    return Array.from({ length: 28 }).map((_, i) => ({
      x: -7.5 + (i / 27) * 15 + (rng() - 0.5) * 0.5,
      y: 1.85 + rng() * 0.55,
      size: 0.18 + rng() * 0.18,
      offset: rng() * Math.PI * 2
    }));
  }, []);

  // Salpicaduras al frente de la ola
  const splashDrops = useMemo(() => {
    const rng = makeRng(999111);
    return Array.from({ length: 18 }).map(() => ({
      x: -6 + rng() * 12,
      yBase: 0.5 + rng() * 0.7,
      size: 0.06 + rng() * 0.08,
      phase: rng() * Math.PI * 2
    }));
  }, []);

  useFrame((state) => {
    if (!active) {
      startTimeRef.current = null;
      // Resetear posiciones cuando no está activo
      if (wallRef.current) wallRef.current.position.z = -12;
      if (floodRef.current) {
        floodRef.current.position.y = 0;
        (floodRef.current.material as THREE.MeshStandardMaterial).opacity = 0;
      }
      return;
    }
    if (startTimeRef.current == null) {
      startTimeRef.current = state.clock.elapsedTime;
    }
    const elapsed = state.clock.elapsedTime - startTimeRef.current;
    const t = Math.min(elapsed / durationSec, 1.0); // 0 → 1

    // Pared cruza la parcela de Z=-12 a Z=12
    if (wallRef.current) {
      wallRef.current.position.z = -12 + t * 24;
      // ligera oscilación de la cresta
      wallRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 4) * 0.015;
    }

    // Inundación: la lámina de agua sube hasta la mitad y baja al final
    if (floodRef.current) {
      // Curva pico-y-baja: max en t=0.5
      const flood = Math.sin(Math.PI * t); // 0 → 1 → 0
      floodRef.current.position.y = 0.04 + flood * 0.45;
      const mat = floodRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.35 + flood * 0.55;
    }

    // Salpicaduras: cada gota se anima individualmente
    if (splashRef.current) {
      splashRef.current.position.z = wallRef.current ? wallRef.current.position.z + 0.6 : 0;
      splashRef.current.children.forEach((child, i) => {
        const d = splashDrops[i];
        if (!d) return;
        const time = state.clock.elapsedTime * 6 + d.phase;
        const yOff = Math.abs(Math.sin(time)) * 0.5;
        child.position.y = d.yBase + yOff;
      });
    }
  });

  if (!active) return null;

  return (
    <group>
      {/* Lámina de agua que inunda el terreno (sube y baja) */}
      <mesh ref={floodRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial
          color="#0f3b62"
          transparent
          opacity={0}
          roughness={0.15}
          metalness={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Pared de tsunami: agua + cresta + espuma */}
      <group ref={wallRef} position={[0, 0, -12]}>
        {/* Cuerpo principal del agua (caja oscura) */}
        <mesh position={[0, 1, 0]} castShadow>
          <boxGeometry args={[16, 2.2, 0.9]} />
          <meshStandardMaterial
            color="#0a2f4c"
            roughness={0.22}
            metalness={0.55}
            transparent
            opacity={0.93}
          />
        </mesh>
        {/* Capa intermedia más clara para profundidad */}
        <mesh position={[0, 0.55, 0.25]}>
          <boxGeometry args={[16, 1.4, 0.55]} />
          <meshStandardMaterial
            color="#155080"
            roughness={0.18}
            metalness={0.5}
            transparent
            opacity={0.85}
          />
        </mesh>
        {/* Cresta curvada al frente (cilindro acostado) */}
        <mesh position={[0, 1.9, 0.35]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.55, 0.55, 16, 18, 1, true]} />
          <meshStandardMaterial
            color="#246596"
            roughness={0.12}
            metalness={0.6}
            transparent
            opacity={0.92}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Tapas del cilindro */}
        <mesh position={[-8, 1.9, 0.35]} rotation={[0, 0, Math.PI / 2]}>
          <circleGeometry args={[0.55, 18]} />
          <meshStandardMaterial color="#246596" roughness={0.2} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[8, 1.9, 0.35]} rotation={[0, 0, -Math.PI / 2]}>
          <circleGeometry args={[0.55, 18]} />
          <meshStandardMaterial color="#246596" roughness={0.2} side={THREE.DoubleSide} />
        </mesh>
        {/* Espuma en la cresta */}
        {foamPositions.map((f, i) => (
          <mesh
            key={i}
            position={[f.x, f.y, 0.42]}
            scale={[1, 0.9, 1]}
            castShadow
          >
            <sphereGeometry args={[f.size, 10, 8]} />
            <meshStandardMaterial
              color="#f4f9ff"
              emissive="#ffffff"
              emissiveIntensity={0.18}
              roughness={0.45}
            />
          </mesh>
        ))}
        {/* Salpicaduras delante */}
        <group ref={splashRef}>
          {splashDrops.map((d, i) => (
            <mesh key={i} position={[d.x, d.yBase, 0]}>
              <sphereGeometry args={[d.size, 6, 5]} />
              <meshStandardMaterial color="#cfe5fa" transparent opacity={0.8} roughness={0.3} metalness={0.4} />
            </mesh>
          ))}
        </group>
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

const Earthquake: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 4 }) => {
  const groupRef = useRef<THREE.Group>(null);
  const dustRef = useRef<THREE.Group>(null);
  const getElapsed = useEffectClock(active);

  const grietas = useMemo(() => {
    const rng = makeRng(33001);
    return Array.from({ length: 7 }).map(() => {
      const angle = rng() * Math.PI;
      const length = 3 + rng() * 3.5;
      const cx = (rng() - 0.5) * 6;
      const cz = (rng() - 0.5) * 6;
      return { angle, length, cx, cz, segs: 3 + Math.floor(rng() * 3), thickness: 0.04 + rng() * 0.05 };
    });
  }, []);

  const polvo = useMemo(() => {
    const rng = makeRng(33002);
    return Array.from({ length: 35 }).map(() => ({
      x: (rng() - 0.5) * 9,
      z: (rng() - 0.5) * 9,
      delay: rng() * 0.6,
      size: 0.07 + rng() * 0.12,
      maxY: 1 + rng() * 1.5,
      drift: (rng() - 0.5) * 0.4
    }));
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) {
      if (groupRef.current) { groupRef.current.position.set(0,0,0); groupRef.current.rotation.set(0,0,0); }
      return;
    }
    const p = Math.min(t / durationSec, 1);

    // Shake del grupo entero (más intenso en el primer tercio)
    if (groupRef.current) {
      const intensity = p < 0.4 ? 1 - p / 0.4 : 0;
      const f = state.clock.elapsedTime * 35;
      groupRef.current.position.x = Math.sin(f) * 0.08 * intensity;
      groupRef.current.position.z = Math.cos(f * 1.3) * 0.06 * intensity;
      groupRef.current.rotation.z = Math.sin(f * 0.7) * 0.015 * intensity;
    }
    // Polvo subiendo y desvaneciéndose
    if (dustRef.current) {
      dustRef.current.children.forEach((c, i) => {
        const d = polvo[i]; if (!d) return;
        const localT = Math.max(0, t - d.delay);
        const phase = (localT * 0.6) % 1;
        c.position.y = phase * d.maxY;
        c.position.x = d.x + d.drift * phase;
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - phase) * 0.7;
      });
    }
  });

  if (!active) return null;
  return (
    <group ref={groupRef}>
      {/* Grietas: cada grieta = varios segmentos en zigzag */}
      {grietas.map((g, gi) => (
        <group key={gi} position={[g.cx, 0.05, g.cz]} rotation={[0, g.angle, 0]}>
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
// Incendio — llamas + humo
// ============================================================

const Fire: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 4 }) => {
  const flameRefs = useRef<THREE.Group[]>([]);
  const smokeRef = useRef<THREE.Group>(null);
  const getElapsed = useEffectClock(active);

  const flames = useMemo(() => {
    const rng = makeRng(55001);
    return Array.from({ length: 8 }).map(() => ({
      x: (rng() - 0.5) * 8,
      z: (rng() - 0.5) * 8,
      scale: 0.6 + rng() * 0.7,
      phase: rng() * Math.PI * 2
    }));
  }, []);

  const smoke = useMemo(() => {
    const rng = makeRng(55002);
    return Array.from({ length: 18 }).map(() => ({
      x: (rng() - 0.5) * 8,
      z: (rng() - 0.5) * 8,
      delay: rng() * 1,
      size: 0.2 + rng() * 0.3,
      maxY: 3 + rng() * 2
    }));
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;
    flameRefs.current.forEach((g, i) => {
      if (!g) return;
      const f = flames[i];
      const wobble = Math.sin(state.clock.elapsedTime * 8 + f.phase) * 0.08;
      g.scale.y = f.scale * (1 + wobble);
      g.rotation.z = Math.sin(state.clock.elapsedTime * 5 + f.phase) * 0.1;
    });
    if (smokeRef.current) {
      smokeRef.current.children.forEach((c, i) => {
        const s = smoke[i]; if (!s) return;
        const localT = Math.max(0, t - s.delay);
        const phase = (localT * 0.35) % 1;
        c.position.y = phase * s.maxY;
        c.scale.setScalar(1 + phase * 1.5);
        const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = (1 - phase) * 0.55;
      });
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Llamas: cada una son varios conos apilados (rojo→naranja→amarillo) */}
      {flames.map((f, i) => (
        <group key={i} position={[f.x, 0, f.z]} ref={(el) => { if (el) flameRefs.current[i] = el; }} scale={f.scale}>
          <mesh position={[0, 0.25, 0]} castShadow>
            <coneGeometry args={[0.3, 0.5, 8]} />
            <meshStandardMaterial color="#c0260e" emissive="#ff4d1c" emissiveIntensity={0.7} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.55, 0]}>
            <coneGeometry args={[0.22, 0.5, 8]} />
            <meshStandardMaterial color="#ff7a1c" emissive="#ff7a1c" emissiveIntensity={0.9} />
          </mesh>
          <mesh position={[0, 0.85, 0]}>
            <coneGeometry args={[0.13, 0.4, 8]} />
            <meshStandardMaterial color="#ffd34d" emissive="#ffea7a" emissiveIntensity={1.1} />
          </mesh>
          {/* Brasas en la base */}
          <mesh position={[0, 0.02, 0]}>
            <sphereGeometry args={[0.18, 8, 6]} />
            <meshStandardMaterial color="#ff5722" emissive="#ff5722" emissiveIntensity={0.8} />
          </mesh>
        </group>
      ))}
      {/* Luz emisiva general */}
      <pointLight position={[0, 1.5, 0]} intensity={2} color="#ff7a3d" distance={12} decay={2} />
      {/* Humo */}
      <group ref={smokeRef}>
        {smoke.map((s, i) => (
          <mesh key={i} position={[s.x, 0, s.z]}>
            <sphereGeometry args={[s.size, 8, 6]} />
            <meshStandardMaterial color="#3a3a3a" transparent opacity={0} roughness={1} />
          </mesh>
        ))}
      </group>
    </>
  );
};

// ============================================================
// Rayo — zigzag desde el cielo + flash de luz
// ============================================================

const Lightning: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 4 }) => {
  const boltRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.PointLight>(null);
  const getElapsed = useEffectClock(active);

  // Zigzag estable de 7 segmentos desde y=8 a y=0
  const segments = useMemo(() => {
    const rng = makeRng(66001);
    const N = 7;
    const pts: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i <= N; i++) {
      pts.push({
        x: (rng() - 0.5) * 1.5,
        y: 8 - (i / N) * 8,
        z: (rng() - 0.5) * 0.6
      });
    }
    return pts;
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;
    // El rayo cae rapidísimo (primeros 0.2s), luego se queda 0.4s y desaparece
    const visible = t < 0.6;
    const flashIntensity = t < 0.15 ? 12 : t < 0.6 ? 12 * (1 - (t - 0.15) / 0.45) : 0;

    if (boltRef.current) {
      boltRef.current.visible = visible;
      // Pequeño flicker en la primera fase
      boltRef.current.scale.x = visible ? (1 + Math.sin(state.clock.elapsedTime * 60) * 0.08) : 0;
    }
    if (flashRef.current) {
      flashRef.current.intensity = flashIntensity;
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Rayo: cilindros entre puntos consecutivos */}
      <group ref={boltRef}>
        {segments.slice(0, -1).map((p, i) => {
          const q = segments[i + 1];
          const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
          const length = Math.sqrt(dx*dx + dy*dy + dz*dz);
          const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, mz = (p.z + q.z) / 2;
          // Calcular rotación: el cilindro apunta en Y por defecto
          const dir = new THREE.Vector3(dx, dy, dz).normalize();
          const yAxis = new THREE.Vector3(0, 1, 0);
          const quat = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
          const euler = new THREE.Euler().setFromQuaternion(quat);
          return (
            <group key={i} position={[mx, my, mz]} rotation={[euler.x, euler.y, euler.z]}>
              {/* Núcleo blanco */}
              <mesh>
                <cylinderGeometry args={[0.04, 0.04, length, 6]} />
                <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={3} />
              </mesh>
              {/* Halo azul-blanco */}
              <mesh>
                <cylinderGeometry args={[0.12, 0.12, length, 6]} />
                <meshStandardMaterial color="#bdd9ff" emissive="#bdd9ff" emissiveIntensity={1.2} transparent opacity={0.45} />
              </mesh>
            </group>
          );
        })}
        {/* Impacto en el suelo: brillo radial */}
        <mesh position={[segments[segments.length - 1].x, 0.01, segments[segments.length - 1].z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0, 0.7, 24]} />
          <meshStandardMaterial color="#ffffff" emissive="#fff8a8" emissiveIntensity={2} transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* Flash de luz puntual */}
      <pointLight ref={flashRef} position={[segments[0].x, 7, segments[0].z]} intensity={12} color="#ffffff" distance={30} decay={2} />
    </>
  );
};

// ============================================================
// Lluvia ácida — tinte verde + nube tóxica + gotas verdes
// ============================================================

const AcidRain: React.FC<{ active: boolean }> = ({ active }) => {
  const dropsRef = useRef<THREE.Group>(null);
  const cloudRef = useRef<THREE.Mesh>(null);
  const drops = useMemo(() => {
    const rng = makeRng(77001);
    return Array.from({ length: 60 }).map(() => ({
      x: (rng() - 0.5) * 14,
      z: (rng() - 0.5) * 14,
      yMax: 5 + rng() * 3,
      speed: 0.6 + rng() * 0.7,
      phase: rng(),
      size: 0.04 + rng() * 0.05
    }));
  }, []);

  useFrame((state) => {
    if (!active) return;
    if (dropsRef.current) {
      dropsRef.current.children.forEach((c, i) => {
        const d = drops[i]; if (!d) return;
        const phase = ((state.clock.elapsedTime * d.speed + d.phase) % 1);
        c.position.y = d.yMax - phase * d.yMax;
      });
    }
    if (cloudRef.current) {
      cloudRef.current.rotation.y = state.clock.elapsedTime * 0.1;
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Nube tóxica baja */}
      <mesh ref={cloudRef} position={[0, 7, 0]} scale={[8, 1, 8]}>
        <sphereGeometry args={[1, 16, 10]} />
        <meshStandardMaterial color="#7faa20" transparent opacity={0.45} emissive="#5a8210" emissiveIntensity={0.1} />
      </mesh>
      {/* Pluma de neblina verdosa que cubre la parcela */}
      <mesh position={[0, 2.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[16, 16]} />
        <meshStandardMaterial color="#a8c252" transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>
      {/* Gotas verdosas cayendo */}
      <group ref={dropsRef}>
        {drops.map((d, i) => (
          <mesh key={i} position={[d.x, d.yMax, d.z]} scale={[d.size, d.size * 2.5, d.size]}>
            <sphereGeometry args={[1, 6, 4]} />
            <meshStandardMaterial color="#a8d028" emissive="#a8d028" emissiveIntensity={0.4} transparent opacity={0.85} />
          </mesh>
        ))}
      </group>
    </>
  );
};

// ============================================================
// Nevada — copos 3D + manto blanco acumulándose
// ============================================================

const Snowfall: React.FC<{ active: boolean; durationSec?: number }> = ({ active, durationSec = 4 }) => {
  const flakesRef = useRef<THREE.Group>(null);
  const groundRef = useRef<THREE.Mesh>(null);
  const getElapsed = useEffectClock(active);

  const flakes = useMemo(() => {
    const rng = makeRng(88001);
    return Array.from({ length: 80 }).map(() => ({
      x: (rng() - 0.5) * 14,
      z: (rng() - 0.5) * 14,
      yMax: 6 + rng() * 3,
      speed: 0.15 + rng() * 0.2,
      phase: rng(),
      sway: rng() * Math.PI * 2,
      size: 0.06 + rng() * 0.08
    }));
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;
    if (flakesRef.current) {
      flakesRef.current.children.forEach((c, i) => {
        const f = flakes[i]; if (!f) return;
        const phase = ((state.clock.elapsedTime * f.speed + f.phase) % 1);
        c.position.y = f.yMax - phase * f.yMax;
        c.position.x = f.x + Math.sin(state.clock.elapsedTime + f.sway) * 0.3;
        c.rotation.z = state.clock.elapsedTime * 0.8;
      });
    }
    // Manto blanco: sube opacity progresivamente, luego se queda
    if (groundRef.current) {
      const p = Math.min(t / durationSec, 1);
      const mat = groundRef.current.material as THREE.MeshStandardMaterial;
      // Sube hasta 0.7 y se mantiene
      mat.opacity = Math.min(p * 1.8, 0.75);
    }
  });

  if (!active) return null;
  return (
    <>
      {/* Manto de nieve sobre el terreno */}
      <mesh ref={groundRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <planeGeometry args={[10, 10]} />
        <meshStandardMaterial color="#f5fbff" transparent opacity={0} roughness={0.9} />
      </mesh>
      {/* Copos cayendo */}
      <group ref={flakesRef}>
        {flakes.map((f, i) => (
          <mesh key={i} position={[f.x, f.yMax, f.z]} scale={[f.size, f.size, f.size * 0.3]}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#ffffff" emissive="#dceaff" emissiveIntensity={0.25} />
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
  const getElapsed = useEffectClock(active);

  const drops = useMemo(() => {
    const rng = makeRng(11101);
    return Array.from({ length: 120 }).map(() => ({
      x: (rng() - 0.5) * 14,
      z: (rng() - 0.5) * 14,
      yMax: 6 + rng() * 3,
      speed: 1.4 + rng() * 0.9,
      phase: rng(),
      length: 0.4 + rng() * 0.4
    }));
  }, []);

  useFrame((state) => {
    const t = getElapsed(state.clock.elapsedTime);
    if (!active) return;
    if (dropsRef.current) {
      dropsRef.current.children.forEach((c, i) => {
        const d = drops[i]; if (!d) return;
        const phase = ((state.clock.elapsedTime * d.speed + d.phase) % 1);
        c.position.y = d.yMax - phase * d.yMax;
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
      {/* Gotas alargadas */}
      <group ref={dropsRef}>
        {drops.map((d, i) => (
          <mesh key={i} position={[d.x, d.yMax, d.z]} scale={[0.025, d.length, 0.025]}>
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
// Campo (grid de plantas)
// ============================================================

const CropField: React.FC<FarmSceneProps> = ({ simulacion }) => {
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
        />
      ))}
    </>
  );
};

// ============================================================
// Escena completa
// ============================================================

const skyParams = (salud: number) => {
  const t = Math.max(0, Math.min(1, salud / 100));
  return {
    turbidity: 10 - t * 3,
    rayleigh: 1.5 + (1 - t) * 4,
    mieCoefficient: 0.005 + (1 - t) * 0.02,
    inclination: 0.55,
    azimuth: 0.25
  };
};

// Nubes aisladas en su propio componente memoizado para que no se reposicionen
// cuando el FarmScene re-renderiza por cambios en otras props (avanzar día, etc.)
const CloudLayer = React.memo(({ nublado }: { nublado: boolean }) => (
  <Clouds material={THREE.MeshBasicMaterial}>
    <Cloud segments={20} bounds={[6, 1, 6]} volume={4} color="#ffffff" position={[-4, 8, -2]} opacity={nublado ? 0.85 : 0.45} />
    <Cloud segments={18} bounds={[5, 1, 5]} volume={3} color="#f0f4f7" position={[5, 9, 3]} opacity={nublado ? 0.9 : 0.4} />
    {nublado && (
      <Cloud segments={22} bounds={[7, 1.2, 7]} volume={5} color="#a8b3bd" position={[0, 7, 0]} opacity={0.7} />
    )}
  </Clouds>
));
CloudLayer.displayName = 'CloudLayer';

export const FarmScene: React.FC<FarmSceneProps> = ({ simulacion, vfxEvent }) => {
  const sky = skyParams(simulacion.saludActual);
  const nublado = simulacion.saludActual < 50;

  return (
    <Canvas
      shadows
      camera={{ position: [9, 7, 9], fov: 45 }}
      style={{ width: '100%', height: '100%', display: 'block' }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={[nublado ? '#7a8a96' : '#cfe7ff']} />

      <Suspense fallback={null}>
        <Sky {...sky} sunPosition={[100, 60, 80]} />

        <ambientLight intensity={nublado ? 0.45 : 0.55} />
        <directionalLight
          position={[10, 15, 8]}
          intensity={nublado ? 0.9 : 1.6}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          color={nublado ? '#cfd6dc' : '#fff4d6'}
        />
        <hemisphereLight args={['#cfe7ff', '#586a3d', 0.4]} />

        <CloudLayer nublado={nublado} />

        <Terrain humedad={simulacion.humedadSueloActual} tipoSuelo={simulacion.tipoSuelo} size={10} />
        <CropField simulacion={simulacion} />

        {/* Modelos 3D específicos por evento — cada uno se monta solo cuando su VFX está activo */}
        <TsunamiWave active={vfxEvent === 'inundacion'} durationSec={4} />
        <Earthquake active={vfxEvent === 'terremoto'} durationSec={4} />
        <Tornado active={vfxEvent === 'tornado'} durationSec={4} />
        <Fire active={vfxEvent === 'incendio_proximo'} durationSec={4} />
        <Lightning active={vfxEvent === 'rayo_caido'} durationSec={4} />
        <AcidRain active={vfxEvent === 'lluvia_acida'} />
        <Snowfall active={vfxEvent === 'nevada'} durationSec={4} />
        <FogVolume active={vfxEvent === 'niebla_persistente'} />
        <HeavyRain active={vfxEvent === 'lluvia_torrencial'} durationSec={4} />

        <ContactShadows position={[0, 0.01, 0]} opacity={0.35} blur={2.5} far={10} resolution={512} />
        {simulacion.saludActual < 25 && <Stars radius={50} depth={20} count={2500} factor={3} fade speed={0.5} />}

        <Environment preset="park" background={false} />

        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={6}
          maxDistance={20}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.1}
          autoRotate={false}
        />
      </Suspense>
    </Canvas>
  );
};

// Solo re-render cuando cambien las propiedades visualmente relevantes
const MemoFarmScene = React.memo(FarmScene, (prev, next) => {
  const a = prev.simulacion;
  const b = next.simulacion;
  return (
    prev.vfxEvent === next.vfxEvent &&
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

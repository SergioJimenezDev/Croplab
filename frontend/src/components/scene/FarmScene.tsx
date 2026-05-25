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

  const arche = archetype(cultivo);
  const factorEtapa = alturaPorEtapa(etapa);
  const altura = Math.max(0.15, Math.min(2.5, (alturaCm / 100) * 1.4 + 0.25)) * factorEtapa;

  // Tamaño general del follaje crece con etapa
  const follajeFactor = factorEtapa; // 0.18 (germinación) → 1.1 (cosecha)

  const baseColor = useMemo(() => follajeColor(salud, cultivo), [salud, cultivo]);
  const colorFruto = useMemo(() => frutoColor(cultivo), [cultivo]);

  // Estado de enfermedad / madurez visual.
  // Niveles de "caída" por salud (escalones a 75/50/25):
  //   nivel 0 (salud >= 75)  → erguida
  //   nivel 1 (50 ≤ salud < 75) → ligeramente caída
  //   nivel 2 (25 ≤ salud < 50) → bastante caída
  //   nivel 3 (salud < 25)   → muy caída (casi tumbada)
  const droopLevel = salud >= 75 ? 0 : salud >= 50 ? 1 : salud >= 25 ? 2 : 3;
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

export const FarmScene: React.FC<FarmSceneProps> = ({ simulacion }) => {
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

import { CultivoConfig, TipoCultivo } from '../types';

// ============================================================================
// CONFIGURACIÓN DE LOS 15 CULTIVOS DISPONIBLES
// Datos agronómicos reales para simulación educativa
// ============================================================================

export const CULTIVOS_CONFIG: Record<TipoCultivo, CultivoConfig> = {
  trigo: {
    nombre: 'Trigo',
    nombreCientifico: 'Triticum aestivum',
    tipo: 'cereal',
    cicloVidaDias: 210,
    temperaturaOptima: { min: 15, max: 24 },
    phOptimo: { min: 6.0, max: 7.5 },
    aguaNecesariaMm: 450,
    densidadRecomendada: 350, // kg/ha
    rendimientoEsperado: 4500,
    precioMercadoKg: 0.25,
    descripcion: 'Cereal fundamental en la alimentación humana. Adaptable a diferentes climas templados.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 10, descripcion: 'Absorción de agua y activación metabólica' },
      { etapa: 'emergencia', duracionDias: 15, descripcion: 'Aparición del coleoptilo' },
      { etapa: 'vegetativo', duracionDias: 100, descripcion: 'Desarrollo de hojas y ahijamiento' },
      { etapa: 'floracion', duracionDias: 25, descripcion: 'Espigado y polinización' },
      { etapa: 'fructificacion', duracionDias: 30, descripcion: 'Formación del grano' },
      { etapa: 'maduracion', duracionDias: 25, descripcion: 'Llenado y endurecimiento del grano' },
      { etapa: 'cosecha', duracionDias: 5, descripcion: 'Cosecha mecánica' }
    ]
  },

  maiz: {
    nombre: 'Maíz',
    nombreCientifico: 'Zea mays',
    tipo: 'cereal',
    cicloVidaDias: 150,
    temperaturaOptima: { min: 20, max: 30 },
    phOptimo: { min: 5.8, max: 7.0 },
    aguaNecesariaMm: 600,
    densidadRecomendada: 75000, // plantas/ha
    rendimientoEsperado: 11000,
    precioMercadoKg: 0.22,
    descripcion: 'Cultivo de alto rendimiento y versatilidad. Requiere calor y abundante agua.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 7, descripcion: 'Absorción de agua y emisión radícula' },
      { etapa: 'emergencia', duracionDias: 10, descripcion: 'Salida del coleoptilo' },
      { etapa: 'vegetativo', duracionDias: 55, descripcion: 'Desarrollo de hojas (V6-V12)' },
      { etapa: 'floracion', duracionDias: 20, descripcion: 'Emisión de panoja y estigmas' },
      { etapa: 'fructificacion', duracionDias: 35, descripcion: 'Llenado de grano' },
      { etapa: 'maduracion', duracionDias: 20, descripcion: 'Madurez fisiológica' },
      { etapa: 'cosecha', duracionDias: 3, descripcion: 'Cosecha mecanizada' }
    ]
  },

  arroz: {
    nombre: 'Arroz',
    nombreCientifico: 'Oryza sativa',
    tipo: 'cereal',
    cicloVidaDias: 140,
    temperaturaOptima: { min: 20, max: 35 },
    phOptimo: { min: 5.5, max: 6.5 },
    aguaNecesariaMm: 1200,
    densidadRecomendada: 150, // kg/ha
    rendimientoEsperado: 6000,
    precioMercadoKg: 0.40,
    descripcion: 'Cultivo acuático tropical. Base de la alimentación en Asia. Requiere inundación.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 10, descripcion: 'Pre-germinación en semillero' },
      { etapa: 'emergencia', duracionDias: 20, descripcion: 'Desarrollo en semillero' },
      { etapa: 'vegetativo', duracionDias: 50, descripcion: 'Trasplante y ahijamiento' },
      { etapa: 'floracion', duracionDias: 15, descripcion: 'Panojamiento' },
      { etapa: 'fructificacion', duracionDias: 30, descripcion: 'Llenado de grano' },
      { etapa: 'maduracion', duracionDias: 12, descripcion: 'Maduración del grano' },
      { etapa: 'cosecha', duracionDias: 3, descripcion: 'Cosecha en seco' }
    ]
  },

  cebada: {
    nombre: 'Cebada',
    nombreCientifico: 'Hordeum vulgare',
    tipo: 'cereal',
    cicloVidaDias: 180,
    temperaturaOptima: { min: 12, max: 22 },
    phOptimo: { min: 6.5, max: 8.0 },
    aguaNecesariaMm: 400,
    densidadRecomendada: 300, // kg/ha
    rendimientoEsperado: 3800,
    precioMercadoKg: 0.20,
    descripcion: 'Cereal muy resistente. Uso alimentario y producción de malta para cerveza.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 8, descripcion: 'Imbibición y activación' },
      { etapa: 'emergencia', duracionDias: 12, descripcion: 'Emergencia de plántula' },
      { etapa: 'vegetativo', duracionDias: 90, descripcion: 'Macollamiento' },
      { etapa: 'floracion', duracionDias: 20, descripcion: 'Espigado' },
      { etapa: 'fructificacion', duracionDias: 30, descripcion: 'Formación grano' },
      { etapa: 'maduracion', duracionDias: 17, descripcion: 'Madurez del grano' },
      { etapa: 'cosecha', duracionDias: 3, descripcion: 'Recolección' }
    ]
  },

  tomate: {
    nombre: 'Tomate',
    nombreCientifico: 'Solanum lycopersicum',
    tipo: 'hortaliza',
    cicloVidaDias: 120,
    temperaturaOptima: { min: 18, max: 28 },
    phOptimo: { min: 6.0, max: 6.8 },
    aguaNecesariaMm: 600,
    densidadRecomendada: 4, // plantas/m²
    rendimientoEsperado: 70000,
    precioMercadoKg: 0.80,
    descripcion: 'Hortaliza de alto valor comercial. Requiere tutorado y manejo intensivo.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 7, descripcion: 'Germinación en semillero' },
      { etapa: 'emergencia', duracionDias: 25, descripcion: 'Desarrollo en semillero' },
      { etapa: 'vegetativo', duracionDias: 30, descripcion: 'Trasplante y crecimiento' },
      { etapa: 'floracion', duracionDias: 20, descripcion: 'Inicio floración' },
      { etapa: 'fructificacion', duracionDias: 25, descripcion: 'Cuajado y desarrollo fruto' },
      { etapa: 'maduracion', duracionDias: 10, descripcion: 'Maduración escalonada' },
      { etapa: 'cosecha', duracionDias: 3, descripcion: 'Recolección manual' }
    ]
  },

  lechuga: {
    nombre: 'Lechuga',
    nombreCientifico: 'Lactuca sativa',
    tipo: 'hortaliza',
    cicloVidaDias: 70,
    temperaturaOptima: { min: 15, max: 22 },
    phOptimo: { min: 6.5, max: 7.2 },
    aguaNecesariaMm: 300,
    densidadRecomendada: 12, // plantas/m²
    rendimientoEsperado: 35000,
    precioMercadoKg: 1.20,
    descripcion: 'Hortaliza de hoja de ciclo corto. Sensible al calor excesivo.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 5, descripcion: 'Germinación rápida' },
      { etapa: 'emergencia', duracionDias: 10, descripcion: 'Emergencia plántula' },
      { etapa: 'vegetativo', duracionDias: 40, descripcion: 'Desarrollo roseta' },
      { etapa: 'floracion', duracionDias: 0, descripcion: 'No llega a floración' },
      { etapa: 'fructificacion', duracionDias: 0, descripcion: 'No produce fruto' },
      { etapa: 'maduracion', duracionDias: 12, descripcion: 'Acogollado completo' },
      { etapa: 'cosecha', duracionDias: 3, descripcion: 'Corte manual' }
    ]
  },

  pimiento: {
    nombre: 'Pimiento',
    nombreCientifico: 'Capsicum annuum',
    tipo: 'hortaliza',
    cicloVidaDias: 130,
    temperaturaOptima: { min: 20, max: 27 },
    phOptimo: { min: 6.0, max: 7.0 },
    aguaNecesariaMm: 550,
    densidadRecomendada: 4.5, // plantas/m²
    rendimientoEsperado: 60000,
    precioMercadoKg: 1.50,
    descripcion: 'Solanácea de alto valor. Requiere temperaturas cálidas constantes.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 10, descripcion: 'Germinación lenta' },
      { etapa: 'emergencia', duracionDias: 30, descripcion: 'Semillero 40-50 días' },
      { etapa: 'vegetativo', duracionDias: 35, descripcion: 'Trasplante y desarrollo' },
      { etapa: 'floracion', duracionDias: 18, descripcion: 'Floración escalonada' },
      { etapa: 'fructificacion', duracionDias: 25, descripcion: 'Cuajado y engorde' },
      { etapa: 'maduracion', duracionDias: 10, descripcion: 'Cambio de color' },
      { etapa: 'cosecha', duracionDias: 2, descripcion: 'Recolección manual' }
    ]
  },

  zanahoria: {
    nombre: 'Zanahoria',
    nombreCientifico: 'Daucus carota',
    tipo: 'hortaliza',
    cicloVidaDias: 100,
    temperaturaOptima: { min: 16, max: 24 },
    phOptimo: { min: 6.0, max: 7.0 },
    aguaNecesariaMm: 400,
    densidadRecomendada: 80, // plantas/m²
    rendimientoEsperado: 45000,
    precioMercadoKg: 0.60,
    descripcion: 'Raíz de cultivo directo. Requiere suelo suelto y profundo.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 12, descripcion: 'Germinación lenta' },
      { etapa: 'emergencia', duracionDias: 18, descripcion: 'Emergencia' },
      { etapa: 'vegetativo', duracionDias: 50, descripcion: 'Desarrollo raíz' },
      { etapa: 'floracion', duracionDias: 0, descripcion: 'No florece en cultivo' },
      { etapa: 'fructificacion', duracionDias: 0, descripcion: 'No produce fruto' },
      { etapa: 'maduracion', duracionDias: 17, descripcion: 'Engrosamiento raíz' },
      { etapa: 'cosecha', duracionDias: 3, descripcion: 'Arranque mecanizado' }
    ]
  },

  judia: {
    nombre: 'Judía',
    nombreCientifico: 'Phaseolus vulgaris',
    tipo: 'leguminosa',
    cicloVidaDias: 90,
    temperaturaOptima: { min: 18, max: 25 },
    phOptimo: { min: 6.0, max: 7.5 },
    aguaNecesariaMm: 350,
    densidadRecomendada: 40, // kg/ha
    rendimientoEsperado: 2500,
    precioMercadoKg: 1.80,
    descripcion: 'Leguminosa de ciclo corto. Fija nitrógeno atmosférico.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 6, descripcion: 'Germinación epigea' },
      { etapa: 'emergencia', duracionDias: 8, descripcion: 'Emergencia cotiledones' },
      { etapa: 'vegetativo', duracionDias: 30, descripcion: 'Desarrollo hojas' },
      { etapa: 'floracion', duracionDias: 15, descripcion: 'Floración' },
      { etapa: 'fructificacion', duracionDias: 20, descripcion: 'Formación vainas' },
      { etapa: 'maduracion', duracionDias: 9, descripcion: 'Maduración vaina' },
      { etapa: 'cosecha', duracionDias: 2, descripcion: 'Recolección' }
    ]
  },

  guisante: {
    nombre: 'Guisante',
    nombreCientifico: 'Pisum sativum',
    tipo: 'leguminosa',
    cicloVidaDias: 85,
    temperaturaOptima: { min: 12, max: 20 },
    phOptimo: { min: 6.0, max: 7.5 },
    aguaNecesariaMm: 300,
    densidadRecomendada: 130, // kg/ha
    rendimientoEsperado: 3000,
    precioMercadoKg: 2.00,
    descripcion: 'Leguminosa de clima fresco. Excelente fijadora de nitrógeno.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 7, descripcion: 'Germinación hipogea' },
      { etapa: 'emergencia', duracionDias: 10, descripcion: 'Emergencia' },
      { etapa: 'vegetativo', duracionDias: 28, descripcion: 'Desarrollo vegetativo' },
      { etapa: 'floracion', duracionDias: 12, descripcion: 'Floración blanca' },
      { etapa: 'fructificacion', duracionDias: 18, descripcion: 'Formación vainas' },
      { etapa: 'maduracion', duracionDias: 8, descripcion: 'Maduración grano' },
      { etapa: 'cosecha', duracionDias: 2, descripcion: 'Recolección mecánica' }
    ]
  },

  soja: {
    nombre: 'Soja',
    nombreCientifico: 'Glycine max',
    tipo: 'leguminosa',
    cicloVidaDias: 140,
    temperaturaOptima: { min: 20, max: 30 },
    phOptimo: { min: 6.0, max: 7.0 },
    aguaNecesariaMm: 500,
    densidadRecomendada: 80, // kg/ha
    rendimientoEsperado: 3500,
    precioMercadoKg: 0.45,
    descripcion: 'Oleaginosa proteica. Gran capacidad de fijación de nitrógeno.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 8, descripcion: 'Imbibición y germinación' },
      { etapa: 'emergencia', duracionDias: 12, descripcion: 'Emergencia epigea' },
      { etapa: 'vegetativo', duracionDias: 50, descripcion: 'Desarrollo vegetativo (V1-V6)' },
      { etapa: 'floracion', duracionDias: 25, descripcion: 'Floración (R1-R2)' },
      { etapa: 'fructificacion', duracionDias: 30, descripcion: 'Llenado de vaina (R3-R6)' },
      { etapa: 'maduracion', duracionDias: 12, descripcion: 'Maduración (R7-R8)' },
      { etapa: 'cosecha', duracionDias: 3, descripcion: 'Cosecha mecánica' }
    ]
  },

  girasol: {
    nombre: 'Girasol',
    nombreCientifico: 'Helianthus annuus',
    tipo: 'industrial',
    cicloVidaDias: 130,
    temperaturaOptima: { min: 20, max: 28 },
    phOptimo: { min: 6.0, max: 7.5 },
    aguaNecesariaMm: 450,
    densidadRecomendada: 65000, // plantas/ha
    rendimientoEsperado: 2800,
    precioMercadoKg: 0.50,
    descripcion: 'Oleaginosa de alto rendimiento. Resistente a sequía moderada.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 7, descripcion: 'Germinación epigea' },
      { etapa: 'emergencia', duracionDias: 10, descripcion: 'Emergencia' },
      { etapa: 'vegetativo', duracionDias: 45, descripcion: 'Desarrollo vegetativo (V4-V12)' },
      { etapa: 'floracion', duracionDias: 20, descripcion: 'Apertura capítulo (R5)' },
      { etapa: 'fructificacion', duracionDias: 35, descripcion: 'Llenado de aquenios (R6-R8)' },
      { etapa: 'maduracion', duracionDias: 10, descripcion: 'Madurez fisiológica (R9)' },
      { etapa: 'cosecha', duracionDias: 3, descripcion: 'Cosecha mecánica' }
    ]
  },

  colza: {
    nombre: 'Colza',
    nombreCientifico: 'Brassica napus',
    tipo: 'industrial',
    cicloVidaDias: 240,
    temperaturaOptima: { min: 12, max: 22 },
    phOptimo: { min: 6.0, max: 7.5 },
    aguaNecesariaMm: 500,
    densidadRecomendada: 8, // kg/ha
    rendimientoEsperado: 3200,
    precioMercadoKg: 0.42,
    descripcion: 'Oleaginosa de ciclo largo. Cultivo biodiésel. Resistente al frío.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 10, descripcion: 'Germinación otoñal' },
      { etapa: 'emergencia', duracionDias: 15, descripcion: 'Emergencia' },
      { etapa: 'vegetativo', duracionDias: 150, descripcion: 'Roseta invernal' },
      { etapa: 'floracion', duracionDias: 30, descripcion: 'Floración amarilla' },
      { etapa: 'fructificacion', duracionDias: 25, descripcion: 'Formación silicuas' },
      { etapa: 'maduracion', duracionDias: 8, descripcion: 'Maduración' },
      { etapa: 'cosecha', duracionDias: 2, descripcion: 'Cosecha mecánica' }
    ]
  },

  vid: {
    nombre: 'Vid',
    nombreCientifico: 'Vitis vinifera',
    tipo: 'industrial',
    cicloVidaDias: 180,
    temperaturaOptima: { min: 18, max: 28 },
    phOptimo: { min: 6.0, max: 7.5 },
    aguaNecesariaMm: 550,
    densidadRecomendada: 2500, // plantas/ha
    rendimientoEsperado: 8000,
    precioMercadoKg: 0.70,
    descripcion: 'Cultivo perenne para vino. Requiere poda y manejo especializado.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 0, descripcion: 'Plantación de estaquillas' },
      { etapa: 'emergencia', duracionDias: 25, descripcion: 'Desborre' },
      { etapa: 'vegetativo', duracionDias: 60, descripcion: 'Crecimiento pámpanos' },
      { etapa: 'floracion', duracionDias: 15, descripcion: 'Floración' },
      { etapa: 'fructificacion', duracionDias: 50, descripcion: 'Cuajado y envero' },
      { etapa: 'maduracion', duracionDias: 27, descripcion: 'Maduración uva' },
      { etapa: 'cosecha', duracionDias: 3, descripcion: 'Vendimia' }
    ]
  },

  olivo: {
    nombre: 'Olivo',
    nombreCientifico: 'Olea europaea',
    tipo: 'industrial',
    cicloVidaDias: 270,
    temperaturaOptima: { min: 15, max: 30 },
    phOptimo: { min: 6.5, max: 8.0 },
    aguaNecesariaMm: 450,
    densidadRecomendada: 300, // plantas/ha
    rendimientoEsperado: 6000,
    precioMercadoKg: 0.65,
    descripcion: 'Cultivo perenne mediterráneo. Resistente a sequía. Producción de aceite.',
    etapas: [
      { etapa: 'germinacion', duracionDias: 0, descripcion: 'Plantación injertos' },
      { etapa: 'emergencia', duracionDias: 40, descripcion: 'Brotación primaveral' },
      { etapa: 'vegetativo', duracionDias: 90, descripcion: 'Crecimiento brotes' },
      { etapa: 'floracion', duracionDias: 20, descripcion: 'Floración (mayo-junio)' },
      { etapa: 'fructificacion', duracionDias: 90, descripcion: 'Desarrollo aceituna' },
      { etapa: 'maduracion', duracionDias: 27, descripcion: 'Envero' },
      { etapa: 'cosecha', duracionDias: 3, descripcion: 'Vareo o cosecha mecánica' }
    ]
  }
};

// Función helper para obtener info de cultivo
export const getCultivoInfo = (tipo: TipoCultivo): CultivoConfig => {
  return CULTIVOS_CONFIG[tipo];
};

// Obtener todos los cultivos de un tipo
export const getCultivosPorTipo = (tipo: 'cereal' | 'hortaliza' | 'leguminosa' | 'industrial'): CultivoConfig[] => {
  return Object.values(CULTIVOS_CONFIG).filter(cultivo => cultivo.tipo === tipo);
};

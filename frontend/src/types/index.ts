// ============================================================================
// TIPOS BASADOS EN LA BASE DE DATOS AGRISIM
// ============================================================================

// Enums y tipos básicos
export type RolUsuario = 'estudiante' | 'profesor' | 'investigador' | 'agricultor';

export type EstadoSimulacion = 'en_curso' | 'completada' | 'fallida' | 'pausada';

export type TipoSuelo = 'arenoso' | 'franco_arenoso' | 'franco' | 'franco_arcilloso' | 'arcilloso';

export type Drenaje = 'malo' | 'regular' | 'bueno' | 'excelente';

export type CapacidadRetencionAgua = 'baja' | 'media' | 'alta';

export type RegionClimatica = 'mediterraneo' | 'continental' | 'atlantico' | 'subtropical';

export type TipoCultivo =
  | 'trigo' | 'maiz' | 'arroz' | 'cebada'
  | 'tomate' | 'lechuga' | 'pimiento' | 'zanahoria'
  | 'judia' | 'guisante' | 'soja'
  | 'girasol' | 'colza' | 'vid' | 'olivo';

export type SistemaRiego = 'ninguno' | 'goteo' | 'aspersion' | 'inundacion';

export type EtapaFenologica =
  | 'germinacion'
  | 'emergencia'
  | 'vegetativo'
  | 'floracion'
  | 'fructificacion'
  | 'maduracion'
  | 'cosecha';

export type TipoEvento =
  // Clásicos
  | 'sequia' | 'helada' | 'ola_calor' | 'lluvia_torrencial' | 'granizo' | 'viento_fuerte'
  | 'plaga' | 'enfermedad' | 'malas_hierbas'
  | 'riego' | 'fertilizacion' | 'tratamiento_fitosanitario' | 'poda' | 'cosecha'
  | 'otro'
  // Catástrofes naturales
  | 'terremoto' | 'tornado' | 'inundacion' | 'nevada' | 'rayo_caido'
  | 'incendio_proximo' | 'niebla_persistente' | 'polvo_sahariano' | 'lluvia_acida'
  // Problemas del suelo
  | 'erosion_suelo' | 'salinizacion' | 'acidificacion_suelo'
  // Plagas y enfermedades específicas
  | 'roya' | 'mildiu' | 'oidio' | 'virus_mosaico'
  | 'pulgones' | 'arana_roja' | 'caracoles' | 'nematodos'
  | 'aves_plaga' | 'jabalies' | 'langostas'
  // Subrealistas / técnicos
  | 'apagon_riego' | 'contaminacion_quimica' | 'marabunta_hormigas' | 'ola_radiacion_uv'
  // Nuevas acciones de manejo
  | 'mulching' | 'control_biologico' | 'enmienda_calcica'
  | 'instalacion_malla' | 'compostaje' | 'aireacion_suelo';

export type OrigenEvento = 'usuario' | 'sistema';

export type Intensidad = 'leve' | 'moderado' | 'severo' | 'critico';

export type EstadoFinal = 'exitoso' | 'fracaso_parcial' | 'fracaso_total';

export type CalidadProducto = 'baja' | 'media' | 'alta' | 'excelente';

export type CausaPrincipal =
  | 'sequia' | 'exceso_agua' | 'helada' | 'calor_extremo'
  | 'deficiencia_nutrientes' | 'plaga' | 'enfermedad'
  | 'manejo_inadecuado' | 'ninguna';

// ============================================================================
// INTERFACES PRINCIPALES
// ============================================================================

export interface Usuario {
  idUsuario?: number;
  nombre: string;
  email: string;
  contrasena?: string;
  fechaRegistro?: Date;
  fechaUltimoAcceso?: Date;
  rol: RolUsuario;
  institucion?: string;
}

export interface Simulacion {
  idSimulacion?: number;
  idUsuario: number;

  // Información básica
  nombreSimulacion: string;
  fechaCreacion?: Date;
  estado: EstadoSimulacion;
  diaActual: number;

  // Configuración del terreno
  superficieHectareas: number;
  tipoSuelo: TipoSuelo;
  phSuelo: number;
  materiaOrganica?: number;
  drenaje: Drenaje;
  capacidadRetencionAgua: CapacidadRetencionAgua;

  // Nutrientes iniciales (kg/ha)
  nitrogenoInicial: number;
  fosforoInicial: number;
  potasioInicial: number;

  // Configuración climática
  regionClimatica: RegionClimatica;
  temperaturaMedia: number;
  precipitacionAnual: number;

  // Cultivo seleccionado
  tipoCultivo: TipoCultivo;
  fechaSiembra: Date | string;
  densidadSiembra: number;
  sistemaRiego: SistemaRiego;

  // Estado actual del cultivo
  etapaFenologica: EtapaFenologica;
  saludActual: number;
  alturaActual: number;
  humedadSueloActual: number;

  // Economía
  presupuestoInicial?: number;
  presupuestoActual?: number;
  gastosTotales?: number;
  ingresosEstimados?: number;

  // Configuración de gameplay
  eventosAleatorios?: boolean;
  modoInvencible?: boolean;
}

export interface EstadoDiario {
  idEstado?: number;
  idSimulacion: number;

  // Información temporal
  dia: number;
  fechaSimulada: Date | string;

  // Estado de la planta
  saludPlanta: number;
  alturaCm: number;
  biomasaKgHa?: number;
  indiceAreaFoliar?: number;
  etapaFenologica: EtapaFenologica;

  // Condiciones ambientales
  humedadSuelo: number;
  temperatura: number;
  precipitacionMm: number;
  radiacionSolar?: number;

  // Nutrientes disponibles
  nitrogenoDisponible?: number;
  fosforoDisponible?: number;
  potasioDisponible?: number;

  // Indicadores de estrés
  estresHidrico: boolean;
  estresTermico: boolean;
  estresNutricional: boolean;
}

export interface Evento {
  idEvento?: number;
  idSimulacion: number;

  // Información temporal
  diaEvento: number;
  fechaEvento?: Date;

  // Tipo de evento
  tipoEvento: TipoEvento;
  origen: OrigenEvento;

  // Detalles del evento
  intensidad?: Intensidad;
  descripcion?: string;

  // Parámetros cuantitativos
  cantidad?: number;
  tipoProducto?: string;

  // Análisis de impacto
  impactoEstimado?: number;
  impactoReal?: number;

  // Coste económico
  costeEuros: number;
}

export interface Resultado {
  idResultado?: number;
  idSimulacion: number;

  // Información temporal
  fechaFinalizacion?: Date;
  diaFinalizacion: number;

  // Estado final
  estadoFinal: EstadoFinal;
  etapaAlcanzada: EtapaFenologica;

  // Métricas de rendimiento
  rendimientoKgHa: number;
  rendimientoPotencial?: number;
  rendimientoRelativo: number;
  calidadProducto: CalidadProducto;

  // Parámetros finales del cultivo
  biomasaFinal?: number;
  alturaFinal?: number;
  indiceAreaFoliarFinal?: number;

  // Balance hídrico
  precipitacionTotal: number;
  riegoTotal: number;
  evapotranspiracionReal?: number;
  diasEstresHidrico: number;
  eficienciaUsoAgua?: number;

  // Balance nutricional
  nitrogenoUsado: number;
  fosforoUsado: number;
  potasioUsado: number;
  nitrogenoExtraido?: number;
  fosforoExtraido?: number;
  potasioExtraido?: number;

  // Indicadores de estrés acumulados
  diasEstresTermico: number;
  diasEstresNutricional: number;

  // Análisis de causas
  causaPrincipal: CausaPrincipal;
  diaCritico?: number;

  // Recomendaciones
  recomendaciones?: Recomendacion[];

  // Análisis económico
  costeTotal: number;
  ingresoEstimado: number;
  beneficioNeto: number;
}

export interface Recomendacion {
  tipo: string;
  mensaje: string;
  prioridad: 'baja' | 'media' | 'alta';
}

export interface Economia {
  idEconomia?: number;
  idSimulacion: number;

  // Costes desglosados
  costeSemillas: number;
  costeFertilizantes: number;
  costeRiego: number;
  costeTratamientos: number;
  costeManoObra: number;
  costeMaquinaria: number;
  otrosCostes: number;
  costeTotal: number;

  // Ingresos
  precioVentaKg: number;
  ingresoEstimado: number;

  // Balance
  beneficioNeto: number;
  rentabilidadPorcentaje?: number;
}

export interface EscenarioPredefinido {
  idEscenario?: number;
  idCreador: number;

  // Información básica
  nombre: string;
  descripcion: string;
  objetivoEducativo?: string;
  nivelDificultad: number;

  // Configuración del escenario
  configuracion: Partial<Simulacion>;
  eventosProgramados?: Evento[];

  // Metadatos
  esPublico: boolean;
  fechaCreacion?: Date;
  vecesUsado: number;
  valoracionPromedio?: number;
}

// ============================================================================
// INTERFACES PARA FORMULARIOS Y UI
// ============================================================================

export interface LoginData {
  email: string;
  contrasena: string;
}

export interface RegisterData {
  nombre: string;
  email: string;
  contrasena: string;
  confirmarContrasena: string;
  rol: RolUsuario;
  institucion?: string;
}

export interface SimulacionFormData {
  // Paso 1: Información básica
  nombreSimulacion: string;
  superficieHectareas: number;

  // Paso 2: Configuración del suelo
  tipoSuelo: TipoSuelo;
  phSuelo: number;
  materiaOrganica?: number;
  drenaje: Drenaje;
  capacidadRetencionAgua: CapacidadRetencionAgua;
  nitrogenoInicial: number;
  fosforoInicial: number;
  potasioInicial: number;

  // Paso 3: Configuración climática
  regionClimatica: RegionClimatica;
  temperaturaMedia: number;
  precipitacionAnual: number;

  // Paso 4: Selección de cultivo
  tipoCultivo: TipoCultivo;
  fechaSiembra: Date | string;
  densidadSiembra: number;
  sistemaRiego: SistemaRiego;
}

export interface Notificacion {
  id: string;
  tipo: 'success' | 'warning' | 'error' | 'info';
  titulo: string;
  mensaje: string;
  timestamp: Date;
  leida: boolean;
}

export interface EstadisticasUsuario {
  totalSimulaciones: number;
  completadas: number;
  fallidas: number;
  enCurso: number;
  saludPromedio?: number;
}

export interface EstadisticasEconomicas {
  presupuestoInicial: number;
  presupuestoActual: number;
  gastosTotales: number;
  ingresosEstimados: number;
  balanceActual: number;
  gastosPorCategoria: {
    [categoria: string]: number;
  };
}

// ============================================================================
// DATOS DE CULTIVOS (Configuraciones de los 15 cultivos)
// ============================================================================

export interface CultivoConfig {
  nombre: string;
  nombreCientifico: string;
  tipo: 'cereal' | 'hortaliza' | 'leguminosa' | 'industrial';
  cicloVidaDias: number;
  temperaturaOptima: { min: number; max: number };
  phOptimo: { min: number; max: number };
  aguaNecesariaMm: number;
  densidadRecomendada: number;
  rendimientoEsperado: number; // kg/ha
  precioMercadoKg: number;
  imagen?: string;
  descripcion: string;
  etapas: {
    etapa: EtapaFenologica;
    duracionDias: number;
    descripcion: string;
  }[];
}

// ============================================================================
// RESPUESTAS DE API
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

export interface AuthResponse {
  token: string;
  usuario: Usuario;
}

export interface PaginatedResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

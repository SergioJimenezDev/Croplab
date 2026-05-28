import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Loading, EconomyPanel, EventEffects } from '../components/common';
import { simulacionService } from '../services/simulacionService';
import { CULTIVOS_CONFIG } from '../utils/cultivosData';
import {
  Simulacion,
  EstadoDiario,
  Evento,
  TipoEvento,
  OrigenEvento,
  Intensidad
} from '../types';
import NotificationPanel from '../components/NotificationPanel';
import InteractiveGuide from '../components/InteractiveGuide';
import EventVFX, { VFXEffect } from '../components/EventVFX';

// Lazy load del FarmScene — la escena 3D + three.js + drei pesa ~1 MB.
// Cargándola solo al entrar a la simulación reducimos drásticamente el bundle inicial
// y el time-to-interactive del login/dashboard.
const FarmScene = React.lazy(() => import('../components/scene/FarmScene'));
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart
} from 'recharts';
import './SimulationView.css';

type EventTone = 'positive' | 'climatic' | 'soil' | 'bio' | 'anomaly';

interface EventOption {
  tipo: TipoEvento;
  nombre: string;
  icono: string;
}

interface EventCategory {
  titulo: string;
  emoji: string;
  tono: EventTone;
  eventos: EventOption[];
}

// Eventos persistentes (siguen "activos" mientras no se aplique una acción correctora)
// y su acción resolutoria. Eventos puntuales (terremoto, rayo, granizo, etc.) NO están aquí
// porque su daño es de un día y no necesitan tratamiento continuo.
interface EventoActivoInfo {
  emoji: string;
  nombre: string;
  acciones: TipoEvento[];   // tipos de evento del usuario que resuelven
  accionTexto: string;       // descripción legible para la UI
  /** Si true, el evento permanece activo indefinidamente hasta que se aplique
   *  la acción correctora. Los problemas fitosanitarios y bióticos NUNCA caducan
   *  solos: si tienes pulgones, los seguirás teniendo hasta tratar. */
  permanente?: boolean;
  /** Si true, la animación 3D de este evento solo se dispara UNA VEZ (el día
   *  que aparece) y no se re-renderiza continuamente desde baseVFX. El evento
   *  sigue apareciendo en el panel de "eventos activos" durante la ventana,
   *  pero el tornado/tsunami/granizo… no debe repetir su animación cada día. */
  oneShot?: boolean;
}

const EVENTOS_PERSISTENTES: Partial<Record<TipoEvento, EventoActivoInfo>> = {
  // Plagas, enfermedades, malas hierbas y animales — persisten hasta tratar
  // o hasta que un cataclismo los borre del mapa. Las catástrofes naturales
  // — tsunami, incendio, helada — arrastran/queman/congelan a cualquier ser
  // vivo presente en la parcela, así que cualquier insecto, hongo, virus,
  // mala hierba o animal se considera resuelto si se desata alguno de los 3.
  // Los marcamos en todas las `acciones` para que aparezcan como "remedios"
  // en el panel y el cálculo de eventos activos los limpie a la vez.
  plaga: { emoji: '🐛', nombre: 'Plaga', acciones: ['tratamiento_fitosanitario', 'control_biologico', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento, control biológico o una catástrofe (helada, tsunami, incendio)', permanente: true },
  enfermedad: { emoji: '🦠', nombre: 'Enfermedad', acciones: ['tratamiento_fitosanitario', 'control_biologico', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento, control biológico o una catástrofe que la borre', permanente: true },
  roya: { emoji: '🍂', nombre: 'Roya (hongo)', acciones: ['tratamiento_fitosanitario', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento, helada, tsunami o incendio', permanente: true },
  mildiu: { emoji: '🍄', nombre: 'Mildiu (hongo)', acciones: ['tratamiento_fitosanitario', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento, helada, tsunami o incendio', permanente: true },
  oidio: { emoji: '⚪', nombre: 'Oídio (hongo)', acciones: ['tratamiento_fitosanitario', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento, helada, tsunami o incendio', permanente: true },
  virus_mosaico: { emoji: '🧬', nombre: 'Virus del mosaico', acciones: ['tratamiento_fitosanitario', 'control_biologico', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento + control biológico, o una catástrofe', permanente: true },
  pulgones: { emoji: '🐜', nombre: 'Pulgones', acciones: ['tratamiento_fitosanitario', 'control_biologico', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Control biológico, tratamiento o catástrofe (frío/agua/fuego)', permanente: true },
  arana_roja: { emoji: '🕷️', nombre: 'Araña roja', acciones: ['tratamiento_fitosanitario', 'control_biologico', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento, control biológico o catástrofe', permanente: true },
  caracoles: { emoji: '🐌', nombre: 'Caracoles', acciones: ['tratamiento_fitosanitario', 'control_biologico', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento, control biológico o catástrofe', permanente: true },
  nematodos: { emoji: '🪱', nombre: 'Nematodos', acciones: ['tratamiento_fitosanitario', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento o catástrofe (helada / tsunami / incendio)', permanente: true },
  // Las langostas también pueden ser arrastradas por un tornado.
  langostas: { emoji: '🦗', nombre: 'Langostas', acciones: ['tratamiento_fitosanitario', 'tornado', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento urgente, tornado o cualquier catástrofe que las elimine', permanente: true },
  marabunta_hormigas: { emoji: '🐜', nombre: 'Marabunta de hormigas', acciones: ['tratamiento_fitosanitario', 'control_biologico', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Tratamiento, control biológico o catástrofe', permanente: true },

  // Fauna grande — persiste hasta instalar barrera; también se dispersa o
  // muere ante un tornado, tsunami, incendio o una helada brutal.
  aves_plaga: { emoji: '🐦', nombre: 'Bandadas de aves', acciones: ['instalacion_malla', 'tornado', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Mallas, tornado o una catástrofe que las disperse', permanente: true },
  jabalies: { emoji: '🐗', nombre: 'Jabalíes', acciones: ['instalacion_malla', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Vallado, helada, tsunami o incendio los echa de la parcela', permanente: true },

  // Malas hierbas — persisten hasta limpiar; también las arrastra el agua,
  // las quema un incendio o las mata una helada.
  malas_hierbas: { emoji: '🌾', nombre: 'Malas hierbas', acciones: ['poda', 'mulching', 'helada', 'inundacion', 'incendio_proximo'], accionTexto: 'Azada, mulching o una catástrofe que las arrase', permanente: true },

  // Problemas de suelo persistentes
  salinizacion: { emoji: '🧂', nombre: 'Salinización del suelo', acciones: ['riego', 'enmienda_calcica'], accionTexto: 'Riegos abundantes de lavado + enmienda cálcica' },
  acidificacion_suelo: { emoji: '🧪', nombre: 'Acidificación del suelo', acciones: ['enmienda_calcica'], accionTexto: 'Aplica enmienda cálcica (encalado)' },
  erosion_suelo: { emoji: '⛰️', nombre: 'Erosión del suelo', acciones: ['compostaje', 'mulching'], accionTexto: 'Aplica compostaje o mulching' },

  // Otros
  contaminacion_quimica: { emoji: '☣️', nombre: 'Contaminación química', acciones: ['compostaje', 'fertilizacion'], accionTexto: 'Aplica compostaje y refuerza con fertilización' },

  // Climáticos persistentes. Una lluvia intensa o un tsunami arrastran la
  // calima; un buen aguacero también acaba con la sequía y la ola de calor;
  // un viento fuerte dispersa la niebla.
  polvo_sahariano: { emoji: '🏜️', nombre: 'Calima sahariana', acciones: ['riego', 'lluvia_torrencial', 'inundacion'], accionTexto: 'Riega o deja que la lluvia / un tsunami limpie la calima' },
  niebla_persistente: { emoji: '🌫️', nombre: 'Niebla densa persistente', acciones: ['tratamiento_fitosanitario', 'viento_fuerte'], accionTexto: 'Aplica tratamiento o suelta un viento fuerte que la disperse' },
  lluvia_acida: { emoji: '☢️', nombre: 'Lluvia ácida', acciones: ['enmienda_calcica', 'riego'], accionTexto: 'Aplica enmienda cálcica y riega para lavar las hojas' },
  sequia: { emoji: '☀️', nombre: 'Sequía', acciones: ['riego', 'lluvia_torrencial', 'inundacion', 'nevada'], accionTexto: 'Riega o desata lluvia, tsunami o nevada para romper la sequía' },
  ola_calor: { emoji: '🔥', nombre: 'Ola de calor', acciones: ['riego', 'mulching', 'lluvia_torrencial'], accionTexto: 'Riega, aplica mulching o deja que una lluvia torrencial enfríe el cultivo' },

  // Climáticos transitorios — la animación 3D se dispara UNA SOLA VEZ el día
  // que ocurren (vía flash puntual). Aparecen en el panel de eventos activos
  // durante la ventana de días, pero no relanzan la animación cada día.
  // El incendio se queda como continuo (el fuego sigue ardiendo) porque su
  // resolución necesita riego — el resto son fenómenos meteorológicos de
  // duración corta cuyo daño ya está hecho cuando pasan.
  lluvia_torrencial: { emoji: '🌧️', nombre: 'Lluvia torrencial', acciones: [], accionTexto: 'El suelo queda saturado al 100%; se irá secando solo', oneShot: true },
  granizo: { emoji: '🧊', nombre: 'Granizo', acciones: [], accionTexto: 'El daño físico ya está hecho; espera a que pase', oneShot: true },
  viento_fuerte: { emoji: '💨', nombre: 'Viento fuerte', acciones: [], accionTexto: 'Espera a que amaine', oneShot: true },
  helada: { emoji: '❄️', nombre: 'Helada', acciones: [], accionTexto: 'Espera a que el frío remita', oneShot: true },
  nevada: { emoji: '🌨️', nombre: 'Nevada', acciones: [], accionTexto: 'Espera al deshielo', oneShot: true },
  rayo_caido: { emoji: '⚡', nombre: 'Rayo caído', acciones: ['tratamiento_fitosanitario'], accionTexto: 'Aplica tratamiento para mitigar el estrés', oneShot: true },
  incendio_proximo: { emoji: '🔥', nombre: 'Incendio', acciones: ['riego', 'inundacion', 'lluvia_torrencial', 'nevada'], accionTexto: 'Riega, lanza un tsunami, una lluvia torrencial o una nevada para apagarlo' },
  inundacion: { emoji: '🌊', nombre: 'Tsunami', acciones: ['aireacion_suelo'], accionTexto: 'Airea el suelo cuando baje el agua', oneShot: true },
  tornado: { emoji: '🌀', nombre: 'Tornado', acciones: [], accionTexto: 'El daño físico ya está hecho; espera a que pase', oneShot: true },
  terremoto: { emoji: '🌍', nombre: 'Terremoto', acciones: ['aireacion_suelo'], accionTexto: 'Airea las raíces dañadas por la sacudida', oneShot: true },
  // El OVNI sólo se va con el cañón anti-OVNI. acciones=[] para que ningún
  // riego ni malla lo resuelva por el flujo normal; la "resolución" se hace
  // localmente añadiendo el idEvento al set ovnisDerribadosIds (persistido en
  // localStorage) y filtrándolo en eventosActivosMemo.
  ola_radiacion_uv: { emoji: '🛸', nombre: 'Radiación UV alta', acciones: [], accionTexto: '¡Saca el cañón anti-OVNI y derríbalo!' },

  // Técnicos persistentes
  apagon_riego: { emoji: '🔌', nombre: 'Apagón del sistema de riego', acciones: ['riego'], accionTexto: 'Riega manualmente hasta que se restaure el sistema' }
};

const VENTANA_DIAS_ACTIVO = 10;

// Coste base €/ha de cada acción del usuario. ESTA TABLA DEBE COINCIDIR EXACTAMENTE
// con SimulacionService.calcularCosteEvento() en el backend; en caso contrario el
// preview que ve el usuario antes de aplicar el evento no encajaría con el cargo real.
const COSTE_POR_HECTAREA: Partial<Record<TipoEvento, number>> = {
  riego: 15.00,
  fertilizacion: 80.00,
  tratamiento_fitosanitario: 120.00,
  poda: 60.00,
  mulching: 70.00,
  control_biologico: 90.00,
  enmienda_calcica: 55.00,
  instalacion_malla: 180.00,
  compostaje: 50.00,
  aireacion_suelo: 45.00,
};

interface EventoActivo {
  evento: Evento;
  info: EventoActivoInfo;
}

// Algunos eventos llevan una coreografía 3D más larga (rayos múltiples,
// terremoto con sacudida sostenida, destrucción total...) y necesitan más
// tiempo de flash para que la animación termine antes de que se desactive.
// Constante a nivel de módulo para que triggerFlash pueda consultarla.
const FLASH_DURATIONS_MS_MAP: Partial<Record<string, number>> = {
  rayo_caido: 6000,
  terremoto: 5000,
  inundacion: 5000,
  ola_radiacion_uv: 7000,
  plaga: 5000,
  pulgones: 5000,
  arana_roja: 5000,
  caracoles: 5000,
  langostas: 5000,
  marabunta_hormigas: 5000,
  // Destrucción total
  meteorito: 8000,
  bomba_nuclear: 9000,
  zombies: 9000,
  // Cañón anti-OVNI (acción visual local, no se persiste como tal)
  derribar_ovni: 7000
};
const DEFAULT_FLASH_MS = 4000;

const calcularEventosActivos = (eventos: Evento[], diaActual: number): EventoActivo[] => {
  const activos: EventoActivo[] = [];
  // Recorrer en orden cronológico; nos quedamos con la última ocurrencia de cada tipo sin tratar.
  // Incluye tanto eventos del sistema como aplicados manualmente por el usuario.
  const masRecientePorTipo = new Map<string, Evento>();
  eventos.forEach(ev => {
    const info = EVENTOS_PERSISTENTES[ev.tipoEvento];
    if (!info) return;
    // Los eventos `permanente` (problemas fitosanitarios, fauna, malas hierbas)
    // siguen activos hasta que se apliquen sus acciones correctoras —
    // saltamos el cribado por ventana de días para ellos.
    if (!info.permanente && ev.diaEvento < diaActual - VENTANA_DIAS_ACTIVO) return;
    masRecientePorTipo.set(ev.tipoEvento, ev);
  });
  masRecientePorTipo.forEach((ev) => {
    const info = EVENTOS_PERSISTENTES[ev.tipoEvento]!;
    // ¿Hay alguna acción del usuario DESPUÉS del evento que lo resuelva?
    // En el mismo día, usamos idEvento (secuencial en backend) como desempate,
    // si no, una acción podría "resolver" un evento futuro invocado más tarde
    // ese mismo día (caso del cañón anti-OVNI re-invocado en el mismo día).
    const evId = ev.idEvento ?? 0;
    const resuelto = eventos.some(e =>
      e.origen === 'usuario' &&
      e.diaEvento <= diaActual &&
      info.acciones.includes(e.tipoEvento) &&
      (
        e.diaEvento > ev.diaEvento ||
        (e.diaEvento === ev.diaEvento && (e.idEvento ?? 0) > evId)
      )
    );
    if (!resuelto) activos.push({ evento: ev, info });
  });
  return activos;
};

// ============================================================
// Configuración de eventos para el panel de PERSONALIZACIÓN
// ============================================================

// Universo de eventos que el sistema puede generar aleatoriamente
// (debe coincidir con el `pool` de SimulacionService.construirEventoAleatorio).
const EVENTOS_SISTEMA: TipoEvento[] = [
  'sequia', 'helada', 'ola_calor', 'lluvia_torrencial', 'granizo', 'viento_fuerte',
  'plaga', 'enfermedad', 'malas_hierbas',
  'terremoto', 'tornado', 'inundacion', 'nevada', 'rayo_caido',
  'incendio_proximo', 'niebla_persistente', 'polvo_sahariano', 'lluvia_acida',
  'erosion_suelo', 'salinizacion', 'acidificacion_suelo',
  'roya', 'mildiu', 'oidio', 'virus_mosaico',
  'pulgones', 'arana_roja', 'caracoles', 'nematodos',
  'aves_plaga', 'jabalies', 'langostas',
  'apagon_riego', 'contaminacion_quimica', 'marabunta_hormigas', 'ola_radiacion_uv'
];

// "Modo realista" — eventos que ocurren con cierta frecuencia en agricultura
// real (sobre todo en el contexto mediterráneo / europeo). Se excluyen:
//   • Catástrofes geológicas o muy raras: terremoto, tornado, rayo_caido, lluvia_acida.
//   • Problemas de suelo muy específicos: salinizacion, acidificacion_suelo.
//   • Enfermedades muy concretas: virus_mosaico.
//   • Fauna exótica: langostas (no llegan a España).
//   • Subrealistas / técnicos: apagon_riego, contaminacion_quimica, marabunta_hormigas, ola_radiacion_uv.
const EVENTOS_REALISTAS: TipoEvento[] = [
  'sequia', 'helada', 'ola_calor', 'lluvia_torrencial', 'granizo', 'viento_fuerte',
  'inundacion', 'nevada', 'incendio_proximo', 'niebla_persistente', 'polvo_sahariano',
  'erosion_suelo',
  'plaga', 'enfermedad', 'malas_hierbas',
  'roya', 'mildiu', 'oidio',
  'pulgones', 'arana_roja', 'caracoles', 'nematodos',
  'aves_plaga', 'jabalies'
];

const EVENT_CATEGORIES: EventCategory[] = [
  {
    titulo: 'Manejo del Cultivo',
    emoji: '🌱',
    tono: 'positive',
    eventos: [
      { tipo: 'riego', nombre: 'Riego', icono: '💧' },
      { tipo: 'fertilizacion', nombre: 'Fertilización', icono: '🌿' },
      { tipo: 'tratamiento_fitosanitario', nombre: 'Tratamiento', icono: '💉' },
      { tipo: 'poda', nombre: 'Poda', icono: '✂️' },
      { tipo: 'mulching', nombre: 'Mulching', icono: '🍂' },
      { tipo: 'control_biologico', nombre: 'Control biológico', icono: '🐞' },
      { tipo: 'enmienda_calcica', nombre: 'Enmienda cálcica', icono: '🥛' },
      { tipo: 'instalacion_malla', nombre: 'Instalar malla', icono: '🕸️' },
      { tipo: 'compostaje', nombre: 'Compostaje', icono: '♻️' },
      { tipo: 'aireacion_suelo', nombre: 'Airear suelo', icono: '🌬️' }
    ]
  },
  {
    titulo: 'Eventos Climáticos',
    emoji: '🌤️',
    tono: 'climatic',
    eventos: [
      { tipo: 'sequia', nombre: 'Sequía', icono: '☀️' },
      { tipo: 'helada', nombre: 'Helada', icono: '❄️' },
      { tipo: 'ola_calor', nombre: 'Ola de calor', icono: '🔥' },
      { tipo: 'lluvia_torrencial', nombre: 'Lluvia torrencial', icono: '🌧️' },
      { tipo: 'granizo', nombre: 'Granizo', icono: '🧊' },
      { tipo: 'viento_fuerte', nombre: 'Viento fuerte', icono: '💨' },
      { tipo: 'terremoto', nombre: 'Terremoto', icono: '🌋' },
      { tipo: 'tornado', nombre: 'Tornado', icono: '🌪️' },
      { tipo: 'inundacion', nombre: 'Tsunami', icono: '🌊' },
      { tipo: 'nevada', nombre: 'Nevada', icono: '🌨️' },
      { tipo: 'rayo_caido', nombre: 'Rayo', icono: '⚡' },
      { tipo: 'incendio_proximo', nombre: 'Incendio', icono: '🔥' },
      { tipo: 'niebla_persistente', nombre: 'Niebla densa', icono: '🌫️' },
      { tipo: 'polvo_sahariano', nombre: 'Calima', icono: '🏜️' },
      { tipo: 'lluvia_acida', nombre: 'Lluvia ácida', icono: '☢️' }
    ]
  },
  {
    titulo: 'Problemas del Suelo',
    emoji: '🌍',
    tono: 'soil',
    eventos: [
      { tipo: 'erosion_suelo', nombre: 'Erosión', icono: '⛰️' },
      { tipo: 'salinizacion', nombre: 'Salinización', icono: '🧂' },
      { tipo: 'acidificacion_suelo', nombre: 'Acidificación', icono: '🧪' }
    ]
  },
  {
    titulo: 'Problemas Fitosanitarios',
    emoji: '🐛',
    tono: 'bio',
    eventos: [
      { tipo: 'plaga', nombre: 'Plaga genérica', icono: '🐛' },
      { tipo: 'enfermedad', nombre: 'Enfermedad', icono: '🦠' },
      { tipo: 'malas_hierbas', nombre: 'Malas hierbas', icono: '🌾' },
      { tipo: 'roya', nombre: 'Roya', icono: '🍂' },
      { tipo: 'mildiu', nombre: 'Mildiu', icono: '🍄' },
      { tipo: 'oidio', nombre: 'Oídio', icono: '⚪' },
      { tipo: 'virus_mosaico', nombre: 'Virus mosaico', icono: '🧬' },
      { tipo: 'pulgones', nombre: 'Pulgones', icono: '🐜' },
      { tipo: 'arana_roja', nombre: 'Araña roja', icono: '🕷️' },
      { tipo: 'caracoles', nombre: 'Caracoles', icono: '🐌' },
      { tipo: 'nematodos', nombre: 'Nematodos', icono: '🪱' },
      { tipo: 'aves_plaga', nombre: 'Aves plaga', icono: '🐦' },
      { tipo: 'jabalies', nombre: 'Jabalíes', icono: '🐗' },
      { tipo: 'langostas', nombre: 'Langostas', icono: '🦗' }
    ]
  },
  {
    titulo: 'Eventos Técnicos / Anómalos',
    emoji: '🛸',
    tono: 'anomaly',
    eventos: [
      { tipo: 'apagon_riego', nombre: 'Apagón de riego', icono: '🔌' },
      { tipo: 'contaminacion_quimica', nombre: 'Contaminación', icono: '☣️' },
      { tipo: 'marabunta_hormigas', nombre: 'Marabunta', icono: '🐜' },
      { tipo: 'ola_radiacion_uv', nombre: 'Radiación UV', icono: '🛸' }
    ]
  }
];

const SimulationView: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();

  const [simulacion, setSimulacion] = useState<Simulacion | null>(null);
  const [historial, setHistorial] = useState<EstadoDiario[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [modalClosing, setModalClosing] = useState(false);
  const [personalizacionAbierta, setPersonalizacionAbierta] = useState(false);
  // Eventos de destrucción total — vivían en un modal aparte pero ahora se
  // disparan desde una sección dentro del propio panel de personalización.
  type EventoDestructivo = 'meteorito' | 'bomba_nuclear' | 'zombies';
  const [destruccionAplicando, setDestruccionAplicando] = useState(false);

  // OVNIs derribados localmente (no se persiste en backend). Cada vez que el
  // jugador acaba con un OVNI a tiros, guardamos el idEvento del evento UV
  // para excluirlo de eventosActivosMemo. localStorage por id de simulación
  // para que sobreviva a recargas. Cuando aparezca un OVNI NUEVO tendrá un
  // idEvento distinto y volverá a salir activo (y el cañón disponible).
  // Eventos "ignorados localmente": el jugador los ha resuelto desde el frontend
  // (derribar OVNI, limpiar afecciones...) sin tocar backend. Sus idEvento se
  // excluyen de eventosActivosMemo. Se persisten por simulación en localStorage
  // para que sobrevivan a recargas.
  const eventosIgnoradosKey = id ? `croplab_eventos_ignorados_${id}` : null;
  const [eventosIgnoradosIds, setEventosIgnoradosIds] = useState<Set<number>>(() => {
    if (!eventosIgnoradosKey) return new Set();
    try {
      const raw = window.localStorage.getItem(eventosIgnoradosKey);
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as number[];
      return new Set(arr);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (!eventosIgnoradosKey) return;
    try {
      window.localStorage.setItem(eventosIgnoradosKey, JSON.stringify(Array.from(eventosIgnoradosIds)));
    } catch { /* quota / privacy mode → ignorar */ }
  }, [eventosIgnoradosIds, eventosIgnoradosKey]);

  // Cierra el modal con animación de salida (~280 ms)
  const closeEventModal = () => {
    setModalClosing(true);
    setTimeout(() => {
      setShowEventModal(false);
      setModalClosing(false);
    }, 280);
  };
  const [selectedTab, setSelectedTab] = useState<'detalles' | 'alertas' | 'graficos' | 'eventos' | 'economia'>('alertas');
  const [sidePanelOpen, setSidePanelOpen] = useState<boolean>(true);
  const [sidePanelFullscreen, setSidePanelFullscreen] = useState<boolean>(false);
  // VFX en TRES capas, ya con soporte de SIMULTÁNEOS para la escena 3D:
  //  - flashes (queue): efectos temporales acumulables (acción del usuario,
  //    catástrofe puntual del sistema, cañón anti-OVNI...). Cada flash tiene
  //    su propio temporizador; pueden coexistir varios al mismo tiempo y la
  //    escena 3D los muestra en paralelo. La capa 2D (EventVFX) sólo lleva el
  //    más reciente para no saturar la pantalla con partículas solapadas.
  //  - baseVFX: efecto continuo correspondiente al evento ACTIVO más reciente.
  //    Se reproduce en bucle mientras haya algún problema persistente sin resolver.
  //  - aftermathSet: set de eventos destructivos cuya secuela visual sigue en
  //    pantalla tras terminar su flash, hasta que avances día.
  type FlashEntry = { id: number; effect: VFXEffect; expiresAt: number };
  const [flashes, setFlashes] = useState<FlashEntry[]>([]);
  const [aftermathSet, setAftermathSet] = useState<Set<VFXEffect>>(new Set());
  // Eventos cuyo VFX está en "fade-out" porque el jugador acaba de aplicar la
  // acción correctora. El componente del evento (p.ej. Fire) recibe un flag
  // para que las llamas se reduzcan progresivamente durante la animación de la
  // acción, en lugar de desaparecer de golpe.
  const [extinguishingSet, setExtinguishingSet] = useState<Set<VFXEffect>>(new Set());
  const flashIdCounter = useRef(0);
  const flashTimeoutsRef = useRef<Map<number, number>>(new Map());
  const knownEventoIdsRef = useRef<Set<number>>(new Set());
  const eventosInitialisedRef = useRef(false);
  // Eventos cuya animación NUNCA debe reproducirse dos veces el mismo día.
  // Si el jugador (o el sistema) intenta volver a disparar uno de ellos
  // — tsunami, tornado, rayo, OVNI — `triggerFlash` ignora la petición
  // hasta que se avance día. Esto evita que la pared de agua del tsunami
  // o la coreografía de entrada del OVNI se relancen al aplicar otros
  // eventos.
  const NO_REPEAT_EVENTS_TODAY = React.useRef(new Set<string>([
    'inundacion', 'tornado', 'rayo_caido', 'ola_radiacion_uv'
  ])).current;
  const firedNoRepeatTodayRef = useRef<Set<string>>(new Set());

  // Estado para nuevo evento
  const [nuevoEvento, setNuevoEvento] = useState<Partial<Evento>>({
    tipoEvento: 'riego',
    cantidad: 0,
    descripcion: ''
  });

  // Memos derivados que dependen de eventos / simulacion.
  // IMPORTANTE: estos hooks tienen que estar antes de cualquier early-return
  // (los hooks deben llamarse en el mismo orden en cada render).
  const eventosActivosMemo = React.useMemo(
    () => calcularEventosActivos(eventos, simulacion?.diaActual ?? 0)
      // Excluimos OVNIs que el jugador ya derribó con el cañón (resolución local).
      .filter(({ evento }) => evento.idEvento == null || !eventosIgnoradosIds.has(evento.idEvento)),
    [eventos, simulacion?.diaActual, eventosIgnoradosIds]
  );
  const baseVFXMemo: VFXEffect | null = React.useMemo(() => {
    // Los eventos `oneShot` (tornado, tsunami, granizo…) NO contribuyen al
    // baseVFX porque su animación ya se disparó vía flash el día que ocurrió.
    // Si los incluyéramos, la animación se relanzaría cada render mientras el
    // evento siga apareciendo en el panel de activos.
    const candidatos = eventosActivosMemo.filter(({ info }) => !info.oneShot);
    if (candidatos.length === 0) return null;
    return candidatos.reduce(
      (m, e) => e.evento.diaEvento > m.evento.diaEvento ? e : m
    ).evento.tipoEvento as VFXEffect;
  }, [eventosActivosMemo]);

  // baseVFXSetMemo = TODOS los persistentes activos (no solo el más reciente).
  // Antes baseVFX era un solo valor, así que si tenías OVNI + sequía solo
  // se veía la sequía y el OVNI desaparecía. Al resolver la sequía, el OVNI
  // volvía a aparecer y su animación de entrada se reproducía de nuevo. Con
  // un Set TODOS los persistentes permanecen montados a la vez y ningún
  // componente se remonta por culpa de otro evento.
  const baseVFXSetMemo: Set<string> = React.useMemo(() => {
    const s = new Set<string>();
    eventosActivosMemo.forEach(({ evento, info }) => {
      if (!info.oneShot) s.add(evento.tipoEvento);
    });
    return s;
  }, [eventosActivosMemo]);

  // sceneVFXSet = TODOS los efectos activos para la escena 3D (modelos 3D
  // pueden coexistir sin solaparse: ovni + tractor + fuego simultáneamente).
  // IMPORTANTE: este useMemo va aquí arriba — los hooks deben llamarse SIEMPRE
  // en el mismo orden, sin early returns por encima.
  const sceneVFXSet: Set<string> = React.useMemo(() => {
    const s = new Set<string>();
    flashes.forEach(f => s.add(f.effect));
    baseVFXSetMemo.forEach(e => s.add(e));
    aftermathSet.forEach(e => s.add(e));
    return s;
  }, [flashes, baseVFXSetMemo, aftermathSet]);

  // Clima ambiental derivado de los eventos activos. Cambia los doodles dibujados
  // en las paredes del cubo de papel (sol, gotas, copos…).
  const climaEscena = React.useMemo<'normal' | 'caluroso' | 'lluvioso' | 'frio'>(() => {
    const tipos = new Set(eventosActivosMemo.map(e => e.evento.tipoEvento));
    if (tipos.has('sequia') || tipos.has('ola_calor') || tipos.has('incendio_proximo')) return 'caluroso';
    if (tipos.has('lluvia_torrencial') || tipos.has('inundacion') || tipos.has('lluvia_acida')) return 'lluvioso';
    if (tipos.has('helada') || tipos.has('nevada')) return 'frio';
    return 'normal';
  }, [eventosActivosMemo]);

  // Lista de banderitas que se clavan en el suelo 3D — una por evento activo.
  const eventosBanderitas = React.useMemo(() => (
    eventosActivosMemo.map(({ evento, info }) => ({
      id: evento.idEvento ?? `${evento.tipoEvento}-${evento.diaEvento}`,
      emoji: info.emoji,
      color: '#fff4cc'
    }))
  ), [eventosActivosMemo]);

  // El espantapájaros aparece mientras el usuario tenga al menos una malla
  // (vallado / antipájaros / antigranizo) instalada en este cultivo.
  const tieneMallas = React.useMemo(
    () => eventos.some(e => e.tipoEvento === 'instalacion_malla'),
    [eventos]
  );

  // Cuando un evento activo desaparece (porque el usuario aplicó la acción
  // correctora), lo mantenemos un par de segundos en pantalla con animación de
  // tachado para que se note visualmente que se ha resuelto.
  type EventoResuelto = { evento: Evento; info: EventoActivoInfo; resolvedAt: number };
  const [eventosResueltosRecientes, setEventosResueltosRecientes] = useState<EventoResuelto[]>([]);
  const prevActivosIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const prevIds = prevActivosIdsRef.current;
    const currentIds = new Set<number>();
    eventosActivosMemo.forEach(a => { if (a.evento.idEvento != null) currentIds.add(a.evento.idEvento); });

    // Eventos que estaban activos en el render previo pero ya no lo están = resueltos
    const resueltosAhora: EventoResuelto[] = [];
    prevIds.forEach(id => {
      if (currentIds.has(id)) return;
      // Sólo añadimos si tenemos info completa (a veces id puede no estar en eventos[])
      const ev = eventos.find(e => e.idEvento === id);
      const info = ev ? EVENTOS_PERSISTENTES[ev.tipoEvento] : undefined;
      if (ev && info) resueltosAhora.push({ evento: ev, info, resolvedAt: Date.now() });
    });
    if (resueltosAhora.length > 0) {
      setEventosResueltosRecientes(prev => [...prev, ...resueltosAhora]);
    }
    prevActivosIdsRef.current = currentIds;
  }, [eventosActivosMemo, eventos]);

  // Limpieza: borra del estado los eventos resueltos cuya animación ya ha terminado (2s).
  useEffect(() => {
    if (eventosResueltosRecientes.length === 0) return;
    const t = window.setTimeout(() => {
      const ahora = Date.now();
      setEventosResueltosRecientes(prev => prev.filter(r => ahora - r.resolvedAt < 2000));
    }, 250);
    return () => window.clearTimeout(t);
  }, [eventosResueltosRecientes]);

  useEffect(() => {
    loadSimulationData();
  }, [id]);

  // Eventos cuya secuela visual (plantas espachurradas, suelo inundado,
  // restos del OVNI estrellado, nieve en el terreno...) debe quedarse en pantalla
  // hasta que el jugador avance día o aplique la acción correctora. NO incluimos
  // acciones de manejo (riego, poda...) ni plagas (sus bichitos ya se van solos).
  const EVENTOS_CON_AFTERMATH = React.useRef(new Set<string>([
    'inundacion', 'incendio_proximo', 'tornado', 'granizo', 'terremoto',
    'rayo_caido', 'nevada', 'helada', 'viento_fuerte', 'lluvia_torrencial',
    'lluvia_acida', 'derribar_ovni',
    'meteorito', 'bomba_nuclear', 'zombies'
  ])).current;

  // Dispara un flash temporal. Múltiples flashes pueden coexistir; cada uno
  // tiene su propio setTimeout y se borra de la cola cuando expira.
  const triggerFlash = React.useCallback((effect: VFXEffect) => {
    // Tsunami / tornado / rayo / OVNI: una sola animación por día. Si se
    // intenta lanzar otra (re-aplicado por el usuario o spawn casual del
    // sistema), salimos sin tocar el estado para no remontar el componente.
    if (NO_REPEAT_EVENTS_TODAY.has(effect)) {
      if (firedNoRepeatTodayRef.current.has(effect)) return;
      firedNoRepeatTodayRef.current.add(effect);
    }
    const durationMs = FLASH_DURATIONS_MS_MAP[effect] ?? DEFAULT_FLASH_MS;
    flashIdCounter.current += 1;
    const id = flashIdCounter.current;
    const expiresAt = Date.now() + durationMs;
    setFlashes(prev => [...prev, { id, effect, expiresAt }]);
    const handle = window.setTimeout(() => {
      flashTimeoutsRef.current.delete(id);
      setFlashes(prev => prev.filter(f => f.id !== id));
      if (EVENTOS_CON_AFTERMATH.has(effect)) {
        setAftermathSet(prev => {
          if (prev.has(effect)) return prev;
          const next = new Set(prev);
          next.add(effect);
          return next;
        });
      }
    }, durationMs);
    flashTimeoutsRef.current.set(id, handle);
  }, [EVENTOS_CON_AFTERMATH, NO_REPEAT_EVENTS_TODAY]);

  // Cancela todos los flashes en curso (y sus aftermath asociados) — se usa al
  // avanzar día, para amanecer con la "página en blanco". También resetea el
  // ref de "ya disparado hoy" para que el día siguiente vuelvan a poder
  // dispararse tsunami / tornado / rayo / OVNI si reaparecen.
  const clearAllFlashes = React.useCallback(() => {
    flashTimeoutsRef.current.forEach(h => window.clearTimeout(h));
    flashTimeoutsRef.current.clear();
    setFlashes([]);
    firedNoRepeatTodayRef.current.clear();
  }, []);

  // Cleanup al desmontar — evita timeouts huérfanos que disparen setState en
  // un componente ya inexistente.
  useEffect(() => () => {
    flashTimeoutsRef.current.forEach(h => window.clearTimeout(h));
    flashTimeoutsRef.current.clear();
  }, []);

  // No-op para EventVFX (cada flash tiene su propio temporizador, no necesita
  // ser notificado desde fuera para limpiarse).
  const handleVfxFinish = React.useCallback(() => {}, []);

  // Detecta eventos PUNTUALES nuevos del sistema (no persistentes) → flash 4s.
  // Los persistentes no se manejan aquí; se reflejan continuamente vía baseVFX.
  // IMPORTANTE: la inicialización del set de eventos "conocidos" se hace en
  // loadSimulationData (después del primer fetch real). Si la hiciéramos aquí
  // con el array vacío del primer render, al recargar la página todos los
  // eventos antiguos se considerarían "nuevos" y dispararían un flash residual.
  useEffect(() => {
    if (!eventosInitialisedRef.current) return; // esperamos al primer load
    let puntualMasReciente: Evento | null = null;
    eventos.forEach(ev => {
      if (ev.idEvento == null) return;
      if (knownEventoIdsRef.current.has(ev.idEvento)) return;
      knownEventoIdsRef.current.add(ev.idEvento);
      if (ev.origen !== 'sistema') return;
      // Solo flash si:
      //  - NO es persistente (plagas, sequías…) — esos salen vía baseVFX continuo, O
      //  - es `oneShot` (tornado, tsunami…) — su animación es un evento de un
      //    solo día y solo debe dispararse en su aparición, no en cada render.
      const info = EVENTOS_PERSISTENTES[ev.tipoEvento];
      if (info && !info.oneShot) return;
      if (!puntualMasReciente || ev.diaEvento > puntualMasReciente.diaEvento) puntualMasReciente = ev;
    });
    if (puntualMasReciente) {
      triggerFlash((puntualMasReciente as Evento).tipoEvento as VFXEffect);
    }
  }, [eventos, triggerFlash]);

  const loadSimulationData = async () => {
    if (!id) return;

    setIsLoading(true);
    try {
      const [simData, historialData, eventosData] = await Promise.all([
        simulacionService.obtenerPorId(parseInt(id)),
        simulacionService.obtenerHistorial(parseInt(id)).catch(() => []),
        simulacionService.obtenerEventos(parseInt(id)).catch(() => [])
      ]);

      setSimulacion(simData);
      setHistorial(historialData);
      setEventos(eventosData);
      // En el PRIMER load (tras montar el componente o recargar la página),
      // marcamos todos los eventos existentes como "conocidos" para que el
      // detector de flashes no los considere nuevos. Recargas posteriores
      // (avanzar día, aplicar evento) ya tienen el ref inicializado y solo
      // se anota cada nuevo id.
      if (!eventosInitialisedRef.current) {
        eventosData.forEach((e: Evento) => {
          if (e.idEvento != null) knownEventoIdsRef.current.add(e.idEvento);
        });
        eventosInitialisedRef.current = true;
      }
    } catch (error: any) {
      console.error('Error al cargar simulación:', error);
      alert(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const avanzarDia = async () => {
    if (!id || !simulacion) return;

    setIsAdvancing(true);
    // Cancelar inmediatamente cualquier flash del día anterior — si no, sus
    // timers internos siguen corriendo y se ven en el día nuevo.
    clearAllFlashes();
    // Avanzar día también limpia el aftermath y los fade-outs en curso.
    setAftermathSet(new Set());
    setExtinguishingSet(new Set());
    try {
      const nuevoEstado = await simulacionService.avanzarDia(parseInt(id));
      await loadSimulationData();
    } catch (error: any) {
      alert(error.message || 'Error al avanzar el día');
    } finally {
      setIsAdvancing(false);
    }
  };

  const avanzarVariosDias = async (dias: number) => {
    if (!id) return;

    setIsAdvancing(true);
    clearAllFlashes();
    setAftermathSet(new Set());
    setExtinguishingSet(new Set());
    try {
      // Una sola petición HTTP en lugar de N (evita el cold start + latencia × N)
      await simulacionService.avanzarVariosDias(parseInt(id), dias);
      await loadSimulationData();
    } catch (error: any) {
      alert(error.message || 'Error al avanzar días');
    } finally {
      setIsAdvancing(false);
    }
  };

  // ============================================================
  // Eventos de DESTRUCCIÓN TOTAL — disparo manual desde modal aparte.
  // El backend pone saludActual=0 y estado=fallida. Aquí mostramos un flash
  // VFX largo correspondiente para que la animación 3D se vea por completo.
  // ============================================================
  const aplicarDestruccion = async (tipo: EventoDestructivo) => {
    if (!id) return;
    if (destruccionAplicando) return;
    setDestruccionAplicando(true);
    try {
      await simulacionService.aplicarEvento(parseInt(id), {
        tipoEvento: tipo,
        diaEvento: simulacion?.diaActual || 1,
        origen: 'usuario' as OrigenEvento,
        intensidad: 'critico'
      });
      await loadSimulationData();
      // Cerramos el panel de personalización para que el VFX se vea sin estorbo.
      setPersonalizacionAbierta(false);
      triggerFlash(tipo as VFXEffect);
    } catch (error: any) {
      alert(error.message || 'Error al aplicar destrucción');
    } finally {
      setDestruccionAplicando(false);
    }
  };

  // ============================================================
  // Derribar OVNI 🎯 — coreografía visual del cañón anti-OVNI.
  // Resolución 100% local: no se manda nada al backend (sin coste, sin malla,
  // sin riego). Marcamos el idEvento del UV activo como "derribado" y queda
  // excluido de eventosActivosMemo. Cada nuevo OVNI invocado vendrá con un
  // idEvento distinto y volverá a ser derribable.
  // ============================================================
  const [derribandoOvni, setDerribandoOvni] = useState(false);
  const derribarOvni = () => {
    if (derribandoOvni) return;
    setDerribandoOvni(true);
    triggerFlash('derribar_ovni' as VFXEffect);
    // Mata cualquier rastro del UFORadiation antes de mostrar el derribo:
    // si el OVNI vino con un flash de 'ola_radiacion_uv' (p.ej. el jugador lo
    // acaba de invocar del panel), ese flash seguiría vivo durante 7 s y el
    // modelo 3D del OVNI se vería volando a la vez que cae el otro (duplicado).
    // Limpiando también su aftermath por seguridad.
    setFlashes(prev => {
      let changed = false;
      const next = prev.filter(f => {
        if (f.effect !== 'ola_radiacion_uv') return true;
        const handle = flashTimeoutsRef.current.get(f.id);
        if (handle != null) {
          window.clearTimeout(handle);
          flashTimeoutsRef.current.delete(f.id);
        }
        changed = true;
        return false;
      });
      return changed ? next : prev;
    });
    setAftermathSet(prev => {
      if (!prev.has('ola_radiacion_uv' as VFXEffect)) return prev;
      const next = new Set(prev);
      next.delete('ola_radiacion_uv' as VFXEffect);
      return next;
    });
    // Marca todos los OVNIs activos ahora mismo como derribados (lo normal es
    // que haya uno solo; si por algún motivo hubiera varios, caen todos a la vez).
    const ovnisActivos = eventosActivosMemo
      .filter(({ evento }) => evento.tipoEvento === 'ola_radiacion_uv' && evento.idEvento != null)
      .map(({ evento }) => evento.idEvento as number);
    if (ovnisActivos.length > 0) {
      setEventosIgnoradosIds(prev => {
        const next = new Set(prev);
        ovnisActivos.forEach(id => next.add(id));
        return next;
      });
    }
    // Pequeño debounce para evitar dobles clics durante la animación
    window.setTimeout(() => setDerribandoOvni(false), 1200);
  };

  // ============================================================
  // Limpiar todas las afecciones — botón "panic" en personalización.
  // Mata cualquier flash en curso, vacía el aftermath, y marca como ignorados
  // localmente todos los eventos activos (plagas, OVNI, sequía, etc.). Todo
  // 100% local: no toca backend, sobrevive a recargas vía localStorage.
  // ============================================================
  const limpiarTodasAfecciones = () => {
    clearAllFlashes();
    setAftermathSet(new Set());
    setExtinguishingSet(new Set());
    const idsActivos = eventosActivosMemo
      .map(({ evento }) => evento.idEvento)
      .filter((id): id is number => id != null);
    if (idsActivos.length > 0) {
      setEventosIgnoradosIds(prev => {
        const next = new Set(prev);
        idsActivos.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const aplicarEvento = async () => {
    if (!id || !nuevoEvento.tipoEvento) return;

    try {
      // No enviamos costeEuros: el backend lo recalcula a partir del tipo y la superficie.
      // Si lo enviáramos con un valor erróneo (p.ej. 0 para mulching), igual quedaría
      // sobrescrito en el servidor pero confundía al desarrollador leyendo el código.
      const eventoData = {
        ...nuevoEvento,
        diaEvento: simulacion?.diaActual || 1,
        origen: 'usuario' as OrigenEvento
      };

      const tipoAplicado = nuevoEvento.tipoEvento;

      // ¿Esta acción resuelve algún evento persistente activo ahora mismo?
      // Si es así, no disparamos el flash de la acción: el baseVFX del evento
      // resuelto cae a null al instante (loadSimulationData lo recalcula) y
      // las partículas desaparecen sin que el flash de 4 s las suplante.
      // Además, recogemos los TIPOS concretos resueltos para poder retirarlos
      // a la vez del aftermathSet y de la cola de flashes — si no, el modelo
      // 3D (llamas del incendio, agua del tsunami...) seguiría en pantalla
      // hasta avanzar día aunque la acción correctora ya se haya aplicado.
      const tiposResueltos = new Set<string>(
        eventosActivosMemo
          .filter(({ info }) => info.acciones.includes(tipoAplicado as TipoEvento))
          .map(({ evento }) => evento.tipoEvento)
      );
      const resuelveActivoActual = tiposResueltos.size > 0;

      // === Fusión: rayo caído sobre sequía → genera un incendio próximo ===
      // Si el jugador suelta un rayo y la parcela está reseca, las brasas
      // prenden el cultivo. Persistimos el evento incendio EN el mismo día
      // (origen=sistema, marcado como provocado por el rayo) y luego
      // recargamos una sola vez para que ambos eventos aparezcan.
      const sequiaActiva = eventosActivosMemo.some(a => a.evento.tipoEvento === 'sequia');
      const fusionFire = tipoAplicado === 'rayo_caido' && sequiaActiva;

      await simulacionService.aplicarEvento(parseInt(id), eventoData);
      if (fusionFire) {
        try {
          await simulacionService.aplicarEvento(parseInt(id), {
            tipoEvento: 'incendio_proximo',
            diaEvento: simulacion?.diaActual || 1,
            origen: 'sistema' as OrigenEvento,
            intensidad: 'moderado',
            descripcion: 'Incendio provocado por un rayo durante la sequía'
          });
        } catch { /* si falla la fusión, seguimos con el rayo a secas */ }
      }
      await loadSimulationData();
      closeEventModal();
      setNuevoEvento({
        tipoEvento: 'riego',
        cantidad: 0,
        descripcion: ''
      });

      if (tipoAplicado) {
        // SIEMPRE mostramos la animación de la acción aplicada (riego =
        // aspersor + goteo, poda = tractor, tratamiento = pulverizador...).
        // Antes la suprimíamos cuando resolvía un evento, pero el jugador no
        // veía feedback de su acción.
        triggerFlash(tipoAplicado as VFXEffect);
        // Si la fusión disparó un incendio, lo encadenamos detrás con un
        // pequeño retardo para que el efecto del rayo se vea primero y luego
        // arranque el fuego.
        if (fusionFire) {
          window.setTimeout(() => triggerFlash('incendio_proximo' as VFXEffect), 800);
        }

        if (resuelveActivoActual) {
          // Los eventos resueltos se mantienen visibles durante la duración
          // del flash de la acción para que se vea la transición, y luego se
          // eliminan. Mientras dura esa ventana, los marcamos en
          // `extinguishingSet` para que el componente del evento (Fire) sepa
          // que tiene que apagarse progresivamente en lugar de quedarse a
          // tope hasta el último frame.
          setExtinguishingSet(prev => {
            let changed = false;
            const next = new Set(prev);
            tiposResueltos.forEach(t => {
              if (!next.has(t as VFXEffect)) {
                next.add(t as VFXEffect);
                changed = true;
              }
            });
            return changed ? next : prev;
          });
          const actionMs = FLASH_DURATIONS_MS_MAP[tipoAplicado] ?? DEFAULT_FLASH_MS;
          window.setTimeout(() => {
            setExtinguishingSet(prev => {
              let changed = false;
              const next = new Set(prev);
              tiposResueltos.forEach(t => {
                if (next.delete(t as VFXEffect)) changed = true;
              });
              return changed ? next : prev;
            });
            setAftermathSet(prev => {
              let changed = false;
              const next = new Set(prev);
              tiposResueltos.forEach(t => {
                if (next.delete(t as VFXEffect)) changed = true;
              });
              return changed ? next : prev;
            });
            setFlashes(prev => {
              let changed = false;
              const next = prev.filter(f => {
                if (!tiposResueltos.has(f.effect)) return true;
                const handle = flashTimeoutsRef.current.get(f.id);
                if (handle != null) {
                  window.clearTimeout(handle);
                  flashTimeoutsRef.current.delete(f.id);
                }
                changed = true;
                return false;
              });
              return changed ? next : prev;
            });
          }, actionMs);
        }
        // Si el evento aplicado es persistente (plaga, sequía, enfermedad...), abrir el
        // panel de alertas en la pestaña "Alertas" para que el usuario lo vea de inmediato.
        if (EVENTOS_PERSISTENTES[tipoAplicado]) {
          setSidePanelOpen(true);
          setSelectedTab('alertas');
        }
      }
    } catch (error: any) {
      alert(error.message || 'Error al aplicar evento');
    }
  };

  // Mirror exacto de SimulacionService.calcularCosteEvento(). El backend SIEMPRE
  // recalcula el coste a partir del tipo de evento × superficie; aquí lo replicamos
  // para que el usuario vea el importe real antes de aplicar.
  const calcularCosteEvento = (tipo?: TipoEvento): number => {
    if (!tipo) return 0;
    const costeBase = COSTE_POR_HECTAREA[tipo];
    if (costeBase === undefined) return 0;
    const superficie = Number(simulacion?.superficieHectareas ?? 0);
    return costeBase * superficie;
  };

  const toggleEventosAleatorios = async () => {
    if (!id || !simulacion) return;
    const nuevoValor = !(simulacion.eventosAleatorios ?? true);
    try {
      const actualizada = await simulacionService.setEventosAleatorios(parseInt(id), nuevoValor);
      setSimulacion(actualizada);
    } catch (error: any) {
      alert(error.message || 'Error al cambiar eventos aleatorios');
    }
  };

  const toggleModoInvencible = async () => {
    if (!id || !simulacion) return;
    const nuevoValor = !(simulacion.modoInvencible ?? false);
    try {
      const actualizada = await simulacionService.setModoInvencible(parseInt(id), nuevoValor);
      setSimulacion(actualizada);
    } catch (error: any) {
      alert(error.message || 'Error al cambiar modo invencible');
    }
  };

  const toggleDineroInfinito = async () => {
    if (!id || !simulacion) return;
    const nuevoValor = !(simulacion.dineroInfinito ?? false);
    try {
      const actualizada = await simulacionService.setDineroInfinito(parseInt(id), nuevoValor);
      setSimulacion(actualizada);
    } catch (error: any) {
      alert(error.message || 'Error al cambiar dinero infinito');
    }
  };

  // ============================================================
  // PERSONALIZACIÓN: eventos permitidos
  // ============================================================
  // Set actual de tipos permitidos como evento aleatorio del sistema.
  // Si el backend devuelve null/vacío, interpretamos "todos los del pool".
  const eventosPermitidosSet: Set<string> = React.useMemo(() => {
    const csv = simulacion?.eventosPermitidos;
    if (csv == null || csv.trim() === '') return new Set(EVENTOS_SISTEMA);
    return new Set(csv.split(',').map(s => s.trim()).filter(Boolean));
  }, [simulacion?.eventosPermitidos]);

  // Etiqueta legible del modo actual.
  const modoEventosLabel: 'Todos' | 'Modo realista' | 'Personalizado' = React.useMemo(() => {
    if (eventosPermitidosSet.size === EVENTOS_SISTEMA.length) return 'Todos';
    if (
      eventosPermitidosSet.size === EVENTOS_REALISTAS.length &&
      EVENTOS_REALISTAS.every(e => eventosPermitidosSet.has(e))
    ) return 'Modo realista';
    return 'Personalizado';
  }, [eventosPermitidosSet]);

  const guardarEventosPermitidos = async (lista: string[] | null) => {
    if (!id) return;
    try {
      const actualizada = await simulacionService.setEventosPermitidos(parseInt(id), lista);
      setSimulacion(actualizada);
    } catch (err: any) {
      alert(err.message || 'Error al guardar eventos permitidos');
    }
  };

  const toggleEventoPermitido = (tipo: TipoEvento) => {
    const nueva = new Set(eventosPermitidosSet);
    if (nueva.has(tipo)) nueva.delete(tipo);
    else nueva.add(tipo);
    // Si quedan TODOS marcados, mandamos null (= comportamiento por defecto del backend).
    if (nueva.size === EVENTOS_SISTEMA.length) {
      guardarEventosPermitidos(null);
    } else {
      guardarEventosPermitidos(Array.from(nueva));
    }
  };

  const aplicarPresetEventos = (preset: 'todos' | 'realista') => {
    if (preset === 'todos') guardarEventosPermitidos(null);
    else guardarEventosPermitidos([...EVENTOS_REALISTAS]);
  };

  const finalizarSimulacion = async () => {
    if (!id) return;

    if (!window.confirm('¿Estás seguro de finalizar la simulación? Esta acción no se puede deshacer.')) {
      return;
    }

    try {
      await simulacionService.finalizar(parseInt(id));
      navigate('/dashboard');
    } catch (error: any) {
      alert(error.message || 'Error al finalizar simulación');
    }
  };

  if (isLoading) {
    return <Loading fullScreen text="Cargando simulación..." />;
  }

  if (!simulacion) {
    return (
      <div className="container" style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Simulación no encontrada</h2>
        <Button onClick={() => navigate('/dashboard')}>Volver al Dashboard</Button>
      </div>
    );
  }

  const cultivoConfig = CULTIVOS_CONFIG[simulacion.tipoCultivo];
  const progresoCiclo = (simulacion.diaActual / (simulacion.diasMaximos ?? cultivoConfig.cicloVidaDias)) * 100;

  const eventosAleatoriosOn = simulacion.eventosAleatorios ?? true;
  const modoInvencibleOn = simulacion.modoInvencible ?? false;
  const dineroInfinitoOn = simulacion.dineroInfinito ?? false;
  const ultimoEstado = historial.length > 0 ? historial[historial.length - 1] : null;
  const saludColor = simulacion.saludActual > 80 ? '#5fae45' : simulacion.saludActual > 50 ? '#ffa726' : '#e53935';

  // Cálculos derivados — los hooks de memo ya están arriba (antes de los early returns).
  // Aquí simplemente accedemos a los memos definidos al principio del componente.
  const eventosActivosNow = eventosActivosMemo;
  const baseVFX: VFXEffect | null = baseVFXMemo;
  // currentVFX = lo que se ve en el HUD 2D (partículas, lluvia, granizo...).
  // Sólo el flash MÁS RECIENTE (para no apilar partículas) + base como fallback.
  const primaryFlashVFX: VFXEffect | null = flashes.length > 0
    ? flashes[flashes.length - 1].effect
    : null;
  const currentVFX: VFXEffect | null = primaryFlashVFX ?? baseVFX;
  const currentVFXDuration: number | null = primaryFlashVFX
    ? (FLASH_DURATIONS_MS_MAP[primaryFlashVFX] ?? DEFAULT_FLASH_MS)
    : null;

  // Clases extra del root según el VFX activo: screen-shake y flash de pantalla
  // para los eventos de destrucción total. Se aplican mientras dura el flash
  // (currentVFX coincide con el flash que acaba de dispararse).
  const destructClass =
    currentVFX === 'meteorito' ? 'sim-v2-shake-heavy sim-v2-flash-meteor' :
    currentVFX === 'bomba_nuclear' ? 'sim-v2-shake-extreme sim-v2-flash-nuke' :
    currentVFX === 'zombies' ? 'sim-v2-shake-light sim-v2-flash-zombies' :
    '';

  return (
    <div className={`sim-v2 ${sidePanelFullscreen ? 'sim-v2-fullscreen-active' : ''} ${destructClass}`}>
      {/* Fondo 3D */}
      <div className="sim-v2-scene">
        <Suspense fallback={<div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#cfe7ff', color: '#1c2421', fontFamily: 'var(--font-hand, sans-serif)', fontSize: '1.5rem' }}>Cargando escena…</div>}>
          <FarmScene
            simulacion={simulacion}
            vfxEvent={primaryFlashVFX ?? baseVFX}
            vfxEvents={sceneVFXSet}
            extinguishingEvents={extinguishingSet}
            clima={climaEscena}
            eventosActivos={eventosBanderitas}
            hasMallas={tieneMallas}
          />
        </Suspense>
      </div>

      {/* Overlay de flash de pantalla para eventos destructivos — un div
          a pantalla completa que parpadea blanco/rojo/verde según el evento.
          La animación CSS hace el trabajo (ver .sim-v2-flash-*). */}
      {destructClass && <div className="sim-v2-destruct-flash" aria-hidden />}

      {/* Header glass */}
      <header className="sim-v2-header">
        <div className="sim-v2-header-left">
          <button className="sim-v2-back" onClick={() => navigate('/dashboard')} title="Volver al dashboard">←</button>
          <div className="sim-v2-title">
            <h1>{simulacion.nombreSimulacion}</h1>
            <div className="sim-v2-subtitle">
              <span>{cultivoConfig.nombre}</span>
              <span className="sim-v2-dot">•</span>
              <span>{simulacion.superficieHectareas} ha</span>
              <span className="sim-v2-dot">•</span>
              <span className={`sim-v2-pill sim-v2-pill-${simulacion.estado}`}>{simulacion.estado.replace(/_/g, ' ').toUpperCase()}</span>
            </div>
          </div>
        </div>

      </header>

      {/* Stats bar */}
      <div className="sim-v2-stats">
        <div className="sim-v2-stat sim-v2-stat-salud">
          <div className="sim-v2-stat-ring">
            <svg viewBox="0 0 64 64" width="56" height="56">
              <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="6" />
              <circle
                cx="32" cy="32" r="26"
                fill="none"
                stroke={saludColor}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${(simulacion.saludActual / 100) * 163.4} 163.4`}
                transform="rotate(-90 32 32)"
              />
              <text x="32" y="37" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">{simulacion.saludActual.toFixed(0)}</text>
            </svg>
          </div>
          <div className="sim-v2-stat-meta">
            <span className="sim-v2-stat-label">Salud</span>
            <span className="sim-v2-stat-value">{simulacion.saludActual.toFixed(0)}%</span>
          </div>
        </div>

        <div className="sim-v2-stat">
          <span className="sim-v2-stat-emoji">💧</span>
          <div className="sim-v2-stat-meta">
            <span className="sim-v2-stat-label">Humedad</span>
            <span className="sim-v2-stat-value">{simulacion.humedadSueloActual.toFixed(0)}%</span>
            <div className="sim-v2-bar"><div className="sim-v2-bar-fill" style={{ width: `${simulacion.humedadSueloActual}%`, background: '#4fb3d9' }} /></div>
          </div>
        </div>

        <div className="sim-v2-stat">
          <span className="sim-v2-stat-emoji">🌿</span>
          <div className="sim-v2-stat-meta">
            <span className="sim-v2-stat-label">Etapa</span>
            <span className="sim-v2-stat-value">{simulacion.etapaFenologica}</span>
            <div className="sim-v2-bar"><div className="sim-v2-bar-fill" style={{ width: `${progresoCiclo}%`, background: '#5fae45' }} /></div>
          </div>
        </div>

        <div className="sim-v2-stat">
          <span className="sim-v2-stat-emoji">📏</span>
          <div className="sim-v2-stat-meta">
            <span className="sim-v2-stat-label">Altura</span>
            <span className="sim-v2-stat-value">{simulacion.alturaActual.toFixed(1)} cm</span>
          </div>
        </div>

        <div className="sim-v2-stat sim-v2-stat-money">
          <span className="sim-v2-stat-emoji">💰</span>
          <div className="sim-v2-stat-meta">
            <span className="sim-v2-stat-label">Presupuesto</span>
            <span className={`sim-v2-stat-value ${(simulacion.presupuestoActual || 0) < 500 ? 'low' : ''}`}>
              €{(simulacion.presupuestoActual || 0).toFixed(0)}
            </span>
          </div>
        </div>

        <div className="sim-v2-stat sim-v2-stat-day">
          <div className="sim-v2-stat-meta">
            <span className="sim-v2-stat-label">Día</span>
            <span className="sim-v2-stat-value sim-v2-day">{simulacion.diaActual}<small>/{(simulacion.diasMaximos ?? cultivoConfig.cicloVidaDias)}</small></span>
          </div>
        </div>
      </div>

      {/* Botón toggle del panel — siempre fijo al viewport, se desplaza con el panel */}
      <button
        className={`sim-v2-panel-toggle ${sidePanelOpen ? 'open' : ''} ${sidePanelFullscreen ? 'fullscreen' : ''}`}
        onClick={() => setSidePanelOpen(o => !o)}
        title={sidePanelOpen ? 'Cerrar panel' : 'Abrir panel'}
        aria-label={sidePanelOpen ? 'Cerrar panel' : 'Abrir panel'}
      >
        {sidePanelOpen ? '›' : '‹'}
      </button>

      {/* Botón pantalla completa / salir — visible solo cuando panel abierto */}
      {sidePanelOpen && (
        <button
          className={`sim-v2-panel-fullscreen ${sidePanelFullscreen ? 'exit' : ''}`}
          onClick={() => setSidePanelFullscreen(f => !f)}
          title={sidePanelFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        >
          {sidePanelFullscreen ? <><span>✕</span><span>Cerrar pantalla completa</span></> : '🗖'}
        </button>
      )}

      {/* Tabs laterales fixed al viewport */}
      {!sidePanelFullscreen && (
        <div className={`sim-v2-side-tabs ${sidePanelOpen ? 'open' : ''}`}>
          {(['detalles', 'alertas', 'graficos', 'eventos', 'economia'] as const).map(t => (
            <button
              key={t}
              className={`sim-v2-side-tab ${selectedTab === t ? 'active' : ''}`}
              onClick={() => { setSidePanelOpen(true); setSelectedTab(t as any); }}
              title={t}
            >
              {t === 'detalles' && '📋'}
              {t === 'alertas' && '⚠️'}
              {t === 'graficos' && '📈'}
              {t === 'eventos' && '📅'}
              {t === 'economia' && '💰'}
            </button>
          ))}
        </div>
      )}

      {/* Side panel */}
      <aside className={`sim-v2-side ${sidePanelOpen ? 'open' : ''} ${sidePanelFullscreen ? 'fullscreen' : ''}`}>
        <div className="sim-v2-side-content" aria-hidden={!sidePanelOpen}>
          {selectedTab === 'alertas' && (
              <>
                {(() => {
                  const activos = eventosActivosMemo;
                  const resueltos = eventosResueltosRecientes;
                  if (activos.length === 0 && resueltos.length === 0) {
                    return (
                      <div className="sim-v2-activos sim-v2-activos-empty">
                        <h3>🚨 Eventos activos</h3>
                        <p>Ningún problema persistente del sistema sin resolver. ¡Buen trabajo!</p>
                      </div>
                    );
                  }
                  return (
                    <div className="sim-v2-activos">
                      <h3>🚨 Eventos activos ({activos.length})</h3>
                      {activos.length > 0 && (
                        <p className="sim-v2-activos-hint">
                          Estos problemas siguen afectando al cultivo hasta que apliques la acción correctora.
                        </p>
                      )}
                      {activos.map(({ evento, info }) => (
                        <div key={evento.idEvento} className="sim-v2-activo-card">
                          <div className="sim-v2-activo-head">
                            <span className="sim-v2-activo-emoji">{info.emoji}</span>
                            <div className="sim-v2-activo-titulo">
                              <strong>{info.nombre}</strong>
                              <small>
                                Apareció el día {evento.diaEvento}
                                {evento.intensidad ? ` · intensidad ${evento.intensidad}` : ''}
                                {' · '}hace {Math.max(0, simulacion.diaActual - evento.diaEvento)} día(s)
                              </small>
                            </div>
                          </div>
                          <div className="sim-v2-activo-accion">
                            💡 <span>{info.accionTexto}</span>
                          </div>
                        </div>
                      ))}
                      {/* Eventos recién resueltos: aparecen tachados durante ~2 s */}
                      {resueltos.map(({ evento, info }) => (
                        <div key={`resolved-${evento.idEvento}`} className="sim-v2-activo-card sim-v2-activo-resuelto">
                          <div className="sim-v2-activo-head">
                            <span className="sim-v2-activo-emoji">{info.emoji}</span>
                            <div className="sim-v2-activo-titulo">
                              <strong>{info.nombre}</strong>
                              <small>✅ Resuelto</small>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <NotificationPanel simulacion={simulacion} ultimoEstado={ultimoEstado} eventos={eventos} />
              </>
            )}
            {selectedTab === 'detalles' && (
              <div className="sim-v2-details">
                <h3>🌍 Suelo</h3>
                <div className="info-row"><span className="label">Tipo:</span><span className="value">{simulacion.tipoSuelo.replace('_', ' ')}</span></div>
                <div className="info-row"><span className="label">pH:</span><span className="value">{simulacion.phSuelo}</span></div>
                <div className="info-row"><span className="label">Drenaje:</span><span className="value">{simulacion.drenaje}</span></div>
                <div className="info-row"><span className="label">Retención agua:</span><span className="value">{simulacion.capacidadRetencionAgua}</span></div>

                <h3 style={{ marginTop: '1rem' }}>🌤️ Clima</h3>
                <div className="info-row"><span className="label">Región:</span><span className="value">{simulacion.regionClimatica}</span></div>
                <div className="info-row"><span className="label">Tª media:</span><span className="value">{simulacion.temperaturaMedia}°C</span></div>
                <div className="info-row"><span className="label">Precip. anual:</span><span className="value">{simulacion.precipitacionAnual} mm</span></div>
                <div className="info-row"><span className="label">Riego:</span><span className="value">{simulacion.sistemaRiego}</span></div>

                <h3 style={{ marginTop: '1rem' }}>🌾 Cultivo</h3>
                <p className="scientific-name">{cultivoConfig.nombreCientifico}</p>
                <p className="description" style={{ fontSize: '0.85rem' }}>{cultivoConfig.descripcion}</p>
                <div className="info-row"><span className="label">Densidad:</span><span className="value">{simulacion.densidadSiembra}</span></div>
                <div className="info-row"><span className="label">Rend. esperado:</span><span className="value">{cultivoConfig.rendimientoEsperado} kg/ha</span></div>
                <div className="info-row"><span className="label">Precio:</span><span className="value">{cultivoConfig.precioMercadoKg} €/kg</span></div>
              </div>
            )}
            {selectedTab === 'graficos' && (
              <div className="sim-v2-charts">
                {historial.length > 0 ? (
                  <>
                    <h4>Salud</h4>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={historial}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="dia" hide />
                        <YAxis hide domain={[0, 100]} />
                        <Tooltip />
                        <Line type="monotone" dataKey="saludPlanta" stroke="#5fae45" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>

                    <h4>Altura (cm)</h4>
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={historial}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="dia" hide />
                        <YAxis hide />
                        <Tooltip />
                        <Area type="monotone" dataKey="alturaCm" stroke="#2196f3" fill="#2196f388" />
                      </AreaChart>
                    </ResponsiveContainer>

                    <h4>Humedad</h4>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={historial}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="dia" hide />
                        <YAxis hide domain={[0, 100]} />
                        <Tooltip />
                        <Line type="monotone" dataKey="humedadSuelo" stroke="#00bcd4" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>

                    <h4>Temperatura / Lluvia</h4>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={historial}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="dia" />
                        <YAxis yAxisId="temp" />
                        <YAxis yAxisId="precip" orientation="right" />
                        <Tooltip />
                        <Legend />
                        <Line yAxisId="temp" type="monotone" dataKey="temperatura" stroke="#ff9800" strokeWidth={2} dot={false} />
                        <Line yAxisId="precip" type="monotone" dataKey="precipitacionMm" stroke="#03a9f4" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>

                    <h4>Estrés acumulado (días)</h4>
                    {(() => {
                      const estresAcum = historial.map((e, i) => {
                        let h = 0, t = 0, n = 0;
                        for (let j = 0; j <= i; j++) {
                          if (historial[j].estresHidrico) h++;
                          if (historial[j].estresTermico) t++;
                          if (historial[j].estresNutricional) n++;
                        }
                        return { dia: e.dia, Hídrico: h, Térmico: t, Nutricional: n };
                      });
                      return (
                        <ResponsiveContainer width="100%" height={180}>
                          <AreaChart data={estresAcum}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dia" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Area type="monotone" dataKey="Hídrico" stackId="1" stroke="#03a9f4" fill="#03a9f455" />
                            <Area type="monotone" dataKey="Térmico" stackId="1" stroke="#ff9800" fill="#ff980055" />
                            <Area type="monotone" dataKey="Nutricional" stackId="1" stroke="#9c27b0" fill="#9c27b055" />
                          </AreaChart>
                        </ResponsiveContainer>
                      );
                    })()}

                    <h4>Salud media móvil 7 días</h4>
                    {(() => {
                      const promedio = historial.map((e, i) => {
                        const window = historial.slice(Math.max(0, i - 6), i + 1);
                        const avg = window.reduce((a, x) => a + Number(x.saludPlanta), 0) / window.length;
                        return { dia: e.dia, media: Number(avg.toFixed(1)), instantanea: Number(e.saludPlanta) };
                      });
                      return (
                        <ResponsiveContainer width="100%" height={180}>
                          <LineChart data={promedio}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dia" />
                            <YAxis domain={[0, 100]} />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="instantanea" stroke="#bbb" strokeWidth={1.5} dot={false} name="Día a día" />
                            <Line type="monotone" dataKey="media" stroke="#5fae45" strokeWidth={2.5} dot={false} name="Media 7 d" />
                          </LineChart>
                        </ResponsiveContainer>
                      );
                    })()}

                    <h4>Gasto acumulado vs presupuesto</h4>
                    {(() => {
                      const presupuesto = simulacion.presupuestoInicial ?? 1000;
                      const gastoPorDia = new Map<number, number>();
                      eventos.forEach(ev => {
                        if (ev.costeEuros && ev.costeEuros > 0) {
                          gastoPorDia.set(ev.diaEvento, (gastoPorDia.get(ev.diaEvento) ?? 0) + ev.costeEuros);
                        }
                      });
                      let acum = 0;
                      const data = historial.map(e => {
                        acum += gastoPorDia.get(e.dia) ?? 0;
                        return { dia: e.dia, Gasto: Number(acum.toFixed(2)), Presupuesto: presupuesto };
                      });
                      return (
                        <ResponsiveContainer width="100%" height={180}>
                          <AreaChart data={data}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dia" />
                            <YAxis />
                            <Tooltip formatter={(v: any) => `€${Number(v).toFixed(2)}`} />
                            <Legend />
                            <Area type="monotone" dataKey="Gasto" stroke="#e53935" fill="#e5393555" />
                            <Line type="monotone" dataKey="Presupuesto" stroke="#1565c0" strokeWidth={2} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      );
                    })()}

                    <h4>Eventos por día</h4>
                    {(() => {
                      const conteoPorDia: Record<number, { dia: number; Sistema: number; Usuario: number }> = {};
                      historial.forEach(e => { conteoPorDia[e.dia] = { dia: e.dia, Sistema: 0, Usuario: 0 }; });
                      eventos.forEach(ev => {
                        if (!conteoPorDia[ev.diaEvento]) conteoPorDia[ev.diaEvento] = { dia: ev.diaEvento, Sistema: 0, Usuario: 0 };
                        if (ev.origen === 'sistema') conteoPorDia[ev.diaEvento].Sistema++;
                        else conteoPorDia[ev.diaEvento].Usuario++;
                      });
                      const data = Object.values(conteoPorDia).sort((a, b) => a.dia - b.dia);
                      return (
                        <ResponsiveContainer width="100%" height={180}>
                          <LineChart data={data}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dia" />
                            <YAxis allowDecimals={false} />
                            <Tooltip />
                            <Legend />
                            <Line type="stepAfter" dataKey="Sistema" stroke="#c62828" strokeWidth={2} dot={false} />
                            <Line type="stepAfter" dataKey="Usuario" stroke="#2e7d32" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </>
                ) : (
                  <p>Avanza días para ver gráficos.</p>
                )}
              </div>
            )}
            {selectedTab === 'eventos' && (
              <div className="sim-v2-events">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0 }}>📅 Eventos ({eventos.length})</h3>
                  <Button size="sm" onClick={() => setShowEventModal(true)}>+ Aplicar</Button>
                </div>
                {eventos.length > 0 ? (
                  <div className="events-list-new">
                    {[...eventos].reverse().map(e => <EventEffects key={e.idEvento} event={e} />)}
                  </div>
                ) : (
                  <p>Sin eventos todavía.</p>
                )}
              </div>
            )}
            {selectedTab === 'economia' && (
              <EconomyPanel
                simulacionId={simulacion.idSimulacion!}
                presupuestoActual={simulacion.presupuestoActual}
                refreshKey={simulacion.diaActual + eventos.length}
              />
            )}
        </div>
      </aside>

      {/* Dock inferior-izquierda: personalización + finalizar.
          El botón "Derribar OVNI" aparece encima sólo mientras el OVNI está
          sobrevolando la parcela (evento ola_radiacion_uv activo). */}
      <div className="sim-v2-settings-dock">
        {eventosActivosNow.some(({ evento }) => evento.tipoEvento === 'ola_radiacion_uv') && (
          <button
            type="button"
            className="sim-v2-derribar-ovni-btn"
            onClick={derribarOvni}
            disabled={derribandoOvni || simulacion.estado !== 'en_curso'}
            title="Saca un cañón anti-aéreo y derriba al OVNI a tiros"
          >
            🎯 {derribandoOvni ? 'Disparando...' : 'Derribar OVNI'}
          </button>
        )}

        <button
          type="button"
          className="sim-v2-toggle sim-v2-perso-btn"
          onClick={() => setPersonalizacionAbierta(true)}
          disabled={simulacion.estado !== 'en_curso'}
          title="Configurar modos de juego y eventos permitidos"
        >
          <span className="sim-v2-toggle-icon">⚙️</span>
          <span className="sim-v2-toggle-text">Personalización</span>
        </button>


        <button
          type="button"
          className="sim-v2-finish-btn"
          onClick={finalizarSimulacion}
          disabled={simulacion.estado !== 'en_curso'}
          title="Finalizar simulación y ver resultados"
        >
          🏁 <span>Finalizar</span>
        </button>
      </div>

      {/* Panel modal de personalización */}
      {personalizacionAbierta && (
        <div
          className="sim-v2-perso-overlay"
          onClick={() => setPersonalizacionAbierta(false)}
        >
          <div
            className="sim-v2-perso-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <header className="sim-v2-perso-header">
              <h3>⚙️ Personalización de la partida</h3>
              <button
                type="button"
                className="sim-v2-perso-close"
                onClick={() => setPersonalizacionAbierta(false)}
                aria-label="Cerrar personalización"
              >
                ✕
              </button>
            </header>

            <div className="sim-v2-perso-body">
              {/* === Modos de juego === */}
              <section className="sim-v2-perso-section">
                <h4>Modos de juego</h4>
                <div className="sim-v2-perso-modes">
                  <button
                    type="button"
                    className={`sim-v2-perso-toggle ${eventosAleatoriosOn ? 'on' : 'off'}`}
                    onClick={toggleEventosAleatorios}
                  >
                    <span className="sim-v2-perso-toggle-icon">
                      {eventosAleatoriosOn ? '🎲' : '⏸️'}
                    </span>
                    <span className="sim-v2-perso-toggle-body">
                      <strong>Eventos aleatorios</strong>
                      <small>
                        {eventosAleatoriosOn
                          ? 'El sistema generará problemas al avanzar días.'
                          : 'Solo ocurrirá lo que apliques manualmente.'}
                      </small>
                    </span>
                    <span className={`sim-v2-perso-pill ${eventosAleatoriosOn ? 'on' : 'off'}`}>
                      {eventosAleatoriosOn ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`sim-v2-perso-toggle ${modoInvencibleOn ? 'on invencible' : 'off'}`}
                    onClick={toggleModoInvencible}
                  >
                    <span className="sim-v2-perso-toggle-icon">🛡️</span>
                    <span className="sim-v2-perso-toggle-body">
                      <strong>Modo invencible</strong>
                      <small>
                        {modoInvencibleOn
                          ? 'La salud se mantiene al 100%.'
                          : 'La salud baja normalmente.'}
                      </small>
                    </span>
                    <span className={`sim-v2-perso-pill ${modoInvencibleOn ? 'invencible' : 'off'}`}>
                      {modoInvencibleOn ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`sim-v2-perso-toggle ${dineroInfinitoOn ? 'on dinero' : 'off'}`}
                    onClick={toggleDineroInfinito}
                  >
                    <span className="sim-v2-perso-toggle-icon">💰</span>
                    <span className="sim-v2-perso-toggle-body">
                      <strong>Dinero infinito</strong>
                      <small>
                        {dineroInfinitoOn
                          ? 'Los eventos no descuentan presupuesto.'
                          : 'Los eventos consumen tu presupuesto.'}
                      </small>
                    </span>
                    <span className={`sim-v2-perso-pill ${dineroInfinitoOn ? 'dinero' : 'off'}`}>
                      {dineroInfinitoOn ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    className="sim-v2-perso-toggle sim-v2-perso-action"
                    onClick={limpiarTodasAfecciones}
                  >
                    <span className="sim-v2-perso-toggle-icon">🧹</span>
                    <span className="sim-v2-perso-toggle-body">
                      <strong>Limpiar afecciones</strong>
                      <small>
                        Cancela todo lo que está pasando ahora (eventos activos,
                        plagas, OVNI, animaciones en curso).
                      </small>
                    </span>
                    <span className="sim-v2-perso-pill action">LIMPIAR</span>
                  </button>
                </div>
              </section>

              {/* === Eventos del sistema permitidos === */}
              <section className="sim-v2-perso-section">
                <div className="sim-v2-perso-section-head">
                  <h4>Eventos del sistema permitidos</h4>
                  <span className={`sim-v2-perso-mode-badge mode-${modoEventosLabel.replace(/\s+/g, '-').toLowerCase()}`}>
                    {modoEventosLabel}
                  </span>
                </div>
                <p className="sim-v2-perso-hint">
                  Solo los eventos marcados podrán aparecer aleatoriamente. El{' '}
                  <strong>Modo realista</strong> deja activos únicamente los desastres y
                  problemas comunes en agricultura real; un tornado, por ejemplo, es
                  realista pero poco común y queda fuera.
                </p>

                <div className="sim-v2-perso-presets">
                  <button
                    type="button"
                    className={`sim-v2-perso-preset ${modoEventosLabel === 'Todos' ? 'active' : ''}`}
                    onClick={() => aplicarPresetEventos('todos')}
                  >
                    🌐 Todos los eventos
                  </button>
                  <button
                    type="button"
                    className={`sim-v2-perso-preset ${modoEventosLabel === 'Modo realista' ? 'active' : ''}`}
                    onClick={() => aplicarPresetEventos('realista')}
                  >
                    🌾 Modo realista
                  </button>
                </div>

                {eventosPermitidosSet.size === 0 && (
                  <div className="sim-v2-perso-warning">
                    ⚠️ No hay ningún evento marcado. Para desactivar por completo los
                    eventos aleatorios usa el toggle <em>Eventos aleatorios</em>.
                  </div>
                )}

                <div className="sim-v2-perso-cats">
                  {EVENT_CATEGORIES
                    .filter(cat => cat.titulo !== 'Manejo del Cultivo')
                    .map(cat => (
                      <div key={cat.titulo} className="sim-v2-perso-cat">
                        <h5>
                          <span>{cat.emoji}</span> {cat.titulo}
                        </h5>
                        <div className="sim-v2-perso-events">
                          {cat.eventos
                            .filter(ev => EVENTOS_SISTEMA.includes(ev.tipo))
                            .map(ev => {
                              const checked = eventosPermitidosSet.has(ev.tipo);
                              const realista = EVENTOS_REALISTAS.includes(ev.tipo);
                              return (
                                <label
                                  key={ev.tipo}
                                  className={`sim-v2-perso-event ${checked ? 'checked' : ''}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleEventoPermitido(ev.tipo)}
                                  />
                                  <span className="sim-v2-perso-event-icon">{ev.icono}</span>
                                  <span className="sim-v2-perso-event-name">{ev.nombre}</span>
                                  {realista && (
                                    <span className="sim-v2-perso-event-tag" title="Común en agricultura real">
                                      realista
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                </div>
              </section>

              {/* === Efectos de destrucción total === */}
              <section className="sim-v2-perso-section sim-v2-perso-destruct">
                <div className="sim-v2-perso-section-head">
                  <h4>💀 Efectos de destrucción</h4>
                </div>
                <p className="sim-v2-perso-hint">
                  Catástrofes irreales que <strong>aniquilan la planta al instante</strong>
                  {' '}y marcan la simulación como fallida. No aparecen en el modo realista.
                </p>
                <div className="sim-v2-destruct-grid">
                  <button
                    type="button"
                    className="sim-v2-destruct-card meteor"
                    disabled={destruccionAplicando || simulacion.estado !== 'en_curso'}
                    onClick={() => aplicarDestruccion('meteorito')}
                  >
                    <span className="sim-v2-destruct-icon">☄️</span>
                    <span className="sim-v2-destruct-name">Meteoritos</span>
                    <small>Lluvia de 10 rocas ardientes con sacudida sísmica.</small>
                  </button>
                  <button
                    type="button"
                    className="sim-v2-destruct-card nuke"
                    disabled={destruccionAplicando || simulacion.estado !== 'en_curso'}
                    onClick={() => aplicarDestruccion('bomba_nuclear')}
                  >
                    <span className="sim-v2-destruct-icon">☢️</span>
                    <span className="sim-v2-destruct-name">Bomba nuclear</span>
                    <small>Detonación cegadora, hongo atómico y tierra calcinada.</small>
                  </button>
                  <button
                    type="button"
                    className="sim-v2-destruct-card zombies"
                    disabled={destruccionAplicando || simulacion.estado !== 'en_curso'}
                    onClick={() => aplicarDestruccion('zombies')}
                  >
                    <span className="sim-v2-destruct-icon">🧟</span>
                    <span className="sim-v2-destruct-name">Zombies</span>
                    <small>Hordas de no-muertos brotan del suelo y devoran todo.</small>
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Action dock flotante */}
      <div className="sim-v2-dock">
        <div className="sim-v2-dock-row sim-v2-dock-quick">
          <button
            className="sim-v2-quick"
            onClick={() => { setNuevoEvento({ tipoEvento: 'riego', cantidad: 1, descripcion: '' }); setShowEventModal(true); }}
            disabled={simulacion.estado !== 'en_curso'}
            title="Riego rápido"
          >
            <span className="sim-v2-quick-icon">💧</span>
            <span className="sim-v2-quick-label">Regar</span>
          </button>
          <button
            className="sim-v2-quick"
            onClick={() => { setNuevoEvento({ tipoEvento: 'fertilizacion', cantidad: 1, descripcion: '' }); setShowEventModal(true); }}
            disabled={simulacion.estado !== 'en_curso'}
            title="Fertilizar"
          >
            <span className="sim-v2-quick-icon">🌿</span>
            <span className="sim-v2-quick-label">Fertilizar</span>
          </button>
          <button
            className="sim-v2-quick"
            onClick={() => { setNuevoEvento({ tipoEvento: 'tratamiento_fitosanitario', cantidad: 1, descripcion: '' }); setShowEventModal(true); }}
            disabled={simulacion.estado !== 'en_curso'}
            title="Tratamiento fitosanitario"
          >
            <span className="sim-v2-quick-icon">💉</span>
            <span className="sim-v2-quick-label">Tratar</span>
          </button>
          <button
            className="sim-v2-quick sim-v2-quick-more"
            onClick={() => setShowEventModal(true)}
            disabled={simulacion.estado !== 'en_curso'}
            title="Aplicar otro evento"
          >
            <span className="sim-v2-quick-icon">🎯</span>
            <span className="sim-v2-quick-label">Más acciones</span>
          </button>
        </div>

        <div className="sim-v2-dock-row sim-v2-dock-time">
          <button
            className="sim-v2-time sim-v2-time-primary"
            onClick={avanzarDia}
            disabled={isAdvancing || simulacion.estado !== 'en_curso'}
            title="Avanzar 1 día"
          >
            {isAdvancing ? '...' : '▶'} <span>1 día</span>
          </button>
          <button
            className="sim-v2-time"
            onClick={() => avanzarVariosDias(7)}
            disabled={isAdvancing || simulacion.estado !== 'en_curso'}
            title="Avanzar 7 días"
          >
            ⏩ <span>7 días</span>
          </button>
          <button
            className="sim-v2-time"
            onClick={() => avanzarVariosDias(30)}
            disabled={isAdvancing || simulacion.estado !== 'en_curso'}
            title="Avanzar 30 días"
          >
            ⏭ <span>30 días</span>
          </button>
        </div>
      </div>


      {/* Modal de Eventos */}
      {showEventModal && (
        <div className={`modal-overlay ${modalClosing ? 'closing' : ''}`}>
          <div className={`modal-content ${modalClosing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Aplicar Evento</h2>
              <button className="close-btn" onClick={closeEventModal}>×</button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Tipo de Evento</label>
                <div className="event-picker">
                  {EVENT_CATEGORIES.map((cat) => (
                    <div key={cat.titulo} className={`event-category event-category-${cat.tono}`}>
                      <div className="event-category-title">
                        <span className="event-category-emoji">{cat.emoji}</span>
                        {cat.titulo}
                      </div>
                      <div className="event-grid">
                        {cat.eventos.map((ev) => {
                          const seleccionado = nuevoEvento.tipoEvento === ev.tipo;
                          return (
                            <button
                              key={ev.tipo}
                              type="button"
                              className={`event-card event-card-${cat.tono} ${seleccionado ? 'selected' : ''}`}
                              onClick={() => setNuevoEvento({ ...nuevoEvento, tipoEvento: ev.tipo })}
                              title={ev.nombre}
                            >
                              <span className="event-card-icon">{ev.icono}</span>
                              <span className="event-card-name">{ev.nombre}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {['riego', 'fertilizacion', 'tratamiento_fitosanitario', 'poda'].includes(nuevoEvento.tipoEvento || '') && (
                <div className="form-group">
                  <label>Cantidad (informativo)</label>
                  <input
                    type="number"
                    value={nuevoEvento.cantidad || 0}
                    onChange={(e) => setNuevoEvento({ ...nuevoEvento, cantidad: parseFloat(e.target.value) })}
                    className="input"
                    min="0"
                    step="0.1"
                  />
                  <small className="help-text">
                    {nuevoEvento.tipoEvento === 'riego' && 'Litros de agua aplicados (no altera el coste, sólo se guarda para estadísticas).'}
                    {nuevoEvento.tipoEvento === 'fertilizacion' && 'Kilogramos de fertilizante (informativo).'}
                    {nuevoEvento.tipoEvento === 'tratamiento_fitosanitario' && 'Litros de producto (informativo).'}
                    {nuevoEvento.tipoEvento === 'poda' && 'Número de plantas podadas (informativo).'}
                  </small>
                </div>
              )}

              {[
                'plaga', 'enfermedad', 'sequia', 'helada', 'ola_calor', 'lluvia_torrencial', 'granizo', 'viento_fuerte',
                'terremoto', 'tornado', 'inundacion', 'nevada', 'rayo_caido', 'incendio_proximo',
                'niebla_persistente', 'polvo_sahariano', 'lluvia_acida',
                'erosion_suelo', 'salinizacion', 'acidificacion_suelo',
                'roya', 'mildiu', 'oidio', 'virus_mosaico',
                'pulgones', 'arana_roja', 'caracoles', 'nematodos',
                'aves_plaga', 'jabalies', 'langostas',
                'apagon_riego', 'contaminacion_quimica', 'marabunta_hormigas', 'ola_radiacion_uv'
              ].includes(nuevoEvento.tipoEvento || '') && (
                <div className="form-group">
                  <label>Intensidad</label>
                  <select
                    value={nuevoEvento.intensidad || 'moderado'}
                    onChange={(e) => setNuevoEvento({ ...nuevoEvento, intensidad: e.target.value as Intensidad })}
                    className="select-input"
                  >
                    <option value="leve">Leve</option>
                    <option value="moderado">Moderado</option>
                    <option value="severo">Severo</option>
                    <option value="critico">Crítico</option>
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>Descripción (Opcional)</label>
                <textarea
                  value={nuevoEvento.descripcion || ''}
                  onChange={(e) => setNuevoEvento({ ...nuevoEvento, descripcion: e.target.value })}
                  className="textarea"
                  rows={3}
                  placeholder="Agrega notas sobre este evento..."
                />
              </div>

              {nuevoEvento.tipoEvento && COSTE_POR_HECTAREA[nuevoEvento.tipoEvento] !== undefined && (
                <div className="cost-info">
                  <strong>Coste estimado:</strong> €{calcularCosteEvento(nuevoEvento.tipoEvento).toFixed(2)}
                  <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.75 }}>
                    €{COSTE_POR_HECTAREA[nuevoEvento.tipoEvento]!.toFixed(2)}/ha × {Number(simulacion?.superficieHectareas ?? 0).toFixed(2)} ha
                    {simulacion && Number(simulacion.presupuestoActual ?? 0) < calcularCosteEvento(nuevoEvento.tipoEvento) && (
                      <span style={{ color: '#e53935', fontWeight: 600, marginLeft: '0.5rem' }}>
                        ⚠️ Presupuesto insuficiente
                      </span>
                    )}
                  </small>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <Button variant="secondary" onClick={closeEventModal}>
                Cancelar
              </Button>
              <Button onClick={aplicarEvento}>
                Aplicar Evento
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Guía interactiva */}
      <InteractiveGuide onTabChange={(tab) => setSelectedTab(tab as any)} />

      {/* Efectos visuales para eventos climáticos */}
      <EventVFX effect={currentVFX} durationMs={currentVFXDuration} onFinish={handleVfxFinish} />
    </div>
  );
};

export default SimulationView;

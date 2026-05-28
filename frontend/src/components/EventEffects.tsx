import React from 'react';
import { Evento } from '../types';
import './EventEffects.css';

interface EventEffectsProps {
  event: Evento;
}

// Nombres bonitos por tipo (para no mostrar nunca el identificador con "_" en la UI).
// Si un tipo nuevo no aparece aquí, getEventName() lo formatea capitalizando y
// reemplazando "_" por espacios.
const NOMBRES_EVENTO: { [key: string]: string } = {
  sequia: 'Sequía',
  helada: 'Helada',
  ola_calor: 'Ola de calor',
  lluvia_torrencial: 'Lluvia torrencial',
  granizo: 'Granizo',
  viento_fuerte: 'Viento fuerte',
  plaga: 'Plaga',
  enfermedad: 'Enfermedad',
  malas_hierbas: 'Malas hierbas',
  riego: 'Riego',
  fertilizacion: 'Fertilización',
  tratamiento_fitosanitario: 'Tratamiento fitosanitario',
  poda: 'Poda',
  cosecha: 'Cosecha',
  terremoto: 'Terremoto',
  tornado: 'Tornado',
  inundacion: 'Tsunami',
  nevada: 'Nevada',
  rayo_caido: 'Rayo',
  incendio_proximo: 'Incendio',
  niebla_persistente: 'Niebla densa',
  polvo_sahariano: 'Calima sahariana',
  lluvia_acida: 'Lluvia ácida',
  erosion_suelo: 'Erosión del suelo',
  salinizacion: 'Salinización',
  acidificacion_suelo: 'Acidificación del suelo',
  roya: 'Roya',
  mildiu: 'Mildiu',
  oidio: 'Oídio',
  virus_mosaico: 'Virus del mosaico',
  pulgones: 'Pulgones',
  arana_roja: 'Araña roja',
  caracoles: 'Caracoles',
  nematodos: 'Nematodos',
  aves_plaga: 'Bandadas de aves',
  jabalies: 'Jabalíes',
  langostas: 'Langostas',
  apagon_riego: 'Apagón de riego',
  contaminacion_quimica: 'Contaminación química',
  marabunta_hormigas: 'Marabunta de hormigas',
  ola_radiacion_uv: 'Radiación UV alta',
  mulching: 'Mulching',
  control_biologico: 'Control biológico',
  enmienda_calcica: 'Enmienda cálcica',
  instalacion_malla: 'Instalación de malla',
  compostaje: 'Compostaje',
  aireacion_suelo: 'Aireación del suelo',
  meteorito: 'Meteorito',
  bomba_nuclear: 'Bomba nuclear',
  zombies: 'Zombis'
};

export const getEventName = (tipoEvento: string): string => {
  if (NOMBRES_EVENTO[tipoEvento]) return NOMBRES_EVENTO[tipoEvento];
  // Fallback: reemplaza "_" por espacios y capitaliza la primera letra
  const limpio = tipoEvento.replace(/_/g, ' ');
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
};

const getEventIcon = (tipoEvento: string): string => {
  const icons: { [key: string]: string } = {
    sequia: '☀️',
    helada: '❄️',
    ola_calor: '🔥',
    lluvia_torrencial: '🌧️',
    granizo: '🌨️',
    viento_fuerte: '💨',
    plaga: '🐛',
    enfermedad: '🦠',
    malas_hierbas: '🌿',
    riego: '💧',
    fertilizacion: '🌱',
    tratamiento_fitosanitario: '💊',
    poda: '✂️',
    cosecha: '🌾',
    // Nuevos eventos
    terremoto: '🌋',
    tornado: '🌪️',
    inundacion: '🌊',
    nevada: '🌨️',
    rayo_caido: '⚡',
    incendio_proximo: '🔥',
    niebla_persistente: '🌫️',
    polvo_sahariano: '🏜️',
    lluvia_acida: '☢️',
    erosion_suelo: '⛰️',
    salinizacion: '🧂',
    acidificacion_suelo: '🧪',
    roya: '🍂',
    mildiu: '🍄',
    oidio: '⚪',
    virus_mosaico: '🧬',
    pulgones: '🐜',
    arana_roja: '🕷️',
    caracoles: '🐌',
    nematodos: '🪱',
    aves_plaga: '🐦',
    jabalies: '🐗',
    langostas: '🦗',
    apagon_riego: '🔌',
    contaminacion_quimica: '☣️',
    marabunta_hormigas: '🐜',
    ola_radiacion_uv: '🛸',
    mulching: '🍂',
    control_biologico: '🐞',
    enmienda_calcica: '🥛',
    instalacion_malla: '🕸️',
    compostaje: '♻️',
    aireacion_suelo: '🌬️'
  };
  return icons[tipoEvento] || '📌';
};

// Multiplicador de intensidad. DEBE coincidir con SimulacionService.factorIntensidad()
// en el backend o el usuario verá daños que no encajan con la salud que pierde.
const FACTOR_INTENSIDAD: Record<string, number> = {
  leve: 0.5,
  moderado: 1.0,
  severo: 1.6,
  critico: 2.4
};

const factor = (intensidad?: string): number =>
  intensidad ? (FACTOR_INTENSIDAD[intensidad] ?? 1.0) : 1.0;

// Daño base (salud / humedad / altura) de cada evento negativo, igual que en
// SimulacionService.aplicarEfectosEvento. Permite mostrar el daño real esperado.
const DANIO_BASE: Record<string, { salud?: number; humedad?: number; alturaPct?: number }> = {
  plaga: { salud: 18 },
  enfermedad: { salud: 22 },
  malas_hierbas: { salud: 8 },
  sequia: { salud: 15, humedad: 45 },
  helada: { salud: 25 },
  ola_calor: { salud: 12, humedad: 30 },
  lluvia_torrencial: { salud: 5 },
  granizo: { salud: 22 },
  viento_fuerte: { salud: 10 },
  terremoto: { salud: 18, humedad: 15 },
  tornado: { salud: 30, alturaPct: 30 },
  inundacion: { salud: 20 },
  nevada: { salud: 18 },
  rayo_caido: { salud: 15 },
  incendio_proximo: { salud: 25, humedad: 25 },
  niebla_persistente: { salud: 5 },
  polvo_sahariano: { salud: 7 },
  lluvia_acida: { salud: 10 },
  erosion_suelo: { salud: 10 },
  salinizacion: { salud: 12, humedad: 10 },
  acidificacion_suelo: { salud: 10 },
  roya: { salud: 14 },
  mildiu: { salud: 14 },
  oidio: { salud: 14 },
  virus_mosaico: { salud: 16 },
  pulgones: { salud: 12 },
  arana_roja: { salud: 12 },
  caracoles: { salud: 8 },
  nematodos: { salud: 15 },
  aves_plaga: { salud: 8 },
  jabalies: { salud: 22, alturaPct: 15 },
  langostas: { salud: 25 },
  apagon_riego: { humedad: 25 },
  contaminacion_quimica: { salud: 22 },
  marabunta_hormigas: { salud: 9 },
  ola_radiacion_uv: { salud: 8 }
};

const calcularDanio = (tipo: string, intensidad?: string) => {
  const base = DANIO_BASE[tipo];
  if (!base) return null;
  const f = factor(intensidad);
  return {
    salud: base.salud !== undefined ? Math.round(base.salud * f) : undefined,
    humedad: base.humedad !== undefined ? Math.round(base.humedad * f) : undefined,
    // Altura escala como en el backend: porcentaje * f, con tope al 80% (tornado) o 50% (jabalí)
    alturaPct: base.alturaPct !== undefined
      ? Math.round(Math.min(tipo === 'tornado' ? 80 : 50, base.alturaPct * f))
      : undefined
  };
};

const getEventEffects = (tipoEvento: string, intensidad?: string): { effect: string; type: 'positive' | 'negative' | 'neutral' }[] => {
  // Para los eventos del DANIO_BASE generamos los textos a partir de la intensidad real,
  // así que coinciden exactamente con el daño que aplica el backend en este evento concreto.
  const danio = calcularDanio(tipoEvento, intensidad);
  if (danio && (danio.salud !== undefined || danio.humedad !== undefined || danio.alturaPct !== undefined)) {
    const items: { effect: string; type: 'positive' | 'negative' | 'neutral' }[] = [];
    if (danio.salud !== undefined && danio.salud > 0) {
      items.push({ effect: `-${danio.salud}% Salud${intensidad ? ` (intensidad ${intensidad})` : ''}`, type: 'negative' });
    }
    if (danio.humedad !== undefined && danio.humedad > 0) {
      items.push({ effect: `-${danio.humedad}% Humedad del suelo`, type: 'negative' });
    }
    if (danio.alturaPct !== undefined && danio.alturaPct > 0) {
      items.push({ effect: `-${danio.alturaPct}% Altura por daño físico`, type: 'negative' });
    }
    // Conservamos también el texto descriptivo / solución del catálogo siguiente
    const extra = (CATALOGO_EFECTOS[tipoEvento] || []).filter(e => e.type !== 'negative' || /Sin cura|sin cura|Requiere|Daño/i.test(e.effect));
    return [...items, ...extra];
  }
  const effects = CATALOGO_EFECTOS;
  return effects[tipoEvento] || [{ effect: 'Efectos desconocidos', type: 'neutral' }];
};

// Catálogo descriptivo: descripciones/soluciones por tipo. Para los eventos con daño
// numérico (en DANIO_BASE) el daño en % se calcula dinámicamente arriba; aquí solo
// dejamos los textos de contexto y la pista de solución.
const CATALOGO_EFECTOS: { [key: string]: { effect: string; type: 'positive' | 'negative' | 'neutral' }[] } = {
    // Eventos positivos (acciones del usuario)
    riego: [
      { effect: '+35% Humedad del suelo', type: 'positive' },
      { effect: '+2% Salud', type: 'positive' },
      { effect: `Coste: €15/ha`, type: 'neutral' }
    ],
    fertilizacion: [
      { effect: '+12% Salud', type: 'positive' },
      { effect: 'Nutrientes restaurados', type: 'positive' },
      { effect: `Coste: €80/ha`, type: 'neutral' }
    ],
    tratamiento_fitosanitario: [
      { effect: '+20% Salud', type: 'positive' },
      { effect: 'Elimina plagas y enfermedades', type: 'positive' },
      { effect: `Coste: €120/ha`, type: 'neutral' }
    ],
    poda: [
      { effect: '+8% Salud', type: 'positive' },
      { effect: 'Mejora la estructura', type: 'positive' },
      { effect: `Coste: €60/ha`, type: 'neutral' }
    ],

    // Eventos negativos — los % de daño los pinta calcularDanio() arriba
    // según la intensidad real; aquí solo dejamos descripciones/solución.
    sequia: [
      { effect: 'Estrés hídrico severo', type: 'negative' }
    ],
    helada: [
      { effect: 'Daño por congelación', type: 'negative' },
      { effect: 'Puede matar la planta', type: 'negative' }
    ],
    ola_calor: [
      { effect: 'Estrés térmico', type: 'negative' }
    ],
    lluvia_torrencial: [
      { effect: '+100% Humedad (saturación)', type: 'neutral' },
      { effect: 'Posible encharcamiento', type: 'negative' }
    ],
    granizo: [
      { effect: 'Daño físico severo', type: 'negative' },
      { effect: 'Afecta la producción', type: 'negative' }
    ],
    viento_fuerte: [
      { effect: 'Daño mecánico', type: 'negative' }
    ],
    plaga: [
      { effect: 'Requiere tratamiento urgente', type: 'negative' },
      { effect: 'Daño continuo si no se trata', type: 'negative' }
    ],
    enfermedad: [
      { effect: 'CRÍTICO: Requiere tratamiento inmediato', type: 'negative' },
      { effect: 'Puede propagarse', type: 'negative' }
    ],
    malas_hierbas: [
      { effect: 'Compiten por nutrientes', type: 'negative' }
    ],

    // === Nuevas catástrofes ===
    terremoto: [
      { effect: 'Grietas en el suelo', type: 'negative' },
      { effect: 'Solución: airear el suelo y regar', type: 'neutral' }
    ],
    tornado: [
      { effect: 'Solución: poda y fertilización', type: 'neutral' }
    ],
    inundacion: [
      { effect: '+100% Humedad (saturación)', type: 'negative' },
      { effect: 'Asfixia radicular', type: 'negative' },
      { effect: 'Solución: aireación del suelo', type: 'neutral' }
    ],
    nevada: [
      { effect: 'Peso de la nieve sobre las plantas', type: 'negative' },
      { effect: 'Solución: poda y tratamientos', type: 'neutral' }
    ],
    rayo_caido: [
      { effect: 'Daño puntual por descarga', type: 'negative' },
      { effect: 'Solución: poda de zonas afectadas', type: 'neutral' }
    ],
    incendio_proximo: [
      { effect: 'Solución: riego abundante y compostaje', type: 'neutral' }
    ],
    niebla_persistente: [
      { effect: 'Menos fotosíntesis', type: 'negative' },
      { effect: 'Favorece hongos', type: 'negative' }
    ],
    polvo_sahariano: [
      { effect: 'Polvo cubre las hojas', type: 'negative' },
      { effect: 'Solución: riego por aspersión', type: 'neutral' }
    ],
    lluvia_acida: [
      { effect: 'Acidifica el suelo', type: 'negative' },
      { effect: 'Solución: enmienda cálcica', type: 'neutral' }
    ],

    // === Problemas del suelo ===
    erosion_suelo: [
      { effect: 'Se pierde capa fértil', type: 'negative' },
      { effect: 'Solución: compostaje o mulching', type: 'neutral' }
    ],
    salinizacion: [
      { effect: 'Solución: riegos de lavado + enmienda', type: 'neutral' }
    ],
    acidificacion_suelo: [
      { effect: 'pH demasiado bajo', type: 'negative' },
      { effect: 'Solución: enmienda cálcica', type: 'neutral' }
    ],

    // === Plagas y enfermedades específicas ===
    roya: [
      { effect: 'Hongo que se propaga rápido', type: 'negative' },
      { effect: 'Solución: tratamiento fitosanitario', type: 'neutral' }
    ],
    mildiu: [
      { effect: 'Hongo favorecido por humedad', type: 'negative' },
      { effect: 'Solución: tratamiento fitosanitario', type: 'neutral' }
    ],
    oidio: [
      { effect: 'Polvo blanco sobre las hojas', type: 'negative' },
      { effect: 'Solución: tratamiento fitosanitario', type: 'neutral' }
    ],
    virus_mosaico: [
      { effect: 'Sin cura: solo se mitiga', type: 'negative' },
      { effect: 'Solución: tratamiento + control biológico', type: 'neutral' }
    ],
    pulgones: [
      { effect: 'Chupan savia de los brotes', type: 'negative' },
      { effect: 'Solución: control biológico (mariquitas)', type: 'neutral' }
    ],
    arana_roja: [
      { effect: 'Aparece en ambientes secos', type: 'negative' },
      { effect: 'Solución: tratamiento + riego', type: 'neutral' }
    ],
    caracoles: [
      { effect: 'Devoran hojas tiernas', type: 'negative' },
      { effect: 'Solución: control biológico', type: 'neutral' }
    ],
    nematodos: [
      { effect: 'Atacan las raíces', type: 'negative' },
      { effect: 'Solución: tratamiento fitosanitario', type: 'neutral' }
    ],
    aves_plaga: [
      { effect: 'Picotean frutos y semillas', type: 'negative' },
      { effect: 'Solución: instalar mallas', type: 'neutral' }
    ],
    jabalies: [
      { effect: 'Solución: instalar vallado/mallas', type: 'neutral' }
    ],
    langostas: [
      { effect: 'Devastación masiva', type: 'negative' },
      { effect: 'Solución: tratamiento urgente', type: 'neutral' }
    ],

    // === Eventos técnicos / subrealistas ===
    apagon_riego: [
      { effect: 'El riego automático falla', type: 'negative' },
      { effect: 'Solución: riego manual', type: 'neutral' }
    ],
    contaminacion_quimica: [
      { effect: 'Vertido tóxico cercano', type: 'negative' },
      { effect: 'Solución: compostaje + fertilización', type: 'neutral' }
    ],
    marabunta_hormigas: [
      { effect: 'Excavan raíces y traen pulgones', type: 'negative' },
      { effect: 'Solución: tratamiento o control biológico', type: 'neutral' }
    ],
    ola_radiacion_uv: [
      { effect: 'Quema de hojas por UV anómalo', type: 'negative' },
      { effect: 'Solución: mallas de sombreo + riego', type: 'neutral' }
    ],

    // === Nuevas acciones de manejo (positivas) ===
    mulching: [
      { effect: '+20% Humedad retenida', type: 'positive' },
      { effect: '+5% Salud', type: 'positive' },
      { effect: 'Reduce malas hierbas y erosión', type: 'positive' },
      { effect: 'Coste: €70/ha', type: 'neutral' }
    ],
    control_biologico: [
      { effect: '+15% Salud', type: 'positive' },
      { effect: 'Elimina plagas sin químicos', type: 'positive' },
      { effect: 'Coste: €90/ha', type: 'neutral' }
    ],
    enmienda_calcica: [
      { effect: '+10% Salud', type: 'positive' },
      { effect: 'Corrige pH ácido', type: 'positive' },
      { effect: 'Coste: €55/ha', type: 'neutral' }
    ],
    instalacion_malla: [
      { effect: '+5% Salud', type: 'positive' },
      { effect: 'Protege de aves, granizo y jabalíes', type: 'positive' },
      { effect: 'Coste: €180/ha', type: 'neutral' }
    ],
    compostaje: [
      { effect: '+10% Salud', type: 'positive' },
      { effect: '+10% Humedad retenida', type: 'positive' },
      { effect: 'Mejora la estructura del suelo', type: 'positive' },
      { effect: 'Coste: €50/ha', type: 'neutral' }
    ],
    aireacion_suelo: [
      { effect: '+8% Salud', type: 'positive' },
      { effect: 'Mejora oxigenación de raíces', type: 'positive' },
      { effect: 'Útil tras inundación o compactación', type: 'positive' },
      { effect: 'Coste: €45/ha', type: 'neutral' }
    ]
};

const getIntensityColor = (intensidad?: string): string => {
  const colors: { [key: string]: string } = {
    leve: '#4CAF50',
    moderado: '#FF9800',
    severo: '#f44336',
    critico: '#9C27B0'
  };
  return intensidad ? colors[intensidad] : '#999';
};

export const EventEffects: React.FC<EventEffectsProps> = ({ event }) => {
  const effects = getEventEffects(event.tipoEvento, event.intensidad);
  const icon = getEventIcon(event.tipoEvento);
  const negativeEvents = [
    'sequia', 'helada', 'ola_calor', 'granizo', 'viento_fuerte', 'plaga', 'enfermedad', 'malas_hierbas',
    'terremoto', 'tornado', 'inundacion', 'nevada', 'rayo_caido', 'incendio_proximo',
    'niebla_persistente', 'polvo_sahariano', 'lluvia_acida',
    'erosion_suelo', 'salinizacion', 'acidificacion_suelo',
    'roya', 'mildiu', 'oidio', 'virus_mosaico',
    'pulgones', 'arana_roja', 'caracoles', 'nematodos',
    'aves_plaga', 'jabalies', 'langostas',
    'apagon_riego', 'contaminacion_quimica', 'marabunta_hormigas', 'ola_radiacion_uv'
  ];
  const isNegative = negativeEvents.includes(event.tipoEvento);

  return (
    <div className={`event-effects-card ${isNegative ? 'negative-event' : 'positive-event'}`}>
      <div className="event-effects-header">
        <span className="event-icon">{icon}</span>
        <div className="event-info">
          <h4>{event.descripcion || getEventName(event.tipoEvento)}</h4>
          <div className="event-meta">
            <span className="event-day">Día {event.diaEvento}</span>
            {event.intensidad && (
              <span
                className="event-intensity"
                style={{ backgroundColor: getIntensityColor(event.intensidad) }}
              >
                {event.intensidad}
              </span>
            )}
            {event.costeEuros !== undefined && event.costeEuros > 0 && (
              <span className="event-cost">€{event.costeEuros.toFixed(2)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="event-effects-list">
        {effects.map((item, index) => {
          const isSolution = item.type === 'neutral' && /^Soluci[oó]n:/i.test(item.effect);
          return (
            <div key={index} className={`effect-item ${item.type}${isSolution ? ' effect-solution' : ''}`}>
              <span className="effect-indicator">
                {isSolution ? '💡' : item.type === 'positive' ? '✓' : item.type === 'negative' ? '✗' : '•'}
              </span>
              <span className="effect-text">{item.effect}</span>
            </div>
          );
        })}
      </div>

      {isNegative && (
        <div className="event-warning">
          ⚠️ Este evento causará daños. Toma medidas correctivas inmediatamente.
        </div>
      )}
    </div>
  );
};

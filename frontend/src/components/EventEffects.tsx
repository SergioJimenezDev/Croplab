import React from 'react';
import { Evento } from '../types';
import './EventEffects.css';

interface EventEffectsProps {
  event: Evento;
}

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

const getEventEffects = (tipoEvento: string, intensidad?: string): { effect: string; type: 'positive' | 'negative' | 'neutral' }[] => {
  const effects: { [key: string]: { effect: string; type: 'positive' | 'negative' | 'neutral' }[] } = {
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

    // Eventos negativos
    sequia: [
      { effect: '-45% Humedad del suelo', type: 'negative' },
      { effect: '-15% Salud', type: 'negative' },
      { effect: 'Estrés hídrico severo', type: 'negative' }
    ],
    helada: [
      { effect: '-25% Salud', type: 'negative' },
      { effect: 'Daño por congelación', type: 'negative' },
      { effect: 'Puede matar la planta', type: 'negative' }
    ],
    ola_calor: [
      { effect: '-30% Humedad', type: 'negative' },
      { effect: '-12% Salud', type: 'negative' },
      { effect: 'Estrés térmico', type: 'negative' }
    ],
    lluvia_torrencial: [
      { effect: '+100% Humedad (saturación)', type: 'neutral' },
      { effect: '-5% Salud (exceso de agua)', type: 'negative' },
      { effect: 'Posible encharcamiento', type: 'negative' }
    ],
    granizo: [
      { effect: '-35% Salud', type: 'negative' },
      { effect: 'Daño físico severo', type: 'negative' },
      { effect: 'Afecta la producción', type: 'negative' }
    ],
    viento_fuerte: [
      { effect: '-10% Salud', type: 'negative' },
      { effect: 'Daño mecánico', type: 'negative' }
    ],
    plaga: [
      { effect: intensidad === 'severo' || intensidad === 'critico' ? '-25 a -35% Salud' : '-8 a -15% Salud', type: 'negative' },
      { effect: 'Requiere tratamiento urgente', type: 'negative' },
      { effect: 'Daño continuo si no se trata', type: 'negative' }
    ],
    enfermedad: [
      { effect: intensidad === 'severo' || intensidad === 'critico' ? '-30 a -40% Salud' : '-10 a -18% Salud', type: 'negative' },
      { effect: 'CRÍTICO: Requiere tratamiento inmediato', type: 'negative' },
      { effect: 'Puede propagarse', type: 'negative' }
    ],
    malas_hierbas: [
      { effect: '-8% Salud', type: 'negative' },
      { effect: 'Compiten por nutrientes', type: 'negative' }
    ],

    // === Nuevas catástrofes ===
    terremoto: [
      { effect: '-18% Salud', type: 'negative' },
      { effect: '-15% Humedad (grietas en el suelo)', type: 'negative' },
      { effect: 'Solución: airear el suelo y regar', type: 'neutral' }
    ],
    tornado: [
      { effect: '-30% Salud', type: 'negative' },
      { effect: 'Reduce la altura un 30%', type: 'negative' },
      { effect: 'Solución: poda y fertilización', type: 'neutral' }
    ],
    inundacion: [
      { effect: '+100% Humedad (saturación)', type: 'negative' },
      { effect: '-20% Salud por asfixia radicular', type: 'negative' },
      { effect: 'Solución: aireación del suelo', type: 'neutral' }
    ],
    nevada: [
      { effect: '-18% Salud', type: 'negative' },
      { effect: 'Peso de la nieve sobre las plantas', type: 'negative' },
      { effect: 'Solución: poda y tratamientos', type: 'neutral' }
    ],
    rayo_caido: [
      { effect: '-15% Salud', type: 'negative' },
      { effect: 'Daño puntual por descarga', type: 'negative' },
      { effect: 'Solución: poda de zonas afectadas', type: 'neutral' }
    ],
    incendio_proximo: [
      { effect: '-25% Salud', type: 'negative' },
      { effect: '-25% Humedad por calor extremo', type: 'negative' },
      { effect: 'Solución: riego abundante y compostaje', type: 'neutral' }
    ],
    niebla_persistente: [
      { effect: '-5% Salud (menos fotosíntesis)', type: 'negative' },
      { effect: 'Favorece hongos', type: 'negative' }
    ],
    polvo_sahariano: [
      { effect: '-7% Salud', type: 'negative' },
      { effect: 'Polvo cubre las hojas', type: 'negative' },
      { effect: 'Solución: riego por aspersión', type: 'neutral' }
    ],
    lluvia_acida: [
      { effect: '-10% Salud', type: 'negative' },
      { effect: 'Acidifica el suelo', type: 'negative' },
      { effect: 'Solución: enmienda cálcica', type: 'neutral' }
    ],

    // === Problemas del suelo ===
    erosion_suelo: [
      { effect: '-10% Salud', type: 'negative' },
      { effect: 'Se pierde capa fértil', type: 'negative' },
      { effect: 'Solución: compostaje o mulching', type: 'neutral' }
    ],
    salinizacion: [
      { effect: '-12% Salud', type: 'negative' },
      { effect: '-10% Humedad útil', type: 'negative' },
      { effect: 'Solución: riegos de lavado + enmienda', type: 'neutral' }
    ],
    acidificacion_suelo: [
      { effect: '-10% Salud', type: 'negative' },
      { effect: 'pH demasiado bajo', type: 'negative' },
      { effect: 'Solución: enmienda cálcica', type: 'neutral' }
    ],

    // === Plagas y enfermedades específicas ===
    roya: [
      { effect: '-7 a -28% Salud según intensidad', type: 'negative' },
      { effect: 'Hongo que se propaga rápido', type: 'negative' },
      { effect: 'Solución: tratamiento fitosanitario', type: 'neutral' }
    ],
    mildiu: [
      { effect: '-7 a -28% Salud según intensidad', type: 'negative' },
      { effect: 'Hongo favorecido por humedad', type: 'negative' },
      { effect: 'Solución: tratamiento fitosanitario', type: 'neutral' }
    ],
    oidio: [
      { effect: '-7 a -28% Salud según intensidad', type: 'negative' },
      { effect: 'Polvo blanco sobre las hojas', type: 'negative' },
      { effect: 'Solución: tratamiento fitosanitario', type: 'neutral' }
    ],
    virus_mosaico: [
      { effect: '-8 a -32% Salud según intensidad', type: 'negative' },
      { effect: 'Sin cura: solo se mitiga', type: 'negative' },
      { effect: 'Solución: tratamiento + control biológico', type: 'neutral' }
    ],
    pulgones: [
      { effect: '-6 a -22% Salud según intensidad', type: 'negative' },
      { effect: 'Chupan savia de los brotes', type: 'negative' },
      { effect: 'Solución: control biológico (mariquitas)', type: 'neutral' }
    ],
    arana_roja: [
      { effect: '-6 a -22% Salud según intensidad', type: 'negative' },
      { effect: 'Aparece en ambientes secos', type: 'negative' },
      { effect: 'Solución: tratamiento + riego', type: 'neutral' }
    ],
    caracoles: [
      { effect: '-8% Salud', type: 'negative' },
      { effect: 'Devoran hojas tiernas', type: 'negative' },
      { effect: 'Solución: control biológico', type: 'neutral' }
    ],
    nematodos: [
      { effect: '-15% Salud', type: 'negative' },
      { effect: 'Atacan las raíces', type: 'negative' },
      { effect: 'Solución: tratamiento fitosanitario', type: 'neutral' }
    ],
    aves_plaga: [
      { effect: '-8% Salud', type: 'negative' },
      { effect: 'Picotean frutos y semillas', type: 'negative' },
      { effect: 'Solución: instalar mallas', type: 'neutral' }
    ],
    jabalies: [
      { effect: '-22% Salud', type: 'negative' },
      { effect: 'Reducen la altura del cultivo', type: 'negative' },
      { effect: 'Solución: instalar vallado/mallas', type: 'neutral' }
    ],
    langostas: [
      { effect: '-15 a -45% Salud según intensidad', type: 'negative' },
      { effect: 'Devastación masiva', type: 'negative' },
      { effect: 'Solución: tratamiento urgente', type: 'neutral' }
    ],

    // === Eventos técnicos / subrealistas ===
    apagon_riego: [
      { effect: '-25% Humedad', type: 'negative' },
      { effect: 'El riego automático falla', type: 'negative' },
      { effect: 'Solución: riego manual', type: 'neutral' }
    ],
    contaminacion_quimica: [
      { effect: '-22% Salud', type: 'negative' },
      { effect: 'Vertido tóxico cercano', type: 'negative' },
      { effect: 'Solución: compostaje + fertilización', type: 'neutral' }
    ],
    marabunta_hormigas: [
      { effect: '-9% Salud', type: 'negative' },
      { effect: 'Excavan raíces y traen pulgones', type: 'negative' },
      { effect: 'Solución: tratamiento o control biológico', type: 'neutral' }
    ],
    ola_radiacion_uv: [
      { effect: '-8% Salud', type: 'negative' },
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

  return effects[tipoEvento] || [{ effect: 'Efectos desconocidos', type: 'neutral' }];
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
          <h4>{event.descripcion || event.tipoEvento}</h4>
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

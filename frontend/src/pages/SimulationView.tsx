import React, { useEffect, useRef, useState } from 'react';
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
import FarmScene from '../components/scene/FarmScene';
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
}

const EVENTOS_PERSISTENTES: Partial<Record<TipoEvento, EventoActivoInfo>> = {
  // Plagas y enfermedades — necesitan tratamiento o control biológico
  plaga: { emoji: '🐛', nombre: 'Plaga', acciones: ['tratamiento_fitosanitario', 'control_biologico'], accionTexto: 'Aplica tratamiento fitosanitario o control biológico' },
  enfermedad: { emoji: '🦠', nombre: 'Enfermedad', acciones: ['tratamiento_fitosanitario', 'control_biologico'], accionTexto: 'Aplica tratamiento fitosanitario' },
  roya: { emoji: '🍂', nombre: 'Roya (hongo)', acciones: ['tratamiento_fitosanitario'], accionTexto: 'Aplica tratamiento fitosanitario' },
  mildiu: { emoji: '🍄', nombre: 'Mildiu (hongo)', acciones: ['tratamiento_fitosanitario'], accionTexto: 'Aplica tratamiento fitosanitario' },
  oidio: { emoji: '⚪', nombre: 'Oídio (hongo)', acciones: ['tratamiento_fitosanitario'], accionTexto: 'Aplica tratamiento fitosanitario' },
  virus_mosaico: { emoji: '🧬', nombre: 'Virus del mosaico', acciones: ['tratamiento_fitosanitario', 'control_biologico'], accionTexto: 'Mitígalo con tratamiento + control biológico' },
  pulgones: { emoji: '🐜', nombre: 'Pulgones', acciones: ['tratamiento_fitosanitario', 'control_biologico'], accionTexto: 'Usa control biológico (mariquitas) o tratamiento' },
  arana_roja: { emoji: '🕷️', nombre: 'Araña roja', acciones: ['tratamiento_fitosanitario', 'control_biologico'], accionTexto: 'Aplica tratamiento + aumenta la humedad' },
  caracoles: { emoji: '🐌', nombre: 'Caracoles', acciones: ['tratamiento_fitosanitario', 'control_biologico'], accionTexto: 'Aplica tratamiento o control biológico' },
  nematodos: { emoji: '🪱', nombre: 'Nematodos', acciones: ['tratamiento_fitosanitario'], accionTexto: 'Aplica tratamiento fitosanitario' },
  langostas: { emoji: '🦗', nombre: 'Langostas', acciones: ['tratamiento_fitosanitario'], accionTexto: 'Aplica tratamiento urgente' },
  marabunta_hormigas: { emoji: '🐜', nombre: 'Marabunta de hormigas', acciones: ['tratamiento_fitosanitario', 'control_biologico'], accionTexto: 'Aplica tratamiento o control biológico' },

  // Fauna grande — necesita barrera
  aves_plaga: { emoji: '🐦', nombre: 'Bandadas de aves', acciones: ['instalacion_malla'], accionTexto: 'Instala mallas antipájaros' },
  jabalies: { emoji: '🐗', nombre: 'Jabalíes', acciones: ['instalacion_malla'], accionTexto: 'Instala vallado/mallas' },

  // Malas hierbas
  malas_hierbas: { emoji: '🌾', nombre: 'Malas hierbas', acciones: ['poda', 'mulching'], accionTexto: 'Pasa la azada (poda) o aplica mulching' },

  // Problemas de suelo persistentes
  salinizacion: { emoji: '🧂', nombre: 'Salinización del suelo', acciones: ['riego', 'enmienda_calcica'], accionTexto: 'Riegos abundantes de lavado + enmienda cálcica' },
  acidificacion_suelo: { emoji: '🧪', nombre: 'Acidificación del suelo', acciones: ['enmienda_calcica'], accionTexto: 'Aplica enmienda cálcica (encalado)' },
  erosion_suelo: { emoji: '⛰️', nombre: 'Erosión del suelo', acciones: ['compostaje', 'mulching'], accionTexto: 'Aplica compostaje o mulching' },

  // Otros
  contaminacion_quimica: { emoji: '☣️', nombre: 'Contaminación química', acciones: ['compostaje', 'fertilizacion'], accionTexto: 'Aplica compostaje y refuerza con fertilización' }
};

const VENTANA_DIAS_ACTIVO = 10;

interface EventoActivo {
  evento: Evento;
  info: EventoActivoInfo;
}

const calcularEventosActivos = (eventos: Evento[], diaActual: number): EventoActivo[] => {
  const activos: EventoActivo[] = [];
  // Recorrer en orden cronológico; nos quedamos con la última ocurrencia de cada tipo sin tratar
  const masRecientePorTipo = new Map<string, Evento>();
  eventos.forEach(ev => {
    if (ev.origen !== 'sistema') return;
    const info = EVENTOS_PERSISTENTES[ev.tipoEvento];
    if (!info) return;
    if (ev.diaEvento < diaActual - VENTANA_DIAS_ACTIVO) return;
    masRecientePorTipo.set(ev.tipoEvento, ev);
  });
  masRecientePorTipo.forEach((ev) => {
    const info = EVENTOS_PERSISTENTES[ev.tipoEvento]!;
    // ¿Hay alguna acción del usuario después del evento que lo resuelva?
    const resuelto = eventos.some(e =>
      e.origen === 'usuario' &&
      e.diaEvento >= ev.diaEvento &&
      e.diaEvento <= diaActual &&
      info.acciones.includes(e.tipoEvento)
    );
    if (!resuelto) activos.push({ evento: ev, info });
  });
  return activos;
};

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
      { tipo: 'inundacion', nombre: 'Inundación', icono: '🌊' },
      { tipo: 'nevada', nombre: 'Nevada', icono: '🌨️' },
      { tipo: 'rayo_caido', nombre: 'Rayo', icono: '⚡' },
      { tipo: 'incendio_proximo', nombre: 'Incendio próximo', icono: '🔥' },
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
  const [selectedTab, setSelectedTab] = useState<'detalles' | 'alertas' | 'graficos' | 'eventos' | 'economia'>('alertas');
  const [sidePanelOpen, setSidePanelOpen] = useState<boolean>(true);
  // VFX en dos capas:
  //  - flashVFX: efecto temporal (4 s) que aparece al disparar un evento concreto
  //    (acción del usuario, o catástrofe puntual del sistema). Tiene prioridad.
  //  - baseVFX: efecto continuo correspondiente al evento ACTIVO más reciente.
  //    Se reproduce en bucle mientras haya algún problema persistente sin resolver.
  const [flashVFX, setFlashVFX] = useState<VFXEffect | null>(null);
  const knownEventoIdsRef = useRef<Set<number>>(new Set());
  const eventosInitialisedRef = useRef(false);

  // Estado para nuevo evento
  const [nuevoEvento, setNuevoEvento] = useState<Partial<Evento>>({
    tipoEvento: 'riego',
    cantidad: 0,
    descripcion: ''
  });

  useEffect(() => {
    loadSimulationData();
  }, [id]);

  // Detecta eventos PUNTUALES nuevos del sistema (no persistentes) → flash 4s.
  // Los persistentes no se manejan aquí; se reflejan continuamente vía baseVFX.
  useEffect(() => {
    if (!eventosInitialisedRef.current) {
      eventos.forEach(e => { if (e.idEvento != null) knownEventoIdsRef.current.add(e.idEvento); });
      eventosInitialisedRef.current = true;
      return;
    }
    let puntualMasReciente: Evento | null = null;
    eventos.forEach(ev => {
      if (ev.idEvento == null) return;
      if (knownEventoIdsRef.current.has(ev.idEvento)) return;
      knownEventoIdsRef.current.add(ev.idEvento);
      if (ev.origen !== 'sistema') return;
      // Solo flash si NO es persistente (los persistentes salen vía baseVFX continuo)
      if (EVENTOS_PERSISTENTES[ev.tipoEvento]) return;
      if (!puntualMasReciente || ev.diaEvento > puntualMasReciente.diaEvento) puntualMasReciente = ev;
    });
    if (puntualMasReciente) {
      setFlashVFX((puntualMasReciente as Evento).tipoEvento as VFXEffect);
    }
  }, [eventos]);

  const handleVfxFinish = () => {
    setFlashVFX(null);
  };

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
    try {
      for (let i = 0; i < dias; i++) {
        await simulacionService.avanzarDia(parseInt(id));
      }
      await loadSimulationData();
    } catch (error: any) {
      alert(error.message || 'Error al avanzar días');
    } finally {
      setIsAdvancing(false);
    }
  };

  const aplicarEvento = async () => {
    if (!id || !nuevoEvento.tipoEvento) return;

    try {
      const eventoData = {
        ...nuevoEvento,
        diaEvento: simulacion?.diaActual || 1,
        origen: 'usuario' as OrigenEvento,
        costeEuros: calcularCosteEvento(nuevoEvento.tipoEvento, nuevoEvento.cantidad || 0)
      };

      const tipoAplicado = nuevoEvento.tipoEvento;
      await simulacionService.aplicarEvento(parseInt(id), eventoData);
      await loadSimulationData();
      setShowEventModal(false);
      setNuevoEvento({
        tipoEvento: 'riego',
        cantidad: 0,
        descripcion: ''
      });

      if (tipoAplicado) {
        // Acción manual: mostrar flash temporal del efecto que se acaba de aplicar.
        setFlashVFX(tipoAplicado as VFXEffect);
      }
    } catch (error: any) {
      alert(error.message || 'Error al aplicar evento');
    }
  };

  const calcularCosteEvento = (tipo: TipoEvento, cantidad: number): number => {
    const costes: Record<string, number> = {
      riego: 0.5,
      fertilizacion: 2.0,
      tratamiento_fitosanitario: 5.0,
      poda: 10.0,
      cosecha: 15.0
    };

    return (costes[tipo] || 0) * cantidad;
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
  const progresoCiclo = (simulacion.diaActual / cultivoConfig.cicloVidaDias) * 100;

  const eventosAleatoriosOn = simulacion.eventosAleatorios ?? true;
  const modoInvencibleOn = simulacion.modoInvencible ?? false;
  const ultimoEstado = historial.length > 0 ? historial[historial.length - 1] : null;
  const saludColor = simulacion.saludActual > 80 ? '#5fae45' : simulacion.saludActual > 50 ? '#ffa726' : '#e53935';

  // VFX base continuo: refleja el evento ACTIVO más reciente (persistente y sin resolver).
  // Cuando no hay activos, no se muestra nada (a menos que haya un flashVFX temporal).
  const eventosActivosNow = calcularEventosActivos(eventos, simulacion.diaActual);
  const baseVFX: VFXEffect | null = eventosActivosNow.length > 0
    ? eventosActivosNow.reduce((m, e) => e.evento.diaEvento > m.evento.diaEvento ? e : m).evento.tipoEvento as VFXEffect
    : null;
  // El flash temporal tiene prioridad; cuando termina, vuelve el base (o null).
  const currentVFX: VFXEffect | null = flashVFX ?? baseVFX;
  const currentVFXDuration: number | null = flashVFX ? 4000 : null;

  return (
    <div className="sim-v2">
      {/* Fondo 3D */}
      <div className="sim-v2-scene">
        <FarmScene simulacion={simulacion} />
      </div>

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
              <span className={`sim-v2-pill sim-v2-pill-${simulacion.estado}`}>{simulacion.estado}</span>
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
            <span className="sim-v2-stat-value sim-v2-day">{simulacion.diaActual}<small>/{cultivoConfig.cicloVidaDias}</small></span>
          </div>
        </div>
      </div>

      {/* Side panel */}
      <aside className={`sim-v2-side ${sidePanelOpen ? 'open' : ''}`}>
        <button className="sim-v2-side-toggle" onClick={() => setSidePanelOpen(o => !o)} title="Detalles">
          {sidePanelOpen ? '›' : '‹'}
        </button>
        <div className="sim-v2-side-tabs">
          {(['detalles', 'alertas', 'graficos', 'eventos', 'economia'] as const).map(t => (
            <button
              key={t}
              className={`sim-v2-side-tab ${selectedTab === t ? 'active' : ''}`}
              onClick={() => { setSidePanelOpen(true); setSelectedTab(t as any); }}
            >
              {t === 'detalles' && '📋'}
              {t === 'alertas' && '⚠️'}
              {t === 'graficos' && '📈'}
              {t === 'eventos' && '📅'}
              {t === 'economia' && '💰'}
            </button>
          ))}
        </div>
        {sidePanelOpen && (
          <div className="sim-v2-side-content">
            {selectedTab === 'alertas' && (
              <>
                {(() => {
                  const activos = calcularEventosActivos(eventos, simulacion.diaActual);
                  if (activos.length === 0) {
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
                      <p className="sim-v2-activos-hint">
                        Estos problemas siguen afectando al cultivo hasta que apliques la acción correctora.
                      </p>
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
              <EconomyPanel simulacionId={simulacion.idSimulacion!} presupuestoActual={simulacion.presupuestoActual} />
            )}
          </div>
        )}
      </aside>

      {/* Dock inferior-izquierda: ajustes de partida */}
      <div className="sim-v2-settings-dock">
        <button
          type="button"
          className={`sim-v2-toggle ${eventosAleatoriosOn ? 'on' : 'off'}`}
          onClick={toggleEventosAleatorios}
          disabled={simulacion.estado !== 'en_curso'}
          title={eventosAleatoriosOn
            ? 'Eventos aleatorios ON — el sistema generará problemas al avanzar días'
            : 'Eventos aleatorios OFF — solo lo que apliques manualmente'}
        >
          <span className="sim-v2-toggle-icon">{eventosAleatoriosOn ? '🎲' : '⏸️'}</span>
          <span className="sim-v2-toggle-text">Aleatorios <strong>{eventosAleatoriosOn ? 'ON' : 'OFF'}</strong></span>
        </button>

        <button
          type="button"
          className={`sim-v2-toggle ${modoInvencibleOn ? 'on invencible' : 'off'}`}
          onClick={toggleModoInvencible}
          disabled={simulacion.estado !== 'en_curso'}
          title={modoInvencibleOn
            ? 'Modo invencible ON — la salud se mantiene al 100% siempre'
            : 'Modo invencible OFF — la salud baja normalmente'}
        >
          <span className="sim-v2-toggle-icon">🛡️</span>
          <span className="sim-v2-toggle-text">Invencible <strong>{modoInvencibleOn ? 'ON' : 'OFF'}</strong></span>
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
        <div className="modal-overlay" onClick={() => setShowEventModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Aplicar Evento</h2>
              <button className="close-btn" onClick={() => setShowEventModal(false)}>×</button>
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
                  <label>Cantidad/Intensidad</label>
                  <input
                    type="number"
                    value={nuevoEvento.cantidad || 0}
                    onChange={(e) => setNuevoEvento({ ...nuevoEvento, cantidad: parseFloat(e.target.value) })}
                    className="input"
                    min="0"
                    step="0.1"
                  />
                  <small className="help-text">
                    {nuevoEvento.tipoEvento === 'riego' && 'Litros de agua'}
                    {nuevoEvento.tipoEvento === 'fertilizacion' && 'Kilogramos de fertilizante'}
                    {nuevoEvento.tipoEvento === 'tratamiento_fitosanitario' && 'Litros de producto'}
                    {nuevoEvento.tipoEvento === 'poda' && 'Número de plantas'}
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

              {nuevoEvento.tipoEvento && nuevoEvento.cantidad && (
                <div className="cost-info">
                  <strong>Coste estimado:</strong> {calcularCosteEvento(nuevoEvento.tipoEvento, nuevoEvento.cantidad).toFixed(2)} €
                </div>
              )}
            </div>

            <div className="modal-footer">
              <Button variant="secondary" onClick={() => setShowEventModal(false)}>
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

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Simulacion, EstadoDiario, Evento, Resultado, Economia, Notificacion } from '../types';
import { simulacionService } from '../services/simulacionService';

// ============================================================================
// CONTEXT DE SIMULACIÓN
// ============================================================================

interface SimulacionContextType {
  simulacionActual: Simulacion | null;
  estadosDiarios: EstadoDiario[];
  eventos: Evento[];
  resultado: Resultado | null;
  economia: Economia | null;
  notificaciones: Notificacion[];
  isLoading: boolean;

  // Funciones
  cargarSimulacion: (id: number) => Promise<void>;
  avanzarDia: () => Promise<void>;
  aplicarEvento: (evento: Partial<Evento>) => Promise<void>;
  finalizarSimulacion: () => Promise<void>;
  limpiarSimulacion: () => void;
  agregarNotificacion: (notificacion: Omit<Notificacion, 'id' | 'timestamp' | 'leida'>) => void;
  marcarNotificacionLeida: (id: string) => void;
  limpiarNotificaciones: () => void;
}

const SimulacionContext = createContext<SimulacionContextType | undefined>(undefined);

// ============================================================================
// PROVIDER
// ============================================================================

interface SimulacionProviderProps {
  children: ReactNode;
}

export const SimulacionProvider: React.FC<SimulacionProviderProps> = ({ children }) => {
  const [simulacionActual, setSimulacionActual] = useState<Simulacion | null>(null);
  const [estadosDiarios, setEstadosDiarios] = useState<EstadoDiario[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [economia, setEconomia] = useState<Economia | null>(null);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const cargarSimulacion = async (id: number) => {
    setIsLoading(true);
    try {
      const [simulacion, historial, eventosData] = await Promise.all([
        simulacionService.obtenerPorId(id),
        simulacionService.obtenerHistorial(id),
        simulacionService.obtenerEventos(id)
      ]);

      setSimulacionActual(simulacion);
      setEstadosDiarios(historial);
      setEventos(eventosData);

      // Si está completada o fallida, cargar resultado
      if (simulacion.estado === 'completada' || simulacion.estado === 'fallida') {
        const [resultadoData, economiaData] = await Promise.all([
          simulacionService.obtenerResultado(id),
          simulacionService.obtenerEconomia(id)
        ]);
        setResultado(resultadoData);
        setEconomia(economiaData);
      }
    } catch (error: any) {
      agregarNotificacion({
        tipo: 'error',
        titulo: 'Error',
        mensaje: error.message || 'Error al cargar la simulación'
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const avanzarDia = async () => {
    if (!simulacionActual?.idSimulacion) return;

    setIsLoading(true);
    try {
      const nuevoEstado = await simulacionService.avanzarDia(simulacionActual.idSimulacion);

      // Actualizar estados diarios
      setEstadosDiarios(prev => [...prev, nuevoEstado]);

      // Actualizar simulación
      const simulacionActualizada = await simulacionService.obtenerPorId(simulacionActual.idSimulacion);
      setSimulacionActual(simulacionActualizada);

      // Verificar condiciones y generar notificaciones
      checkCondicionesPlanta(nuevoEstado);

    } catch (error: any) {
      agregarNotificacion({
        tipo: 'error',
        titulo: 'Error',
        mensaje: error.message || 'Error al avanzar el día'
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const aplicarEvento = async (evento: Partial<Evento>) => {
    if (!simulacionActual?.idSimulacion) return;

    setIsLoading(true);
    try {
      const nuevoEvento = await simulacionService.aplicarEvento(simulacionActual.idSimulacion, evento);
      setEventos(prev => [...prev, nuevoEvento]);

      agregarNotificacion({
        tipo: 'info',
        titulo: 'Evento aplicado',
        mensaje: `Se ha aplicado el evento: ${evento.tipoEvento}`
      });

      // Recargar simulación para obtener efectos
      await cargarSimulacion(simulacionActual.idSimulacion);
    } catch (error: any) {
      agregarNotificacion({
        tipo: 'error',
        titulo: 'Error',
        mensaje: error.message || 'Error al aplicar evento'
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const finalizarSimulacion = async () => {
    if (!simulacionActual?.idSimulacion) return;

    setIsLoading(true);
    try {
      const resultadoData = await simulacionService.finalizar(simulacionActual.idSimulacion);
      setResultado(resultadoData);

      const [economiaData, simulacionActualizada] = await Promise.all([
        simulacionService.obtenerEconomia(simulacionActual.idSimulacion),
        simulacionService.obtenerPorId(simulacionActual.idSimulacion)
      ]);

      setEconomia(economiaData);
      setSimulacionActual(simulacionActualizada);

      agregarNotificacion({
        tipo: 'success',
        titulo: 'Simulación finalizada',
        mensaje: `La simulación ha finalizado con estado: ${resultadoData.estadoFinal}`
      });
    } catch (error: any) {
      agregarNotificacion({
        tipo: 'error',
        titulo: 'Error',
        mensaje: error.message || 'Error al finalizar simulación'
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const limpiarSimulacion = () => {
    setSimulacionActual(null);
    setEstadosDiarios([]);
    setEventos([]);
    setResultado(null);
    setEconomia(null);
  };

  const agregarNotificacion = (notificacion: Omit<Notificacion, 'id' | 'timestamp' | 'leida'>) => {
    const nuevaNotificacion: Notificacion = {
      ...notificacion,
      id: Date.now().toString(),
      timestamp: new Date(),
      leida: false
    };

    setNotificaciones(prev => [nuevaNotificacion, ...prev]);
  };

  const marcarNotificacionLeida = (id: string) => {
    setNotificaciones(prev =>
      prev.map(notif => (notif.id === id ? { ...notif, leida: true } : notif))
    );
  };

  const limpiarNotificaciones = () => {
    setNotificaciones([]);
  };

  // Función auxiliar para verificar condiciones de la planta
  const checkCondicionesPlanta = (estado: EstadoDiario) => {
    // Verificar salud
    if (estado.saludPlanta < 30) {
      agregarNotificacion({
        tipo: 'error',
        titulo: 'Salud crítica',
        mensaje: `La salud de la planta está en ${estado.saludPlanta.toFixed(1)}%. ¡Requiere atención inmediata!`
      });
    } else if (estado.saludPlanta < 60) {
      agregarNotificacion({
        tipo: 'warning',
        titulo: 'Salud baja',
        mensaje: `La salud de la planta está en ${estado.saludPlanta.toFixed(1)}%. Considera tomar medidas.`
      });
    }

    // Verificar humedad
    if (estado.humedadSuelo < 30) {
      agregarNotificacion({
        tipo: 'warning',
        titulo: 'Humedad baja',
        mensaje: `La humedad del suelo está en ${estado.humedadSuelo.toFixed(1)}%. Considera regar.`
      });
    } else if (estado.humedadSuelo > 90) {
      agregarNotificacion({
        tipo: 'warning',
        titulo: 'Humedad alta',
        mensaje: `La humedad del suelo está en ${estado.humedadSuelo.toFixed(1)}%. Riesgo de encharcamiento.`
      });
    }

    // Verificar estrés
    if (estado.estresHidrico) {
      agregarNotificacion({
        tipo: 'error',
        titulo: 'Estrés hídrico',
        mensaje: 'La planta está sufriendo estrés por falta de agua.'
      });
    }

    if (estado.estresTermico) {
      agregarNotificacion({
        tipo: 'error',
        titulo: 'Estrés térmico',
        mensaje: 'La planta está sufriendo estrés por temperatura inadecuada.'
      });
    }

    if (estado.estresNutricional) {
      agregarNotificacion({
        tipo: 'warning',
        titulo: 'Estrés nutricional',
        mensaje: 'La planta está sufriendo deficiencias nutricionales.'
      });
    }
  };

  const value: SimulacionContextType = {
    simulacionActual,
    estadosDiarios,
    eventos,
    resultado,
    economia,
    notificaciones,
    isLoading,
    cargarSimulacion,
    avanzarDia,
    aplicarEvento,
    finalizarSimulacion,
    limpiarSimulacion,
    agregarNotificacion,
    marcarNotificacionLeida,
    limpiarNotificaciones
  };

  return <SimulacionContext.Provider value={value}>{children}</SimulacionContext.Provider>;
};

// ============================================================================
// HOOK
// ============================================================================

export const useSimulacion = (): SimulacionContextType => {
  const context = useContext(SimulacionContext);
  if (context === undefined) {
    throw new Error('useSimulacion debe ser usado dentro de un SimulacionProvider');
  }
  return context;
};

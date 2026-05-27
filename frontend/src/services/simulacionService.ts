import { api } from './api';
import {
  Simulacion,
  SimulacionFormData,
  EstadoDiario,
  Evento,
  Resultado,
  Economia,
  ApiResponse,
  PaginatedResponse,
  EstadisticasUsuario,
  EstadisticasEconomicas
} from '../types';

// ============================================================================
// SERVICIO DE SIMULACIÓN
// ============================================================================

export const simulacionService = {
  /**
   * Crear una nueva simulación
   */
  crear: async (data: any): Promise<Simulacion> => {
    try {
      const response = await api.post<ApiResponse<Simulacion>>('/simulaciones', data);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al crear simulación');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || error.message || 'Error al crear simulación');
    }
  },

  /**
   * Obtener simulaciones del usuario
   */
  obtenerPorUsuario: async (userId?: number, page: number = 0, size: number = 10): Promise<Simulacion[]> => {
    try {
      const response = await api.get<ApiResponse<Simulacion[]>>('/simulaciones');

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al obtener simulaciones');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || error.message || 'Error al obtener simulaciones');
    }
  },

  /**
   * Obtener una simulación por ID
   */
  obtenerPorId: async (id: number): Promise<Simulacion> => {
    try {
      const response = await api.get<ApiResponse<Simulacion>>(`/simulaciones/${id}`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al obtener simulación');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al obtener simulación');
    }
  },

  /**
   * Avanzar un día en la simulación
   */
  avanzarDia: async (id: number): Promise<EstadoDiario> => {
    try {
      const response = await api.post<ApiResponse<EstadoDiario>>(`/simulaciones/${id}/avanzar-dia`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al avanzar día');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al avanzar día');
    }
  },

  /**
   * Avanzar N días en una sola petición HTTP (mucho más rápido en el plan gratis
   * de Render que llamar N veces a /avanzar-dia).
   */
  avanzarVariosDias: async (id: number, n: number): Promise<EstadoDiario> => {
    try {
      const response = await api.post<ApiResponse<EstadoDiario>>(
        `/simulaciones/${id}/avanzar-dias?n=${n}`
      );
      if (response.success && response.data) return response.data;
      throw new Error(response.message || 'Error al avanzar días');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al avanzar días');
    }
  },

  /**
   * Obtener historial diario de la simulación
   */
  obtenerHistorial: async (simulacionId: number): Promise<EstadoDiario[]> => {
    try {
      const response = await api.get<ApiResponse<EstadoDiario[]>>(`/simulaciones/${simulacionId}/historial`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al obtener historial');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al obtener historial');
    }
  },

  /**
   * Aplicar evento a la simulación
   */
  aplicarEvento: async (simulacionId: number, evento: Partial<Evento>): Promise<Evento> => {
    try {
      const response = await api.post<ApiResponse<Evento>>(
        `/simulaciones/${simulacionId}/eventos`,
        evento
      );

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al aplicar evento');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al aplicar evento');
    }
  },

  /**
   * Obtener eventos de una simulación
   */
  obtenerEventos: async (simulacionId: number): Promise<Evento[]> => {
    try {
      const response = await api.get<ApiResponse<Evento[]>>(`/simulaciones/${simulacionId}/eventos`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al obtener eventos');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al obtener eventos');
    }
  },

  /**
   * Finalizar simulación
   */
  finalizar: async (simulacionId: number): Promise<Resultado> => {
    try {
      const response = await api.post<ApiResponse<Resultado>>(`/simulaciones/${simulacionId}/finalizar`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al finalizar simulación');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al finalizar simulación');
    }
  },

  /**
   * Obtener resultado de una simulación
   */
  obtenerResultado: async (simulacionId: number): Promise<Resultado> => {
    try {
      const response = await api.get<ApiResponse<Resultado>>(`/simulaciones/${simulacionId}/resultado`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al obtener resultado');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al obtener resultado');
    }
  },

  /**
   * Obtener economía de una simulación
   */
  obtenerEconomia: async (simulacionId: number): Promise<Economia> => {
    try {
      const response = await api.get<ApiResponse<Economia>>(`/simulaciones/${simulacionId}/economia`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al obtener economía');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al obtener economía');
    }
  },

  /**
   * Actualizar simulación
   */
  actualizar: async (id: number, data: Partial<Simulacion>): Promise<Simulacion> => {
    try {
      const response = await api.put<ApiResponse<Simulacion>>(`/simulaciones/${id}`, data);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al actualizar simulación');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al actualizar simulación');
    }
  },

  /**
   * Activar o desactivar el modo invencible (la salud no baja)
   */
  setModoInvencible: async (id: number, activo: boolean): Promise<Simulacion> => {
    try {
      const response = await api.put<ApiResponse<Simulacion>>(
        `/simulaciones/${id}/modo-invencible?activo=${activo}`
      );
      if (response.success && response.data) return response.data;
      throw new Error(response.message || 'Error al cambiar modo invencible');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || error.message || 'Error al cambiar modo invencible');
    }
  },

  /**
   * Activar o desactivar el dinero infinito (los eventos no descuentan presupuesto)
   */
  setDineroInfinito: async (id: number, activo: boolean): Promise<Simulacion> => {
    try {
      const response = await api.put<ApiResponse<Simulacion>>(
        `/simulaciones/${id}/dinero-infinito?activo=${activo}`
      );
      if (response.success && response.data) return response.data;
      throw new Error(response.message || 'Error al cambiar dinero infinito');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || error.message || 'Error al cambiar dinero infinito');
    }
  },

  /**
   * Activar o desactivar la generación aleatoria de eventos del sistema
   */
  setEventosAleatorios: async (id: number, activos: boolean): Promise<Simulacion> => {
    try {
      const response = await api.put<ApiResponse<Simulacion>>(
        `/simulaciones/${id}/eventos-aleatorios?activos=${activos}`
      );

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al cambiar eventos aleatorios');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || error.message || 'Error al cambiar eventos aleatorios');
    }
  },

  /**
   * Configura la lista de tipos de evento permitidos como aleatorios.
   * Pasar `null` → cualquier evento del pool puede ocurrir (por defecto).
   * Pasar un array → solo esos tipos se generarán aleatoriamente.
   */
  setEventosPermitidos: async (id: number, tipos: string[] | null): Promise<Simulacion> => {
    try {
      const body = { eventosPermitidos: tipos === null ? null : tipos.join(',') };
      const response = await api.put<ApiResponse<Simulacion>>(
        `/simulaciones/${id}/eventos-permitidos`,
        body
      );
      if (response.success && response.data) return response.data;
      throw new Error(response.message || 'Error al cambiar eventos permitidos');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || error.message || 'Error al cambiar eventos permitidos');
    }
  },

  /**
   * Eliminar simulación
   */
  eliminar: async (id: number): Promise<void> => {
    try {
      const response = await api.delete<ApiResponse<void>>(`/simulaciones/${id}`);

      if (!response.success) {
        throw new Error(response.message || 'Error al eliminar simulación');
      }
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al eliminar simulación');
    }
  },

  /**
   * Pausar simulación
   */
  pausar: async (id: number): Promise<Simulacion> => {
    try {
      const response = await api.post<ApiResponse<Simulacion>>(`/simulaciones/${id}/pausar`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al pausar simulación');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al pausar simulación');
    }
  },

  /**
   * Reanudar simulación
   */
  reanudar: async (id: number): Promise<Simulacion> => {
    try {
      const response = await api.post<ApiResponse<Simulacion>>(`/simulaciones/${id}/reanudar`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al reanudar simulación');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al reanudar simulación');
    }
  },

  /**
   * Obtener estadísticas del usuario
   */
  obtenerEstadisticas: async (userId: number): Promise<EstadisticasUsuario> => {
    try {
      const response = await api.get<ApiResponse<EstadisticasUsuario>>(`/usuarios/${userId}/estadisticas`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al obtener estadísticas');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al obtener estadísticas');
    }
  },

  /**
   * Obtener resultados de todas las simulaciones completadas del usuario (comparativa)
   */
  obtenerComparativa: async (): Promise<Resultado[]> => {
    try {
      const response = await api.get<ApiResponse<Resultado[]>>('/simulaciones/resultados/comparativa');

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al obtener comparativa');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al obtener comparativa');
    }
  },

  /**
   * Obtener estadísticas económicas de una simulación
   */
  obtenerEstadisticasEconomicas: async (simulacionId: number): Promise<EstadisticasEconomicas> => {
    try {
      const response = await api.get<ApiResponse<EstadisticasEconomicas>>(`/simulaciones/${simulacionId}/economia`);

      if (response.success && response.data) {
        return response.data;
      }

      throw new Error(response.message || 'Error al obtener estadísticas económicas');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al obtener estadísticas económicas');
    }
  }
};

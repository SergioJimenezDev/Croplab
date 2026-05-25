import { api, setAuthToken, removeAuthToken } from './api';
import { LoginData, RegisterData, Usuario, AuthResponse, ApiResponse } from '../types';

// ============================================================================
// SERVICIO DE AUTENTICACIÓN
// ============================================================================

export const authService = {
  /**
   * Iniciar sesión
   */
  login: async (credentials: LoginData): Promise<AuthResponse> => {
    try {
      const response = await api.post<ApiResponse<AuthResponse>>('/auth/login', credentials);

      if (response.success && response.data) {
        setAuthToken(response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.usuario));
        return response.data;
      }

      throw new Error(response.message || 'Error en el inicio de sesión');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al iniciar sesión');
    }
  },

  /**
   * Registrarse
   */
  register: async (userData: RegisterData): Promise<AuthResponse> => {
    try {
      const response = await api.post<ApiResponse<AuthResponse>>('/auth/register', userData);

      if (response.success && response.data) {
        setAuthToken(response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.usuario));
        return response.data;
      }

      throw new Error(response.message || 'Error en el registro');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al registrarse');
    }
  },

  /**
   * Cerrar sesión
   */
  logout: () => {
    removeAuthToken();
  },

  /**
   * Obtener usuario actual
   */
  getCurrentUser: (): Usuario | null => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  },

  /**
   * Verificar si hay sesión activa
   */
  isAuthenticated: (): boolean => {
    const token = localStorage.getItem('authToken');
    const user = localStorage.getItem('user');
    return !!(token && user);
  },

  /**
   * Actualizar perfil de usuario
   */
  updateProfile: async (userId: number, userData: Partial<Usuario>): Promise<Usuario> => {
    try {
      const response = await api.put<ApiResponse<Usuario>>(`/usuarios/${userId}`, userData);

      if (response.success && response.data) {
        localStorage.setItem('user', JSON.stringify(response.data));
        return response.data;
      }

      throw new Error(response.message || 'Error al actualizar perfil');
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al actualizar perfil');
    }
  },

  /**
   * Cambiar contraseña
   */
  changePassword: async (userId: number, oldPassword: string, newPassword: string): Promise<void> => {
    try {
      const response = await api.post<ApiResponse<void>>(`/usuarios/${userId}/cambiar-contrasena`, {
        contrasenaActual: oldPassword,
        contrasenaNueva: newPassword
      });

      if (!response.success) {
        throw new Error(response.message || 'Error al cambiar contraseña');
      }
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Error al cambiar contraseña');
    }
  }
};

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button, Input, Card, CardBody } from '../common';
import { RolUsuario } from '../../types';
import {
  AuthLogoEmblem,
  DecoMagnifier,
  DecoDrop,
  DecoFlask,
  DecoLeaves,
  DecoArrow
} from './AuthDecorations';
import './Auth.css';

const Register: React.FC = () => {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [formData, setFormData] = useState({
    nombre: '',
    email: '',
    contrasena: '',
    confirmarContrasena: '',
    rol: 'estudiante' as RolUsuario,
    institucion: ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    // Limpiar error del campo
    if (errors[e.target.name]) {
      setErrors({ ...errors, [e.target.name]: '' });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.nombre.trim()) {
      newErrors.nombre = 'El nombre es requerido';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'El email es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Email no válido';
    }

    if (!formData.contrasena) {
      newErrors.contrasena = 'La contraseña es requerida';
    } else if (formData.contrasena.length < 6) {
      newErrors.contrasena = 'La contraseña debe tener al menos 6 caracteres';
    }

    if (formData.contrasena !== formData.confirmarContrasena) {
      newErrors.confirmarContrasena = 'Las contraseñas no coinciden';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setIsLoading(true);

    try {
      await register(formData);
      navigate('/dashboard');
    } catch (err: any) {
      setErrors({ submit: err.message || 'Error al registrarse. Por favor, intenta de nuevo.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      {/* Decoraciones de cuaderno */}
      <div className="auth-deco auth-deco-magnifier"><DecoMagnifier /></div>
      <div className="auth-deco auth-deco-drop"><DecoDrop /></div>
      <div className="auth-deco auth-deco-flask"><DecoFlask /></div>
      <div className="auth-deco auth-deco-leaves"><DecoLeaves /></div>
      <div className="auth-deco auth-deco-arrow"><DecoArrow /></div>
      <div className="auth-deco auth-deco-arrow-right"><DecoArrow flip /></div>

      <div className="auth-content">
        <div className="auth-logo">
          <div className="auth-logo-emblem"><AuthLogoEmblem /></div>
          <h1>CropLab</h1>
          <p>Simulador educativo de cultivos</p>
        </div>

        <Card className="auth-card">
          <CardBody>
            <h2 className="auth-title">Crear cuenta</h2>
            <p className="auth-subtitle">
              Abre tu propio cuaderno de experimentos
            </p>

            {errors.submit && (
              <div className="auth-error">
                {errors.submit}
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form">
              <Input
                type="text"
                name="nombre"
                label="Nombre Completo"
                placeholder="Juan Pérez"
                value={formData.nombre}
                onChange={handleChange}
                error={errors.nombre}
                required
                fullWidth
                autoComplete="name"
              />

              <Input
                type="email"
                name="email"
                label="Correo Electrónico"
                placeholder="tu@email.com"
                value={formData.email}
                onChange={handleChange}
                error={errors.email}
                required
                fullWidth
                autoComplete="email"
              />

              <div className="form-row">
                <Input
                  type="password"
                  name="contrasena"
                  label="Contraseña"
                  placeholder="••••••••"
                  value={formData.contrasena}
                  onChange={handleChange}
                  error={errors.contrasena}
                  required
                  fullWidth
                  autoComplete="new-password"
                />

                <Input
                  type="password"
                  name="confirmarContrasena"
                  label="Confirmar Contraseña"
                  placeholder="••••••••"
                  value={formData.confirmarContrasena}
                  onChange={handleChange}
                  error={errors.confirmarContrasena}
                  required
                  fullWidth
                  autoComplete="new-password"
                />
              </div>

              <div className="input-wrapper">
                <label htmlFor="rol" className="input-label">
                  Rol
                </label>
                <select
                  id="rol"
                  name="rol"
                  className="input"
                  value={formData.rol}
                  onChange={handleChange}
                >
                  <option value="estudiante">Estudiante</option>
                  <option value="profesor">Profesor</option>
                  <option value="investigador">Investigador</option>
                  <option value="agricultor">Agricultor</option>
                </select>
              </div>

              <Input
                type="text"
                name="institucion"
                label="Institución (Opcional)"
                placeholder="Universidad..."
                value={formData.institucion}
                onChange={handleChange}
                fullWidth
              />

              <div className="auth-submit-wrap">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  isLoading={isLoading}
                >
                  Crear cuenta
                </Button>
              </div>
            </form>

            <div className="auth-footer">
              <p>
                ¿Ya tienes una cuenta?{' '}
                <Link to="/login" className="auth-link">
                  Inicia sesión aquí
                </Link>
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

export default Register;

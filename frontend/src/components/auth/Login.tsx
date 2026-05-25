import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button, Input, Card, CardBody } from '../common';
import {
  AuthLogoEmblem,
  DecoMagnifier,
  DecoDrop,
  DecoFlask,
  DecoLeaves,
  DecoArrow
} from './AuthDecorations';
import './Auth.css';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    contrasena: ''
  });

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(formData);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión. Por favor, verifica tus credenciales.');
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
            <h2 className="auth-title">Iniciar sesión</h2>
            <p className="auth-subtitle">Accede a tu cuaderno de experimentos</p>

            {error && <div className="auth-error">{error}</div>}

            <form onSubmit={handleSubmit} className="auth-form">
              <Input
                type="email"
                name="email"
                label="Correo electrónico"
                placeholder="tu@email.com"
                value={formData.email}
                onChange={handleChange}
                required
                fullWidth
                autoComplete="email"
              />

              <Input
                type="password"
                name="contrasena"
                label="Contraseña"
                placeholder="••••••••"
                value={formData.contrasena}
                onChange={handleChange}
                required
                fullWidth
                autoComplete="current-password"
              />

              <div className="auth-submit-wrap">
                <Button type="submit" variant="primary" size="lg" isLoading={isLoading}>
                  Iniciar sesión
                </Button>
              </div>
            </form>

            <div className="auth-footer">
              <p>
                ¿No tienes una cuenta?{' '}
                <Link to="/register" className="auth-link">Regístrate aquí</Link>
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

export default Login;

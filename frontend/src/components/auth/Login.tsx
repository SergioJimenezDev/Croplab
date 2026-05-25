import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button, Input, Card, CardBody } from '../common';
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
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
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
      <div className="auth-content">
        <div className="auth-logo">
          <h1>🌱 CropLab</h1>
          <p>Simulador Educativo de Cultivos</p>
        </div>

        <Card className="auth-card">
          <CardBody>
            <h2 className="auth-title">Iniciar Sesión</h2>
            <p className="auth-subtitle">
              Accede a tu cuenta para gestionar tus simulaciones
            </p>

            {error && (
              <div className="auth-error">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form">
              <Input
                type="email"
                name="email"
                label="Correo Electrónico"
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

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
              >
                Iniciar Sesión
              </Button>
            </form>

            <div className="auth-footer">
              <p>
                ¿No tienes una cuenta?{' '}
                <Link to="/register" className="auth-link">
                  Regístrate aquí
                </Link>
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

export default Login;

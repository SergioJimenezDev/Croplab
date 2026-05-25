import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button, Card, CardBody } from '../components/common';
import './Profile.css';

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { usuario } = useAuth();

  return (
    <div className="profile-page">
      <header className="profile-header">
        <h1>👤 Perfil de Usuario</h1>
      </header>

      <div className="profile-content">
        <Card className="profile-card">
          <CardBody>
            <div className="profile-row">
              <span className="profile-label">Nombre</span>
              <span className="profile-value">{usuario?.nombre}</span>
            </div>
            <div className="profile-row">
              <span className="profile-label">Email</span>
              <span className="profile-value">{usuario?.email}</span>
            </div>
            <div className="profile-row">
              <span className="profile-label">Rol</span>
              <span className="profile-value">{usuario?.rol}</span>
            </div>
            {usuario?.institucion && (
              <div className="profile-row">
                <span className="profile-label">Institución</span>
                <span className="profile-value">{usuario.institucion}</span>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="profile-actions">
          <Button onClick={() => navigate('/dashboard')}>
            ← Volver al Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Profile;

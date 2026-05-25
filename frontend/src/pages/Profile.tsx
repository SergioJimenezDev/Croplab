import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button, Card, CardBody } from '../components/common';

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { usuario } = useAuth();

  return (
    <div className="container" style={{ padding: '2rem' }}>
      <h1>Perfil de Usuario</h1>

      <Card>
        <CardBody>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Nombre:</strong> {usuario?.nombre}
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Email:</strong> {usuario?.email}
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <strong>Rol:</strong> {usuario?.rol}
          </div>
          {usuario?.institucion && (
            <div style={{ marginBottom: '1rem' }}>
              <strong>Institución:</strong> {usuario.institucion}
            </div>
          )}
        </CardBody>
      </Card>

      <div style={{ marginTop: '2rem' }}>
        <Button onClick={() => navigate('/dashboard')}>
          Volver al Dashboard
        </Button>
      </div>
    </div>
  );
};

export default Profile;

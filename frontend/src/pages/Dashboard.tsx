import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Simulacion, EstadisticasUsuario } from '../types';
import { simulacionService } from '../services/simulacionService';
import { Button, Card, CardHeader, CardTitle, CardBody, Loading } from '../components/common';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();

  const [simulaciones, setSimulaciones] = useState<Simulacion[]>([]);
  const [estadisticas, setEstadisticas] = useState<EstadisticasUsuario | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    if (!usuario?.idUsuario) return;

    try {
      const [simData, stats] = await Promise.all([
        simulacionService.obtenerPorUsuario(usuario.idUsuario, 0, 10),
        simulacionService.obtenerEstadisticas(usuario.idUsuario)
      ]);

      setSimulaciones(simData);
      setEstadisticas(stats);
    } catch (error) {
      console.error('Error al cargar datos:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <Loading fullScreen text="Cargando dashboard..." />;
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>🌱 CropLab</h1>
        <div className="dashboard-user">
          <span>Hola, {usuario?.nombre}</span>
          <Button variant="outline" size="sm" onClick={() => navigate('/profile')}>
            Perfil
          </Button>
          <Button variant="outline" size="sm" onClick={logout}>
            Cerrar Sesión
          </Button>
        </div>
      </header>

      <div className="dashboard-content container">
        <div className="dashboard-stats">
          <Card>
            <CardBody>
              <h3>Total Simulaciones</h3>
              <p className="stat-number">{estadisticas?.totalSimulaciones || 0}</p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3>Completadas</h3>
              <p className="stat-number text-success">{estadisticas?.completadas || 0}</p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3>En Curso</h3>
              <p className="stat-number text-info">{estadisticas?.enCurso || 0}</p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3>Salud Promedio</h3>
              <p className="stat-number">{estadisticas?.saludPromedio?.toFixed(1) || 'N/A'}%</p>
            </CardBody>
          </Card>
        </div>

        <div className="dashboard-actions">
          <Button
            variant="primary"
            size="lg"
            onClick={() => navigate('/simulation/new')}
          >
            + Nueva Simulacion
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => navigate('/compare')}
          >
            Comparar Simulaciones
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Mis Simulaciones</CardTitle>
          </CardHeader>
          <CardBody>
            {simulaciones.length === 0 ? (
              <p className="text-secondary">
                No tienes simulaciones aún. ¡Crea tu primera simulación!
              </p>
            ) : (
              <div className="simulations-list">
                {simulaciones.map((sim) => (
                  <div
                    key={sim.idSimulacion}
                    className="simulation-item"
                    onClick={() => navigate(`/simulation/${sim.idSimulacion}`)}
                  >
                    <div>
                      <h4>{sim.nombreSimulacion}</h4>
                      <p>
                        {sim.tipoCultivo} - Día {sim.diaActual} - {sim.estado}
                      </p>
                    </div>
                    <div className="simulation-health">
                      Salud: {sim.saludActual.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;

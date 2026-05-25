import React from 'react';
import { NotificationContainer } from './common';
import { useSimulacion } from '../contexts/SimulacionContext';

const AppNotifications: React.FC = () => {
  const { notificaciones, marcarNotificacionLeida } = useSimulacion();

  const notificacionesNoLeidas = notificaciones.filter(n => !n.leida);

  if (notificacionesNoLeidas.length === 0) return null;

  return (
    <NotificationContainer
      notifications={notificacionesNoLeidas}
      onClose={(id) => marcarNotificacionLeida(id)}
    />
  );
};

export default AppNotifications;

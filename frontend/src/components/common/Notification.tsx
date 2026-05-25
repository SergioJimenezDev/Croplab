import React, { useEffect } from 'react';
import { Notificacion } from '../../types';
import './Notification.css';

interface NotificationProps {
  notification: Notificacion;
  onClose: () => void;
  autoClose?: boolean;
  autoCloseDelay?: number;
}

const Notification: React.FC<NotificationProps> = ({
  notification,
  onClose,
  autoClose = true,
  autoCloseDelay = 5000
}) => {
  useEffect(() => {
    if (autoClose) {
      const timer = setTimeout(() => {
        onClose();
      }, autoCloseDelay);

      return () => clearTimeout(timer);
    }
  }, [autoClose, autoCloseDelay, onClose]);

  const getIcon = () => {
    switch (notification.tipo) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      case 'info':
        return 'ℹ';
      default:
        return 'ℹ';
    }
  };

  return (
    <div className={`notification notification-${notification.tipo} fade-in`}>
      <div className="notification-icon">{getIcon()}</div>
      <div className="notification-content">
        <div className="notification-title">{notification.titulo}</div>
        <div className="notification-message">{notification.mensaje}</div>
      </div>
      <button
        className="notification-close"
        onClick={onClose}
        aria-label="Cerrar notificación"
      >
        ×
      </button>
    </div>
  );
};

interface NotificationContainerProps {
  notifications: Notificacion[];
  onClose: (id: string) => void;
}

export const NotificationContainer: React.FC<NotificationContainerProps> = ({
  notifications,
  onClose
}) => {
  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <Notification
          key={notification.id}
          notification={notification}
          onClose={() => onClose(notification.id)}
        />
      ))}
    </div>
  );
};

export default Notification;

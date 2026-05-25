import React, { useState } from 'react';
import { Simulacion, EstadoDiario, Evento } from '../types';
import './NotificationPanel.css';

interface Alert {
  id: string;
  tipo: 'success' | 'warning' | 'error';
  titulo: string;
  mensaje: string;
  icono: string;
}

interface NotificationPanelProps {
  simulacion: Simulacion;
  ultimoEstado: EstadoDiario | null;
  eventos: Evento[];
}

const NotificationPanel: React.FC<NotificationPanelProps> = ({ simulacion, ultimoEstado, eventos }) => {
  const [collapsed, setCollapsed] = useState(false);

  const generarAlertas = (): Alert[] => {
    const alertas: Alert[] = [];
    const salud = simulacion.saludActual;
    const humedad = simulacion.humedadSueloActual;

    // --- Salud del cultivo ---
    if (salud >= 80) {
      alertas.push({
        id: 'salud-ok',
        tipo: 'success',
        titulo: 'Salud excelente',
        mensaje: `La planta tiene ${salud.toFixed(0)}% de salud. Sigue as\u00ed.`,
        icono: '\u2714'
      });
    } else if (salud >= 50) {
      alertas.push({
        id: 'salud-media',
        tipo: 'warning',
        titulo: 'Salud moderada',
        mensaje: `Salud al ${salud.toFixed(0)}%. Revisa las condiciones del cultivo.`,
        icono: '\u26a0'
      });
    } else if (salud >= 30) {
      alertas.push({
        id: 'salud-baja',
        tipo: 'error',
        titulo: 'Salud baja',
        mensaje: `Salud cr\u00edtica al ${salud.toFixed(0)}%. Aplica tratamientos urgentemente.`,
        icono: '\u2757'
      });
    } else {
      alertas.push({
        id: 'salud-critica',
        tipo: 'error',
        titulo: 'Planta en peligro',
        mensaje: `\u00a1Salud al ${salud.toFixed(0)}%! La planta puede morir si no act\u00faas.`,
        icono: '\u2620'
      });
    }

    // --- Humedad del suelo ---
    if (humedad < 20) {
      alertas.push({
        id: 'humedad-critica',
        tipo: 'error',
        titulo: 'Suelo seco',
        mensaje: `Humedad al ${humedad.toFixed(0)}%. Necesita riego urgente.`,
        icono: '\ud83c\udfdc'
      });
    } else if (humedad < 35) {
      alertas.push({
        id: 'humedad-baja',
        tipo: 'warning',
        titulo: 'Humedad baja',
        mensaje: `Humedad al ${humedad.toFixed(0)}%. Considera regar pronto.`,
        icono: '\ud83d\udca7'
      });
    } else if (humedad > 90) {
      alertas.push({
        id: 'humedad-alta',
        tipo: 'warning',
        titulo: 'Suelo encharcado',
        mensaje: `Humedad al ${humedad.toFixed(0)}%. Riesgo de pudrici\u00f3n de ra\u00edces.`,
        icono: '\ud83c\udf0a'
      });
    }

    // --- Estr\u00e9s del \u00faltimo d\u00eda ---
    if (ultimoEstado) {
      if (ultimoEstado.estresHidrico) {
        alertas.push({
          id: 'estres-hidrico',
          tipo: 'error',
          titulo: 'Estr\u00e9s h\u00eddrico',
          mensaje: 'La planta sufre por falta de agua. Riega lo antes posible.',
          icono: '\ud83d\ude30'
        });
      }
      if (ultimoEstado.estresTermico) {
        alertas.push({
          id: 'estres-termico',
          tipo: 'error',
          titulo: 'Estr\u00e9s t\u00e9rmico',
          mensaje: `Temperatura inadecuada (${ultimoEstado.temperatura.toFixed(1)}\u00b0C). La planta est\u00e1 sufriendo.`,
          icono: '\ud83c\udf21'
        });
      }
      if (ultimoEstado.estresNutricional) {
        alertas.push({
          id: 'estres-nutricional',
          tipo: 'warning',
          titulo: 'Deficiencia nutricional',
          mensaje: 'Faltan nutrientes. Aplica fertilizaci\u00f3n.',
          icono: '\ud83e\uddea'
        });
      }
    }

    // --- Eventos negativos recientes sin tratar ---
    const eventosRecientes = eventos.filter(
      e => e.diaEvento >= simulacion.diaActual - 5 && e.origen === 'sistema'
    );
    const tratamientosRecientes = eventos.filter(
      e => e.diaEvento >= simulacion.diaActual - 5 && e.tipoEvento === 'tratamiento_fitosanitario'
    );

    const plagasSinTratar = eventosRecientes.filter(
      e => (e.tipoEvento === 'plaga' || e.tipoEvento === 'enfermedad') &&
        !tratamientosRecientes.some(t => t.diaEvento > e.diaEvento)
    );

    if (plagasSinTratar.length > 0) {
      alertas.push({
        id: 'plagas-sin-tratar',
        tipo: 'error',
        titulo: 'Plagas/enfermedades activas',
        mensaje: `Hay ${plagasSinTratar.length} problema(s) fitosanitario(s) sin tratar.`,
        icono: '\ud83d\udc1b'
      });
    }

    // --- Presupuesto ---
    const presupuesto = simulacion.presupuestoActual || 0;
    if (presupuesto < 200) {
      alertas.push({
        id: 'presupuesto-critico',
        tipo: 'error',
        titulo: 'Sin fondos',
        mensaje: `Solo quedan \u20ac${presupuesto.toFixed(0)}. No podr\u00e1s aplicar m\u00e1s acciones.`,
        icono: '\ud83d\udcb8'
      });
    } else if (presupuesto < 1000) {
      alertas.push({
        id: 'presupuesto-bajo',
        tipo: 'warning',
        titulo: 'Presupuesto bajo',
        mensaje: `Quedan \u20ac${presupuesto.toFixed(0)}. Gestiona bien tus recursos.`,
        icono: '\ud83d\udcb0'
      });
    }

    // --- Si no hay alertas negativas, todo OK ---
    if (alertas.every(a => a.tipo === 'success')) {
      alertas.push({
        id: 'todo-ok',
        tipo: 'success',
        titulo: 'Todo en orden',
        mensaje: 'Las condiciones del cultivo son favorables.',
        icono: '\u2600'
      });
    }

    return alertas;
  };

  const alertas = generarAlertas();
  const errores = alertas.filter(a => a.tipo === 'error').length;
  const avisos = alertas.filter(a => a.tipo === 'warning').length;

  return (
    <div className="notification-panel">
      <div className="notification-panel-header" onClick={() => setCollapsed(!collapsed)}>
        <div className="notification-panel-title">
          <span className="bell-icon">{errores > 0 ? '\ud83d\udd34' : avisos > 0 ? '\ud83d\udfe1' : '\ud83d\udfe2'}</span>
          <h3>Alertas del Cultivo</h3>
          <div className="alert-badges">
            {errores > 0 && <span className="alert-count alert-count-error">{errores}</span>}
            {avisos > 0 && <span className="alert-count alert-count-warning">{avisos}</span>}
          </div>
        </div>
        <button className="collapse-btn">{collapsed ? '\u25bc' : '\u25b2'}</button>
      </div>

      {!collapsed && (
        <div className="notification-panel-body">
          {alertas.map(alerta => (
            <div key={alerta.id} className={`alert-item alert-${alerta.tipo}`}>
              <span className="alert-icon">{alerta.icono}</span>
              <div className="alert-content">
                <div className="alert-titulo">{alerta.titulo}</div>
                <div className="alert-mensaje">{alerta.mensaje}</div>
              </div>
              <div className={`alert-indicator indicator-${alerta.tipo}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationPanel;

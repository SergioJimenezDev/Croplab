import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { EstadisticasEconomicas } from '../types';
import { simulacionService } from '../services/simulacionService';
import { Loading } from './common';
import './EconomyPanel.css';

interface EconomyPanelProps {
  simulacionId: number;
  presupuestoActual?: number;
  /** Cambia cada vez que avanza el día para forzar refresco de los datos económicos. */
  refreshKey?: number;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export const EconomyPanel: React.FC<EconomyPanelProps> = ({ simulacionId, presupuestoActual, refreshKey }) => {
  const [estadisticas, setEstadisticas] = useState<EstadisticasEconomicas | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadEconomyData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulacionId, refreshKey]);

  const loadEconomyData = async () => {
    try {
      const data = await simulacionService.obtenerEstadisticasEconomicas(simulacionId);
      setEstadisticas(data);
    } catch (error) {
      console.error('Error al cargar datos económicos:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <Loading text="Cargando datos económicos..." />;
  }

  if (!estadisticas) {
    return <div className="error-message">No se pudieron cargar los datos económicos</div>;
  }

  // Preparar datos para el gráfico de pastel
  const chartData = Object.entries(estadisticas.gastosPorCategoria)
    .filter(([_, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));

  const porcentajeGastado = (estadisticas.gastosTotales / estadisticas.presupuestoInicial) * 100;
  const balance = estadisticas.presupuestoActual - estadisticas.presupuestoInicial;

  return (
    <div className="economy-panel">
      <div className="economy-summary">
        <div className="economy-card presupuesto-card">
          <div className="economy-card-icon">💰</div>
          <div className="economy-card-content">
            <h3>Presupuesto Actual</h3>
            <p className="economy-value primary">€{estadisticas.presupuestoActual.toFixed(2)}</p>
            <p className="economy-subtext">
              Inicial: €{estadisticas.presupuestoInicial.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="economy-card gastos-card">
          <div className="economy-card-icon">📉</div>
          <div className="economy-card-content">
            <h3>Gastos Totales</h3>
            <p className="economy-value danger">€{estadisticas.gastosTotales.toFixed(2)}</p>
            <p className="economy-subtext">
              {porcentajeGastado.toFixed(1)}% del presupuesto
            </p>
          </div>
        </div>

        <div className="economy-card ingresos-card">
          <div className="economy-card-icon">📈</div>
          <div className="economy-card-content">
            <h3>Ingresos Estimados</h3>
            <p className="economy-value success">€{estadisticas.ingresosEstimados.toFixed(2)}</p>
            <p className="economy-subtext">Proyectados al final</p>
          </div>
        </div>

        <div className={`economy-card balance-card ${balance >= 0 ? 'positive' : 'negative'}`}>
          <div className="economy-card-icon">{balance >= 0 ? '✅' : '⚠️'}</div>
          <div className="economy-card-content">
            <h3>Balance</h3>
            <p className={`economy-value ${balance >= 0 ? 'success' : 'danger'}`}>
              €{balance.toFixed(2)}
            </p>
            <p className="economy-subtext">
              {balance >= 0 ? 'Superávit' : 'Déficit'}
            </p>
          </div>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="economy-chart-section">
          <h3>Distribución de Gastos</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `€${Number(value || 0).toFixed(2)}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="expenses-detail">
            <h4>Detalle de Gastos</h4>
            {Object.entries(estadisticas.gastosPorCategoria).map(([categoria, monto], index) => (
              monto > 0 && (
                <div key={categoria} className="expense-item">
                  <div className="expense-info">
                    <div
                      className="expense-color"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <span className="expense-category">{categoria}</span>
                  </div>
                  <span className="expense-amount">€{monto.toFixed(2)}</span>
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {presupuestoActual !== undefined && presupuestoActual < 500 && (
        <div className="economy-warning">
          ⚠️ <strong>Atención:</strong> Tu presupuesto está por debajo de €500.
          Planifica cuidadosamente tus próximas acciones.
        </div>
      )}

      {balance < -1000 && (
        <div className="economy-alert">
          🚨 <strong>Alerta:</strong> Estás operando con déficit.
          Los gastos superan significativamente al presupuesto inicial.
        </div>
      )}
    </div>
  );
};

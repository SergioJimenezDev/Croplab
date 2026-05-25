import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Loading } from '../components/common';
import { simulacionService } from '../services/simulacionService';
import { Resultado, Simulacion } from '../types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from 'recharts';
import './CompareSimulations.css';

// Workaround: Recharts types issue with React 19
const RPolarAngleAxis = PolarAngleAxis as any;
const RPolarRadiusAxis = PolarRadiusAxis as any;
const RPolarGrid = PolarGrid as any;
const RRadar = Radar as any;

interface ResultadoConNombre extends Resultado {
  nombreSimulacion: string;
  tipoCultivo: string;
}

const CompareSimulations: React.FC = () => {
  const navigate = useNavigate();
  const [resultados, setResultados] = useState<ResultadoConNombre[]>([]);
  const [simulaciones, setSimulaciones] = useState<Simulacion[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [sims, results] = await Promise.all([
        simulacionService.obtenerPorUsuario(),
        simulacionService.obtenerComparativa()
      ]);

      setSimulaciones(sims.filter(s => s.estado === 'completada'));

      const resultadosConNombre = results.map(r => {
        const sim = sims.find(s => s.idSimulacion === r.idSimulacion);
        return {
          ...r,
          nombreSimulacion: sim?.nombreSimulacion || `Sim #${r.idSimulacion}`,
          tipoCultivo: sim?.tipoCultivo || 'desconocido'
        };
      });

      setResultados(resultadosConNombre);
      if (resultadosConNombre.length >= 2) {
        setSelectedIds([resultadosConNombre[0].idSimulacion, resultadosConNombre[1].idSimulacion]);
      } else if (resultadosConNombre.length === 1) {
        setSelectedIds([resultadosConNombre[0].idSimulacion]);
      }
    } catch (error) {
      console.error('Error cargando datos:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelection = (id: number) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  const selected = resultados.filter(r => selectedIds.includes(r.idSimulacion));

  const COLORS = ['#2d8659', '#e67e22', '#3498db', '#9b59b6'];

  if (isLoading) return <Loading fullScreen text="Cargando resultados..." />;

  if (resultados.length === 0) {
    return (
      <div className="compare-page">
        <div className="compare-header">
          <Button variant="secondary" onClick={() => navigate('/dashboard')}>← Volver</Button>
          <h1>Comparativa de Simulaciones</h1>
        </div>
        <div className="compare-content">
          <Card>
            <p className="text-center" style={{ padding: '2rem' }}>
              No hay simulaciones completadas para comparar. Finaliza al menos una simulacion.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  // Datos para grafico de barras de rendimiento
  const rendimientoData = selected.map(r => ({
    nombre: r.nombreSimulacion.length > 15 ? r.nombreSimulacion.substring(0, 15) + '...' : r.nombreSimulacion,
    'Rendimiento (kg/ha)': Number(r.rendimientoKgHa),
    'Rendimiento Relativo (%)': Number(r.rendimientoRelativo)
  }));

  // Datos para grafico de barras economico
  const economiaData = selected.map(r => ({
    nombre: r.nombreSimulacion.length > 15 ? r.nombreSimulacion.substring(0, 15) + '...' : r.nombreSimulacion,
    Costes: Number(r.costeTotal),
    Ingresos: Number(r.ingresoEstimado),
    Beneficio: Number(r.beneficioNeto)
  }));

  // Datos para radar comparativo
  const radarData = [
    {
      metric: 'Rendimiento',
      ...Object.fromEntries(selected.map(r => [r.nombreSimulacion.substring(0, 12), Math.min(Number(r.rendimientoRelativo), 100)]))
    },
    {
      metric: 'Salud Final',
      ...Object.fromEntries(selected.map(r => {
        const sim = simulaciones.find(s => s.idSimulacion === r.idSimulacion);
        return [r.nombreSimulacion.substring(0, 12), sim ? Number(sim.saludActual) : 0];
      }))
    },
    {
      metric: 'Sin Estres Hidrico',
      ...Object.fromEntries(selected.map(r => {
        const total = r.diaFinalizacion || 1;
        return [r.nombreSimulacion.substring(0, 12), Math.max(0, 100 - ((r.diasEstresHidrico / total) * 100))];
      }))
    },
    {
      metric: 'Sin Estres Termico',
      ...Object.fromEntries(selected.map(r => {
        const total = r.diaFinalizacion || 1;
        return [r.nombreSimulacion.substring(0, 12), Math.max(0, 100 - ((r.diasEstresTermico / total) * 100))];
      }))
    },
    {
      metric: 'Rentabilidad',
      ...Object.fromEntries(selected.map(r => {
        const beneficio = Number(r.beneficioNeto);
        const coste = Number(r.costeTotal) || 1;
        return [r.nombreSimulacion.substring(0, 12), Math.max(0, Math.min(100, 50 + (beneficio / coste) * 50))];
      }))
    }
  ];

  // Datos para tabla de estres
  const estresData = selected.map(r => ({
    nombre: r.nombreSimulacion.length > 20 ? r.nombreSimulacion.substring(0, 20) + '...' : r.nombreSimulacion,
    'Estres Hidrico': r.diasEstresHidrico,
    'Estres Termico': r.diasEstresTermico,
    'Estres Nutricional': r.diasEstresNutricional
  }));

  return (
    <div className="compare-page">
      <div className="compare-header">
        <Button variant="secondary" onClick={() => navigate('/dashboard')}>← Volver</Button>
        <h1>Comparativa de Simulaciones</h1>
      </div>

      <div className="compare-content">
        {/* Selector */}
        <Card className="selector-card">
          <h3>Selecciona simulaciones a comparar (max. 4)</h3>
          <div className="sim-selector">
            {resultados.map(r => (
              <button
                key={r.idSimulacion}
                className={`sim-chip ${selectedIds.includes(r.idSimulacion) ? 'selected' : ''}`}
                onClick={() => toggleSelection(r.idSimulacion)}
              >
                <span className="chip-cultivo">{r.tipoCultivo}</span>
                <span className="chip-nombre">{r.nombreSimulacion}</span>
                <span className={`chip-estado chip-${r.estadoFinal}`}>{r.estadoFinal}</span>
              </button>
            ))}
          </div>
        </Card>

        {selected.length >= 2 && (
          <>
            {/* Tabla resumen */}
            <Card>
              <h3>Resumen Comparativo</h3>
              <div className="compare-table-wrapper">
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th>Metrica</th>
                      {selected.map((r, i) => (
                        <th key={r.idSimulacion} style={{ color: COLORS[i] }}>
                          {r.nombreSimulacion.length > 18 ? r.nombreSimulacion.substring(0, 18) + '...' : r.nombreSimulacion}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Estado Final</td>
                      {selected.map(r => (
                        <td key={r.idSimulacion}>
                          <span className={`badge-result badge-${r.estadoFinal}`}>{r.estadoFinal.replace('_', ' ')}</span>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>Dias Simulados</td>
                      {selected.map(r => <td key={r.idSimulacion}>{r.diaFinalizacion}</td>)}
                    </tr>
                    <tr>
                      <td>Rendimiento (kg/ha)</td>
                      {selected.map(r => <td key={r.idSimulacion}>{Number(r.rendimientoKgHa).toFixed(0)}</td>)}
                    </tr>
                    <tr>
                      <td>Rendimiento Relativo</td>
                      {selected.map(r => <td key={r.idSimulacion}>{Number(r.rendimientoRelativo).toFixed(1)}%</td>)}
                    </tr>
                    <tr>
                      <td>Calidad</td>
                      {selected.map(r => <td key={r.idSimulacion} className="capitalize">{r.calidadProducto}</td>)}
                    </tr>
                    <tr>
                      <td>Beneficio Neto</td>
                      {selected.map(r => (
                        <td key={r.idSimulacion} className={Number(r.beneficioNeto) >= 0 ? 'text-green' : 'text-red'}>
                          {Number(r.beneficioNeto).toFixed(2)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>Causa Principal</td>
                      {selected.map(r => <td key={r.idSimulacion} className="capitalize">{r.causaPrincipal.replace('_', ' ')}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Graficos */}
            <div className="compare-charts">
              <Card>
                <h3>Rendimiento Comparado</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={rendimientoData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="nombre" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Rendimiento (kg/ha)" fill="#2d8659" />
                    <Bar dataKey="Rendimiento Relativo (%)" fill="#e67e22" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <h3>Balance Economico</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={economiaData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="nombre" />
                    <YAxis />
                    <Tooltip formatter={(value) => `${Number(value).toFixed(2)}`} />
                    <Legend />
                    <Bar dataKey="Costes" fill="#e74c3c" />
                    <Bar dataKey="Ingresos" fill="#2ecc71" />
                    <Bar dataKey="Beneficio" fill="#3498db" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <h3>Radar de Rendimiento</h3>
                <ResponsiveContainer width="100%" height={350}>
                  <RadarChart data={radarData}>
                    <RPolarGrid />
                    <RPolarAngleAxis dataKey="metric" />
                    <RPolarRadiusAxis domain={[0, 100]} />
                    {selected.map((r, i) => (
                      <RRadar
                        key={r.idSimulacion}
                        name={r.nombreSimulacion.substring(0, 12)}
                        dataKey={r.nombreSimulacion.substring(0, 12)}
                        stroke={COLORS[i]}
                        fill={COLORS[i]}
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                    ))}
                    <Legend />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <h3>Dias de Estres Acumulados</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={estresData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="nombre" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Estres Hidrico" fill="#03a9f4" />
                    <Bar dataKey="Estres Termico" fill="#ff5722" />
                    <Bar dataKey="Estres Nutricional" fill="#ff9800" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          </>
        )}

        {selected.length < 2 && resultados.length >= 2 && (
          <Card>
            <p className="text-center" style={{ padding: '2rem' }}>
              Selecciona al menos 2 simulaciones para ver la comparativa.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
};

export default CompareSimulations;

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Card } from '../components/common';
import { simulacionService } from '../services/simulacionService';
import { CULTIVOS_CONFIG } from '../utils/cultivosData';
import {
  SimulacionFormData,
  TipoSuelo,
  Drenaje,
  CapacidadRetencionAgua,
  RegionClimatica,
  TipoCultivo,
  SistemaRiego
} from '../types';
import './SimulationWizard.css';

const SimulationWizard: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [formData, setFormData] = useState<Partial<SimulacionFormData>>({
    nombreSimulacion: '',
    superficieHectareas: 1,
    tipoSuelo: 'franco',
    phSuelo: 6.5,
    materiaOrganica: 2.5,
    drenaje: 'bueno',
    capacidadRetencionAgua: 'media',
    nitrogenoInicial: 100,
    fosforoInicial: 50,
    potasioInicial: 150,
    regionClimatica: 'mediterraneo',
    temperaturaMedia: 20,
    precipitacionAnual: 600,
    tipoCultivo: 'trigo',
    fechaSiembra: new Date().toISOString().split('T')[0],
    densidadSiembra: 350,
    sistemaRiego: 'goteo'
  });

  const totalSteps = 5;

  const handleInputChange = (field: keyof SimulacionFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        if (!formData.nombreSimulacion || formData.nombreSimulacion.trim() === '') {
          setError('El nombre de la simulación es requerido');
          return false;
        }
        if (!formData.superficieHectareas || formData.superficieHectareas < 0.01 || formData.superficieHectareas > 10) {
          setError('La superficie debe estar entre 0.01 y 10 hectáreas');
          return false;
        }
        break;
      case 2:
        if (!formData.phSuelo || formData.phSuelo < 4.5 || formData.phSuelo > 8.5) {
          setError('El pH debe estar entre 4.5 y 8.5');
          return false;
        }
        break;
      case 3:
        if (!formData.temperaturaMedia || formData.temperaturaMedia < -10 || formData.temperaturaMedia > 45) {
          setError('La temperatura debe estar entre -10 y 45 °C');
          return false;
        }
        if (!formData.precipitacionAnual || formData.precipitacionAnual < 0 || formData.precipitacionAnual > 3000) {
          setError('La precipitación debe estar entre 0 y 3000 mm');
          return false;
        }
        break;
      case 4:
        if (!formData.fechaSiembra) {
          setError('La fecha de siembra es requerida');
          return false;
        }
        if (!formData.densidadSiembra || formData.densidadSiembra <= 0) {
          setError('La densidad de siembra debe ser mayor a 0');
          return false;
        }
        break;
    }
    return true;
  };

  const nextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, totalSteps));
    }
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
    setError('');
  };

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) return;

    setLoading(true);
    setError('');

    try {
      const simulacionData = {
        ...formData,
        estado: 'en_curso' as const,
        diaActual: 1,
        etapaFenologica: 'germinacion' as const,
        saludActual: 100,
        alturaActual: 0,
        humedadSueloActual: 50
      };

      const nuevaSimulacion = await simulacionService.crear(simulacionData as any);
      navigate(`/simulation/${nuevaSimulacion.idSimulacion}`);
    } catch (err: any) {
      setError(err.message || 'Error al crear la simulación');
    } finally {
      setLoading(false);
    }
  };

  const renderStepIndicator = () => (
    <div className="step-indicator">
      {[1, 2, 3, 4, 5].map(step => (
        <div
          key={step}
          className={`step ${currentStep === step ? 'active' : ''} ${currentStep > step ? 'completed' : ''}`}
        >
          <div className="step-number">{step}</div>
          <div className="step-label">
            {step === 1 && 'Básico'}
            {step === 2 && 'Suelo'}
            {step === 3 && 'Clima'}
            {step === 4 && 'Cultivo'}
            {step === 5 && 'Revisión'}
          </div>
        </div>
      ))}
    </div>
  );

  const renderStep1 = () => (
    <div className="wizard-step">
      <h2>Información Básica</h2>
      <p className="step-description">Configure los parámetros básicos de su simulación</p>

      <Input
        label="Nombre de la Simulación"
        type="text"
        value={formData.nombreSimulacion}
        onChange={(e) => handleInputChange('nombreSimulacion', e.target.value)}
        placeholder="Ej: Cultivo de Trigo Invierno 2025"
        fullWidth
      />

      <Input
        label="Superficie (hectáreas)"
        type="number"
        value={formData.superficieHectareas}
        onChange={(e) => handleInputChange('superficieHectareas', parseFloat(e.target.value))}
        min="0.01"
        max="10"
        step="0.01"
        helpText="Entre 0.01 y 10 hectáreas"
        fullWidth
      />
    </div>
  );

  const renderStep2 = () => (
    <div className="wizard-step">
      <h2>Configuración del Suelo</h2>
      <p className="step-description">Defina las características del terreno</p>

      <div className="form-group">
        <label>Tipo de Suelo</label>
        <select
          value={formData.tipoSuelo}
          onChange={(e) => handleInputChange('tipoSuelo', e.target.value as TipoSuelo)}
          className="select-input"
        >
          <option value="arenoso">Arenoso</option>
          <option value="franco_arenoso">Franco Arenoso</option>
          <option value="franco">Franco</option>
          <option value="franco_arcilloso">Franco Arcilloso</option>
          <option value="arcilloso">Arcilloso</option>
        </select>
      </div>

      <Input
        label="pH del Suelo"
        type="number"
        value={formData.phSuelo}
        onChange={(e) => handleInputChange('phSuelo', parseFloat(e.target.value))}
        min="4.5"
        max="8.5"
        step="0.1"
        helpText="Entre 4.5 y 8.5"
        fullWidth
      />

      <Input
        label="Materia Orgánica (%)"
        type="number"
        value={formData.materiaOrganica}
        onChange={(e) => handleInputChange('materiaOrganica', parseFloat(e.target.value))}
        min="0"
        max="10"
        step="0.1"
        helpText="Porcentaje de materia orgánica en el suelo"
        fullWidth
      />

      <div className="form-group">
        <label>Drenaje</label>
        <select
          value={formData.drenaje}
          onChange={(e) => handleInputChange('drenaje', e.target.value as Drenaje)}
          className="select-input"
        >
          <option value="malo">Malo</option>
          <option value="regular">Regular</option>
          <option value="bueno">Bueno</option>
          <option value="excelente">Excelente</option>
        </select>
      </div>

      <div className="form-group">
        <label>Capacidad de Retención de Agua</label>
        <select
          value={formData.capacidadRetencionAgua}
          onChange={(e) => handleInputChange('capacidadRetencionAgua', e.target.value as CapacidadRetencionAgua)}
          className="select-input"
        >
          <option value="baja">Baja</option>
          <option value="media">Media</option>
          <option value="alta">Alta</option>
        </select>
      </div>

      <h3>Nutrientes Iniciales (kg/ha)</h3>
      <div className="nutrient-inputs">
        <Input
          label="Nitrógeno (N)"
          type="number"
          value={formData.nitrogenoInicial}
          onChange={(e) => handleInputChange('nitrogenoInicial', parseFloat(e.target.value))}
          min="0"
          step="10"
          fullWidth
        />

        <Input
          label="Fósforo (P)"
          type="number"
          value={formData.fosforoInicial}
          onChange={(e) => handleInputChange('fosforoInicial', parseFloat(e.target.value))}
          min="0"
          step="5"
          fullWidth
        />

        <Input
          label="Potasio (K)"
          type="number"
          value={formData.potasioInicial}
          onChange={(e) => handleInputChange('potasioInicial', parseFloat(e.target.value))}
          min="0"
          step="10"
          fullWidth
        />
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="wizard-step">
      <h2>Configuración Climática</h2>
      <p className="step-description">Establezca las condiciones climáticas de la región</p>

      <div className="form-group">
        <label>Región Climática</label>
        <select
          value={formData.regionClimatica}
          onChange={(e) => handleInputChange('regionClimatica', e.target.value as RegionClimatica)}
          className="select-input"
        >
          <option value="mediterraneo">Mediterráneo</option>
          <option value="continental">Continental</option>
          <option value="atlantico">Atlántico</option>
          <option value="subtropical">Subtropical</option>
        </select>
      </div>

      <Input
        label="Temperatura Media (°C)"
        type="number"
        value={formData.temperaturaMedia}
        onChange={(e) => handleInputChange('temperaturaMedia', parseFloat(e.target.value))}
        min="-10"
        max="45"
        step="0.5"
        helpText="Temperatura promedio anual en la región"
        fullWidth
      />

      <Input
        label="Precipitación Anual (mm)"
        type="number"
        value={formData.precipitacionAnual}
        onChange={(e) => handleInputChange('precipitacionAnual', parseFloat(e.target.value))}
        min="0"
        max="3000"
        step="10"
        helpText="Precipitación total anual esperada"
        fullWidth
      />
    </div>
  );

  const renderStep4 = () => {
    const cultivoSeleccionado = formData.tipoCultivo ? CULTIVOS_CONFIG[formData.tipoCultivo] : null;

    return (
      <div className="wizard-step">
        <h2>Selección de Cultivo</h2>
        <p className="step-description">Elija el cultivo y configure los parámetros de siembra</p>

        <div className="form-group">
          <label>Tipo de Cultivo</label>
          <select
            value={formData.tipoCultivo}
            onChange={(e) => handleInputChange('tipoCultivo', e.target.value as TipoCultivo)}
            className="select-input"
          >
            <optgroup label="Cereales">
              <option value="trigo">Trigo</option>
              <option value="maiz">Maíz</option>
              <option value="arroz">Arroz</option>
              <option value="cebada">Cebada</option>
            </optgroup>
            <optgroup label="Hortalizas">
              <option value="tomate">Tomate</option>
              <option value="lechuga">Lechuga</option>
              <option value="pimiento">Pimiento</option>
              <option value="zanahoria">Zanahoria</option>
            </optgroup>
            <optgroup label="Leguminosas">
              <option value="judia">Judía</option>
              <option value="guisante">Guisante</option>
              <option value="soja">Soja</option>
            </optgroup>
            <optgroup label="Industriales">
              <option value="girasol">Girasol</option>
              <option value="colza">Colza</option>
              <option value="vid">Vid</option>
              <option value="olivo">Olivo</option>
            </optgroup>
          </select>
        </div>

        {cultivoSeleccionado && (
          <Card className="cultivo-info">
            <h3>{cultivoSeleccionado.nombre}</h3>
            <p><em>{cultivoSeleccionado.nombreCientifico}</em></p>
            <p>{cultivoSeleccionado.descripcion}</p>
            <div className="cultivo-stats">
              <div className="stat">
                <strong>Ciclo:</strong> {cultivoSeleccionado.cicloVidaDias} días
              </div>
              <div className="stat">
                <strong>Temp. óptima:</strong> {cultivoSeleccionado.temperaturaOptima.min}°C - {cultivoSeleccionado.temperaturaOptima.max}°C
              </div>
              <div className="stat">
                <strong>pH óptimo:</strong> {cultivoSeleccionado.phOptimo.min} - {cultivoSeleccionado.phOptimo.max}
              </div>
              <div className="stat">
                <strong>Rendimiento esperado:</strong> {cultivoSeleccionado.rendimientoEsperado} kg/ha
              </div>
            </div>
          </Card>
        )}

        <Input
          label="Fecha de Siembra"
          type="date"
          value={typeof formData.fechaSiembra === 'string' ? formData.fechaSiembra : formData.fechaSiembra?.toISOString().split('T')[0]}
          onChange={(e) => handleInputChange('fechaSiembra', e.target.value)}
          fullWidth
        />

        <Input
          label="Densidad de Siembra"
          type="number"
          value={formData.densidadSiembra}
          onChange={(e) => handleInputChange('densidadSiembra', parseFloat(e.target.value))}
          min="1"
          step="1"
          helpText={cultivoSeleccionado ? `Recomendado: ${cultivoSeleccionado.densidadRecomendada}` : ''}
          fullWidth
        />

        <div className="form-group">
          <label>Sistema de Riego</label>
          <select
            value={formData.sistemaRiego}
            onChange={(e) => handleInputChange('sistemaRiego', e.target.value as SistemaRiego)}
            className="select-input"
          >
            <option value="ninguno">Sin riego (Secano)</option>
            <option value="goteo">Goteo</option>
            <option value="aspersion">Aspersión</option>
            <option value="inundacion">Inundación</option>
          </select>
        </div>
      </div>
    );
  };

  const renderStep5 = () => (
    <div className="wizard-step">
      <h2>Revisión y Confirmación</h2>
      <p className="step-description">Revise la configuración antes de crear la simulación</p>

      <div className="review-section">
        <Card>
          <h3>Información Básica</h3>
          <div className="review-item">
            <span className="label">Nombre:</span>
            <span className="value">{formData.nombreSimulacion}</span>
          </div>
          <div className="review-item">
            <span className="label">Superficie:</span>
            <span className="value">{formData.superficieHectareas} ha</span>
          </div>
        </Card>

        <Card>
          <h3>Suelo</h3>
          <div className="review-item">
            <span className="label">Tipo:</span>
            <span className="value">{formData.tipoSuelo?.replace('_', ' ')}</span>
          </div>
          <div className="review-item">
            <span className="label">pH:</span>
            <span className="value">{formData.phSuelo}</span>
          </div>
          <div className="review-item">
            <span className="label">Drenaje:</span>
            <span className="value">{formData.drenaje}</span>
          </div>
          <div className="review-item">
            <span className="label">Nutrientes (N-P-K):</span>
            <span className="value">
              {formData.nitrogenoInicial}-{formData.fosforoInicial}-{formData.potasioInicial} kg/ha
            </span>
          </div>
        </Card>

        <Card>
          <h3>Clima</h3>
          <div className="review-item">
            <span className="label">Región:</span>
            <span className="value">{formData.regionClimatica}</span>
          </div>
          <div className="review-item">
            <span className="label">Temperatura media:</span>
            <span className="value">{formData.temperaturaMedia}°C</span>
          </div>
          <div className="review-item">
            <span className="label">Precipitación anual:</span>
            <span className="value">{formData.precipitacionAnual} mm</span>
          </div>
        </Card>

        <Card>
          <h3>Cultivo</h3>
          <div className="review-item">
            <span className="label">Tipo:</span>
            <span className="value">{formData.tipoCultivo && CULTIVOS_CONFIG[formData.tipoCultivo]?.nombre}</span>
          </div>
          <div className="review-item">
            <span className="label">Fecha de siembra:</span>
            <span className="value">{typeof formData.fechaSiembra === 'string' ? formData.fechaSiembra : formData.fechaSiembra?.toISOString().split('T')[0]}</span>
          </div>
          <div className="review-item">
            <span className="label">Densidad:</span>
            <span className="value">{formData.densidadSiembra}</span>
          </div>
          <div className="review-item">
            <span className="label">Sistema de riego:</span>
            <span className="value">{formData.sistemaRiego}</span>
          </div>
        </Card>
      </div>
    </div>
  );

  return (
    <div className="simulation-wizard">
      <div className="wizard-header">
        <h1>Crear Nueva Simulación</h1>
        {renderStepIndicator()}
      </div>

      <div className="wizard-content">
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
        {currentStep === 5 && renderStep5()}

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
      </div>

      <div className="wizard-footer">
        <Button
          onClick={() => navigate('/dashboard')}
          variant="secondary"
        >
          Cancelar
        </Button>

        <div className="footer-actions">
          {currentStep > 1 && (
            <Button
              onClick={prevStep}
              variant="secondary"
            >
              Anterior
            </Button>
          )}

          {currentStep < totalSteps ? (
            <Button onClick={nextStep}>
              Siguiente
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Creando...' : 'Crear Simulación'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SimulationWizard;

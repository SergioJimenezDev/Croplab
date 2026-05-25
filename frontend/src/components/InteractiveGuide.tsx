import React, { useState, useEffect } from 'react';
import './InteractiveGuide.css';

interface GuideStep {
  title: string;
  description: string;
  target: string; // tab name or section
  icon: string;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    title: 'Panel de Alertas',
    description: 'Aqui veras el estado de tu cultivo con colores: verde (todo bien), amarillo (precaucion) y rojo (accion urgente). Revisa las alertas tras cada dia avanzado.',
    target: 'overview',
    icon: '\ud83d\udea6'
  },
  {
    title: 'Resumen del Cultivo',
    description: 'La pestana Resumen muestra la salud, altura, humedad del suelo, etapa fenologica y progreso del ciclo de tu cultivo. El circulo de salud cambia de color segun el estado.',
    target: 'overview',
    icon: '\ud83c\udf31'
  },
  {
    title: 'Graficos de Evolucion',
    description: 'En la pestana Graficos puedes ver la evolucion temporal de salud, crecimiento, humedad, temperatura, precipitaciones y consumo de recursos dia a dia.',
    target: 'charts',
    icon: '\ud83d\udcca'
  },
  {
    title: 'Registro de Eventos',
    description: 'La pestana Eventos muestra todo lo que ha ocurrido: riegos, fertilizaciones, plagas, heladas... Cada evento indica su impacto y coste. Los eventos del sistema son automaticos.',
    target: 'events',
    icon: '\ud83d\udcc5'
  },
  {
    title: 'Economia y Presupuesto',
    description: 'En Economia veras tus gastos desglosados, presupuesto restante e ingresos estimados. Cuidado: si te quedas sin presupuesto no podras aplicar acciones.',
    target: 'economy',
    icon: '\ud83d\udcb0'
  },
  {
    title: 'Acciones Disponibles',
    description: 'Desde la pestana Acciones puedes: avanzar dias (1, 7 o 30), aplicar eventos manuales (riego, fertilizacion, tratamientos) y finalizar la simulacion cuando quieras ver los resultados.',
    target: 'actions',
    icon: '\u26a1'
  },
  {
    title: 'Consejos para Empezar',
    description: 'Avanza unos dias, revisa las alertas, riega cuando la humedad baje del 35%, fertiliza cada 15 dias y trata las plagas rapidamente. Al finalizar, compara resultados con otras simulaciones.',
    target: 'overview',
    icon: '\ud83d\udca1'
  }
];

const STORAGE_KEY = 'croplab_guide_dismissed';

interface InteractiveGuideProps {
  onTabChange?: (tab: string) => void;
}

const InteractiveGuide: React.FC<InteractiveGuideProps> = ({ onTabChange }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, 'true');
  };

  const next = () => {
    if (currentStep < GUIDE_STEPS.length - 1) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      if (onTabChange) {
        onTabChange(GUIDE_STEPS[nextStep].target);
      }
    } else {
      dismiss();
    }
  };

  const prev = () => {
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      if (onTabChange) {
        onTabChange(GUIDE_STEPS[prevStep].target);
      }
    }
  };

  const reopen = () => {
    setCurrentStep(0);
    setVisible(true);
    if (onTabChange) {
      onTabChange(GUIDE_STEPS[0].target);
    }
  };

  if (!visible) {
    return (
      <button className="guide-reopen-btn" onClick={reopen} title="Abrir guia interactiva">
        ?
      </button>
    );
  }

  const step = GUIDE_STEPS[currentStep];

  return (
    <div className="guide-overlay">
      <div className="guide-modal">
        <div className="guide-progress">
          {GUIDE_STEPS.map((_, i) => (
            <div key={i} className={`guide-dot ${i === currentStep ? 'active' : i < currentStep ? 'done' : ''}`} />
          ))}
        </div>

        <div className="guide-icon">{step.icon}</div>
        <h3 className="guide-title">{step.title}</h3>
        <p className="guide-description">{step.description}</p>

        <div className="guide-step-info">
          Paso {currentStep + 1} de {GUIDE_STEPS.length}
        </div>

        <div className="guide-actions">
          <button className="guide-btn guide-skip" onClick={dismiss}>
            Saltar guia
          </button>
          <div className="guide-nav">
            {currentStep > 0 && (
              <button className="guide-btn guide-prev" onClick={prev}>
                Anterior
              </button>
            )}
            <button className="guide-btn guide-next" onClick={next}>
              {currentStep < GUIDE_STEPS.length - 1 ? 'Siguiente' : 'Comenzar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InteractiveGuide;

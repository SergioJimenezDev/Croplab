import React from 'react';
import './Loading.css';

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg';
  fullScreen?: boolean;
  text?: string;
}

const Loading: React.FC<LoadingProps> = ({
  size = 'md',
  fullScreen = false,
  text = 'Cargando...'
}) => {
  if (fullScreen) {
    return (
      <div className="loading-fullscreen">
        <div className="loading-content">
          <div className={`loading-spinner loading-spinner-${size}`}></div>
          {text && <p className="loading-text">{text}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="loading-inline">
      <div className={`loading-spinner loading-spinner-${size}`}></div>
      {text && <span className="loading-text">{text}</span>}
    </div>
  );
};

export default Loading;

import React, { InputHTMLAttributes, forwardRef } from 'react';
import './Input.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  helpText,
  fullWidth = false,
  icon,
  className = '',
  id,
  ...props
}, ref) => {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

  const wrapperClasses = [
    'input-wrapper',
    fullWidth && 'input-full-width',
    error && 'input-error-wrapper'
  ].filter(Boolean).join(' ');

  const inputClasses = [
    'input',
    icon && 'input-with-icon',
    error && 'input-error',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapperClasses}>
      {label && (
        <label htmlFor={inputId} className="input-label">
          {label}
        </label>
      )}
      <div className="input-container">
        {icon && <span className="input-icon">{icon}</span>}
        <input
          ref={ref}
          id={inputId}
          className={inputClasses}
          {...props}
        />
      </div>
      {error && <span className="input-error-message">{error}</span>}
      {helpText && !error && <span className="input-help-text">{helpText}</span>}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;

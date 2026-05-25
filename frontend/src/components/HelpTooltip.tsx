import React, { useState } from 'react';
import './HelpTooltip.css';

interface HelpTooltipProps {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  children?: React.ReactNode;
}

const HelpTooltip: React.FC<HelpTooltipProps> = ({ text, position = 'top', children }) => {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="help-tooltip-wrapper"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children || <span className="help-tooltip-icon">?</span>}
      {visible && (
        <span className={`help-tooltip-bubble tooltip-${position}`}>
          {text}
        </span>
      )}
    </span>
  );
};

export default HelpTooltip;

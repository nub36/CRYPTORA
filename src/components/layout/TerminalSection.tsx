import React from 'react';

interface TerminalSectionProps {
  children: React.ReactNode;
  className?: string;
  label?: string;
  title?: string;
  meta?: React.ReactNode;
  as?: 'section' | 'div';
}

/** Presentation-only boundary for a meaningful workstation region. */
export const TerminalSection: React.FC<TerminalSectionProps> = ({
  children, className = '', label, title, meta, as: Element = 'section',
}) => (
  <Element className={`terminal-region ${className}`}>
    {(label || title || meta) && (
      <header className="terminal-region__header">
        <div>{label && <span className="eyebrow">{label}</span>}{title && <h2 className="terminal-region__title">{title}</h2>}</div>
        {meta && <div className="terminal-region__meta">{meta}</div>}
      </header>
    )}
    {children}
  </Element>
);

export const MetricStrip: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`metric-strip ${className}`}>{children}</div>
);

export default TerminalSection;

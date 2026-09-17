import React from 'react';
import { Link } from 'react-router-dom';
import { Compass, ChevronLeft } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 font-mono">
      <div className="p-4 rounded-full bg-surface border border-surface-border mb-4">
        <Compass className="w-8 h-8 text-brand-cyan" />
      </div>
      <h1 className="text-3xl font-black text-white mb-2">404</h1>
      <p className="text-sm text-slate-400 max-w-md mb-6 font-sans">
        Запрашиваемый раздел или актив не найден в структуре терминала CRYPTORA.
      </p>
      <Link
        to="/"
        className="px-4 py-2 bg-brand-cyan hover:bg-sky-500 text-slate-950 font-semibold text-xs rounded flex items-center space-x-1.5 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Вернуться на Главный Обзор</span>
      </Link>
    </div>
  );
};

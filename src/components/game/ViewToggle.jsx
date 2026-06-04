import React from 'react';
import { Eye } from 'lucide-react';

export default function ViewToggle({ view, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="absolute top-16 right-4 z-30 flex items-center gap-2 px-3 py-2
                 bg-black/70 backdrop-blur-md border border-white/10 rounded-lg
                 text-white/70 hover:text-white hover:border-white/20 transition-all font-orbitron text-xs"
    >
      <Eye size={14} />
      <span className="hidden sm:inline">{view === 'first' ? '1ST' : '3RD'}</span>
    </button>
  );
}
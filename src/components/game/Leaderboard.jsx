import React, { useState } from 'react';

export default function Leaderboard({ entries, visible, onSpectate, spectatingId }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!visible) return null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 min-w-[220px]">
      <div className="bg-black/80 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden shadow-2xl">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-full px-4 py-2 border-b border-white/10 flex items-center gap-2 hover:bg-white/5 transition-colors"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-orbitron text-white/60 uppercase tracking-widest flex-1 text-left">
            Leaderboard
          </span>
          <span className="text-white/30 text-[10px]">{collapsed ? '▼' : '▲'}</span>
        </button>
        {!collapsed && (
          <div className="py-1">
            {entries.map((entry, idx) => (
              <div
                key={entry.id}
                onClick={() => !entry.isPlayer && onSpectate && onSpectate(entry)}
                className={`flex items-center gap-3 px-4 py-1.5 transition-colors
                  ${entry.isPlayer ? 'bg-white/5' : 'hover:bg-white/10 cursor-pointer'}
                  ${!entry.isPlayer && spectatingId === entry.id ? 'bg-white/10' : ''}`}
              >
                <span className={`text-[11px] font-orbitron font-bold w-4 text-right
                  ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-amber-600' : 'text-white/40'}`}>
                  {idx + 1}
                </span>
                <div className="w-2 h-2 rounded-full flex-shrink-0 transition-all"
                  style={{ background: entry.colorHex, boxShadow: !entry.isPlayer && spectatingId === entry.id ? `0 0 6px ${entry.colorHex}` : 'none' }} />
                <span className={`text-[11px] font-orbitron flex-1 ${entry.isPlayer ? 'text-white' : spectatingId === entry.id ? 'text-white' : 'text-white/70'}`}>
                  {entry.isPlayer ? 'YOU' : entry.name}
                </span>
                <span className="text-[10px] font-orbitron text-white/40 tabular-nums">
                  L{entry.lap}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
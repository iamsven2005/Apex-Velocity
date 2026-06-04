import React from 'react';

export default function HUD({ speed, gear, lap, bestLap, currentLapTime, rpm, fuel, inPit, onWatchReplay }) {
  const speedKmh = Math.round(speed * 3.6);
  const rpmPercent = Math.min((rpm / 18000) * 100, 100);
  const fuelPct = Math.max(0, Math.min(100, fuel));
  
  const formatTime = (ms) => {
    if (!ms || ms === Infinity) return '--:--.---';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const millis = Math.floor(ms % 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
      {/* RPM Bar */}
      <div className="mx-auto max-w-2xl px-6">
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-1">
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${rpmPercent}%`,
              background: rpmPercent > 85
                ? 'linear-gradient(90deg, #22c55e, #eab308, #ef4444)'
                : rpmPercent > 60
                  ? 'linear-gradient(90deg, #22c55e, #eab308)'
                  : '#22c55e'
            }}
          />
        </div>
      </div>

      {/* Main HUD */}
      <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-8 pb-4 px-4">
        <div className="max-w-4xl mx-auto flex items-end justify-between">
          {/* Lap Info */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-orbitron text-white/40 uppercase tracking-wider">Lap</span>
              <span className="text-lg font-orbitron font-bold text-white">{lap}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-orbitron text-white/30 uppercase w-12">Current</span>
                <span className="text-xs font-orbitron text-white/80 tabular-nums">{formatTime(currentLapTime)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-orbitron text-white/30 uppercase w-12">Best</span>
                <span className="text-xs font-orbitron text-accent tabular-nums">{formatTime(bestLap)}</span>
              </div>
            </div>
          </div>

          {/* Speed & Gear - Center */}
          <div className="flex flex-col items-center">
            <div className="text-6xl font-orbitron font-black text-white tabular-nums leading-none">
              {speedKmh}
            </div>
            <div className="text-[10px] font-orbitron text-white/40 uppercase tracking-[0.3em] mt-1">km/h</div>
            <div className="mt-2 flex items-center gap-1">
              <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-orbitron font-bold transition-all duration-100
                ${gear === -1 ? 'bg-accent text-black shadow-lg shadow-accent/30' : 'bg-white/5 text-white/20'}`}>
                R
              </div>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(g => (
                <div
                  key={g}
                  className={`w-6 h-6 rounded flex items-center justify-center text-xs font-orbitron font-bold transition-all duration-100
                    ${g === gear
                      ? 'bg-primary text-white shadow-lg shadow-primary/30'
                      : 'bg-white/5 text-white/20'
                    }`}
                >
                  {g}
                </div>
              ))}
            </div>
          </div>

          {/* Fuel */}
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-orbitron text-white/40 uppercase tracking-wider">Fuel</span>
              <span className={`text-sm font-orbitron font-bold tabular-nums ${fuelPct < 20 ? 'text-red-400' : fuelPct < 40 ? 'text-yellow-400' : 'text-white'}`}>
                {Math.round(fuelPct)}%
              </span>
            </div>
            <div className="w-24 h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${fuelPct}%`,
                  background: fuelPct < 20 ? '#ef4444' : fuelPct < 40 ? '#eab308' : '#22c55e'
                }}
              />
            </div>
            {inPit && (
              <span className="text-[10px] font-orbitron text-green-400 animate-pulse uppercase tracking-widest">⛽ Refuelling</span>
            )}
            {!inPit && fuelPct < 20 && (
              <span className="text-[10px] font-orbitron text-red-400 animate-pulse uppercase tracking-widest">⚠ Low Fuel</span>
            )}
            <div className="flex flex-col items-end gap-0.5 text-[9px] font-inter text-white/25 mt-1">
              <span>W / ↑ — Accelerate</span>
              <span>S / ↓ — Brake</span>
              <span>A D — Steer</span>
              <span>R — Reset</span>
            </div>
            {onWatchReplay && (
              <button
                onClick={onWatchReplay}
                className="pointer-events-auto mt-2 px-3 py-1.5 bg-white/5 hover:bg-white/10
                           border border-white/10 hover:border-white/25 rounded
                           text-[10px] font-orbitron text-white/60 hover:text-white
                           transition-all uppercase tracking-widest"
              >
                ▶ Watch Replay
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
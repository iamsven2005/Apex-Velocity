import React, { useState } from 'react';
import { Settings, X, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const DEFAULT_SETTINGS = {
  acceleration: 35,
  topSpeed: 90,
  braking: 55,
  steering: 2.2,
  grip: 1.0,
};

const PRESETS = {
  'Beginner': { acceleration: 28, topSpeed: 65, braking: 70, steering: 1.8, grip: 1.2 },
  'F1 2024':  { acceleration: 35, topSpeed: 90, braking: 55, steering: 2.2, grip: 1.0 },
  'Arcade':   { acceleration: 50, topSpeed: 80, braking: 80, steering: 3.0, grip: 0.8 },
  'Beast':    { acceleration: 60, topSpeed: 120, braking: 45, steering: 2.6, grip: 0.85 },
};

const sliders = [
  { key: 'acceleration', label: 'Acceleration', min: 10, max: 80, unit: '', color: '#22c55e' },
  { key: 'topSpeed',     label: 'Top Speed',    min: 40, max: 130, unit: ' m/s', color: '#3b82f6' },
  { key: 'braking',      label: 'Braking',      min: 20, max: 100, unit: '', color: '#ef4444' },
  { key: 'steering',     label: 'Steering',     min: 0.8, max: 4.0, unit: '', color: '#f59e0b', step: 0.1 },
  { key: 'grip',         label: 'Grip',         min: 0.5, max: 1.5, unit: '', color: '#a855f7', step: 0.05 },
];

export default function SettingsMenu({ settings, onSettingsChange }) {
  const [open, setOpen] = useState(false);

  const handleSlider = (key, val) => {
    onSettingsChange({ ...settings, [key]: parseFloat(val) });
  };

  const applyPreset = (preset) => {
    onSettingsChange({ ...PRESETS[preset] });
  };

  const reset = () => onSettingsChange({ ...DEFAULT_SETTINGS });

  return (
    <div className="absolute top-4 right-4 z-30">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 bg-black/70 backdrop-blur-md border border-white/10 rounded-lg
                   text-white/70 hover:text-white hover:border-white/20 transition-all font-orbitron text-xs"
      >
        <Settings size={14} />
        <span className="hidden sm:inline">SETTINGS</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute top-12 right-0 w-72 bg-black/85 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <span className="font-orbitron text-xs text-white tracking-widest">CAR SETUP</span>
              <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>

            {/* Presets */}
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-[10px] font-orbitron text-white/30 uppercase tracking-wider mb-2">Presets</p>
              <div className="grid grid-cols-4 gap-1">
                {Object.keys(PRESETS).map(name => (
                  <button
                    key={name}
                    onClick={() => applyPreset(name)}
                    className="py-1.5 text-[10px] font-orbitron text-white/60 hover:text-white
                               bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15
                               rounded transition-all truncate px-1"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Sliders */}
            <div className="px-4 py-3 space-y-4">
              {sliders.map(({ key, label, min, max, unit, color, step = 1 }) => {
                const val = settings[key];
                const pct = ((val - min) / (max - min)) * 100;
                return (
                  <div key={key}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[11px] font-orbitron text-white/60">{label}</span>
                      <span className="text-[11px] font-orbitron tabular-nums" style={{ color }}>
                        {typeof val === 'number' ? (step < 1 ? val.toFixed(step === 0.05 ? 2 : 1) : Math.round(val)) : val}{unit}
                      </span>
                    </div>
                    <div className="relative h-1.5 bg-white/10 rounded-full">
                      <div
                        className="absolute left-0 top-0 h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: color }}
                      />
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={val}
                        onChange={e => handleSlider(key, e.target.value)}
                        className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reset */}
            <div className="px-4 py-3 border-t border-white/10">
              <button
                onClick={reset}
                className="w-full flex items-center justify-center gap-2 py-2 text-[11px] font-orbitron text-white/40
                           hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10
                           rounded-lg transition-all"
              >
                <RotateCcw size={11} />
                Reset to Default
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { DEFAULT_SETTINGS };
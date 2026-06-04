import React, { useEffect, useRef } from 'react';

/**
 * Full-screen replay overlay.
 * Drives playback externally via the `replayState` ref object passed from RacingScene.
 * Renders progress bar, playback controls, and frame counter.
 */
export default function ReplayOverlay({ replayState, onExit }) {
  const progressRef = useRef(null);

  // Sync progress bar width to replayState.progress
  useEffect(() => {
    let raf;
    const tick = () => {
      if (progressRef.current && replayState) {
        const pct = Math.min(100, (replayState.frameIndex / Math.max(1, replayState.totalFrames - 1)) * 100);
        progressRef.current.style.width = `${pct}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replayState]);

  const formatTime = (frameIndex, fps = 30) => {
    const s = Math.floor(frameIndex / fps);
    const ms = Math.floor((frameIndex / fps - s) * 10);
    return `${s}.${ms}s`;
  };

  return (
    <div className="absolute inset-0 z-50 pointer-events-none">
      {/* Top banner */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-3
                      bg-gradient-to-b from-black/80 to-transparent pointer-events-auto">
        <div className="flex items-center gap-3">
          {/* Animated REC-style indicator */}
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <span className="font-orbitron text-xs text-white/70 uppercase tracking-widest">Replay</span>
          <span className="font-orbitron text-xs text-white/40">
            Last Lap
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Speed control */}
          <button
            className="font-orbitron text-[10px] text-white/50 hover:text-white transition-colors px-2 py-1 border border-white/10 rounded hover:border-white/30"
            onClick={() => {
              if (replayState) replayState.speed = replayState.speed === 2 ? 0.5 : replayState.speed === 0.5 ? 1 : 2;
            }}
          >
            {replayState?.speed === 2 ? '2×' : replayState?.speed === 0.5 ? '½×' : '1×'}
          </button>

          {/* Exit */}
          <button
            className="font-orbitron text-[10px] text-white/70 hover:text-white transition-colors
                       px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/30 rounded"
            onClick={onExit}
          >
            ✕ EXIT REPLAY
          </button>
        </div>
      </div>

      {/* Bottom progress bar */}
      <div className="absolute bottom-0 left-0 right-0 px-6 pb-5 pointer-events-auto">
        <div className="flex items-center gap-3 mb-2">
          <span className="font-orbitron text-[10px] text-white/30 tabular-nums min-w-[3rem]">
            {replayState ? formatTime(replayState.frameIndex) : '0.0s'}
          </span>
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              ref={progressRef}
              className="h-full bg-primary rounded-full transition-none"
              style={{ width: '0%' }}
            />
          </div>
          <span className="font-orbitron text-[10px] text-white/30 tabular-nums min-w-[3rem] text-right">
            {replayState ? formatTime(replayState.totalFrames) : '0.0s'}
          </span>
        </div>

        {/* Camera cut indicator */}
        <div className="text-center">
          <span className="font-orbitron text-[9px] text-white/20 uppercase tracking-widest">
            Cinematic Camera
          </span>
        </div>
      </div>
    </div>
  );
}
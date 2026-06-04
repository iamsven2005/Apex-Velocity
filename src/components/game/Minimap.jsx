import React, { useRef, useEffect, useState } from 'react';
import { TRACK_POINTS, TRACK_WIDTH } from './trackData';

export default function Minimap({ carX, carZ, carAngle, aiDrivers = [], onSpectate, spectatingId }) {
  const canvasRef = useRef(null);
  const [hidden, setHidden] = useState(false);
  // Store canvas-space positions of AI dots for click detection
  const aiCanvasPositionsRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    TRACK_POINTS.forEach(p => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    });

    const padding = 25;
    const scaleX = (w - padding * 2) / (maxX - minX);
    const scaleZ = (h - padding * 2) / (maxZ - minZ);
    const scale = Math.min(scaleX, scaleZ);

    const offsetX = (w - (maxX - minX) * scale) / 2;
    const offsetZ = (h - (maxZ - minZ) * scale) / 2;

    const toCanvas = (px, pz) => ({
      cx: (px - minX) * scale + offsetX,
      cy: (pz - minZ) * scale + offsetZ
    });

    // Draw track outline (thick dark line for track surface)
    ctx.beginPath();
    const first = toCanvas(TRACK_POINTS[0].x, TRACK_POINTS[0].z);
    ctx.moveTo(first.cx, first.cy);
    TRACK_POINTS.forEach((p, i) => {
      if (i === 0) return;
      const { cx, cy } = toCanvas(p.x, p.z);
      ctx.lineTo(cx, cy);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = TRACK_WIDTH * scale * 0.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Draw track center line
    ctx.beginPath();
    ctx.moveTo(first.cx, first.cy);
    TRACK_POINTS.forEach((p, i) => {
      if (i === 0) return;
      const { cx, cy } = toCanvas(p.x, p.z);
      ctx.lineTo(cx, cy);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Start/finish line
    const sf = toCanvas(TRACK_POINTS[0].x, TRACK_POINTS[0].z);
    ctx.beginPath();
    ctx.arc(sf.cx, sf.cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Draw car position
    const car = toCanvas(carX, carZ);
    
    // Car glow
    const gradient = ctx.createRadialGradient(car.cx, car.cy, 0, car.cx, car.cy, 10);
    gradient.addColorStop(0, 'rgba(220, 50, 50, 0.6)');
    gradient.addColorStop(1, 'rgba(220, 50, 50, 0)');
    ctx.beginPath();
    ctx.arc(car.cx, car.cy, 10, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Car dot
    ctx.beginPath();
    ctx.arc(car.cx, car.cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#dc3232';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Car direction indicator
    const dirLen = 10;
    const dirX = car.cx + Math.sin(carAngle) * dirLen;
    const dirY = car.cy + Math.cos(carAngle) * dirLen;
    ctx.beginPath();
    ctx.moveTo(car.cx, car.cy);
    ctx.lineTo(dirX, dirY);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw AI drivers
    const positions = [];
    aiDrivers.forEach((ai, idx) => {
      const pos = toCanvas(ai.posX, ai.posZ);
      positions.push({ cx: pos.cx, cy: pos.cy, idx });
      const isSpectating = ai.id !== undefined ? ai.id === spectatingId : false;
      const radius = isSpectating ? 5 : 3;
      ctx.beginPath();
      ctx.arc(pos.cx, pos.cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = ai.colorHex;
      ctx.fill();
      ctx.strokeStyle = isSpectating ? '#fff' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = isSpectating ? 2 : 1;
      ctx.stroke();
    });
    aiCanvasPositionsRef.current = positions;

  }, [carX, carZ, carAngle, aiDrivers, spectatingId]);

  return (
    <div className="absolute top-4 left-4 z-20">
      <div className="relative">
        <div className="absolute inset-0 rounded-xl bg-black/60 backdrop-blur-md border border-white/10" />
        <div className="relative p-2">
          <button
            onClick={() => setHidden(h => !h)}
            className="flex items-center gap-2 px-2 pb-1 w-full hover:opacity-80 transition-opacity"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-orbitron text-white/60 uppercase tracking-widest flex-1 text-left">Track Map</span>
            <span className="text-white/30 text-[10px]">{hidden ? '▼' : '▲'}</span>
          </button>
          {!hidden && (
            <canvas
              ref={canvasRef}
              width={200}
              height={180}
              className="rounded-lg cursor-pointer"
              onClick={(e) => {
                if (!onSpectate) return;
                const rect = canvasRef.current.getBoundingClientRect();
                const mx = (e.clientX - rect.left) * (200 / rect.width);
                const my = (e.clientY - rect.top) * (180 / rect.height);
                const hit = aiCanvasPositionsRef.current.find(p => Math.sqrt((mx - p.cx) ** 2 + (my - p.cy) ** 2) < 10);
                if (hit) onSpectate(aiDrivers[hit.idx]);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
// Monaco-inspired GP circuit - a challenging street circuit
// Points define the center line of the track
export const TRACK_POINTS = [
  // Start/Finish straight
  { x: 0, z: 0 },
  { x: 50, z: 0 },
  { x: 100, z: 0 },
  { x: 150, z: 5 },
  // Turn 1 - Sainte Devote (sharp right)
  { x: 180, z: 20 },
  { x: 190, z: 45 },
  { x: 185, z: 70 },
  // Beau Rivage uphill
  { x: 170, z: 100 },
  { x: 155, z: 135 },
  { x: 145, z: 170 },
  { x: 140, z: 200 },
  // Massenet curve
  { x: 130, z: 230 },
  { x: 110, z: 250 },
  { x: 85, z: 260 },
  // Casino Square
  { x: 55, z: 265 },
  { x: 30, z: 260 },
  { x: 10, z: 245 },
  // Mirabeau
  { x: 0, z: 220 },
  { x: -5, z: 195 },
  // Hairpin (Grand Hotel)
  { x: -15, z: 175 },
  { x: -30, z: 165 },
  { x: -40, z: 175 },
  { x: -35, z: 195 },
  // Portier
  { x: -25, z: 215 },
  { x: -35, z: 235 },
  { x: -55, z: 245 },
  // Tunnel
  { x: -80, z: 245 },
  { x: -110, z: 240 },
  { x: -140, z: 230 },
  { x: -165, z: 215 },
  // Chicane (Nouvelle)
  { x: -180, z: 195 },
  { x: -185, z: 170 },
  { x: -175, z: 145 },
  // Tabac
  { x: -160, z: 125 },
  { x: -150, z: 100 },
  { x: -145, z: 75 },
  // Swimming Pool complex
  { x: -135, z: 55 },
  { x: -120, z: 40 },
  { x: -100, z: 30 },
  { x: -80, z: 25 },
  // La Rascasse
  { x: -60, z: 15 },
  { x: -45, z: 5 },
  { x: -30, z: 0 },
  // Back to start
  { x: -15, z: -2 },
];

export const TRACK_WIDTH = 12;

// Compute track segment data for rendering and physics
export function getTrackSegments() {
  const segments = [];
  const points = TRACK_POINTS;
  
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    
    const dx = next.x - current.x;
    const dz = next.z - current.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);
    
    // Normal perpendicular to track direction
    const nx = -dz / length;
    const nz = dx / length;
    
    segments.push({
      start: current,
      end: next,
      length,
      angle,
      normal: { x: nx, z: nz },
      midpoint: {
        x: (current.x + next.x) / 2,
        z: (current.z + next.z) / 2
      }
    });
  }
  
  return segments;
}

// Get the closest point on track and distance from center
export function getTrackInfo(posX, posZ, segments) {
  let minDist = Infinity;
  let closestSegIdx = 0;
  let closestT = 0;
  
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const dx = posX - seg.start.x;
    const dz = posZ - seg.start.z;
    const segDx = seg.end.x - seg.start.x;
    const segDz = seg.end.z - seg.start.z;
    
    let t = (dx * segDx + dz * segDz) / (seg.length * seg.length);
    t = Math.max(0, Math.min(1, t));
    
    const closestX = seg.start.x + t * segDx;
    const closestZ = seg.start.z + t * segDz;
    
    const dist = Math.sqrt((posX - closestX) ** 2 + (posZ - closestZ) ** 2);
    
    if (dist < minDist) {
      minDist = dist;
      closestSegIdx = i;
      closestT = t;
    }
  }
  
  return {
    distance: minDist,
    segmentIndex: closestSegIdx,
    t: closestT,
    onTrack: minDist < TRACK_WIDTH / 2 + 2
  };
}

// Get progress around the track (0-1)
export function getTrackProgress(segmentIndex, t) {
  const totalSegments = TRACK_POINTS.length;
  return (segmentIndex + t) / totalSegments;
}
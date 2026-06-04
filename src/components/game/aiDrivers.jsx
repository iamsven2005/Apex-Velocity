import * as THREE from 'three';
import { TRACK_POINTS, TRACK_WIDTH, getTrackSegments, getTrackInfo } from './trackData';

export const AI_DRIVERS = [
  { id: 0, name: 'HAM', number: 44, color: 0x00d2be, colorHex: '#00d2be' },
  { id: 1, name: 'VER', number: 1,  color: 0x0600ef, colorHex: '#0600ef' },
  { id: 2, name: 'LEC', number: 16, color: 0xdc0000, colorHex: '#dc0000' },
  { id: 3, name: 'NOR', number: 4,  color: 0xff8000, colorHex: '#ff8000' },
  { id: 4, name: 'RUS', number: 63, color: 0x00d2be, colorHex: '#29f1db' },
];

// Stagger starting positions along the track so they don't all spawn at 0,0
const START_OFFSETS = [5, 10, 15, 20, 25]; // segment indices ahead of start

export function createAIDriver(driver, scene, segments) {
  // Starting segment
  const startSeg = segments[START_OFFSETS[driver.id]];
  const startPt = TRACK_POINTS[START_OFFSETS[driver.id]];

  const state = {
    id: driver.id,
    name: driver.name,
    number: driver.number,
    colorHex: driver.colorHex,
    posX: startPt.x,
    posZ: startPt.z,
    angle: startSeg.angle,
    speed: 0,
    targetSegIdx: (START_OFFSETS[driver.id] + 1) % TRACK_POINTS.length,
    lap: 1,
    lapProgress: START_OFFSETS[driver.id] / TRACK_POINTS.length,
    passedHalf: false,
    lapStartTime: performance.now(),
    bestLap: Infinity,
    // personality tweaks
    topSpeed: 42 + driver.id * 2 + Math.random() * 6,
    accel: 16 + Math.random() * 6,
    braking: 0.93 + Math.random() * 0.02,
    lookahead: 6 + driver.id,
  };

  // 3D mesh
  const mesh = createAIMesh(driver.color);
  mesh.position.set(state.posX, 0.35, state.posZ);
  scene.add(mesh);
  state.mesh = mesh;

  return state;
}

function createAIMesh(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 3.8), mat);
  body.position.y = 0.3;
  group.add(body);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 1.0), dark);
  cockpit.position.set(0, 0.6, -0.1);
  group.add(cockpit);

  const fWing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.4), mat);
  fWing.position.set(0, 0.1, 2.1);
  group.add(fWing);

  const rWing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.1), mat);
  rWing.position.set(0, 0.85, -1.8);
  group.add(rWing);

  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.28, 12);
  [{ x: -0.9, z: 1.2 }, { x: 0.9, z: 1.2 }, { x: -0.9, z: -1.2 }, { x: 0.9, z: -1.2 }].forEach(wp => {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(wp.x, 0, wp.z);
    group.add(w);
  });

  return group;
}

// Helper: normalise an angle to [-π, π]
function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Look several waypoints ahead and return the maximum curvature found.
// Curvature = total absolute heading change across the lookahead window.
function lookAheadCurvature(baseIdx, windowSize) {
  let totalTurn = 0;
  let prevAngle = null;
  for (let i = 0; i < windowSize; i++) {
    const idx  = (baseIdx + i) % TRACK_POINTS.length;
    const next = (baseIdx + i + 1) % TRACK_POINTS.length;
    const dx = TRACK_POINTS[next].x - TRACK_POINTS[idx].x;
    const dz = TRACK_POINTS[next].z - TRACK_POINTS[idx].z;
    const a = Math.atan2(dx, dz);
    if (prevAngle !== null) totalTurn += Math.abs(normAngle(a - prevAngle));
    prevAngle = a;
  }
  return totalTurn;
}

export function updateAIDriver(ai, dt, segments, now, allDrivers = []) {
  const n = TRACK_POINTS.length;

  // ── 0. Proximity: avoidance / overtake ───────────────────────────────────
  // Check all other cars. For each nearby car ahead, apply a lateral offset
  // to steer around it. If we're faster we try to overtake; if slower we
  // back off and follow.
  let avoidOffsetX = 0;
  let avoidOffsetZ = 0;
  let shouldSlowForCar = false;

  for (const other of allDrivers) {
    if (other.id === ai.id) continue;
    const relX = other.posX - ai.posX;
    const relZ = other.posZ - ai.posZ;
    const dist = Math.sqrt(relX * relX + relZ * relZ);
    if (dist > 18 || dist < 0.1) continue; // only care about close cars

    // Check if the other car is roughly ahead (dot product with our heading)
    const fwdX = Math.sin(ai.angle);
    const fwdZ = Math.cos(ai.angle);
    const ahead = relX * fwdX + relZ * fwdZ;
    if (ahead < 0) continue; // behind us — ignore

    // Lateral offset: right-hand side of our heading
    const rightX =  fwdZ;
    const rightZ = -fwdX;
    const lateralDist = relX * rightX + relZ * rightZ; // + = they're to our right

    // Avoidance strength grows as distance shrinks
    const strength = Math.max(0, 1 - dist / 18);

    // Steer away from the other car laterally
    const sideSign = lateralDist >= 0 ? -1 : 1; // go opposite to where they are

    // If we're faster, commit to overtake side; otherwise back off speed
    const fasterThanOther = ai.topSpeed > other.topSpeed + 2;
    if (fasterThanOther) {
      // Overtake: nudge sideways with a stronger push
      avoidOffsetX += rightX * sideSign * strength * 5.0;
      avoidOffsetZ += rightZ * sideSign * strength * 5.0;
    } else {
      // Follow / avoid: gentle nudge + reduce speed to avoid contact
      avoidOffsetX += rightX * sideSign * strength * 2.5;
      avoidOffsetZ += rightZ * sideSign * strength * 2.5;
      if (dist < 10) shouldSlowForCar = true;
    }
  }

  // ── 1. Steering target ───────────────────────────────────────────────────
  // Use a larger, distance-scaled lookahead so the car lines up for bends early.
  const steerLookahead = Math.max(6, Math.min(14, Math.round(ai.speed * 0.18)));
  const targetIdx = (ai.targetSegIdx + steerLookahead) % n;
  const target = TRACK_POINTS[targetIdx];

  // Blend avoidance offset into the target position
  const dx = (target.x + avoidOffsetX) - ai.posX;
  const dz = (target.z + avoidOffsetZ) - ai.posZ;
  const desiredAngle = Math.atan2(dx, dz);

  let angleDiff = normAngle(desiredAngle - ai.angle);

  // Stronger, proportional steering — ramps up when off-angle
  const steerStrength = 4.5 + Math.abs(angleDiff) * 2.0;
  ai.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), steerStrength * dt);

  // ── 2. Speed control ─────────────────────────────────────────────────────
  // Sample curvature over the next ~10 waypoints ahead so we brake BEFORE bends.
  const curvatureAhead = lookAheadCurvature(ai.targetSegIdx, 10);

  // Map curvature to a speed cap: straight = 1.0, sharp hairpin ≈ 0.35
  const speedFactor = Math.max(0.35, 1.0 - curvatureAhead * 2.2);
  const targetSpeed = ai.topSpeed * speedFactor;

  // If blocked by a slower car ahead, cap speed to avoid ramming
  const effectiveTargetSpeed = shouldSlowForCar ? targetSpeed * 0.7 : targetSpeed;

  if (ai.speed < effectiveTargetSpeed) {
    ai.speed += ai.accel * dt * (1 - ai.speed / ai.topSpeed);
  } else {
    ai.speed -= (ai.speed - effectiveTargetSpeed) * 6.0 * dt;
  }
  ai.speed = Math.max(0, Math.min(ai.topSpeed, ai.speed));

  // ── 3. Move ──────────────────────────────────────────────────────────────
  ai.posX += Math.sin(ai.angle) * ai.speed * dt;
  ai.posZ += Math.cos(ai.angle) * ai.speed * dt;

  // ── 4. Track boundary — soft push-back BEFORE hitting the wall ───────────
  const trackInfo = getTrackInfo(ai.posX, ai.posZ, segments);
  const softEdge  = TRACK_WIDTH / 2 - 1.5;  // start correcting 1.5 u before wall
  const hardEdge  = TRACK_WIDTH / 2 + 1.0;  // absolute limit (inside barrier)

  if (trackInfo.distance > softEdge) {
    const seg = segments[trackInfo.segmentIndex];
    const sideX = ai.posX - seg.midpoint.x;
    const sideZ = ai.posZ - seg.midpoint.z;
    const sideDot = sideX * seg.normal.x + sideZ * seg.normal.z;
    // Wall-inward normal
    const wallNx = sideDot > 0 ? -seg.normal.x : seg.normal.x;
    const wallNz = sideDot > 0 ? -seg.normal.z : seg.normal.z;

    if (trackInfo.distance > hardEdge) {
      // Hard collision: push back and reset heading
      const penetration = trackInfo.distance - hardEdge;
      ai.posX += wallNx * (penetration + 0.8);
      ai.posZ += wallNz * (penetration + 0.8);
      ai.speed *= 0.25;

      // Snap to a forward waypoint
      const recoveryIdx = (trackInfo.segmentIndex + 4) % n;
      const recoveryPt = TRACK_POINTS[recoveryIdx];
      ai.angle = Math.atan2(recoveryPt.x - ai.posX, recoveryPt.z - ai.posZ);
      ai.targetSegIdx = recoveryIdx;
    } else {
      // Soft zone: gently nudge back to centre and slow slightly
      const pushStrength = (trackInfo.distance - softEdge) / (hardEdge - softEdge);
      ai.posX += wallNx * pushStrength * 3.0 * dt;
      ai.posZ += wallNz * pushStrength * 3.0 * dt;
      ai.speed *= 1 - pushStrength * 0.4 * dt * 60;
    }
  }

  // ── 5. Advance waypoint ──────────────────────────────────────────────────
  const nextSeg = TRACK_POINTS[ai.targetSegIdx];
  const ndx = nextSeg.x - ai.posX;
  const ndz = nextSeg.z - ai.posZ;
  if (Math.sqrt(ndx * ndx + ndz * ndz) < 7) {
    ai.targetSegIdx = (ai.targetSegIdx + 1) % n;
  }

  // ── 6. Leaderboard / lap ─────────────────────────────────────────────────
  ai.lapProgress = ai.targetSegIdx / n;

  const half = Math.floor(n / 2);
  if (ai.targetSegIdx >= half - 2 && ai.targetSegIdx <= half + 2) ai.passedHalf = true;
  if (ai.passedHalf && ai.targetSegIdx <= 2) {
    const lapTime = now - ai.lapStartTime;
    if (lapTime > 5000) {
      if (lapTime < ai.bestLap) ai.bestLap = lapTime;
      ai.lap++;
      ai.lapStartTime = now;
      ai.passedHalf = false;
    }
  }

  // ── 7. Mesh ───────────────────────────────────────────────────────────────
  if (ai.mesh) {
    ai.mesh.position.set(ai.posX, 0.35, ai.posZ);
    ai.mesh.rotation.y = ai.angle;
  }
}

export function removeAIDriver(ai, scene) {
  if (ai.mesh && scene) scene.remove(ai.mesh);
}

// ─── Car-to-car collision resolution ────────────────────────────────────────
// Call once per frame AFTER all drivers have moved.
// `player` is the gameRef.current object (has posX, posZ, velX, velZ, speed, angle).
// `aiDrivers` is the full array of AI state objects.
const CAR_RADIUS = 2.2; // approximate half-length for collision sphere

export function resolveCarCollisions(aiDrivers, player) {
  const allCars = [
    { obj: player, isPlayer: true },
    ...aiDrivers.map(ai => ({ obj: ai, isPlayer: false })),
  ];

  for (let i = 0; i < allCars.length; i++) {
    for (let j = i + 1; j < allCars.length; j++) {
      const a = allCars[i].obj;
      const b = allCars[j].obj;

      const dx = b.posX - a.posX;
      const dz = b.posZ - a.posZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = CAR_RADIUS * 2;

      if (dist >= minDist || dist < 0.01) continue;

      // Collision normal (a → b)
      const nx = dx / dist;
      const nz = dz / dist;

      // Separate — push each car half the overlap, positionally only
      const overlap = (minDist - dist) * 0.5;
      a.posX -= nx * overlap;
      a.posZ -= nz * overlap;
      b.posX += nx * overlap;
      b.posZ += nz * overlap;

      // Velocities along the normal
      const aVelX = Math.sin(a.angle) * a.speed;
      const aVelZ = Math.cos(a.angle) * a.speed;
      const bVelX = Math.sin(b.angle) * b.speed;
      const bVelZ = Math.cos(b.angle) * b.speed;

      const relVelN = (aVelX - bVelX) * nx + (aVelZ - bVelZ) * nz;

      // Only apply impulse if cars are actually approaching each other
      if (relVelN <= 0) continue;

      const restitution = 0.3;
      const impulse = relVelN * (1 + restitution) * 0.5;

      // Scale each car's speed down by the impulse projected onto its heading
      const aFwdX = Math.sin(a.angle), aFwdZ = Math.cos(a.angle);
      const bFwdX = Math.sin(b.angle), bFwdZ = Math.cos(b.angle);

      const aImpact = impulse * (nx * aFwdX + nz * aFwdZ);
      const bImpact = impulse * (nx * bFwdX + nz * bFwdZ);

      a.speed = Math.max(0, a.speed - aImpact);
      b.speed = Math.max(0, b.speed - bImpact);

      // Small spin proportional to how glancing the hit is — capped to prevent wild spinning
      const maxSpin = 0.15;
      const spinA = Math.max(-maxSpin, Math.min(maxSpin, (nx * aFwdZ - nz * aFwdX) * 0.18));
      const spinB = Math.max(-maxSpin, Math.min(maxSpin, (nx * bFwdZ - nz * bFwdX) * 0.18));
      a.angle -= spinA;
      b.angle += spinB;

      // Keep player world-space velocity coherent after impact
      if (allCars[i].isPlayer) {
        a.velX = Math.sin(a.angle) * a.speed;
        a.velZ = Math.cos(a.angle) * a.speed;
      }
      if (allCars[j].isPlayer) {
        b.velX = Math.sin(b.angle) * b.speed;
        b.velZ = Math.cos(b.angle) * b.speed;
      }
    }
  }
}
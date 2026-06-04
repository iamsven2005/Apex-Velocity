/**
 * Replay Buffer
 * Records vehicle state at ~30fps for the last 30 seconds (900 frames).
 * Also tracks the last completed lap start frame index so the lap can be isolated.
 */

const RECORD_HZ = 30;          // frames per second to record
const BUFFER_SECONDS = 30;     // rolling window
const MAX_FRAMES = RECORD_HZ * BUFFER_SECONDS;

export function createReplayBuffer() {
  const frames = [];            // circular-style — we shift when full
  let frameTimer = 0;           // accumulator for throttling
  let lapStartFrameIndex = 0;   // frame index when current lap began

  function record(game, dt) {
    frameTimer += dt;
    if (frameTimer < 1 / RECORD_HZ) return;
    frameTimer = 0;

    frames.push({
      posX: game.posX,
      posZ: game.posZ,
      angle: game.angle,
      speed: game.speed,
      gear: game.gear,
      lap: game.lap,
    });

    if (frames.length > MAX_FRAMES) frames.shift();
  }

  /** Call when a new lap begins so we know where it started. */
  function markLapStart() {
    lapStartFrameIndex = frames.length;
  }

  /**
   * Returns the frames for the last completed lap.
   * If no lap boundary is available, returns last 30 s of data.
   */
  function getLastLapFrames() {
    if (lapStartFrameIndex <= 0 || lapStartFrameIndex >= frames.length) {
      return [...frames];
    }
    // Everything recorded before the last markLapStart = the previous lap
    return frames.slice(0, lapStartFrameIndex);
  }

  /** Returns ALL buffered frames (for the rolling 30s view). */
  function getAllFrames() {
    return [...frames];
  }

  return { record, markLapStart, getLastLapFrames, getAllFrames };
}

// ─── Cinematic camera path ────────────────────────────────────────────────────
// Given a car position + angle, compute a slowly orbiting elevated camera.
const CAM_ANGLES = [
  { heightMult: 1.0, distMult: 1.0, orbitSpeed: 0.4  },  // close chase
  { heightMult: 2.5, distMult: 2.0, orbitSpeed: -0.25 },  // high wide
  { heightMult: 0.5, distMult: 1.4, orbitSpeed: 0.6  },   // low follow
  { heightMult: 3.0, distMult: 3.5, orbitSpeed: 0.15 },   // bird's eye
];
const CAM_SWITCH_INTERVAL = 6; // seconds before switching angle

export function getCinematicCamera(frame, elapsedSeconds) {
  const camIdx = Math.floor(elapsedSeconds / CAM_SWITCH_INTERVAL) % CAM_ANGLES.length;
  const cam = CAM_ANGLES[camIdx];

  // Transition blend within each segment (last 0.5s smooth lerp)
  const segElapsed = elapsedSeconds % CAM_SWITCH_INTERVAL;
  const nextCamIdx = (camIdx + 1) % CAM_ANGLES.length;
  const nextCam = CAM_ANGLES[nextCamIdx];
  const blend = Math.max(0, (segElapsed - (CAM_SWITCH_INTERVAL - 0.5)) / 0.5);

  const h  = cam.heightMult  * (1 - blend) + nextCam.heightMult  * blend;
  const d  = cam.distMult    * (1 - blend) + nextCam.distMult    * blend;
  const os = cam.orbitSpeed  * (1 - blend) + nextCam.orbitSpeed  * blend;

  const BASE_HEIGHT = 7;
  const BASE_DIST   = 16;

  const orbitAngle = frame.angle + os * elapsedSeconds;
  const camX = frame.posX - Math.sin(orbitAngle) * BASE_DIST * d;
  const camZ = frame.posZ - Math.cos(orbitAngle) * BASE_DIST * d;
  const camY = BASE_HEIGHT * h;

  return { camX, camY, camZ };
}
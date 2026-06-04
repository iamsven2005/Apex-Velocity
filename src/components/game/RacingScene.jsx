import React, { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';
import { TRACK_POINTS, TRACK_WIDTH, getTrackSegments, getTrackInfo } from './trackData';
import Minimap from './Minimap';
import HUD from './HUD';
import SettingsMenu, { DEFAULT_SETTINGS } from './SettingsMenu';
import ViewToggle from './ViewToggle';
import Leaderboard from './Leaderboard';
import { AI_DRIVERS, createAIDriver, updateAIDriver, removeAIDriver, resolveCarCollisions } from './aiDrivers';
import { createSkybox } from './Skybox';
import { createReplayBuffer, getCinematicCamera } from './replayBuffer';
import ReplayOverlay from './ReplayOverlay';

// Camera modes
const CAMERA = {
  FIRST: 'first',
  THIRD: 'third',
};

// Third-person camera spring settings
const CAM3_HEIGHT = 6;
const CAM3_DIST = 14;
const CAM3_SPRING = 6;

export default function RacingScene() {
  const mountRef = useRef(null);

  // All live physics state lives in a ref so Three.js loop reads it without stale closures
  const gameRef = useRef({
    speed: 0,
    velX: 0,        // world-space velocity vector (for collision bounce)
    velZ: 0,
    angle: Math.PI / 2,
    steer: 0,
    posX: 0,
    posZ: 0,
    rpm: 0,
    gear: 1,
    lap: 1,
    lapStartTime: 0,
    currentLapTime: 0,
    bestLap: Infinity,
    passedHalf: false,
    keys: {},
    segments: [],
    // fuel
    fuel: 100,
    inPit: false,
    // crash state
    crashed: false,
    crashTimer: 0,
    crashVelX: 0,
    crashVelZ: 0,
    // camera spring (3rd person)
    camX: -14,
    camZ: 0,
    camLookX: 0,
    camLookZ: 0,
    // mouse look (1st person only)
    mousePitch: 0,  // vertical offset in radians
    mouseYaw: 0,    // horizontal offset in radians
    // refs to external state (updated via setter refs)
    settings: { ...DEFAULT_SETTINGS },
    view: CAMERA.FIRST,
  });

  const settingsRef = useRef({ ...DEFAULT_SETTINGS });
  const viewRef = useRef(CAMERA.FIRST);

  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [view, setView] = useState(CAMERA.FIRST);
  const [isDay, setIsDay] = useState(false);
  const [hudData, setHudData] = useState({ speed: 0, gear: 1, lap: 1, bestLap: Infinity, currentLapTime: 0, rpm: 0, fuel: 100, inPit: false });
  const [minimapData, setMinimapData] = useState({ x: 0, z: -5, angle: 0 });
  const [crashFlash, setCrashFlash] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [minimapAI, setMinimapAI] = useState([]);
  const [spectating, setSpectating] = useState(null); // { id, name, colorHex }
  const spectateRef = useRef(null); // id of AI being spectated (null = player)
  const spectateTimerRef = useRef(null);

  // Replay
  const replayBufferRef = useRef(createReplayBuffer());
  const [isReplaying, setIsReplaying] = useState(false);
  const isReplayingRef = useRef(false);
  // Mutable replay playback state (read by ReplayOverlay via rAF)
  const replayStateRef = useRef({ frameIndex: 0, totalFrames: 0, speed: 1 });
  const replayFramesRef = useRef([]);
  const aiDriversRef = useRef([]);
  const sceneRef = useRef(null);
  const segmentsRef = useRef([]);

  // Keep refs in sync with React state (avoids stale closures in animation loop)
  useEffect(() => {
    settingsRef.current = settings;
    gameRef.current.settings = settings;
  }, [settings]);

  useEffect(() => {
    viewRef.current = view;
    gameRef.current.view = view;
  }, [view]);

  const toggleView = () => setView(v => v === CAMERA.FIRST ? CAMERA.THIRD : CAMERA.FIRST);

  const spectateDriver = (entry) => {
    if (!entry || entry.isPlayer) return;
    // Clear any existing timer
    if (spectateTimerRef.current) clearTimeout(spectateTimerRef.current);
    spectateRef.current = entry.id;
    setSpectating({ id: entry.id, name: entry.name, colorHex: entry.colorHex });
    // Auto-dismiss after 5 seconds
    spectateTimerRef.current = setTimeout(() => {
      spectateRef.current = null;
      setSpectating(null);
    }, 5000);
  };

  const toggleAI = () => {
    setAiEnabled(prev => {
      const next = !prev;
      if (next) {
        // Spawn AI drivers
        const segs = segmentsRef.current;
        const sc = sceneRef.current;
        if (!sc || !segs.length) return prev;
        const drivers = AI_DRIVERS.map(d => createAIDriver(d, sc, segs));
        aiDriversRef.current = drivers;
      } else {
        // Remove AI drivers
        aiDriversRef.current.forEach(ai => removeAIDriver(ai, sceneRef.current));
        aiDriversRef.current = [];
        setLeaderboard([]);
        setMinimapAI([]);
      }
      return next;
    });
  };

  const toggleDay = () => {
    setIsDay(d => {
      const next = !d;
      if (gameRef.current.applyTimeOfDay) gameRef.current.applyTimeOfDay(next);
      return next;
    });
  };

  const startReplay = () => {
    const frames = replayBufferRef.current.getLastLapFrames();
    if (frames.length < 2) return;
    replayFramesRef.current = frames;
    replayStateRef.current = { frameIndex: 0, totalFrames: frames.length, speed: 1 };
    isReplayingRef.current = true;
    setIsReplaying(true);
  };

  const stopReplay = () => {
    isReplayingRef.current = false;
    setIsReplaying(false);
  };

  const createScene = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    mount.appendChild(renderer.domElement);

    // Game state
    const game = gameRef.current;

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1a1a2e, 0.004);

    // Camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);

    // Procedural skybox
    const skybox = createSkybox(scene);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    scene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    sunLight.position.set(100, 150, 50);
    scene.add(sunLight);
    const fillLight = new THREE.DirectionalLight(0x6688cc, 0.3);
    fillLight.position.set(-50, 30, -50);
    scene.add(fillLight);

    // Day/night toggle — drives both skybox and lights
    game.applyTimeOfDay = (day) => {
      skybox.setDay(day);
      if (day) {
        sunLight.color.set(0xffffff);
        sunLight.intensity = 2.2;
        ambientLight.color.set(0x9aafd4);
        ambientLight.intensity = 1.0;
      } else {
        sunLight.color.set(0xffeedd);
        sunLight.intensity = 1.2;
        ambientLight.color.set(0x404060);
        ambientLight.intensity = 0.6;
      }
    };

    // Ground
    const groundGeo = new THREE.PlaneGeometry(1000, 1000);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a3d1a, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);

    // Build track
    game.segments = getTrackSegments();
    buildTrack(scene, game.segments);
    buildScenery(scene);

    // Store scene + segments for AI toggle
    sceneRef.current = scene;
    segmentsRef.current = game.segments;

    // Car mesh (visible in 3rd person, hidden in 1st person)
    const carMesh = createCarMesh();
    scene.add(carMesh);

    // Nose (cockpit view)
    const noseMesh = createCarNose();
    scene.add(noseMesh);

    // Input
    const onKeyDown = (e) => {
      game.keys[e.key.toLowerCase()] = true;
      // V key toggles view
      if (e.key.toLowerCase() === 'v') {
        const next = viewRef.current === CAMERA.FIRST ? CAMERA.THIRD : CAMERA.FIRST;
        setView(next);
        // Reset mouse look when switching views
        game.mouseYaw = 0;
        game.mousePitch = 0;
      }
    };
    const onKeyUp = (e) => { game.keys[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Pointer lock mouse look (1st person)
    const canvas = renderer.domElement;
    const onCanvasClick = () => {
      if (viewRef.current === CAMERA.FIRST) {
        canvas.requestPointerLock();
      }
    };
    const onMouseMove = (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (viewRef.current !== CAMERA.FIRST) return;
      const sensitivity = 0.0015;
      game.mouseYaw   -= e.movementX * sensitivity;
      game.mousePitch -= e.movementY * sensitivity;
      // Clamp pitch to avoid flipping
      game.mousePitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, game.mousePitch));
    };
    canvas.addEventListener('click', onCanvasClick);
    document.addEventListener('mousemove', onMouseMove);

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let lastTime = performance.now();
    game.lapStartTime = performance.now();
    game.camX = game.posX - CAM3_DIST;
    game.camZ = game.posZ;
    let frameId;
    let hudCounter = 0;
    let lastCrashFlash = false;
    let replayElapsed = 0; // seconds elapsed during replay playback

    const animate = (now) => {
      frameId = requestAnimationFrame(animate);
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      // Animate skybox transition + sync fog colour
      skybox.update(dt);
      const fogColor = skybox.getHorizonColor();
      scene.fog.color.copy(fogColor);

      // ── Replay playback ──────────────────────────────────────────────────
      if (isReplayingRef.current) {
        const rs = replayStateRef.current;
        const frames = replayFramesRef.current;
        replayElapsed += dt * rs.speed;
        // Advance frame index at 30fps equivalent
        rs.frameIndex = Math.min(frames.length - 1, Math.floor(replayElapsed * 30));

        if (rs.frameIndex >= frames.length - 1) {
          // Loop replay
          replayElapsed = 0;
          rs.frameIndex = 0;
        }

        const frame = frames[rs.frameIndex];
        // Position car mesh to replay position
        carMesh.position.set(frame.posX, 0.35, frame.posZ);
        carMesh.rotation.y = frame.angle;
        carMesh.visible = true;
        noseMesh.visible = false;

        // Cinematic camera
        const { camX, camY, camZ } = getCinematicCamera(frame, replayElapsed);
        camera.position.set(camX, camY, camZ);
        camera.lookAt(frame.posX, 1.0, frame.posZ);

        renderer.render(scene, camera);
        return; // skip normal physics + HUD updates during replay
      }
      replayElapsed = 0; // reset if we leave replay

      const didCrash = updatePhysics(game, dt);

      // Trigger React crash flash
      if (didCrash && !lastCrashFlash) {
        setCrashFlash(true);
        setTimeout(() => setCrashFlash(false), 300);
      }
      lastCrashFlash = didCrash;

      // Spectate mode: override camera to follow a specific AI car
      const spectateId = spectateRef.current;
      if (spectateId !== null && aiDriversRef.current.length > 0) {
        const target = aiDriversRef.current.find(a => a.id === spectateId);
        if (target) {
          const camX = target.posX - Math.sin(target.angle) * CAM3_DIST;
          const camZ = target.posZ - Math.cos(target.angle) * CAM3_DIST;
          camera.position.set(camX, CAM3_HEIGHT, camZ);
          camera.lookAt(target.posX, 1.0, target.posZ);
          // Still update player car mesh position even while spectating
          carMesh.position.set(game.posX, 0.35, game.posZ);
          carMesh.rotation.y = game.angle;
          carMesh.visible = true;
          noseMesh.visible = false;
        } else {
          updateCamera(camera, carMesh, noseMesh, game, dt);
        }
      } else {
        updateCamera(camera, carMesh, noseMesh, game, dt);
      }

      // Record to replay buffer
      replayBufferRef.current.record(game, dt);

      const prevLap = game.lap;
      game.currentLapTime = now - game.lapStartTime;
      checkLapCompletion(game, now);
      // Mark lap start in buffer when a new lap begins
      if (game.lap !== prevLap) {
        replayBufferRef.current.markLapStart();
      }

      // Update AI drivers
      const aiDrivers = aiDriversRef.current;
      if (aiDrivers.length > 0) {
        aiDrivers.forEach(ai => updateAIDriver(ai, dt, game.segments, now, aiDrivers));
        resolveCarCollisions(aiDrivers, game);
      }

      hudCounter++;
      if (hudCounter % 3 === 0) {
        // Pit stop: box near start line (x: -10..10, z: -8..-2)
        const inPit = game.posX > -10 && game.posX < 10 && game.posZ > -8 && game.posZ < -2;
        if (inPit && game.fuel < 100) {
          game.fuel = Math.min(100, game.fuel + 40 * dt * 3); // refuel at ~120%/sec
        }
        game.inPit = inPit;

        setHudData({
          speed: game.speed,
          gear: game.gear,
          lap: game.lap,
          bestLap: game.bestLap,
          currentLapTime: game.currentLapTime,
          rpm: game.rpm,
          fuel: game.fuel,
          inPit: game.inPit,
        });
        setMinimapData({ x: game.posX, z: game.posZ, angle: game.angle });
        if (aiDrivers.length > 0) {
          setMinimapAI(aiDrivers.map(ai => ({ id: ai.id, posX: ai.posX, posZ: ai.posZ, colorHex: ai.colorHex })));
        }

        // Update leaderboard
        if (aiDrivers.length > 0) {
          const playerEntry = {
            id: 'player',
            name: 'YOU',
            colorHex: '#cc0000',
            lap: game.lap,
            lapProgress: (() => {
              const info = getTrackInfo(game.posX, game.posZ, game.segments);
              return (info.segmentIndex + info.t) / game.segments.length;
            })(),
            isPlayer: true,
          };
          const allEntries = [
            playerEntry,
            ...aiDrivers.map(ai => ({ ...ai, isPlayer: false }))
          ];
          // Sort: higher lap first, then higher progress
          allEntries.sort((a, b) => {
            if (b.lap !== a.lap) return b.lap - a.lap;
            return b.lapProgress - a.lapProgress;
          });
          setLeaderboard(allEntries);
        }
      }

      renderer.render(scene, camera);
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('click', onCanvasClick);
      document.removeEventListener('mousemove', onMouseMove);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []); // eslint-disable-line

  useEffect(() => {
    const cleanup = createScene();
    return cleanup;
  }, [createScene]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      {/* Out of fuel overlay */}
      {hudData.fuel <= 0 && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-black/80 backdrop-blur-md border border-red-500/50 rounded-2xl px-10 py-8 flex flex-col items-center gap-4">
            <span className="text-5xl">⛽</span>
            <span className="font-orbitron text-2xl font-bold text-red-400 uppercase tracking-widest">Out of Fuel</span>
            <span className="font-orbitron text-sm text-white/60">Press <span className="text-white font-bold">R</span> to reset</span>
          </div>
        </div>
      )}

      {/* Crash flash overlay */}
      {crashFlash && (
        <div className="absolute inset-0 z-40 pointer-events-none bg-white/20 animate-pulse" />
      )}

      <div ref={mountRef} className="w-full h-full" />

      {/* Replay overlay (full screen, shown during replay) */}
      {isReplaying && (
        <ReplayOverlay replayState={replayStateRef.current} onExit={stopReplay} />
      )}

      {!isReplaying && (
        <>
      <Minimap carX={minimapData.x} carZ={minimapData.z} carAngle={minimapData.angle} aiDrivers={minimapAI} onSpectate={spectateDriver} spectatingId={spectating?.id} />
      <HUD {...hudData} onWatchReplay={startReplay} />
      <SettingsMenu settings={settings} onSettingsChange={setSettings} />
      <ViewToggle view={view} onToggle={toggleView} />
      <button
        onClick={toggleDay}
        className="absolute top-28 right-4 z-30 flex items-center gap-2 px-3 py-2
                   bg-black/70 backdrop-blur-md border border-white/10 rounded-lg
                   text-white/70 hover:text-white hover:border-white/20 transition-all font-orbitron text-xs"
        style={{ minWidth: '90px' }}
      >
        <span style={{ width: '1em', textAlign: 'center' }}>{isDay ? '🌙' : '☀️'}</span>
        <span className="hidden sm:inline" style={{ display: 'inline-block', width: '36px' }}>{isDay ? 'NIGHT' : 'DAY'}</span>
      </button>

      {/* AI toggle button */}
      <button
        onClick={toggleAI}
        className={`absolute top-44 right-4 z-30 flex items-center gap-2 px-3 py-2
                   backdrop-blur-md border rounded-lg transition-all font-orbitron text-xs
                   ${aiEnabled
                     ? 'bg-primary/30 border-primary/60 text-white'
                     : 'bg-black/70 border-white/10 text-white/70 hover:text-white hover:border-white/20'
                   }`}
        style={{ minWidth: '90px' }}
      >
        <span>🏎</span>
        <span className="hidden sm:inline" style={{ display: 'inline-block', minWidth: '36px' }}>
          {aiEnabled ? 'AI ON' : 'AI OFF'}
        </span>
      </button>

      {/* Spectate banner */}
      {spectating && (
        <div
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 cursor-pointer"
          onClick={() => { spectateRef.current = null; setSpectating(null); if (spectateTimerRef.current) clearTimeout(spectateTimerRef.current); }}
        >
          <div className="bg-black/70 backdrop-blur-md border border-white/20 rounded-xl px-5 py-2 flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: spectating.colorHex }} />
            <span className="font-orbitron text-xs text-white/50 uppercase tracking-widest">Spectating</span>
            <span className="font-orbitron text-sm font-bold text-white">{spectating.name}</span>
            <span className="font-orbitron text-[10px] text-white/30 ml-1">• click to dismiss</span>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <Leaderboard entries={leaderboard} visible={aiEnabled && leaderboard.length > 0} onSpectate={spectateDriver} spectatingId={spectating?.id} />

      {/* View hint */}
      <div className="absolute bottom-28 right-4 z-20 text-[9px] font-orbitron text-white/20 text-right space-y-0.5">
        <div>V — toggle view</div>
        {view === 'first' && <div>Click — mouse look (ESC to release)</div>}
      </div>
        </>
      )}
    </div>
  );
}

// ─── Physics ────────────────────────────────────────────────────────────────

function updatePhysics(game, dt) {
  const keys = game.keys;
  const s = game.settings;

  // Reset
  if (keys['r']) {
    game.posX = 0;
    game.posZ = 0;
    game.angle = Math.PI / 2;
    game.speed = 0;
    game.velX = 0;
    game.velZ = 0;
    game.steer = 0;
    game.crashed = false;
    game.crashTimer = 0;
    game.lap = 1;
    game.lapStartTime = performance.now();
    game.passedHalf = false;
    game.fuel = 100;
    return false;
  }

  // If in crash bounce state, run bounce physics
  if (game.crashed) {
    game.crashTimer -= dt;
    if (game.crashTimer <= 0) {
      game.crashed = false;
      game.crashVelX = 0;
      game.crashVelZ = 0;
    } else {
      // Bounce sliding
      game.crashVelX *= Math.pow(0.85, dt * 60);
      game.crashVelZ *= Math.pow(0.85, dt * 60);
      game.posX += game.crashVelX * dt;
      game.posZ += game.crashVelZ * dt;
      game.speed = Math.sqrt(game.crashVelX ** 2 + game.crashVelZ ** 2);
      game.rpm = game.speed / s.topSpeed * 14000 + 2000;
      game.gear = Math.max(1, Math.min(8, Math.ceil((game.speed / s.topSpeed) * 8)));
      return true; // still crashing
    }
  }

  const trackInfo = getTrackInfo(game.posX, game.posZ, game.segments);
  const onTrack = trackInfo.onTrack;

  // Input
  const accelInput = (keys['w'] || keys['arrowup']) ? 1 : 0;
  const brakeInput = (keys['s'] || keys['arrowdown']) ? 1 : 0;

  const MAX_REVERSE = s.topSpeed * 0.25;

  if (accelInput > 0) {
    if (game.speed >= 0) {
      game.speed += s.acceleration * dt * (1 - game.speed / s.topSpeed);
    } else {
      // Braking out of reverse
      game.speed += s.braking * dt;
    }
  }
  if (brakeInput > 0) {
    if (game.speed > 0) {
      game.speed -= s.braking * dt;
    } else {
      // Reversing
      game.speed -= s.acceleration * 0.5 * dt * (1 - Math.abs(game.speed) / MAX_REVERSE);
    }
  }

  const friction = onTrack ? 8 : 30;
  game.speed -= Math.sign(game.speed) * friction * dt;
  if (Math.abs(game.speed) < 0.1) game.speed = 0;
  game.speed = Math.max(-MAX_REVERSE, Math.min(s.topSpeed, game.speed));

  // Steering
  const grip = s.grip;
  const steerInput = ((keys['a'] || keys['arrowleft']) ? 1 : 0) - ((keys['d'] || keys['arrowright']) ? 1 : 0);
  const steeringSpeed = s.steering;

  if (steerInput !== 0) {
    game.steer += steerInput * steeringSpeed * dt;
    game.steer = Math.max(-0.06 * grip, Math.min(0.06 * grip, game.steer));
  } else {
    if (Math.abs(game.steer) < 0.001) game.steer = 0;
    else game.steer -= Math.sign(game.steer) * 4.0 * dt;
  }

  game.angle += game.steer * game.speed * dt * 0.8;

  // World-space velocity
  game.velX = Math.sin(game.angle) * game.speed;
  game.velZ = Math.cos(game.angle) * game.speed;
  game.posX += game.velX * dt;
  game.posZ += game.velZ * dt;

  // Fuel drain (only when accelerating and not in pit)
  if (accelInput > 0 && game.speed > 1 && !game.inPit) {
    game.fuel = Math.max(0, game.fuel - 1.8 * dt); // ~1.8%/sec at full throttle
  }
  // If out of fuel, coast to stop and block all acceleration
  if (game.fuel <= 0) {
    game.speed = Math.max(0, game.speed - 15 * dt);
    // Block acceleration input when out of fuel
    if (accelInput > 0) game.speed = Math.max(0, game.speed - 5 * dt);
  }

  // Gear / RPM
  if (game.speed < 0) {
    game.gear = -1; // reverse
    game.rpm = 4000 + (Math.abs(game.speed) / (s.topSpeed * 0.25)) * 6000;
  } else {
    const speedRatio = game.speed / s.topSpeed;
    game.gear = Math.max(1, Math.min(8, Math.ceil(speedRatio * 8)));
    game.rpm = 4000 + (game.speed / s.topSpeed * 8 % 1) * 14000;
  }

  // ── Wall collision physics ──────────────────────────────────────────────
  const barrierEdge = TRACK_WIDTH / 2 + 2;
  if (trackInfo.distance > barrierEdge && game.speed > 0.5) {
    const seg = game.segments[trackInfo.segmentIndex];

    // Wall normal pointing from barrier back toward track center
    // Use segment normal as the wall normal (barrier runs along the track)
    // Determine which side the car is on
    const sideX = game.posX - seg.midpoint.x;
    const sideZ = game.posZ - seg.midpoint.z;
    const sideDot = sideX * seg.normal.x + sideZ * seg.normal.z;
    const wallNx = sideDot > 0 ? -seg.normal.x : seg.normal.x;
    const wallNz = sideDot > 0 ? -seg.normal.z : seg.normal.z;

    // Reflect velocity around wall normal
    const dot = game.velX * wallNx + game.velZ * wallNz;
    const restitution = 0.35; // energy kept after bounce
    const reflVelX = (game.velX - 2 * dot * wallNx) * restitution;
    const reflVelZ = (game.velZ - 2 * dot * wallNz) * restitution;

    // Push car back inside track
    const penetration = trackInfo.distance - barrierEdge;
    game.posX += wallNx * (penetration + 0.5);
    game.posZ += wallNz * (penetration + 0.5);

    // Set crash bounce state
    game.crashed = true;
    game.crashTimer = 0.4 + penetration * 0.05;
    game.crashVelX = reflVelX;
    game.crashVelZ = reflVelZ;
    game.speed = Math.sqrt(reflVelX ** 2 + reflVelZ ** 2);

    // Spin the car slightly
    game.angle += (Math.random() - 0.5) * 0.8;

    return true; // just crashed
  }

  return false;
}

// ─── Camera ─────────────────────────────────────────────────────────────────

function updateCamera(camera, carMesh, noseMesh, game, dt) {
  const isThird = game.view === 'third';

  if (isThird) {
    // Spring-follow camera behind car
    const targetX = game.posX - Math.sin(game.angle) * CAM3_DIST;
    const targetZ = game.posZ - Math.cos(game.angle) * CAM3_DIST;
    const lerpFactor = Math.min(1, CAM3_SPRING * dt);
    game.camX += (targetX - game.camX) * lerpFactor;
    game.camZ += (targetZ - game.camZ) * lerpFactor;

    camera.position.set(game.camX, CAM3_HEIGHT, game.camZ);
    camera.lookAt(game.posX, 1.0, game.posZ);

    // Show full car body in 3rd person
    carMesh.visible = true;
    noseMesh.visible = false;
  } else {
    // First person – cockpit view with mouse look
    const camHeight = 1.8;
    const camBack = 0.4;
    const camPosX = game.posX - Math.sin(game.angle) * camBack;
    const camPosZ = game.posZ - Math.cos(game.angle) * camBack;
    camera.position.set(camPosX, camHeight, camPosZ);

    // Combine car heading with mouse yaw/pitch offsets
    const totalYaw = game.angle + game.mouseYaw;
    const lookDist = 30;
    const flatX = Math.sin(totalYaw) * lookDist;
    const flatZ = Math.cos(totalYaw) * lookDist;
    // Pitch: rotate the look vector up/down around the car's right axis
    const pitchFactor = Math.tan(game.mousePitch) * lookDist;
    camera.lookAt(
      camPosX + flatX,
      camHeight + pitchFactor,
      camPosZ + flatZ
    );

    // Position nose/cockpit
    noseMesh.position.set(
      game.posX + Math.sin(game.angle) * 1.5,
      0.4,
      game.posZ + Math.cos(game.angle) * 1.5
    );
    noseMesh.rotation.y = game.angle;

    carMesh.visible = false;
    noseMesh.visible = true;
  }

  // Always move car body
  carMesh.position.set(game.posX, 0.35, game.posZ);
  carMesh.rotation.y = game.angle;

  // Crash wobble
  if (game.crashed) {
    carMesh.rotation.z = Math.sin(game.crashTimer * 20) * 0.1;
  } else {
    carMesh.rotation.z = 0;
  }
}

// ─── Lap ────────────────────────────────────────────────────────────────────

function checkLapCompletion(game, now) {
  if (game.crashed) return;
  const trackInfo = getTrackInfo(game.posX, game.posZ, game.segments);
  const segIdx = trackInfo.segmentIndex;
  const totalSegs = game.segments.length;
  const halfSegs = Math.floor(totalSegs / 2);

  if (segIdx >= halfSegs - 2 && segIdx <= halfSegs + 2) game.passedHalf = true;

  if (game.passedHalf && segIdx <= 2 && game.speed > 1) {
    const lapTime = game.currentLapTime;
    if (lapTime > 5000) {
      if (lapTime < game.bestLap) game.bestLap = lapTime;
      game.lap++;
      game.lapStartTime = now;
      game.passedHalf = false;
    }
  }
}

// ─── Car mesh (3rd person body) ─────────────────────────────────────────────

function createCarMesh() {
  const group = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xcc0000, roughness: 0.2, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.5 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 4.2), red);
  body.position.y = 0.3;
  group.add(body);

  // Cockpit
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 1.2), carbon);
  cockpit.position.set(0, 0.65, -0.2);
  group.add(cockpit);

  // Nose
  const noseGeo = new THREE.ConeGeometry(0.25, 1.8, 8);
  const noseMesh = new THREE.Mesh(noseGeo, red);
  noseMesh.rotation.x = Math.PI / 2;
  noseMesh.position.set(0, 0.3, 2.7);
  group.add(noseMesh);

  // Front wing
  const fWing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.5), red);
  fWing.position.set(0, 0.1, 2.4);
  group.add(fWing);

  // Rear wing
  const rWing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.1), red);
  rWing.position.set(0, 0.9, -2.0);
  group.add(rWing);
  const rWingPylons = [-0.7, 0.7].map(x => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), red);
    p.position.set(x, 0.55, -2.0);
    group.add(p);
    return p;
  });

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const wheelPos = [
    { x: -0.95, y: 0, z: 1.4 },
    { x:  0.95, y: 0, z: 1.4 },
    { x: -0.95, y: 0, z: -1.4 },
    { x:  0.95, y: 0, z: -1.4 },
  ];
  wheelPos.forEach(wp => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wp.x, wp.y, wp.z);
    w.castShadow = true;
    group.add(w);
  });

  group.castShadow = true;
  return group;
}

// ─── Cockpit nose (1st person) ───────────────────────────────────────────────

function createCarNose() {
  const group = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xcc0000, roughness: 0.2, metalness: 0.8 });

  const noseGeo = new THREE.ConeGeometry(0.3, 2, 8);
  const nose = new THREE.Mesh(noseGeo, red);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.3, 1);
  group.add(nose);

  const fWing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.4), red);
  fWing.position.set(0, 0.15, 2);
  group.add(fWing);

  [-0.9, 0.9].forEach(x => {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.5), red);
    plate.position.set(x, 0.2, 2);
    group.add(plate);
  });

  [-0.5, 0.5].forEach(x => {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 1.5), red);
    side.position.set(x, 0.5, 0.5);
    group.add(side);
  });

  const steer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x222222 })
  );
  steer.rotation.x = -Math.PI / 4;
  steer.position.set(0, 0.6, 0.2);
  group.add(steer);

  return group;
}

// ─── Track ───────────────────────────────────────────────────────────────────

function buildTrack(scene, segments) {
  const innerPoints = [];
  const outerPoints = [];

  TRACK_POINTS.forEach((p, i) => {
    const seg = segments[i];
    const hw = TRACK_WIDTH / 2;
    outerPoints.push({ x: p.x + seg.normal.x * hw, z: p.z + seg.normal.z * hw });
    innerPoints.push({ x: p.x - seg.normal.x * hw, z: p.z - seg.normal.z * hw });
  });

  const trackGroup = new THREE.Group();
  for (let i = 0; i < TRACK_POINTS.length; i++) {
    const next = (i + 1) % TRACK_POINTS.length;
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      outerPoints[i].x, 0.01, outerPoints[i].z,
      outerPoints[next].x, 0.01, outerPoints[next].z,
      innerPoints[next].x, 0.01, innerPoints[next].z,
      outerPoints[i].x, 0.01, outerPoints[i].z,
      innerPoints[next].x, 0.01, innerPoints[next].z,
      innerPoints[i].x, 0.01, innerPoints[i].z,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x333340, roughness: 0.6, metalness: 0.1 }));
    mesh.receiveShadow = true;
    trackGroup.add(mesh);
  }
  scene.add(trackGroup);

  // Curbs
  const curbHeight = 0.15;
  const curbW = 1.2;
  for (let i = 0; i < TRACK_POINTS.length; i++) {
    const next = (i + 1) % TRACK_POINTS.length;
    const curbColor = i % 2 === 0 ? 0xdd2222 : 0xffffff;
    const curbMat = new THREE.MeshStandardMaterial({ color: curbColor, roughness: 0.5 });

    [[outerPoints, 1], [innerPoints, -1]].forEach(([pts, sign]) => {
      const a = pts[i], b = pts[next];
      const na = { x: sign * segments[i].normal.x * curbW, z: sign * segments[i].normal.z * curbW };
      const nb = { x: sign * segments[next].normal.x * curbW, z: sign * segments[next].normal.z * curbW };
      const verts = new Float32Array([
        a.x, curbHeight, a.z,
        b.x, curbHeight, b.z,
        b.x + nb.x, curbHeight, b.z + nb.z,
        a.x, curbHeight, a.z,
        b.x + nb.x, curbHeight, b.z + nb.z,
        a.x + na.x, curbHeight, a.z + na.z,
      ]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      scene.add(new THREE.Mesh(geo, curbMat.clone()));
    });
  }

  // Barriers
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.3, metalness: 0.5 });
  const barrierOffset = TRACK_WIDTH / 2 + 2;
  for (let i = 0; i < TRACK_POINTS.length; i++) {
    const next = (i + 1) % TRACK_POINTS.length;
    [[1], [-1]].forEach(([sign]) => {
      const bStart = {
        x: TRACK_POINTS[i].x + sign * segments[i].normal.x * barrierOffset,
        z: TRACK_POINTS[i].z + sign * segments[i].normal.z * barrierOffset
      };
      const bEnd = {
        x: TRACK_POINTS[next].x + sign * segments[next].normal.x * barrierOffset,
        z: TRACK_POINTS[next].z + sign * segments[next].normal.z * barrierOffset
      };
      const dx = bEnd.x - bStart.x, dz = bEnd.z - bStart.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, len), barrierMat);
      barrier.position.set((bStart.x + bEnd.x) / 2, 0.75, (bStart.z + bEnd.z) / 2);
      barrier.rotation.y = angle;
      barrier.castShadow = true;
      scene.add(barrier);
    });
  }

  // Pit stop box (near start, slightly behind start line)
  const pitBoxMat = new THREE.MeshStandardMaterial({ color: 0x1a7a1a, roughness: 0.5 });
  const pitFloor = new THREE.Mesh(new THREE.PlaneGeometry(20, 6), pitBoxMat);
  pitFloor.rotation.x = -Math.PI / 2;
  pitFloor.position.set(0, 0.015, -5);
  scene.add(pitFloor);

  // Pit lane markings (white border)
  const pitBorderMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  [[-10, -5], [10, -5]].forEach(([x, z]) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 6), pitBorderMat);
    post.position.set(x, 0.75, z);
    scene.add(post);
  });

  // "PIT" sign
  const signMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffcc00, emissiveIntensity: 0.4, roughness: 0.4 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 0.2), signMat);
  sign.position.set(0, 2, -2);
  scene.add(sign);
  const signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2, 6),
    new THREE.MeshStandardMaterial({ color: 0x888888 }));
  signPost.position.set(0, 1, -2);
  scene.add(signPost);

  // Start/finish line
  const sfGeo = new THREE.PlaneGeometry(TRACK_WIDTH, 2);
  const sfMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, side: THREE.DoubleSide });
  const sfLine = new THREE.Mesh(sfGeo, sfMat);
  sfLine.rotation.x = -Math.PI / 2;
  sfLine.position.set(0, 0.02, 0);
  scene.add(sfLine);

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 6; col++) {
      if ((row + col) % 2 === 0) continue;
      const check = new THREE.Mesh(
        new THREE.PlaneGeometry(TRACK_WIDTH / 6, 1),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, side: THREE.DoubleSide })
      );
      check.rotation.x = -Math.PI / 2;
      check.position.set(-TRACK_WIDTH / 2 + (col + 0.5) * (TRACK_WIDTH / 6), 0.025, -0.5 + row);
      scene.add(check);
    }
  }
}

// ─── Scenery ─────────────────────────────────────────────────────────────────

function buildScenery(scene) {
  const buildingPositions = [
    { x: 210, z: 100, w: 15, h: 55, d: 15 },
    { x: 200, z: 150, w: 25, h: 35, d: 20 }, { x: 170, z: 250, w: 20, h: 45, d: 15 },
    { x: 80, z: 290, w: 30, h: 30, d: 25 },  { x: 30, z: 285, w: 15, h: 50, d: 15 },
    { x: -20, z: 260, w: 20, h: 35, d: 20 }, { x: -60, z: 270, w: 25, h: 40, d: 20 },
    { x: -120, z: 265, w: 20, h: 55, d: 15 },{ x: -200, z: 220, w: 30, h: 35, d: 25 },
    { x: -200, z: 170, w: 15, h: 45, d: 15 },{ x: -180, z: 80, w: 20, h: 30, d: 20 },
    { x: -160, z: 20, w: 25, h: 50, d: 20 }, { x: -100, z: -10, w: 15, h: 35, d: 15 },
    { x: 120, z: -25, w: 20, h: 55, d: 15 },
    { x: 60, z: 130, w: 30, h: 25, d: 30 },  { x: 30, z: 160, w: 20, h: 35, d: 20 },
    { x: -70, z: 150, w: 25, h: 30, d: 25 }, { x: -90, z: 120, w: 15, h: 40, d: 15 },
  ];
  const buildingColors = [0x2a2a3e, 0x3a3a4e, 0x252540, 0x30304a, 0x353550];

  buildingPositions.forEach((b, i) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.w, b.h, b.d),
      new THREE.MeshStandardMaterial({ color: buildingColors[i % buildingColors.length], roughness: 0.7, metalness: 0.2 })
    );
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const windowRows = Math.floor(b.h / 4);
    const windowCols = Math.floor(b.w / 4);
    for (let r = 0; r < windowRows; r++) {
      for (let c = 0; c < windowCols; c++) {
        if (Math.random() > 0.6) continue;
        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(1.5, 2),
          new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffaa, emissiveIntensity: Math.random() * 0.5 + 0.3, side: THREE.DoubleSide })
        );
        win.position.set(b.x - b.w / 2 + (c + 0.5) * 4, 2 + r * 4, b.z + b.d / 2 + 0.1);
        scene.add(win);
      }
    }
  });

  const segs = getTrackSegments();
  for (let i = 0; i < TRACK_POINTS.length; i += 3) {
    const seg = segs[i];
    const offset = TRACK_WIDTH / 2 + 4;
    const pos = { x: TRACK_POINTS[i].x + seg.normal.x * offset, z: TRACK_POINTS[i].z + seg.normal.z * offset };

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.15, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 })
    );
    pole.position.set(pos.x, 4, pos.z);
    scene.add(pole);

    const lightBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffdd88, emissive: 0xffdd88, emissiveIntensity: 1 })
    );
    lightBulb.position.set(pos.x, 8, pos.z);
    scene.add(lightBulb);

    const pt = new THREE.PointLight(0xffdd88, 0.5, 30);
    pt.position.set(pos.x, 7.5, pos.z);
    scene.add(pt);
  }

  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2;
    const radius = 250 + Math.random() * 200;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius + 130;

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.5, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a3020 })
    );
    trunk.position.set(x, 2, z);
    scene.add(trunk);

    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(3 + Math.random() * 2, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a4a1a, roughness: 0.9 })
    );
    crown.position.set(x, 6 + Math.random() * 2, z);
    crown.castShadow = true;
    scene.add(crown);
  }
}
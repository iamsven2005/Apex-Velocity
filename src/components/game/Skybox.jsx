import * as THREE from 'three';

/**
 * Procedural sky dome using a ShaderMaterial.
 * Supports smooth interpolation between night and day modes.
 *
 * Sky colours are defined per mode at three vertical bands:
 *   zenith  — directly overhead
 *   horizon — eye level
 *   nadir   — below horizon (blends with fog)
 *
 * Call skybox.setDay(bool) to switch modes (cross-fades automatically).
 * Call skybox.update(dt)   every frame to animate the transition.
 */

const SKY_VERT = /* glsl */`
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */`
uniform vec3 zenithA;    // zenith colour mode A (night)
uniform vec3 horizonA;   // horizon colour mode A (night)
uniform vec3 zenithB;    // zenith colour mode B (day)
uniform vec3 horizonB;   // horizon colour mode B (day)
// Sunset / low-angle band (only present in day)
uniform vec3 sunsetColor;
uniform float blend;     // 0 = night, 1 = day

// Sun
uniform vec3 sunDir;
uniform float sunSize;

// Stars (simple hash noise)
varying vec3 vWorldPos;

float hash(vec3 p) {
  p = fract(p * vec3(443.8975, 397.2973, 491.1871));
  p += dot(p, p.yxz + 19.19);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 dir = normalize(vWorldPos);

  // t: 0 at horizon, 1 at zenith, -1 at nadir
  float t = dir.y;

  // Night sky
  vec3 nightCol = mix(horizonA, zenithA, clamp(t * 2.0, 0.0, 1.0));

  // Day sky
  vec3 dayHigh  = mix(horizonB, zenithB, clamp(t * 1.8, 0.0, 1.0));
  // Sunset warm band near horizon
  float sunsetBand = smoothstep(0.3, 0.0, abs(t)) * smoothstep(-0.1, 0.15, t);
  vec3 daySky = mix(dayHigh, sunsetColor, sunsetBand * 0.8);

  // Blend between night and day
  vec3 sky = mix(nightCol, daySky, blend);

  // Stars (visible in night)
  float starNoise = hash(floor(dir * 200.0));
  float starBright = step(0.985, starNoise);
  float starFade = clamp(-dir.y * 3.0 + 3.0, 0.0, 1.0) * (1.0 - blend);
  sky += vec3(starBright * starFade * 0.9);

  // Sun disc
  float sunDot = dot(dir, normalize(sunDir));
  float sunDisc = smoothstep(sunSize - 0.004, sunSize, sunDot);
  vec3 sunCol = mix(vec3(1.0, 0.6, 0.2), vec3(1.0, 1.0, 0.9), blend);
  sky = mix(sky, sunCol, sunDisc * blend);

  // Solar glow halo
  float halo = pow(max(0.0, sunDot - 0.0), 18.0) * 0.3 * blend;
  sky += sunCol * halo;

  gl_FragColor = vec4(sky, 1.0);
}
`;

// Colour palette constants
const NIGHT_ZENITH  = new THREE.Color(0x050a1e);
const NIGHT_HORIZON = new THREE.Color(0x1a1a2e);
const DAY_ZENITH    = new THREE.Color(0x1a6eba);
const DAY_HORIZON   = new THREE.Color(0xb0d8f5);
const SUNSET_COLOR  = new THREE.Color(0xff8030);

export function createSkybox(scene) {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  geo.scale(-1, 1, 1); // invert normals so inside is visible

  const uniforms = {
    zenithA:     { value: NIGHT_ZENITH.clone() },
    horizonA:    { value: NIGHT_HORIZON.clone() },
    zenithB:     { value: DAY_ZENITH.clone() },
    horizonB:    { value: DAY_HORIZON.clone() },
    sunsetColor: { value: SUNSET_COLOR.clone() },
    blend:       { value: 0.0 },
    sunDir:      { value: new THREE.Vector3(0.4, 0.6, 0.5).normalize() },
    sunSize:     { value: 0.9985 },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader:   SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  scene.add(mesh);

  let targetBlend = 0;
  let currentBlend = 0;

  function setDay(isDay) {
    targetBlend = isDay ? 1 : 0;
  }

  function update(dt) {
    const speed = 1.5; // transition speed (seconds to cross full range)
    if (Math.abs(targetBlend - currentBlend) > 0.001) {
      currentBlend += Math.sign(targetBlend - currentBlend) * Math.min(Math.abs(targetBlend - currentBlend), speed * dt);
      uniforms.blend.value = currentBlend;
    }
  }

  /** Returns the current horizon colour so fog can match. */
  function getHorizonColor() {
    const night = NIGHT_HORIZON;
    const day   = DAY_HORIZON;
    return new THREE.Color().lerpColors(night, day, currentBlend);
  }

  return { mesh, setDay, upd
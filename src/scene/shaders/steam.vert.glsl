// Steam from the espresso machine: each puff's place is computed from its seed and the clock (nothing simulated on
// the CPU). Puffs rise, spread and slow; `uRate` is the share of puffs alive, so a brew thickens the column.
uniform float uTime;
uniform float uRate;
uniform float uSize;
uniform float uRise;
uniform vec3 uOrigin;
attribute vec4 aSeed;
varying float vAlpha;

void main() {
  float life = 3.2 + aSeed.y * 1.6;
  float age = fract(aSeed.x + uTime / life);
  float alive = step(aSeed.w, uRate);
  float up = uRise * (1.0 - (1.0 - age) * (1.0 - age));
  vec2 drift = vec2(sin(uTime * 0.9 + aSeed.z * 6.283 + age * 3.0), cos(uTime * 0.7 + aSeed.y * 6.283)) * age * uRise * 0.22;
  vec3 world = uOrigin + vec3(drift.x, up, drift.y);
  vec4 view = viewMatrix * vec4(world, 1.0);
  vAlpha = alive * smoothstep(0.0, 0.12, age) * (1.0 - age) * (0.5 + 0.5 * aSeed.z);
  gl_PointSize = uSize * (0.35 + age * 1.4) / -view.z;
  gl_Position = projectionMatrix * view;
}

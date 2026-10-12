// Dust drifting through the beam on a cheap curl-like flow. Each mote's place is computed from its seed and the
// clock, so nothing is simulated on the CPU. Brightness falls to zero outside the beam: only lit dust is seen.
uniform float uTime;
uniform float uSize;
uniform vec3 uLens;
uniform vec3 uDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uLength;
uniform vec2 uHalfStart;
uniform vec2 uHalfEnd;
attribute vec4 aSeed;
varying float vBright;

vec3 curl(vec3 p) {
  return vec3(
    sin(p.y * 1.7 + cos(p.z * 1.3)) - cos(p.z * 1.9),
    sin(p.z * 1.5 + cos(p.x * 1.1)) - cos(p.x * 1.6),
    sin(p.x * 1.2 + cos(p.y * 1.8)) - cos(p.y * 1.4)
  );
}

void main() {
  float t = fract(aSeed.x + uTime * (0.004 + aSeed.w * 0.006));
  vec3 flow = curl(vec3(aSeed.yzw * 6.283 + uTime * 0.07)) * 0.18;
  vec2 section = (aSeed.yz * 2.0 - 1.0) * 1.35 + flow.xy;
  t = clamp(t + flow.z * 0.02, 0.0, 1.0);

  vec2 halfSize = mix(uHalfStart, uHalfEnd, t);
  vec3 world = uLens + uDir * (t * uLength) + uRight * (section.x * halfSize.x) + uUp * (section.y * halfSize.y);
  vec4 view = viewMatrix * vec4(world, 1.0);

  float inside = smoothstep(1.0, 0.75, max(abs(section.x), abs(section.y)));
  vBright = inside * smoothstep(0.04, 0.15, t) * smoothstep(1.0, 0.85, t) * (0.4 + 0.6 * fract(aSeed.w * 7.31));
  gl_PointSize = uSize * (0.6 + aSeed.y) / -view.z;
  gl_Position = projectionMatrix * view;
}

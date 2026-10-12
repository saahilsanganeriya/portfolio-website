// The projector's light through dusty air: brightest where the line of sight crosses the most beam (faces seen
// head-on), fading with distance from the lens and softening at the frustum's edges. Additive.
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uFlicker;
uniform float uNoiseScale;
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPosition;
varying vec3 vWorld;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void main() {
  float along = 1.0 - vUv.y;
  float across = abs(fract(vUv.x * 4.0) * 2.0 - 1.0);
  float facing = abs(dot(normalize(vNormalView), normalize(-vViewPosition)));
  float body = pow(facing, 1.6) * smoothstep(1.0, 0.55, across);
  float falloff = smoothstep(0.0, 0.06, along) * smoothstep(1.0, 0.86, along) * mix(1.0, 0.35, along);
  float air = 0.65 + 0.35 * noise(vWorld * uNoiseScale + vec3(0.0, uTime * 0.12, uTime * 0.05));
  gl_FragColor = vec4(uColor * body * falloff * air * uStrength * uFlicker, 1.0);
}

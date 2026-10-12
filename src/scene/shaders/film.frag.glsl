// Film grain, vignette and projector flicker in one pass, blended as dst * (src.rgb + src.a) with dst alpha kept,
// so the frame can be brightened or darkened per pixel while the monitor's alpha hole stays exact.
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uFlicker;
uniform float uGrainScale;
varying vec2 vUv;

// Dave Hoskins' hash12 (Hash without Sine, MIT): no visible lattice on integer cell coordinates.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // New grain 24 times a second, like frames of film.
  float frame = mod(floor(uTime * 24.0), 64.0);
  vec2 cell = floor(gl_FragCoord.xy / uGrainScale);
  float n = hash(cell + frame * vec2(37.0, 113.0));

  vec2 centred = vUv - 0.5;
  float vignette = 1.0 - uVignette * smoothstep(0.3, 0.95, length(centred * vec2(1.15, 1.0)));
  float gain = vignette * uFlicker;
  gl_FragColor = vec4(vec3(gain * 2.0 * uGrain * n), gain * (1.0 - uGrain));
}

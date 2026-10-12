// The CRT glass over the iframe. Output is premultiplied: rgb is light added over the screen, alpha is how much of
// the screen it hides (inner shadow, scanlines, view-angle dimming). Blended additively onto the alpha hole.
uniform float uTime;
uniform float uDim;
uniform float uLines;
uniform vec3 uTint;
varying vec2 vUv;

// Dave Hoskins' hash12 (Hash without Sine, MIT).
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 edge = min(vUv, 1.0 - vUv);
  float inner = smoothstep(0.0, 0.07, edge.x) * smoothstep(0.0, 0.09, edge.y);
  float corner = smoothstep(0.6, 1.4, length(max(vec2(0.0), vec2(0.06) - edge) / 0.06));
  float shadow = (1.0 - inner) * 0.85 + corner * 0.15;

  float scan = 0.5 + 0.5 * sin(vUv.y * uLines * 6.2831853);
  float roll = smoothstep(0.0, 0.08, 0.08 - abs(fract(vUv.y + uTime * 0.045) - 0.5));
  float grain = hash(floor(vUv * vec2(640.0, 512.0)) + mod(floor(uTime * 24.0), 64.0) * 37.0);

  float hide = clamp(shadow + scan * 0.07 + uDim + grain * 0.04 - roll * 0.03, 0.0, 0.96);
  vec3 glow = uTint * (0.018 + roll * 0.035 + grain * 0.02) * inner;
  gl_FragColor = vec4(glow, hide);
}

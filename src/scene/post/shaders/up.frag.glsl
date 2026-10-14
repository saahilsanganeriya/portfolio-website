// Dual-filter blur, the double-size step: eight taps on a ring.
uniform sampler2D tInput;
uniform vec2 uTexel;
varying vec2 vUv;

void main() {
  vec2 h = uTexel * 0.5;
  vec3 sum = texture2D(tInput, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  sum += texture2D(tInput, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  sum += texture2D(tInput, vUv + vec2(0.0, h.y * 2.0)).rgb;
  sum += texture2D(tInput, vUv + vec2(h.x, h.y)).rgb * 2.0;
  sum += texture2D(tInput, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  sum += texture2D(tInput, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  sum += texture2D(tInput, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  sum += texture2D(tInput, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  gl_FragColor = vec4(sum / 12.0, 1.0);
}

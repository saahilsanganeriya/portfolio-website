// Dual-filter blur (Marius Bjørge, SIGGRAPH 2015), the half-size step: five taps.
uniform sampler2D tInput;
uniform vec2 uTexel;
varying vec2 vUv;

void main() {
  vec2 h = uTexel * 0.5;
  vec3 sum = texture2D(tInput, vUv).rgb * 4.0;
  sum += texture2D(tInput, vUv - h).rgb;
  sum += texture2D(tInput, vUv + h).rgb;
  sum += texture2D(tInput, vUv + vec2(h.x, -h.y)).rgb;
  sum += texture2D(tInput, vUv - vec2(h.x, -h.y)).rgb;
  gl_FragColor = vec4(sum / 8.0, 1.0);
}

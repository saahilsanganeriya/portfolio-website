// The soft shadow a print drops on the wall a few centimetres behind it: a blurred rectangle of the paper's size.
uniform vec2 uHalf;
uniform float uBlur;
uniform float uStrength;
varying vec2 vLocal;

void main() {
  vec2 outside = max(abs(vLocal) - (uHalf - uBlur * 0.5), 0.0);
  float shade = 1.0 - smoothstep(0.0, uBlur * 1.5, length(outside));
  gl_FragColor = vec4(0.0, 0.0, 0.0, shade * uStrength);
}

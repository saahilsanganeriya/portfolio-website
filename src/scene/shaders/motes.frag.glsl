uniform vec3 uColor;
varying float vBright;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vBright;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}

uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(p)) * vAlpha * uOpacity;
  if (a < 0.004) discard;
  // Premultiplied: steam in front of the monitor hides it a little, as real steam would.
  gl_FragColor = vec4(uColor * a, a);
}

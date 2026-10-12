// Light catching a hovered object: a warm rim along its silhouette, and a band that sweeps across it once.
uniform vec3 uColor;
uniform float uHover;
uniform float uSweep;
uniform float uWidth;
varying vec3 vNormal;
varying vec3 vView;
varying float vAlong;

void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 3.0);
  float band = 1.0 - smoothstep(0.0, uWidth, abs(vAlong - uSweep));
  gl_FragColor = vec4(uColor * uHover * (rim * 0.4 + band * (0.1 + rim * 0.8)), 1.0);
}

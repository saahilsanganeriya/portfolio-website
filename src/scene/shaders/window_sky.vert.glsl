// The sky's colour is worked out once per vertex on the CPU (sky.ts: San Francisco's day sky to Delhi's, one gradient).
attribute vec3 aSky;
varying vec3 vSky;

void main() {
  vSky = aSky;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

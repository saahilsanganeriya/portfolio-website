// The view's land: its world position (for the haze) and its share of Delhi's light (window_blend), per vertex.
uniform vec3 uCentre;
uniform vec3 uEye;
uniform vec3 uOut;
uniform vec3 uRight;
uniform float uBand;
varying vec2 vUv;
varying vec3 vWorld;
varying float vBlend;

#include <window_blend>

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vBlend = windowBlend(world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}

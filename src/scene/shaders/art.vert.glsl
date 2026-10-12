attribute vec2 aBakeUv;
varying vec2 vUv;
varying vec2 vBakeUv;
varying vec3 vWorld;

void main() {
  vUv = uv;
  vBakeUv = aBakeUv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}

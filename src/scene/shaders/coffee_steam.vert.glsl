// The coffee's steam: one quad standing on the mug, turned about the vertical to face the camera (the camera orbits),
// its upper part drifting sideways on slow noise.
uniform float uTime;
varying vec2 vUv;

#include <perlin>

void main() {
  vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float scale = length(modelMatrix[0].xyz);
  vec3 toEye = cameraPosition - base;
  toEye.y = 0.0;
  vec3 across = normalize(cross(vec3(0.0, 1.0, 0.0), toEye + vec3(1e-4, 0.0, 0.0)));
  float drift = perlin2d(vec2(uv.y * 2.2, uTime * 0.12)) * uv.y * uv.y;
  vec3 world = base + across * (position.x + drift * 0.012) * scale + vec3(0.0, position.y * scale, 0.0);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}

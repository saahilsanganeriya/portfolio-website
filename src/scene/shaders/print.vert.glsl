// A print on the darkroom line: a tiny curl toward the room at its sides (more at the bottom, where the clip does not
// hold it), and, with the room's breeze, a sway that grows from nothing at the clip to its full share at the bottom.
attribute float aDrop;
uniform float uCurl;
uniform float uHalfWidth;
#ifdef SWAY
uniform float uSway;
#endif
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vUv = uv;
  float across = position.x / uHalfWidth;
  float hold = 0.35 + 0.65 * aDrop;
  vec3 p = position;
  p.z += uCurl * across * across * hold;
  vec4 world = modelMatrix * vec4(p, 1.0);
#ifdef SWAY
  world.xz += windOffset(world.xz) * aDrop * uSway;
#endif
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * vec3(-2.0 * uCurl * across * hold / uHalfWidth, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * world;
}

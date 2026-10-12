varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPosition;
varying vec3 vWorld;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 view = viewMatrix * world;
  vViewPosition = view.xyz;
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * view;
}

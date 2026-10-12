uniform vec3 uAxis;
varying vec3 vNormal;
varying vec3 vView;
varying float vAlong;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 view = viewMatrix * world;
  vNormal = normalize(normalMatrix * normal);
  vView = -view.xyz;
  vAlong = dot(world.xyz, uAxis);
  gl_Position = projectionMatrix * view;
}

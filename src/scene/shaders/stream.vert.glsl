varying float vAlong;
varying float vAround;

void main() {
  vAlong = 1.0 - uv.y;
  vAround = uv.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

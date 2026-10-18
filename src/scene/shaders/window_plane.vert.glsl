// The plane over the window: its livery per vertex, and its normal in the world for one fixed sun.
attribute vec3 aColour;
varying vec3 vColour;
varying vec3 vNormal;

void main() {
  vColour = aColour;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

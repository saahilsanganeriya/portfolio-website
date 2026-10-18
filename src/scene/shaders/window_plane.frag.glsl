// Lit by the diorama's sun (up, left and toward the room) over a sky-bright ambient, so it reads as a solid in the sky
// and its bank shows; uOpacity fades it in over New Delhi and out over San Francisco.
uniform vec3 uSun;
uniform float uOpacity;
varying vec3 vColour;
varying vec3 vNormal;

void main() {
  float light = 0.64 + 0.42 * max(dot(normalize(vNormal), uSun), 0.0);
  gl_FragColor = vec4(vColour * light, uOpacity);
  #include <colorspace_fragment>
}

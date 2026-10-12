// An album page under the desk lamp: its picture (the back of a turning page shows the next page, mirrored), the
// shadow of the gutter at the spine, and less light where the page bends away from the camera.
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uTwoSided;
uniform float uSpineU;
uniform float uLight;
varying vec2 vUv;
varying vec3 vViewNormal;

void main() {
  vec3 colour = uTwoSided > 0.5 && !gl_FrontFacing ? texture2D(uBack, vec2(1.0 - vUv.x, vUv.y)).rgb : texture2D(uFront, vUv).rgb;
  float gutter = 1.0 - 0.3 * exp(-abs(vUv.x - uSpineU) * 16.0);
  float facing = abs(normalize(vViewNormal).z);
  gl_FragColor = vec4(colour * uLight * gutter * (0.6 + 0.4 * facing), 1.0);
  #include <colorspace_fragment>
}

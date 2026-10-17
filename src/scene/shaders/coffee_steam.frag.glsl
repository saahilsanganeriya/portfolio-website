// Soft steam from noise scrolled upward, fading toward both edges and the top, and in at the coffee's surface.
uniform float uTime;
uniform vec3 uColour;
uniform float uOpacity;
varying vec2 vUv;

#include <perlin>

void main() {
  vec2 uv = vUv * vec2(3.0, 5.0);
  uv.y -= uTime * 0.55;
  float edges = min(vUv.x * 4.0, (1.0 - vUv.x) * 4.0) * (1.0 - vUv.y) * smoothstep(0.0, 0.14, vUv.y);
  float steam = clamp(perlin2d(uv) * edges * 0.6, 0.0, 1.0);
  gl_FragColor = vec4(uColour, steam * uOpacity);
  #include <colorspace_fragment>
}

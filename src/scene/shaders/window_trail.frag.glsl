// Faint and fading: strongest just behind the plane, gone by the end of its length, soft at both edges.
uniform vec3 uColour;
uniform float uOpacity;
varying float vAge;
varying float vSide;

void main() {
  if (vAge < 0.0 || vAge > 1.0) discard;
  float fade = smoothstep(0.0, 0.06, vAge) * (1.0 - vAge) * (1.0 - vAge);
  gl_FragColor = vec4(uColour, uOpacity * fade * (1.0 - abs(vSide)));
  #include <colorspace_fragment>
}

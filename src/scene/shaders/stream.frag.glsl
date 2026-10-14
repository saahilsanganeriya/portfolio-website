// The espresso's stream, from the spout (along 0) down into the cup: only the part between its falling tail and its
// falling head, above the coffee's surface, is drawn. Ripples run down it; its edges, seen side-on, thin out and let
// the light through; it necks down and breaks into drips as the shot ends.
uniform float uTime;
uniform float uHead;
uniform float uTail;
uniform float uSurface;
uniform float uBlond;
uniform float uThin;
varying float vAlong;
varying float vAround;

void main() {
  if (vAlong > uHead || vAlong < uTail || vAlong > uSurface) discard;
  float side = abs(fract(vAround) * 2.0 - 1.0);
  float edge = 1.0 - abs(side * 2.0 - 1.0);
  float ripple = 0.5 + 0.5 * sin(vAlong * 90.0 - uTime * 38.0);
  // A thinning stream breaks up: gaps open between drips as it necks down.
  float drips = step(0.0, sin(vAlong * 140.0 - uTime * 30.0) + uThin * 2.0 - 0.9);
  if (drips < 0.5) discard;
  // Linear colours: a dark red-brown shot that blonds to amber.
  vec3 dark = vec3(0.05, 0.015, 0.005);
  vec3 blond = vec3(0.38, 0.17, 0.05);
  vec3 colour = mix(dark, blond, uBlond) * (0.75 + 0.35 * ripple) + vec3(0.06, 0.035, 0.02) * pow(edge, 6.0);
  float alpha = mix(0.55, 0.95, smoothstep(0.0, 0.6, edge)) * uThin;
  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
}

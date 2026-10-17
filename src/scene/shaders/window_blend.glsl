// How far a point lies toward Delhi's side, 0 (San Francisco) to 1 (Delhi): where the line from the window framing's
// eye through it crosses the window's plane, eased across a band centred between the cities. sky.ts's windowBlend is
// the same function, so the skyline's haze changes over where the sky does.
float windowBlend(vec3 p) {
  vec3 ray = p - uEye;
  float t = dot(uCentre - uEye, uOut) / max(dot(ray, uOut), 1e-3);
  vec3 q = uEye + ray * t;
  return smoothstep(-uBand, uBand, dot(q - uCentre, uRight));
}

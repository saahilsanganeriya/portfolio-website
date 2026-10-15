// How far a point lies toward Delhi's side, 0 (San Francisco) to 1 (Delhi): where the line from the window framing's
// eye through it crosses the window's plane, eased across a band centred on the seam. The sky and the land share it,
// so the cities' skies and their skylines change over in the same place.
float windowBlend(vec3 p) {
  vec3 ray = p - uEye;
  float t = dot(uCentre - uEye, uOut) / max(dot(ray, uOut), 1e-3);
  vec3 q = uEye + ray * t;
  return smoothstep(-uBand, uBand, dot(q - uCentre, uRight));
}

// Two linear colours mixed as the eye sees them (in display values, gamma 2 for speed), so a dark-to-light blend looks
// centred on w = 0.5.
vec3 blendDisplay(vec3 a, vec3 b, float w) {
  vec3 c = mix(sqrt(a), sqrt(b), w);
  return c * c;
}

// Live shine (Shine.ts): what a glossy dielectric (glass, glaze, varnish) reflects of the room, drawn over its baked
// light. The bake holds the view-independent light only; this is the view-dependent rest, from the room probe.

#define SHINE_F0 0.04

uniform float shineRoughness;
uniform float shineStrength;
uniform vec3 shineProbeAt;
uniform vec3 shineBoxMin;
uniform vec3 shineBoxMax;
varying vec3 vShineNormal;
varying vec3 vShinePosition;

// Specular antialiasing (Tokuyoshi & Kaplanyan 2019, Filament's constants): where the normal turns fast across a pixel
// the lobe widens, so a curved rim cannot alias into sparkle while the camera drifts.
float shineFilteredRoughness(vec3 n, float perceptual) {
  vec3 du = dFdx(n);
  vec3 dv = dFdy(n);
  float variance = 0.15 * (dot(du, du) + dot(dv, dv));
  float kernel = min(2.0 * variance, 0.2);
  float alpha = perceptual * perceptual;
  return sqrt(sqrt(clamp(alpha * alpha + kernel, 0.0, 1.0)));
}

// How much of the prefiltered probe a dielectric reflects: the split-sum environment BRDF with Schlick's Fresnel
// (F0 = 0.04, F90 = 1) in Karis' analytic fit ("Physically Based Shading on Mobile", 2014).
float shineWeight(float NdotV, float roughness) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NdotV)) * r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
  return SHINE_F0 * ab.x + ab.y;
}

// Parallax-corrected lookup: where the reflected ray from `at` leaves the set's box, seen from where the probe was
// taken. A reflection of the window then stays on the window as the camera moves, not on the probe's view of it.
vec3 shineOnBox(vec3 at, vec3 dir) {
  vec3 safe = dir + vec3(equal(dir, vec3(0.0))) * 1e-5;
  vec3 t = (mix(shineBoxMin, shineBoxMax, step(0.0, safe)) - at) / safe;
  return at + safe * min(min(t.x, t.y), t.z) - shineProbeAt;
}

// Live shine (Shine.ts): what a glossy dielectric (glass, glaze, varnish) reflects of the room, drawn over its baked
// light. The bake holds the view-independent light only; this is the view-dependent rest, from the room probe, whose
// texels are scene-linear light at the bake's exposure.

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

// The bake's tone curve (Blender's AgX, as three's AgXToneMapping after Filament, MIT), so a reflection shows as the
// bake shows light: 4% of a lamp is still far brighter than the wall beside it. Linear sRGB in and out.
vec3 shineAgX(vec3 color) {
  const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 fromRec2020 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 inset = mat3(
    vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
  );
  const mat3 outset = mat3(
    vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
  );
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  vec3 x = clamp((log2(max(inset * (toRec2020 * color), 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  x = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  return clamp(fromRec2020 * pow(max(outset * x, 0.0), vec3(2.2)), 0.0, 1.0);
}

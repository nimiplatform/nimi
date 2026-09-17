/** GLSL sources for the Simulator's photographic lunar-scene composite. */

export const SKY_VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;

void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/**
 * One full-screen hybrid pass:
 *  - preserves the clean photographic plate as geometry/texture authority;
 *  - applies only bounded, low-frequency scene modulation;
 *  - composites an independently textured and phased Earth.
 *
 * The solar direction is a lighting input only. No solar body is rendered.
 */
export const SKY_FRAG = `#version 300 es
precision highp float;

uniform sampler2D u_sceneTex;
uniform sampler2D u_earthSurfaceTex;
uniform sampler2D u_earthCloudTex;
uniform vec2 u_res;
uniform float u_sceneAspect;
uniform float u_sceneTime;
uniform float u_intensity;
uniform float u_earthshine;
uniform vec3 u_sunDirection;
uniform vec3 u_earthDirection;
uniform float u_cloudRotation;

in vec2 v_uv;
out vec4 outColor;

const float PI = 3.14159265;
const float TAU = 6.28318531;
const float EARTH_AXIAL_TILT = 0.40910518;

vec3 rotateZ(vec3 point, float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return vec3(
    cosine * point.x - sine * point.y,
    sine * point.x + cosine * point.y,
    point.z);
}

vec2 sphereUv(vec3 direction, float rotation) {
  vec3 tiltedDirection = rotateZ(direction, EARTH_AXIAL_TILT);
  // Rotate the texture in continuous longitude space. Rotating the direction
  // would move atan's branch cut across the visible disc; fract() would then
  // turn that cut into a false high-frequency mip seam.
  return vec2(
    atan(tiltedDirection.z, tiltedDirection.x) / TAU
      + 0.5
      - rotation / TAU,
    clamp(
      asin(clamp(tiltedDirection.y, -1.0, 1.0)) / PI + 0.5,
      0.002,
      0.998));
}

vec3 linearToSrgb(vec3 linearColor) {
  vec3 lower = linearColor * 12.92;
  vec3 upper =
    1.055 * pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.4))
    - 0.055;
  return mix(
    lower,
    upper,
    step(vec3(0.0031308), linearColor));
}

float henyeyGreenstein(float cosineTheta, float asymmetry) {
  float asymmetrySquared = asymmetry * asymmetry;
  float denominator = max(
    1.0 + asymmetrySquared - 2.0 * asymmetry * cosineTheta,
    0.001);
  return
    (1.0 - asymmetrySquared)
    / pow(denominator, 1.5);
}

float keyedCycle(
  float cycle,
  float night,
  float dawn,
  float day,
  float dusk
) {
  float t = fract(cycle);
  if (t < 0.25) {
    return mix(night, dawn, smoothstep(0.0, 0.25, t));
  }
  if (t < 0.50) {
    return mix(dawn, day, smoothstep(0.25, 0.50, t));
  }
  if (t < 0.75) {
    return mix(day, dusk, smoothstep(0.50, 0.75, t));
  }
  return mix(dusk, night, smoothstep(0.75, 1.0, t));
}

vec3 keyedCycle3(
  float cycle,
  vec3 night,
  vec3 dawn,
  vec3 day,
  vec3 dusk
) {
  float t = fract(cycle);
  if (t < 0.25) {
    return mix(night, dawn, smoothstep(0.0, 0.25, t));
  }
  if (t < 0.50) {
    return mix(dawn, day, smoothstep(0.25, 0.50, t));
  }
  if (t < 0.75) {
    return mix(day, dusk, smoothstep(0.50, 0.75, t));
  }
  return mix(dusk, night, smoothstep(0.75, 1.0, t));
}

vec2 sceneCoverUv() {
  float viewportAspect = u_res.x / max(u_res.y, 1.0);
  vec2 visibleFraction = vec2(
    min(1.0, viewportAspect / u_sceneAspect),
    min(1.0, u_sceneAspect / viewportAspect));
  return clamp(
    (v_uv - 0.5) * visibleFraction + 0.5,
    vec2(0.001),
    vec2(0.999));
}

float sceneSkyExposure(float cycle) {
  return keyedCycle(
    cycle,
    0.50,
    1.00,
    1.03,
    0.76);
}

vec3 sceneTemperature(float cycle) {
  return keyedCycle3(
    cycle,
    vec3(0.86, 0.90, 0.98),
    vec3(1.04, 1.00, 0.97),
    vec3(1.00, 1.00, 1.01),
    vec3(1.06, 0.94, 0.90));
}

float sceneGradeStrength(float cycle) {
  return keyedCycle(
    cycle,
    0.28,
    1.00,
    0.95,
    0.72);
}

vec3 sceneToneGrade(vec3 scene, float surfaceWeight) {
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float gradeStrength = sceneGradeStrength(u_sceneTime);
  float sourceLuma = dot(scene, LUMA);
  float blackPoint =
    mix(0.0010, 0.0065, surfaceWeight) * gradeStrength;
  float contrast =
    1.0
    + mix(0.015, 0.050, surfaceWeight) * gradeStrength;
  float gradedLuma =
    max((sourceLuma - blackPoint) / (1.0 - blackPoint), 0.0);
  gradedLuma = max(
    (gradedLuma - 0.18) * contrast + 0.18,
    0.0);
  scene *= gradedLuma / max(sourceLuma, 0.0001);
  float postGradeLuma = dot(scene, LUMA);
  return mix(
    vec3(postGradeLuma),
    scene,
    1.0
      + mix(0.008, 0.035, surfaceWeight)
        * gradeStrength);
}

vec3 modulatedScene(vec2 sceneUv) {
  // SRGB8_ALPHA8 decodes the source plate into linear light on sample.
  vec3 source = texture(u_sceneTex, sceneUv).rgb;

  // The soft mask is not geometry reconstruction. It only limits the amount
  // of low-frequency modulation applied to sky versus surface.
  float surfaceWeight =
    1.0 - smoothstep(0.46, 0.58, sceneUv.y);
  vec3 lowFrequencyPlate =
    textureLod(u_sceneTex, sceneUv, 2.1).rgb;
  float surfaceDetail = clamp(
    dot(
      source - lowFrequencyPlate,
      vec3(0.2126, 0.7152, 0.0722)),
    -0.055,
    0.055);
  source = max(
    source
      + vec3(surfaceDetail)
        * 0.075
        * surfaceWeight
        * sceneGradeStrength(u_sceneTime),
    vec3(0.0));

  float surfaceExposure = keyedCycle(
    u_sceneTime,
    0.34,
    1.00,
    1.06,
    0.70);
  float skyExposure = sceneSkyExposure(u_sceneTime);
  float exposure = mix(skyExposure, surfaceExposure, surfaceWeight);
  vec3 temperature = sceneTemperature(u_sceneTime);

  // A small grazing-light dodge/burn makes direction legible without
  // inventing new hard shadows in the fixed photographic geometry.
  float grazing =
    1.0 - smoothstep(0.10, 0.62, abs(u_sunDirection.z));
  float directional = 1.0
    + (0.5 - sceneUv.x)
      * u_sunDirection.x
      * grazing
      * 0.15
      * surfaceWeight;
  float intensityGain = 0.14 + 0.86 * clamp(u_intensity, 0.0, 2.0);
  float earthshine =
    u_earthshine
    * surfaceWeight
    * clamp(u_intensity, 0.0, 2.0);
  float earthshineGain = 1.0 + 0.045 * earthshine;
  vec3 earthshineTint = mix(
    vec3(1.0),
    vec3(0.96, 0.985, 1.035),
    0.30 * earthshine);

  vec3 scene =
    source
    * temperature
    * exposure
    * intensityGain
    * directional
    * earthshineGain
    * earthshineTint;
  return sceneToneGrade(scene, surfaceWeight);
}

vec3 earthLightDirection() {
  // Project the one shared lunar-local solar vector into the Earth view basis.
  vec3 earthViewZ = normalize(-u_earthDirection);
  vec3 basisReference = abs(earthViewZ.y) > 0.96
    ? vec3(1.0, 0.0, 0.0)
    : vec3(0.0, 1.0, 0.0);
  vec3 earthViewRight =
    normalize(cross(earthViewZ, basisReference));
  vec3 earthViewUp =
    normalize(cross(earthViewRight, earthViewZ));
  vec3 physicalEarthLight = normalize(vec3(
    // The plate's positive authored X points screen-left, while the sphere's
    // positive normal X and this view-basis vector point screen-right.
    -dot(u_sunDirection, earthViewRight),
    dot(u_sunDirection, earthViewUp),
    dot(u_sunDirection, earthViewZ)));
  // At and near conjunction the physical phase approaches a new Earth, but
  // the fixed photographic composition needs a quiet, legible distant Earth
  // whose key does not flip against the lower-left horizon. Preserve unbiased
  // state metadata and derive one bounded 20-30% presentation crescent from
  // that same authored plate key while the physical phase is below 30%.
  float conjunctionBias =
    1.0 - smoothstep(-0.72, -0.45, physicalEarthLight.z);
  const vec3 minimumCrescentLight =
    vec3(-0.6628, -0.4971, -0.5600);
  return normalize(mix(
    physicalEarthLight,
    minimumCrescentLight,
    conjunctionBias));
}

vec3 earthSurface(vec2 point, float radiusSquared) {
  vec3 normal = normalize(vec3(
    point,
    sqrt(max(1.0 - radiusSquared, 0.0))));
  const vec3 viewDirection = vec3(0.0, 0.0, 1.0);
  vec3 earthLight = earthLightDirection();
  float mu = dot(normal, earthLight);
  // At exact conjunction the presentation-only bias keeps one broad,
  // lower-left crescent. It remains derived from the shared light state and
  // does not create a second light direction.
  float conjunctionPresentation =
    1.0 - smoothstep(-0.60, -0.42, earthLight.z);
  float conjunctionCrescentGain =
    1.0 + 0.28 * conjunctionPresentation;
  float terminatorWidth = max(5.20 * fwidth(mu), 0.220);
  float dayMask = smoothstep(
    -terminatorWidth,
    terminatorWidth,
    mu);
  float noL = max(mu, 0.0);
  float wrappedNoL = max((mu + 0.14) / 1.14, 0.0);
  float noV = max(normal.z, 0.0);

  // The user-supplied Asia-facing plate is the surface identity authority.
  // Sample it in orthographic disc space instead of distorting it through an
  // equirectangular wrap.
  vec2 plateUv = point * 0.5 + 0.5;
  vec3 suppliedPlate =
    texture(u_earthSurfaceTex, plateUv, 0.45).rgb;
  // Divide out only the plate's low-frequency baked illumination field.
  // High-frequency geography and clouds remain source-preserved, while the
  // live solar vector becomes the sole large-scale light authority.
  vec3 suppliedPlateField =
    textureLod(u_earthSurfaceTex, plateUv, 4.8).rgb;
  float suppliedPlateFieldLuma = dot(
    suppliedPlateField,
    vec3(0.2126, 0.7152, 0.0722));
  float bakedLightCompensation = clamp(
    0.16 / max(suppliedPlateFieldLuma, 0.035),
    0.70,
    2.25);
  vec3 rawAlbedo = suppliedPlate
    * mix(1.0, bakedLightCompensation, 0.68);
  rawAlbedo = min(rawAlbedo, vec3(1.16));
  float rawAlbedoLuma =
    dot(rawAlbedo, vec3(0.2126, 0.7152, 0.0722));
  float displayAlbedoLuma = max(
    (rawAlbedoLuma - 0.10) * 0.88 + 0.10,
    0.0);
  float polarLatitude =
    clamp(abs(normal.y), 0.0, 1.0);
  float polarIce = smoothstep(0.62, 0.90, rawAlbedoLuma)
    * smoothstep(0.54, 0.86, polarLatitude);
  float polarLimb = 1.0 - smoothstep(0.03, 0.30, noV);
  float polarSurfaceTone = mix(0.70, 0.46, polarLimb);
  displayAlbedoLuma *= mix(1.0, polarSurfaceTone, polarIce);
  vec3 albedo = mix(
    vec3(rawAlbedoLuma),
    rawAlbedo,
    0.88);
  albedo *=
    displayAlbedoLuma / max(rawAlbedoLuma, 0.0001);
  albedo *= vec3(1.00, 0.99, 0.98);

  // Keep material classification independent from the display grade.
  float oceanSignal =
    rawAlbedo.b - max(rawAlbedo.r, rawAlbedo.g);
  float ocean =
    smoothstep(0.006, 0.050, oceanSignal)
    * (1.0 - smoothstep(0.34, 0.68, rawAlbedoLuma));
  float land = 1.0 - ocean;
  albedo *= mix(
    vec3(1.0),
    vec3(0.76, 0.92, 1.18),
    ocean * 0.20);
  albedo *= mix(
    vec3(1.0),
    vec3(1.035, 1.005, 0.94),
    land * 0.08);

  vec2 cloudUv = sphereUv(normal, u_cloudRotation);
  float cloudSignal =
    texture(u_earthCloudTex, cloudUv, 1.25).r;
  float cloud = smoothstep(0.16, 0.82, cloudSignal);

  const float cloudShellRadius = 1.0024;
  float lightAlongNormal = dot(normal, earthLight);
  float cloudIntersection = -lightAlongNormal + sqrt(max(
    lightAlongNormal * lightAlongNormal
      + cloudShellRadius * cloudShellRadius
      - 1.0,
    0.0));
  vec3 cloudShadowDirection = normalize(
    normal + earthLight * cloudIntersection);
  float cloudShadowSignal = texture(
    u_earthCloudTex,
    sphereUv(cloudShadowDirection, u_cloudRotation),
    1.40).r;
  float cloudShadow = smoothstep(0.14, 0.80, cloudShadowSignal);

  float surfaceDiffuse =
    0.012 + 1.30 * pow(wrappedNoL, 0.78);
  float cloudTransmittance =
    1.0 - 0.11 * cloudShadow * dayMask;
  vec3 litSurface =
    albedo
    * surfaceDiffuse
    * cloudTransmittance;

  vec3 halfVectorInput = earthLight + viewDirection;
  float halfVectorLength = length(halfVectorInput);
  float oceanSpecular = 0.0;
  if (halfVectorLength > 0.0001 && noL > 0.0 && noV > 0.0) {
    vec3 halfVector = halfVectorInput / halfVectorLength;
    float noH = max(dot(normal, halfVector), 0.0);
    float voH = max(dot(viewDirection, halfVector), 0.0);
    const float roughness = 0.16;
    const float alphaSquared =
      roughness * roughness * roughness * roughness;
    float ggxDenominator =
      noH * noH * (alphaSquared - 1.0) + 1.0;
    float distribution =
      alphaSquared
      / max(PI * ggxDenominator * ggxDenominator, 0.0001);
    float geometryK =
      (roughness + 1.0) * (roughness + 1.0) / 8.0;
    float geometryV =
      noV / max(noV * (1.0 - geometryK) + geometryK, 0.0001);
    float geometryL =
      noL / max(noL * (1.0 - geometryK) + geometryK, 0.0001);
    float fresnel =
      0.0204
      + (1.0 - 0.0204) * pow(1.0 - voH, 5.0);
    oceanSpecular =
      distribution
      * geometryV
      * geometryL
      * fresnel
      / max(4.0 * noV * noL, 0.0001);
  }
  vec3 oceanGlint =
    vec3(0.38, 0.48, 0.62)
    * oceanSpecular
    * ocean
    * dayMask
    * (1.0 - 0.88 * cloud)
    * 0.16;

  float cloudPhase = clamp(
    0.78
      + 0.14 * henyeyGreenstein(
        dot(-earthLight, viewDirection),
        0.55),
    0.78,
    1.28);
  vec3 cloudReflectance =
    vec3(0.64, 0.67, 0.70)
    * (0.008 + 1.15 * pow(wrappedNoL, 0.70))
    * cloudPhase
    * mix(0.54, 1.0, smoothstep(0.03, 0.48, noV));
  vec3 daylight =
    (
      mix(
        litSurface,
        cloudReflectance,
        cloud * 0.10)
      + oceanGlint
    ) * conjunctionCrescentGain;
  float albedoLuma =
    dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  float nightVolume =
    mix(0.58, 1.18, pow(noV, 0.70));
  vec3 nightAlbedo = mix(
    vec3(albedoLuma),
    albedo,
    0.32);
  vec3 nightBase = vec3(0.0014, 0.0042, 0.0086);
  vec3 nightDetail =
    nightAlbedo * vec3(0.0090, 0.0105, 0.0125)
    + cloud * vec3(0.0025, 0.0028, 0.0032);
  float nightEarthshine =
    mix(0.92, 1.08, clamp(u_earthshine, 0.0, 1.0));
  vec3 nightSurface =
    (nightBase + nightDetail)
    * nightVolume
    * nightEarthshine;
  // One continuous blend owns the terminator. Avoid multiplying a Lambert
  // lobe by a second hard shadow mask, which reads as painted black.
  vec3 surfaceRadiance =
    mix(nightSurface, daylight, dayMask);

  // Atmosphere belongs to Earth only. Keep it restrained and soft so the
  // globe sits in the photographic field instead of reading as an icon.
  float rim = pow(
    1.0 - clamp(normal.z, 0.0, 1.0),
    2.80);
  float litRim = smoothstep(-0.10, 0.16, mu);
  vec3 atmosphere =
    vec3(0.10, 0.18, 0.27)
    * rim
    * litRim
    * 0.16
    * (1.0 + 0.32 * conjunctionPresentation);
  float terminatorBand =
    exp(-abs(mu) * 18.0)
    * smoothstep(0.04, 0.72, noV);
  vec3 terminatorHaze =
    mix(
      vec3(0.055, 0.075, 0.12),
      vec3(0.18, 0.070, 0.025),
      smoothstep(-0.10, 0.10, mu))
    * terminatorBand
    * smoothstep(-0.04, 0.14, mu)
    * (0.026 + 0.040 * cloud);
  float earthGain = 0.42 + 0.50 * clamp(u_intensity, 0.0, 2.0);
  // Bright polar rows in the satellite inputs become spatially compressed at
  // grazing view angles. Attenuate the surface/cloud composite toward every
  // limb, while keeping the atmospheric shell independent and continuous.
  float limbTransmission =
    mix(0.18, 1.0, smoothstep(0.02, 0.74, noV));
  vec3 earth =
    (
      surfaceRadiance * limbTransmission
      + atmosphere
      + terminatorHaze
    ) * earthGain;
  earth *= mix(
    1.0,
    sceneSkyExposure(u_sceneTime),
    0.10);
  return earth;
}

void main() {
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 sceneUv = sceneCoverUv();
  vec3 color = modulatedScene(sceneUv);

  vec2 projectedEarth =
    u_earthDirection.xy / max(abs(u_earthDirection.z), 0.5);
  const vec2 baseProjectedEarth = vec2(0.32 / 0.85, 0.42 / 0.85);
  vec2 earthParallax = projectedEarth - baseProjectedEarth;
  vec2 earthCenter =
    vec2(0.738, 0.730) + earthParallax * vec2(0.045, 0.040);
  const float earthRadius = 0.0531;
  vec2 earthPoint =
    (v_uv - earthCenter) * vec2(aspect, 1.0) / earthRadius;
  float earthDistance = length(earthPoint);

  float halo =
    smoothstep(0.99, 1.00, earthDistance)
    * (1.0 - smoothstep(1.00, 1.025, earthDistance));
  vec3 earthLight = earthLightDirection();
  vec2 haloDirection = earthDistance > 0.0001
    ? earthPoint / earthDistance
    : vec2(0.0);
  float haloLight =
    smoothstep(-0.10, 0.34, dot(haloDirection, earthLight.xy));
  vec3 haloTint = mix(
    color,
    vec3(0.045, 0.060, 0.085),
    0.25);
  color +=
    haloTint
    * halo
    * haloLight
    * 0.006
    * (0.45 + 0.55 * u_earthshine);

  float edgeWidth = max(
    2.30 * fwidth(earthDistance),
    0.0045);
  float discAlpha =
    1.0 - smoothstep(1.0 - edgeWidth, 1.0 + edgeWidth, earthDistance);
  if (discAlpha > 0.0) {
    float radiusSquared = min(dot(earthPoint, earthPoint), 1.0);
    vec3 earth = earthSurface(earthPoint, radiusSquared);

    // Borrow only the plate's low-frequency chromaticity. Earth keeps its
    // own luminance and remains fully opaque, so stars cannot show through.
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    vec3 plateField =
      textureLod(u_sceneTex, sceneUv, 4.0).rgb
      * sceneTemperature(u_sceneTime);
    float plateFieldLuma = max(dot(plateField, LUMA), 0.0001);
    vec3 plateChromaticity = clamp(
      plateField / plateFieldLuma,
      vec3(0.78),
      vec3(1.22));
    plateChromaticity /=
      max(dot(plateChromaticity, LUMA), 0.0001);
    float earthLuma = dot(earth, LUMA);
    vec3 lowChromaEarth = mix(
      vec3(earthLuma),
      earth,
      0.58);
    earth = mix(
      lowChromaEarth,
      plateChromaticity * earthLuma,
      0.12);

    color = mix(color, earth, discAlpha);
  }

  // The default framebuffer is not sRGB; encode the linear composite once.
  color = linearToSrgb(clamp(color, vec3(0.0), vec3(1.0)));
  outColor = vec4(color, 1.0);
}
`;

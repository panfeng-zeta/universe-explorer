// Positive sidereal periods and full 0..180 degree obliquities. Do not negate
// Venus/Uranus periods as well: their tilted axes already express retrograde spin.
// Sources and reference conventions are documented in CREDITS.txt.
export const rotationModels = {
  sun: { hours: 609.12, tilt: 7.25 },
  mercury: { hours: 1407.6, tilt: .034 },
  venus: { hours: 5832.6, tilt: 177.36 },
  earth: { hours: 23.9345, tilt: 23.44 },
  mars: { hours: 24.6229, tilt: 25.19 },
  jupiter: { hours: 9.925, tilt: 3.13 },
  saturn: { hours: 10 + 33 / 60 + 38 / 3600, tilt: 26.73 },
  uranus: { hours: 17 + 14 / 60 + 52 / 3600, tilt: 97.77 },
  neptune: { hours: 16.11, tilt: 28.32 }
};
const TAU = Math.PI * 2;
export function orbitAngle(body, days) {
  return body.phase + (body.period ? days / body.period * TAU * (body.retrograde ? -1 : 1) : 0);
}
export function spinAngle(body, days) {
  // With XZ=(cos a,-sin a), local +X rotated by pi+a always faces the parent.
  // Satellite poles/orbits are idealized as coplanar; no libration model.
  if (body.parent) return Math.PI + orbitAngle(body, days);
  const period = rotationModels[body.id].hours / 24;
  // +Y is the north of the ecliptic; geographic texture north is local +Y.
  return (body.id === 'earth' ? 3.8 : body.phase) + (days % period) / period * TAU;
}
export function sunDirection(body, days, catalog) {
  const planet = body.parent ? catalog[body.parent] : body;
  const angle = orbitAngle(planet, days);
  // Parallel sunlight for a close-up; moon distance is negligible at this scale.
  return { x: -Math.cos(angle), y: 0, z: Math.sin(angle) };
}

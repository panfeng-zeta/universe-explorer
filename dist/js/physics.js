export const AU_KM=149597870.7;
export const SOLAR_MU=1.32712440018e11;
export function hohmann(fromAU,toAU){
  if(!Number.isFinite(fromAU)||!Number.isFinite(toAU)||fromAU<=0||toAU<=0||fromAU===toAU)throw new RangeError('Choose two different planets');
  const r1=fromAU*AU_KM,r2=toAU*AU_KM,a=(r1+r2)/2;
  const seconds=Math.PI*Math.sqrt(a**3/SOLAR_MU);
  const departureBurn=Math.abs(Math.sqrt(SOLAR_MU*(2/r1-1/a))-Math.sqrt(SOLAR_MU/r1));
  const arrivalBurn=Math.abs(Math.sqrt(SOLAR_MU/r2)-Math.sqrt(SOLAR_MU*(2/r2-1/a)));
  const phaseRaw=Math.PI-Math.sqrt(SOLAR_MU/r2**3)*seconds;
  const phase=((phaseRaw*180/Math.PI+180)%360+360)%360-180;
  return {days:seconds/86400,deltaV:departureBurn+arrivalBurn,departureBurn,arrivalBurn,phase};
}
// A focused ellipse: departure at x=r1 and arrival at x=-r2.
// E is solved from Kepler's equation to preserve elapsed-time progression.
export function transferPosition(r1,r2,progress){
  const a=(r1+r2)/2,e=(r2-r1)/(r1+r2),M=Math.PI*Math.min(1,Math.max(0,progress));
  let E=M;for(let i=0;i<16;i++)E-=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));
  return {x:a*(Math.cos(E)-e),z:a*Math.sqrt(1-e*e)*Math.sin(E)};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {hohmann,transferPosition,AU_KM,SOLAR_MU} from '../dist/js/physics.js';
import {planets,moons,bodies,byId} from '../dist/js/data.js';
import {strings} from '../dist/js/i18n.js';
test('eight planets, twenty moons, unique ids, valid parents and translations',()=>{
 assert.equal(planets.filter(p=>p.type!=='star').length,8);assert.equal(moons.length,20);assert.equal(new Set(bodies.map(b=>b.id)).size,29);
 for(const m of moons){assert.ok(byId[m.parent]);assert.ok(m.period>0&&m.radius>0&&m.orbitKm>byId[m.parent].radius)}
 for(const b of bodies)for(const l of ['zh','en','ja'])assert.ok(b.name[l]&&b.description[l]);
 for(const l of ['en','ja'])assert.deepEqual(Object.keys(strings[l]).sort(),Object.keys(strings.zh).sort());
});
test('Earth to Mars matches JPL educational Hohmann example',()=>{
 const r=hohmann(1,1.5237);assert.ok(Math.abs(r.days-258.869)<.01);assert.ok(Math.abs(r.deltaV-5.59374)<.001);assert.ok(Math.abs(r.phase-44.345)<.01);
});
test('inward transfer is symmetric in time and delta-v with negative phase',()=>{
 const a=hohmann(1,1.5237),b=hohmann(1.5237,1);assert.equal(a.days,b.days);assert.ok(Math.abs(a.deltaV-b.deltaV)<1e-9);assert.ok(Math.abs(b.phase+75.143)<.01);
});
test('every ordered planet pair has a finite transfer and rendezvous',()=>{
 for(const from of planets.slice(1))for(const to of planets.slice(1)){if(from===to)continue;const r=hohmann(from.au,to.au);assert.ok(r.days>0&&r.deltaV>0&&Number.isFinite(r.phase));const start=transferPosition(from.au,to.au,0),end=transferPosition(from.au,to.au,1);assert.ok(Math.abs(start.x-from.au)<1e-9);assert.ok(Math.abs(end.x+to.au)<1e-9);assert.ok(Math.abs(end.z)<1e-8);const targetAngle=r.phase*Math.PI/180+Math.sqrt(SOLAR_MU/(to.au*AU_KM)**3)*r.days*86400;assert.ok(Math.abs(Math.cos(targetAngle)+1)<1e-9);for(let p=0;p<=1;p+=.05){const point=transferPosition(from.au,to.au,p);assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.z))}}
});
test('rejects invalid route inputs',()=>{for(const [a,b]of [[1,1],[0,1],[-1,2],[NaN,2],[1,Infinity]])assert.throws(()=>hohmann(a,b),RangeError)});

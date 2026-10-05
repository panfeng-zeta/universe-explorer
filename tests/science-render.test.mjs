import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { planets, moons, byId } from '../dist/js/data.js';
import { rotationModels, orbitAngle, spinAngle, sunDirection } from '../dist/js/orientation.js';
import { RenderLoop } from '../dist/js/render-loop.js';
import { UniverseScene, qualityProfiles } from '../dist/js/scene.js';
import { hohmann } from '../dist/js/physics.js';

test('spin follows sidereal time, poles stay fixed, Venus and Uranus reverse exactly once', () => {
  for (const body of planets) {
    const model = rotationModels[body.id];
    assert.ok(model.hours > 0 && model.tilt >= 0 && model.tilt <= 180);
    const quarter = model.hours / 24 / 4;
    assert.ok(Math.abs(spinAngle(body, quarter) - spinAngle(body, 0) - Math.PI / 2) < 1e-10);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), model.tilt * Math.PI / 180);
    const pole = new THREE.Vector3(0,1,0).applyQuaternion(tilt);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), spinAngle(body, quarter));
    assert.ok(pole.distanceTo(new THREE.Vector3(0,1,0).applyQuaternion(tilt.clone().multiply(spin))) < 1e-10);
    assert.equal(pole.y < 0, ['venus','uranus'].includes(body.id));
    // Surface spin about the geographic north pole has positive handedness.
    const start = new THREE.Vector3(1,0,0).applyQuaternion(tilt);
    const next = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),.01).applyQuaternion(tilt);
    assert.ok(start.clone().cross(next).dot(pole)>0);
  }
  assert.equal(rotationModels.earth.hours, 23.9345);
  assert.ok(Math.abs(spinAngle(byId.earth, 0) - spinAngle(byId.earth, rotationModels.earth.hours / 24)) < 1e-9);
});

test('every synchronous moon keeps the same local face toward its parent, including retrograde Triton', () => {
  for (const body of moons) for (const fraction of [0,.125,.25,.5,.75,1]) {
    const days = body.period * fraction;
    const angle = orbitAngle(body, days);
    const face = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), spinAngle(body, days));
    assert.ok(face.dot(new THREE.Vector3(-Math.cos(angle),0,Math.sin(angle))) > 1-1e-10);
  }
  assert.ok(orbitAngle(byId.triton,1) < orbitAngle(byId.triton,0));
});

test('sun direction opposes heliocentric position and gives opposite seasonal illumination after half an orbit', () => {
  for (const body of planets.slice(1)) {
    const a = orbitAngle(body, 17), light = sunDirection(body,17,byId);
    assert.ok(Math.abs(light.x*Math.cos(a)-light.z*Math.sin(a)+1) < 1e-10);
  }
  assert.deepEqual(sunDirection(byId.moon,0,byId),sunDirection(byId.earth,0,byId));
  const a=sunDirection(byId.earth,0,byId), b=sunDirection(byId.earth,byId.earth.period/2,byId);
  assert.ok(Math.abs(a.x+b.x)<1e-10 && Math.abs(a.z+b.z)<1e-10);
});

function clock() {
  let time=0, id=0;const pending=new Map();
  return { now:()=>time, request:callback=>{pending.set(++id,callback);return id}, cancel:key=>pending.delete(key),
    get pending(){return pending.size}, advance(ms=20){time+=ms;const callbacks=[...pending.values()];pending.clear();callbacks.forEach(callback=>callback(time))},
    drain(){for(let i=0;pending.size&&i<500;i++)this.advance();assert.equal(pending.size,0,'render loop must settle')}
  };
}
test('demand loop sleeps, deduplicates invalidation, limits low-quality rendering and excludes hidden time', () => {
  const c=clock(), elapsed=[];let moving=false, loop;
  loop=new RenderLoop(dt=>{elapsed.push(dt);if(elapsed.length===1)loop.invalidate();return moving}, {...c,fps:30});
  loop.invalidate();loop.invalidate();assert.equal(c.pending,1);
  c.advance(16);assert.equal(elapsed.length,0);c.advance(18);assert.equal(elapsed.length,1);
  c.drain();assert.equal(elapsed.length,2);c.advance(2000);assert.equal(elapsed.length,2);
  moving=true;loop.invalidate();c.advance(40);loop.setVisible(false);assert.equal(c.pending,0);
  c.advance(60000);loop.setVisible(true);c.advance(40);assert.ok(elapsed.at(-1)<.05);
  loop.dispose();assert.equal(c.pending,0);loop.invalidate();assert.equal(c.pending,0);
});

class Element extends EventTarget {
  clientWidth=900;clientHeight=700;style={};classList={toggle(){}};
  children=[];append(child){this.children.push(child)}replaceChildren(){this.children=[]}
}
function sceneHarness(t) {
  const saved={};
  for(const key of ['document','window','ResizeObserver','devicePixelRatio']) saved[key]=Object.getOwnPropertyDescriptor(globalThis,key);
  const document=new EventTarget();document.hidden=false;document.createElement=()=>new Element();
  Object.assign(globalThis,{document,window:new EventTarget(),ResizeObserver:class{observe(){}disconnect(){}},devicePixelRatio:2});
  const c=clock(),loaded=[], completions=[],notifications=[];
  const renderer={domElement:new Element(),capabilities:{getMaxAnisotropy:()=>16},renders:0,setPixelRatio(value){this.pixelRatio=value},setSize(){},render(scene,camera){scene.updateMatrixWorld();camera.updateMatrixWorld();this.renders++},dispose(){}};
  const controls=new EventTarget();controls.target=new THREE.Vector3();controls.update=()=>false;controls.dispose=()=>{};
  const scene=new UniverseScene(new Element(),new Element(),{
    onSelect(){},onFrame:(days,flight)=>notifications.push({days,progress:flight?.progress}),onError(){},
    rendererFactory:()=>renderer,controlsFactory:()=>controls,loopFactory:draw=>new RenderLoop(draw,c),
    textureLoader:{load(url,complete){loaded.push(url);completions.push(complete);return new THREE.Texture()}}
  });
  t.after(()=>{scene.dispose();for(const [key,descriptor]of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]});
  return {scene,c,renderer,controls,loaded,completions,notifications,document};
}

test('real scene lazily creates visible bodies, shares cloud texture and wakes all paused controls', t => {
  const {scene,c,renderer,controls,loaded,completions}=sceneHarness(t);
  scene.setPaused(true);c.drain();assert.deepEqual([...scene.objects.keys()],['earth','moon']);
  assert.equal(loaded.length,3);assert.equal(scene.clouds.material.map,scene.clouds.material.alphaMap);
  const before=renderer.renders;c.advance(1000);assert.equal(renderer.renders,before);
  for(const action of [()=>scene.zoom(.8),()=>scene.resetCamera(),()=>scene.setDisplay('labels',false),()=>scene.setDisplay('orbits',false),()=>scene.resize(),()=>completions[0](),()=>scene.resetTime()]){
    const previous=renderer.renders;action();c.drain();assert.ok(renderer.renders>previous);
  }
  assert.ok([...scene.labels.values()].every(label=>label.hidden));
  let damping=3;controls.update=()=>damping-->0;controls.dispatchEvent(new Event('change'));const renders=renderer.renders;c.drain();assert.ok(renderer.renders>=renders+4);
  scene.setLanguage('ja');scene.select('jupiter');c.drain();assert.equal(scene.labels.get('jupiter').textContent,'木星');assert.equal(scene.objects.get('earth').group.visible,false);
  scene.select('earth');c.drain();assert.equal(loaded.filter(url=>url.endsWith('/clouds.jpg')).length,1);
});

test('quality changes preserve simulation and camera; hidden scene sleeps and flight completion reports its last frame', t => {
  const {scene,c,renderer,document,notifications,completions}=sceneHarness(t);
  scene.setPaused(true);scene.days=123;scene.updatePositions();c.drain();
  const camera=scene.camera.position.clone();scene.setQuality('low');c.drain();
  assert.equal(scene.days,123);assert.equal(scene.paused,true);assert.equal(scene.selected,'earth');assert.ok(camera.equals(scene.camera.position));
  assert.equal(renderer.pixelRatio,1);assert.equal(scene.stars.geometry.drawRange.count,qualityProfiles.low.stars);assert.equal(scene.clouds.visible,false);
  const lowVertices=scene.objects.get('earth').mesh.geometry.attributes.position.count;
  scene.setQuality('standard');c.drain();assert.ok(scene.objects.get('earth').mesh.geometry.attributes.position.count>lowVertices*4);assert.equal(scene.clouds.visible,true);
  scene.setPaused(false);c.advance();const day=scene.days;document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(c.pending,0);c.advance(60000);assert.equal(scene.days,day);
  document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));c.advance();assert.ok(scene.days-day<.1);
  scene.startFlight(byId.earth,byId.mars,hohmann(1,1.5237));scene.flight.progress=.9999;scene.cameraGoal=null;c.drain();
  assert.equal(scene.flight.progress,1);assert.equal(notifications.at(-1).progress,1);assert.equal(scene.paused,false);
  const arrival=scene.flightPoint(1),target=scene.objects.get('mars').group.position;
  assert.ok(Math.hypot(arrival.x-target.x,arrival.z-target.z)<1e-8);
  const frames=renderer.renders;c.advance(2000);assert.equal(renderer.renders,frames);
  scene.resetTime();assert.equal(scene.flight,null);assert.equal(scene.days,0);assert.equal(c.pending,1);
  scene.dispose();completions[0]();assert.equal(c.pending,0);
});

test('pausing inside the notification interval synchronizes both clock and flight progress', t => {
  const {scene,c,notifications}=sceneHarness(t);
  scene.setSpeed(1000);c.advance(20);scene.setPaused(true);
  assert.equal(notifications.at(-1).days,scene.days);assert.equal(scene.days,20);c.drain();
  scene.startFlight(byId.earth,byId.mars,hohmann(1,1.5237));scene.setPaused(false);c.advance(20);scene.setPaused(true);
  assert.equal(notifications.at(-1).progress,scene.flight.progress);c.drain();
});

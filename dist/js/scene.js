import * as THREE from '../vendor/three.module.js';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {planets,moons,bodies,byId} from './data.js';
import {transferPosition,AU_KM,SOLAR_MU} from './physics.js';
import {rotationModels,orbitAngle,spinAngle,sunDirection} from './orientation.js';
import {RenderLoop} from './render-loop.js';
const TAU=Math.PI*2;
export const qualityProfiles={standard:{pixelRatio:1.7,widthSegments:72,heightSegments:48,stars:2500,anisotropy:8,fps:60},low:{pixelRatio:1,widthSegments:32,heightSegments:20,stars:700,anisotropy:2,fps:30}};
export const orbitRadius=au=>au===0?0:10+Math.log1p(au)*21;
export class UniverseScene{
 constructor(container,labelRoot,{onSelect,onFrame,onError,quality='standard',rendererFactory=options=>new THREE.WebGLRenderer(options),controlsFactory=(camera,element)=>new OrbitControls(camera,element),textureLoader=new THREE.TextureLoader(),loopFactory=draw=>new RenderLoop(draw)}){
  this.container=container;this.labelRoot=labelRoot;this.onSelect=onSelect;this.onFrame=onFrame;this.onError=onError;this.days=0;this.speed=1;this.paused=false;this.mode='planet';this.selected='earth';this.lang='zh';this.showOrbits=true;this.showLabels=true;this.flight=null;this.disposed=false;this.lastNotify=0;this.quality=qualityProfiles[quality]?quality:'standard';
  this.renderer=rendererFactory({antialias:true,alpha:true,powerPreference:'default'});this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;container.append(this.renderer.domElement);
  this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(40,1,.02,1600);this.controls=controlsFactory(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.07;this.controls.minDistance=4;this.controls.maxDistance=290;this.controls.addEventListener('start',()=>{this.cameraGoal=null});
  this.scene.add(new THREE.AmbientLight('#b6d4ed',.16));this.light=new THREE.DirectionalLight('#fff4df',2.6);this.scene.add(this.light,this.light.target);this.sunLight=new THREE.PointLight('#fff4df',2.6,0,0);this.scene.add(this.sunLight);
  this.objects=new Map();this.labels=new Map();this.orbits=new Map();this.meshes=[];this.loader=textureLoader;this.textures=new Map();this.textureMaterials=new Map();this.failedTextures=new Set();this.spheres=new Map();
  this.makeStars();this.makeOrbitLines();this.makeFlightObjects();this.setQuality(this.quality);
  this.loop=loopFactory((dt,now)=>this.animate(dt,now));this.loop.fps=qualityProfiles[this.quality].fps;
  this.controls.addEventListener('change',()=>this.invalidate());
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();this.select('earth',true);
  const raycaster=new THREE.Raycaster();let down=null;container.addEventListener('pointerdown',e=>down={x:e.clientX,y:e.clientY});container.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const r=container.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.camera);const hit=raycaster.intersectObjects(this.meshes.filter(m=>this.objects.get(m.userData.id).group.visible));if(hit.length)this.onSelect(hit[0].object.userData.id)});
  this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.loop.setVisible(false);this.onError('webglError')});
  this.onVisibility=()=>this.loop.setVisible(!document.hidden);document.addEventListener('visibilitychange',this.onVisibility);
  this.onPageShow=()=>this.onVisibility();window.addEventListener('pageshow',this.onPageShow);
  this.onVisibility();
 }
 invalidate(){this.loop?.invalidate()}
 texture(id){
  if(this.textures.has(id))return this.textures.get(id);
  const texture=this.loader.load(new URL('../assets/'+id+'.jpg',import.meta.url).href,()=>{if(!this.disposed)this.invalidate()},undefined,()=>{
   if(this.disposed)return;this.failedTextures.add(id);
   for(const material of this.textureMaterials.get(id)||[]){material.map=null;material.alphaMap=null;material.color.set(byId[id]?.color||'#ffffff');material.needsUpdate=true}
   if(id==='clouds'&&this.clouds)this.clouds.visible=false;this.onError('textureError');this.invalidate();
  });
  texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(qualityProfiles[this.quality].anisotropy,this.renderer.capabilities.getMaxAnisotropy());this.textures.set(id,texture);return texture;
 }
 bindTexture(id,material){if(!this.textureMaterials.has(id))this.textureMaterials.set(id,new Set());this.textureMaterials.get(id).add(material)}
 sphere(){if(!this.spheres.has(this.quality)){const q=qualityProfiles[this.quality];this.spheres.set(this.quality,new THREE.SphereGeometry(1,q.widthSegments,q.heightSegments))}return this.spheres.get(this.quality)}
 ensureBody(body){if(!this.objects.has(body.id))this.makeBody(body)}
 setQuality(value){
  this.quality=qualityProfiles[value]?value:'standard';const q=qualityProfiles[this.quality];
  this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,q.pixelRatio));
  const sphere=this.sphere();for(const {group}of this.objects.values())group.traverse(o=>{if(o.userData.sphere)o.geometry=sphere;if(o.userData.detail)o.visible=this.quality!=='low'&&!(o===this.clouds&&this.failedTextures.has('clouds'))});
  for(const texture of this.textures.values()){texture.anisotropy=Math.min(q.anisotropy,this.renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true}
  this.stars.geometry.setDrawRange(0,q.stars);if(this.loop)this.loop.fps=q.fps;this.resize();this.invalidate();
 }
 makeBody(body){
  const group=new THREE.Group();const axis=new THREE.Group();axis.rotation.z=(rotationModels[body.id]?.tilt||0)*Math.PI/180;group.add(axis);const textured=!body.parent||body.id==='moon';
  const material=body.id==='sun'?new THREE.MeshBasicMaterial({map:this.texture('sun'),color:'#ffdfac'}):new THREE.MeshStandardMaterial({map:textured?this.texture(body.id):null,color:textured?'#ffffff':body.color,roughness:.93,metalness:0});
  const mesh=new THREE.Mesh(this.sphere(),material);mesh.userData.id=body.id;mesh.userData.sphere=true;axis.add(mesh);this.meshes.push(mesh);this.scene.add(group);this.objects.set(body.id,{group,axis,mesh,body});if(textured)this.bindTexture(body.id,material);
  if(!body.parent){const axisLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-1.4,0),new THREE.Vector3(0,1.4,0)]),new THREE.LineBasicMaterial({color:'#bddbd8',transparent:true,opacity:.42}));axis.add(axisLine);this.objects.get(body.id).axisLine=axisLine}
  if(body.id==='earth'){
   const atmosphere=new THREE.Mesh(this.sphere(),new THREE.ShaderMaterial({uniforms:{glowColor:{value:new THREE.Color('#4ba3d4')}},vertexShader:'varying vec3 vN;varying vec3 vP;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vP=p.xyz;gl_Position=projectionMatrix*p;}',fragmentShader:'varying vec3 vN;varying vec3 vP;uniform vec3 glowColor;void main(){float a=pow(1.0-max(dot(normalize(vN),normalize(-vP)),0.0),4.0);gl_FragColor=vec4(glowColor,a*.52);}',transparent:true,side:THREE.FrontSide,depthWrite:false,blending:THREE.AdditiveBlending}));atmosphere.scale.setScalar(1.025);atmosphere.userData={sphere:true,detail:true};atmosphere.visible=this.quality!=='low';axis.add(atmosphere);
   const cloudTexture=this.texture('clouds');const clouds=new THREE.Mesh(this.sphere(),new THREE.MeshStandardMaterial({map:cloudTexture,alphaMap:cloudTexture,transparent:true,opacity:.55,depthWrite:false}));clouds.scale.setScalar(1.008);clouds.userData={sphere:true,detail:true};clouds.visible=this.quality!=='low'&&!this.failedTextures.has('clouds');axis.add(clouds);this.clouds=clouds;this.bindTexture('clouds',clouds.material);
  }
  if(body.id==='saturn'){
   const ringGeometry=new THREE.RingGeometry(1.28,2.28,160,1);const pos=ringGeometry.attributes.position,uv=ringGeometry.attributes.uv;
   for(let i=0;i<pos.count;i++){const r=Math.hypot(pos.getX(i),pos.getY(i));uv.setXY(i,(r-1.28),0)}
   const ring=new THREE.Mesh(ringGeometry,new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;void main(){float r=vUv.x;float band=.62+.16*sin(r*125.)+.09*sin(r*360.);float gap=1.-smoothstep(.57,.58,r)*(1.-smoothstep(.62,.63,r));vec3 c=mix(vec3(.36,.31,.23),vec3(.79,.74,.59),band);gl_FragColor=vec4(c,band*gap*.88);}'}));ring.rotation.x=-Math.PI/2;axis.add(ring);
  }
  if(body.id==='sun'){
   const glow=new THREE.Mesh(this.sphere(),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.BackSide,blending:THREE.AdditiveBlending,vertexShader:'varying vec3 n;varying vec3 p;void main(){vec4 v=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);p=v.xyz;gl_Position=projectionMatrix*v;}',fragmentShader:'varying vec3 n;varying vec3 p;void main(){float f=pow(max(0.,dot(normalize(n),normalize(p))),3.);gl_FragColor=vec4(1.,.39,.05,f*.13);}'}));glow.scale.setScalar(1.35);glow.userData={sphere:true,detail:true};glow.visible=this.quality!=='low';axis.add(glow);
  }
  const label=document.createElement('button');label.className='planet-label';label.textContent=body.name[this.lang];label.addEventListener('click',()=>this.onSelect(body.id));this.labelRoot.append(label);this.labels.set(body.id,label);
 }
 makeStars(){let seed=87219;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};const p=[],colors=[];for(let i=0;i<2500;i++){const theta=rand()*TAU,z=rand()*2-1,r=450+rand()*200,s=Math.sqrt(1-z*z);p.push(r*s*Math.cos(theta),r*z,r*s*Math.sin(theta));const lum=.2+rand()*.65;colors.push(lum*.85,lum*.93,lum)}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));this.stars=new THREE.Points(g,new THREE.PointsMaterial({size:.65,sizeAttenuation:true,vertexColors:true,transparent:true,opacity:.75}));this.scene.add(this.stars)}
 circle(radius,color,opacity){const p=[];for(let i=0;i<=180;i++){const a=i/180*TAU;p.push(new THREE.Vector3(Math.cos(a)*radius,0,Math.sin(a)*radius))}return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(p),new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false}))}
 makeOrbitLines(){for(const p of planets.slice(1)){const orbit=this.circle(orbitRadius(p.au),'#7094a7',.17);this.scene.add(orbit);this.orbits.set(p.id,orbit)}for(const moon of moons){const orbit=this.circle(1,'#6c8c9a',.2);this.scene.add(orbit);this.orbits.set(moon.id,orbit)}}
 makeFlightObjects(){this.flightGroup=new THREE.Group();this.scene.add(this.flightGroup);this.flightGroup.visible=false;this.ship=new THREE.Mesh(new THREE.ConeGeometry(.38,1.5,6),new THREE.MeshBasicMaterial({color:'#d5fff0'}));this.flightGroup.add(this.ship);this.flightLine=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:'#bcebd4',dashSize:1,gapSize:.7,transparent:true,opacity:.9}));this.flightGroup.add(this.flightLine)}
 localMoonRadius(m){const siblings=moons.filter(x=>x.parent===m.parent);return 5.5+siblings.indexOf(m)*1.3+Math.log1p(m.orbitKm/100000)*.75}
 select(id,instant=false){this.selected=id;this.mode='planet';this.flight=null;this.flightGroup.visible=false;this.configureView();this.resetCamera(instant)}
 overview(instant=false){this.mode='orbit';this.flight=null;this.flightGroup.visible=false;this.configureView();this.resetCamera(instant)}
 configureView(){const selected=byId[this.selected];for(const body of bodies)if(this.mode==='orbit'?!body.parent:body.id===selected.id||body.parent===selected.id)this.ensureBody(body);for(const {group,body,axisLine}of this.objects.values()){group.visible=this.mode==='orbit'?!body.parent:body.id===selected.id||body.parent===selected.id;group.scale.setScalar(this.mode==='orbit'?body.size:body.id===selected.id?3.2:Math.max(.1,body.radius/selected.radius*3.2));if(axisLine)axisLine.visible=this.mode==='planet';if(this.mode==='planet'&&body.id===selected.id)group.position.set(0,0,0)}this.updatePositions();this.updateOrbits();this.invalidate()}
 resetCamera(instant=false){const isOrbit=this.mode==='orbit',ringed=this.selected==='saturn',narrow=this.camera.aspect<.8;this.controls.minDistance=isOrbit?8:4.3;this.controls.maxDistance=isOrbit?300:90;const closeDistance=Math.max(ringed?23:15.7,(ringed?7.3:3.2)/Math.tan(this.camera.fov*Math.PI/360)/this.camera.aspect*1.12);const dest=isOrbit?new THREE.Vector3(16,98,127):new THREE.Vector3(0,ringed?closeDistance*.3:3.5,closeDistance);const target=isOrbit?new THREE.Vector3(-4,0,0):new THREE.Vector3(narrow?0:-.9,1.1,0);if(instant){this.camera.position.copy(dest);this.controls.target.copy(target);this.controls.update()}else this.cameraGoal={dest,target};this.invalidate()}
 zoom(factor){this.cameraGoal=null;const offset=this.camera.position.clone().sub(this.controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,this.controls.minDistance,this.controls.maxDistance));this.camera.position.copy(this.controls.target).add(offset);this.controls.update();this.invalidate()}
 setLanguage(lang){this.lang=lang;for(const [id,label]of this.labels)label.textContent=byId[id].name[lang];this.invalidate()}
 setPaused(value){this.paused=value;this.onFrame(this.days,this.flight);this.invalidate()}
 setSpeed(value){this.speed=value;this.invalidate()}
 setDisplay(key,value){if(key==='orbits'){this.showOrbits=value;this.updateOrbits()}if(key==='labels')this.showLabels=value;this.invalidate()}
 resetTime(){this.days=0;this.flight=null;this.flightGroup.visible=false;this.updatePositions();this.onFrame(this.days,null);this.invalidate()}
 updateOrbits(){for(const[id,line]of this.orbits){const b=byId[id];line.visible=this.showOrbits&&(this.mode==='orbit'?!b.parent:b.parent===this.selected);if(b.parent&&this.mode==='planet')line.scale.setScalar(this.localMoonRadius(b))}this.invalidate()}
 updatePositions(){const motionDays=this.flight?this.days+this.flight.result.days*this.flight.progress:this.days;for(const {body,group,mesh}of this.objects.values()){
  if(!group.visible)continue;
  mesh.rotation.y=spinAngle(body,motionDays);if(body.id==='earth'&&this.clouds)this.clouds.rotation.y=mesh.rotation.y;
  if(this.mode==='planet'){if(body.id===this.selected)group.position.set(0,0,0);else{const angle=orbitAngle(body,this.days),r=this.localMoonRadius(body);group.position.set(Math.cos(angle)*r,0,-Math.sin(angle)*r)}continue}
  if(body.id==='sun'){group.position.set(0,0,0);continue}
  let angle=body.phase+this.days/body.period*TAU;
  if(this.flight){const f=this.flight;const elapsed=f.result.days*86400*f.progress;const omega=Math.sqrt(SOLAR_MU/(body.au*AU_KM)**3);angle=(body.id===f.from.id?0:body.id===f.to.id?f.result.phase*Math.PI/180:body.phase)+omega*elapsed}
  const r=orbitRadius(body.au);group.position.set(Math.cos(angle)*r,0,-Math.sin(angle)*r)
 }this.updateLighting()}
 updateLighting(){this.sunLight.visible=this.mode==='orbit';this.light.visible=this.mode==='planet';if(this.mode==='planet'){const direction=sunDirection(byId[this.selected],this.days,byId);this.light.position.set(direction.x*80,direction.y*80,direction.z*80);this.light.target.position.set(0,0,0)}}
 startFlight(from,to,result){this.mode='orbit';this.flight={from,to,result,progress:0};this.configureView();this.flightGroup.visible=true;this.resetCamera();const points=[];for(let i=0;i<=160;i++)points.push(this.flightPoint(i/160));this.flightLine.geometry.dispose();this.flightLine.geometry=new THREE.BufferGeometry().setFromPoints(points);this.flightLine.computeLineDistances();const r=Math.max(orbitRadius(from.au),orbitRadius(to.au));this.cameraGoal={dest:new THREE.Vector3(0,r*1.5,r*1.9),target:new THREE.Vector3(0,0,0)};this.updatePositions()}
 flightPoint(t){const p=transferPosition(this.flight.from.au,this.flight.to.au,t),r=Math.hypot(p.x,p.z),s=orbitRadius(r)/r;return new THREE.Vector3(p.x*s,.25,-p.z*s)}
 updateLabels(){const w=this.container.clientWidth,h=this.container.clientHeight;const occupied=[];for(const[id,label]of this.labels){const o=this.objects.get(id);const visible=this.showLabels&&o.group.visible&&!(this.mode==='planet'&&id===this.selected);label.hidden=!visible;if(!visible)continue;const world=o.group.position.clone();if(this.mode==='planet'){const direction=world.clone().sub(this.camera.position),length=direction.length();direction.normalize();const near=-this.camera.position.dot(direction);if(near>0&&near<length&&this.camera.position.clone().addScaledVector(direction,near).length()<3.2){label.hidden=true;continue}}world.y-=o.group.scale.x+.32;const v=world.project(this.camera);if(v.z>1||v.z< -1||Math.abs(v.x)>1.15||Math.abs(v.y)>1.15){label.hidden=true;continue}const x=(v.x+1)*w/2;let y=(-v.y+1)*h/2;for(const prev of occupied)if(Math.abs(prev.x-x)<90&&Math.abs(prev.y-y)<20)y=prev.y+21;occupied.push({x,y});label.style.left=x+'px';label.style.top=y+'px';label.classList.toggle('selected',id===this.selected)}}
 resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.invalidate()}
 animate(dt,now){const wasMoving=!this.paused&&(!this.flight||this.flight.progress<1);const previous=this.flight?.progress;if(wasMoving){if(this.flight)this.flight.progress=Math.min(1,this.flight.progress+dt/22);else this.days+=dt*this.speed}
  this.updatePositions();if(this.flight){const p=this.flightPoint(this.flight.progress);this.ship.position.copy(p);const next=this.flightPoint(Math.min(1,this.flight.progress+.001));if(next.distanceTo(p)>.0001)this.ship.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),next.sub(p).normalize())}
  if(this.cameraGoal){const blend=1-Math.exp(-dt*6);this.camera.position.lerp(this.cameraGoal.dest,blend);this.controls.target.lerp(this.cameraGoal.target,blend);if(this.camera.position.distanceTo(this.cameraGoal.dest)<.025)this.cameraGoal=null}
  const damping=this.controls.update();this.updateLabels();this.renderer.render(this.scene,this.camera);
  const moving=(!this.paused&&(!this.flight||this.flight.progress<1))||!!this.cameraGoal||damping;
  const arrived=previous<1&&this.flight?.progress===1;if(arrived||!moving||now-this.lastNotify>=120){this.onFrame(this.days,this.flight);this.lastNotify=now}
  return moving;
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.loop.dispose();document.removeEventListener('visibilitychange',this.onVisibility);window.removeEventListener('pageshow',this.onPageShow);this.resizeObserver.disconnect();this.controls.dispose();const geometries=new Set(this.spheres.values()),materials=new Set();this.scene.traverse(obj=>{if(obj.geometry)geometries.add(obj.geometry);if(obj.material)for(const material of Array.isArray(obj.material)?obj.material:[obj.material])materials.add(material)});for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const texture of this.textures.values())texture.dispose();this.renderer.dispose();this.labelRoot.replaceChildren()}
}

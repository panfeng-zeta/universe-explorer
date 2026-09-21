import {planets,moons,bodies,byId} from './data.js';
import {strings,locale} from './i18n.js';
import {hohmann} from './physics.js';
import {UniverseScene} from './scene.js';
const $=id=>document.getElementById(id);
let lang='zh';try{const saved=localStorage.getItem('universe-language');if(strings[saved])lang=saved}catch{}
let selected='earth',mode='planet',scene=null,paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
const epoch=Date.UTC(2026,8,21);let days=0;
const t=key=>strings[lang][key]??key;
const fmt=(n,max=1)=>new Intl.NumberFormat(locale[lang],{maximumFractionDigits:max}).format(n);
function renderCatalog(){
 const parent=byId[selected].parent??selected;
 $('body-list').innerHTML=planets.map((p,i)=>`<button class="body-item ${selected===p.id?'active':''}" data-body="${p.id}" aria-pressed="${selected===p.id}"><span class="body-thumb" style="background-color:${p.color};background-image:url('/assets/${p.id}.jpg')"></span><span><strong>${p.name[lang]}</strong><small>${t(p.type)}</small></span><span class="body-number">${String(i).padStart(2,'0')}</span></button>${p.id===parent&&moons.some(m=>m.parent===p.id)?`<div class="moon-list">${moons.filter(m=>m.parent===p.id).map(m=>`<button class="moon-item ${selected===m.id?'active':''}" data-body="${m.id}" aria-pressed="${selected===m.id}"><i class="moon-dot"></i>${m.name[lang]}<span>↗</span></button>`).join('')}</div>`:''}`).join('');
}
function fact(label,value,unit=''){return `<div class="fact"><dt>${label}</dt><dd>${value}<small>${unit}</small></dd></div>`}
function renderBody(){
 const b=byId[selected],overview=mode==='orbit';
 $('breadcrumb').textContent=overview?t('solar'):b.name[lang];$('body-type').textContent=overview?t('overviewType'):t(b.type);$('body-name').textContent=overview?t('overviewTitle'):b.name[lang].split(' · ').at(-1);$('body-description').textContent=overview?t('overviewDesc'):b.description[lang];
 $('planet-view').classList.toggle('active',!overview);$('orbit-view').classList.toggle('active',overview);
 $('planet-view').setAttribute('aria-pressed',!overview);$('orbit-view').setAttribute('aria-pressed',overview);
 $('location-code').textContent=overview?'SOL / 01 · '+t('explorationScale'):b.parent?t('around')+' '+byId[b.parent].name[lang]:'SOL / '+String(planets.indexOf(b)).padStart(2,'0')+' · '+fmt(b.au,3)+' AU '+t('fromSun');
 if(overview)$('facts-grid').innerHTML=fact(t('planetCount'),'8')+fact(t('moonCount'),'20')+fact(t('age'),'4.6',t('billion'));
 else $('facts-grid').innerHTML=fact(t('radius'),fmt(b.radius),'km')+fact(t('period'),b.period?fmt(b.period>1000?b.period/365.25:b.period,2):'—',b.period?(b.period>1000?t('year'):t('days')):'')+fact(t(b.parent?'parentDistance':'gravity'),fmt(b.parent?b.orbitKm:b.gravity,b.parent?0:2),b.parent?'km':'m/s²');
 renderCatalog();
}
function chooseBody(id){if(!byId[id])throw new Error('Unknown celestial body');selected=id;mode='planet';scene?.select(id);clearFlightUI();renderBody();$('catalog').classList.remove('open')}
function overview(){mode='orbit';scene?.overview();clearFlightUI();renderBody()}
function clearFlightUI(){$('flight-progress').hidden=true;$('scene-status').textContent='';$('explore-tab').classList.add('active');$('flight-tab').classList.remove('active');updateClock()}
function renderRouteOptions(){for(const [id,defaultId]of [['departure','earth'],['destination','mars']]){const old=$(id).value||defaultId;$(id).innerHTML=planets.slice(1).map(p=>`<option value="${p.id}">${p.name[lang]}</option>`).join('');$(id).value=old}updateEstimate()}
function updateEstimate(){const from=byId[$('departure').value],to=byId[$('destination').value];if(from.id===to.id){$('transfer-days').textContent='—';$('delta-v').textContent='—';$('phase-angle').textContent='—';$('plot-course').disabled=true;$('scene-status').textContent=t('chooseDifferent');return}const result=hohmann(from.au,to.au);$('transfer-days').textContent=fmt(result.days,1);$('delta-v').textContent=fmt(result.deltaV,2)+' km/s';$('phase-angle').textContent=fmt(Math.abs(result.phase),1)+'° '+t(result.phase>=0?'ahead':'behind');$('target-distance').textContent=fmt(to.au,3)+' AU';$('plot-course').disabled=false;document.querySelector('.mission-art h3').textContent=t('headingTo')+to.name[lang];if(!scene?.flight)$('scene-status').textContent=''}
function plot(){const from=byId[$('departure').value],to=byId[$('destination').value];if(from===to||!scene)return;const result=hohmann(from.au,to.au);mode='orbit';scene.startFlight(from,to,result);paused=false;scene.paused=false;updatePlay();$('flight-progress').hidden=false;$('scene-status').textContent=t('flightStatus');$('explore-tab').classList.remove('active');$('flight-tab').classList.add('active');renderBody();$('flight-meter').value=0;$('flight-label').textContent=t('flightRunning');if(innerWidth<=950)$('mission').classList.remove('open')}
function updateClock(){const date=new Date(epoch+days*86400000);$('simulation-date').textContent=date.toLocaleDateString(locale[lang],{year:'numeric',month:'short',day:'2-digit',timeZone:'UTC'});$('simulation-date').dateTime=date.toISOString().slice(0,10)}
function updatePlay(){$('play-pause').textContent=paused?'▶':'Ⅱ';$('play-pause').ariaLabel=t(paused?'play':'pause');$('play-pause').title=t(paused?'play':'pause')}
function translate(){document.documentElement.lang=locale[lang];$('language').value=lang;document.title=t('brand')+' · Universe Explorer';document.querySelectorAll('[data-i18n]').forEach(el=>{const key=el.dataset.i18n;if(typeof t(key)==='string')el.textContent=t(key)});for(const[id,key]of Object.entries({'zoom-in':'zoomIn','zoom-out':'zoomOut','reset-camera':'resetCamera',fullscreen:'fullScreen','swap-route':'swap','close-about':'close','catalog-toggle':'atlas'})){$(id).ariaLabel=t(key);$(id).title=t(key)}$('observatory').ariaLabel=t('solar');document.querySelector('.trajectory-diagram').ariaLabel=t('missionModel');$('about-content').innerHTML=t('aboutText').map(p=>`<p>${p}</p>`).join('')+`<p><a href="https://ssd.jpl.nasa.gov/planets/phys_par.html" target="_blank" rel="noreferrer">NASA / JPL ↗</a> · <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noreferrer">Solar System Scope ↗</a> · <a href="/CREDITS.txt" target="_blank">Credits ↗</a></p>`;renderBody();renderRouteOptions();scene?.setLanguage(lang);if(scene?.flight)$('scene-status').textContent=t('flightStatus');updateClock();updatePlay()}
translate();
try{scene=new UniverseScene($('scene'),$('labels'),{onSelect:chooseBody,onError:key=>{$('scene-status').textContent=t(key)},onFrame:(d,flight)=>{days=d;updateClock();if(flight){$('flight-label').textContent=flight.progress>=1?t('flightArrived'):t('elapsed')+' '+fmt(flight.progress*flight.result.days,0)+' / '+fmt(flight.result.days,0)+' '+t('days');$('flight-meter').value=flight.progress}}});scene.paused=paused;scene.setLanguage(lang)}catch(error){console.error(error);$('scene').innerHTML=`<p class="error-message">${t('webglError')}</p>`;$('plot-course').disabled=true}
$('body-list').addEventListener('click',e=>{const b=e.target.closest('[data-body]');if(b)chooseBody(b.dataset.body)});
$('language').addEventListener('change',e=>{lang=e.target.value;try{localStorage.setItem('universe-language',lang)}catch{}translate()});
$('planet-view').onclick=()=>chooseBody(selected);$('orbit-view').onclick=overview;$('system-home').onclick=()=>{overview();$('catalog').classList.remove('open')};
$('explore-tab').onclick=()=>{$('mission').classList.remove('open');chooseBody(selected)};
$('flight-tab').onclick=()=>{$('mission').classList.toggle('open');$('explore-tab').classList.remove('active');$('flight-tab').classList.add('active');$('departure').focus()};
$('zoom-in').onclick=()=>scene?.zoom(.8);$('zoom-out').onclick=()=>scene?.zoom(1.25);$('reset-camera').onclick=()=>scene?.resetCamera();$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('observatory').requestFullscreen()}catch{}};
$('play-pause').onclick=()=>{paused=!paused;if(scene)scene.paused=paused;updatePlay()};
$('speed-controls').addEventListener('click',e=>{const button=e.target.closest('[data-speed]');if(!button)return;const speed=Number(button.dataset.speed);if(scene)scene.speed=speed;document.querySelectorAll('[data-speed]').forEach(b=>b.classList.toggle('active',b===button))});
$('reset-time').onclick=()=>{if(scene){scene.days=0;scene.flight=null;scene.flightGroup.visible=false;scene.updatePositions()}days=0;clearFlightUI();updateClock()};
$('show-orbits').onchange=e=>{if(scene){scene.showOrbits=e.target.checked;scene.updateOrbits()}};$('show-labels').onchange=e=>{if(scene)scene.showLabels=e.target.checked};
for(const id of ['departure','destination'])$(id).onchange=()=>{if(scene?.flight){scene.overview();clearFlightUI()}updateEstimate()};
$('swap-route').onclick=()=>{const a=$('departure').value;$('departure').value=$('destination').value;$('destination').value=a;if(scene?.flight){scene.overview();clearFlightUI()}updateEstimate()};
$('plot-course').onclick=plot;$('replay-flight').onclick=plot;$('catalog-toggle').onclick=()=>$('catalog').classList.toggle('open');
$('about-button').onclick=()=>$('about-dialog').showModal();$('close-about').onclick=()=>$('about-dialog').close();$('about-dialog').addEventListener('click',e=>{if(e.target===$('about-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||$('about-dialog').open)return;if(e.code==='Space'){e.preventDefault();$('play-pause').click()}if(e.key==='Escape'){$('catalog').classList.remove('open');$('mission').classList.remove('open')}});
// Optional browser tool bridge uses the exact same navigation action as the UI.
if(document.modelContext?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});try{Promise.resolve(document.modelContext.registerTool({name:'explore_celestial_body',description:'Select and show one celestial body in the solar system explorer.',inputSchema:{type:'object',properties:{id:{type:'string',enum:bodies.map(b=>b.id)}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||typeof input.id!=='string'||!byId[input.id])throw new Error('Unknown celestial body');chooseBody(input.id);return {selected:input.id,name:byId[input.id].name[lang],view:'planet'}}},{signal:lifecycle.signal})).catch(console.warn)}catch(e){console.warn(e)}}
window.addEventListener('pagehide',()=>scene?.dispose(),{once:true});

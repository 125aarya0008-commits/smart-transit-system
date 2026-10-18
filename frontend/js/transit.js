/* Standalone public transit explorer. Never labels unverified observations as live. */
const config = window.TRANSIT_CONFIG || {};
const root = document.getElementById('root');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let feed, disruptions=[], selectedTrip, activeStop='';
const subscriptions = () => JSON.parse(localStorage.getItem('best-subscriptions') || '[]');
const saveSubscriptions = v => localStorage.setItem('best-subscriptions', JSON.stringify(v));
const byId = id => feed.stops.find(s=>s.stop_id===id);
const routeFor = t => feed.routes.find(r=>r.route_id===t.route_id);
function detour(trip, blockedIds) {
  const affected = trip.stop_ids.filter(id=>blockedIds.includes(id));
  if (!affected.length) return {affected, alternatives:[]};
  const options=feed.trips.filter(t=>t.trip_id!==trip.trip_id && t.stop_ids[0]===trip.stop_ids[0] && t.stop_ids.at(-1)===trip.stop_ids.at(-1) && !t.stop_ids.some(id=>blockedIds.includes(id)));
  return {affected,alternatives:options};
}
function effectiveDisruptions(){return [...disruptions,...JSON.parse(localStorage.getItem('best-demo-disruptions')||'[]')];}
function display(){
  const mode=feed.metadata?.mode||'unverified';
  const choices=feed.trips.map(t=>`<option value="${esc(t.trip_id)}" ${t.trip_id===selectedTrip?'selected':''}>${esc(routeFor(t)?.route_short_name)} — ${esc(t.trip_id)}</option>`).join('');
  const trip=feed.trips.find(t=>t.trip_id===selectedTrip)||feed.trips[0];selectedTrip=trip?.trip_id;
  const issues=effectiveDisruptions().filter(d=>d.status==='active' && (!d.route_id||d.route_id===trip?.route_id));
  const blocked=[...new Set(issues.flatMap(d=>d.blocked_stop_ids||[]))];
  const reroute=trip?detour(trip,blocked):{affected:[],alternatives:[]};
  const subs=subscriptions();
  const shortRouteWarning = trip && trip.stop_ids.length <= 5
    ? `<p class="hint" role="status"><strong>Limited stop information:</strong> This trip contains only ${trip.stop_ids.length} recorded stops. Intermediate stops may be missing from the source data.</p>`
    : '';
  root.innerHTML=`<div class="transit-wrap"><header class="transit-head"><div><div class="eyebrow">SMART TRANSIT NETWORK SYSTEM · V2</div><h1>Mumbai BEST Route Explorer</h1><p>Station and stop-based journey monitoring · independent static website</p></div><a href="legacy.html">Original networking console ↗</a></header>
  <div class="source-banner"><strong>${mode==='simulation'?'SIMULATION — NOT LIVE BEST DATA':'UNVERIFIED DATA — NOT OFFICIAL LIVE STATUS'}</strong><span>${esc(feed.metadata?.source||'Source not specified')}</span></div>
  <div class="transit-grid"><section class="transit-panel"><h2>Explore a complete route</h2><label for="trip">Route / direction / trip</label><select id="trip">${choices}</select>
<div class="route-sub">${esc(routeFor(trip)?.route_long_name||'')}</div>${shortRouteWarning}<ol class="stop-list">
${(trip?.stop_ids||[]).map((id,i)=>`<li class="${blocked.includes(id)?'skipped':''}"><span>${i+1}</span><div><b>${esc(byId(id)?.stop_name||id)}</b><small>${blocked.includes(id)?'Potentially skipped — demo scenario':'Stop ID: '+esc(id)}</small></div></li>`).join('')}</ol></section>
  <section class="transit-panel"><h2>Service changes</h2><p class="hint">Verified alerts require an authenticated operator feed. A simulated disruption can be tested below.</p><div id="issues">${issues.length?issues.map(d=>`<div class="incident"><b>${esc(d.title||'Service disruption')}</b><p>${esc(d.description||'')}</p><small>${esc(d.source||'Simulation')} · ${esc(d.status)}</small></div>`).join(''):'<p>No published disruption in the loaded dataset. This does not confirm that service is normal.</p>'}</div><h3>Rerouting suggestions</h3>${reroute.affected.length?`<p>Affected stops: ${reroute.affected.map(id=>esc(byId(id)?.stop_name||id)).join(', ')}</p>`:'<p>No skipped stops in the loaded scenario.</p>'}${reroute.alternatives.length?reroute.alternatives.map(t=>`<div class="suggestion">Possible alternate route: <b>${esc(routeFor(t)?.route_short_name)}</b><small>Graph-level demo only; operational feasibility not verified</small></div>`).join(''):'<p>No validated alternative route in this dataset. Do not infer a usable detour.</p>'}<div class="actions"><button id="demo">Simulate skipped stop</button><button id="clear" class="outline">Clear demo</button></div></section>
  <section class="transit-panel"><h2>Passenger alerts</h2><p class="hint">Subscribe to a route and boarding stop. In-page alerts work without a backend. System push delivery requires a separate authorized push sender.</p><label for="boarding">Boarding stop</label><select id="boarding">${(trip?.stop_ids||[]).map(id=>`<option value="${esc(id)}" ${id===activeStop?'selected':''}>${esc(byId(id)?.stop_name||id)}</option>`).join('')}</select><div class="actions"><button id="subscribe">Subscribe on this browser</button><button id="permission" class="outline">Enable notifications</button></div><h3>My subscriptions</h3><div id="subscriptions">${subs.length?subs.map(s=>`<div class="subscription">${esc(s.route_id)} · ${esc(byId(s.stop_id)?.stop_name||s.stop_id)} <button class="remove" data-route="${esc(s.route_id)}" data-stop="${esc(s.stop_id)}">Remove</button></div>`).join(''):'No subscriptions yet.'}</div><h3>Relevant alerts</h3><div id="relevant">${subs.flatMap(s=>effectiveDisruptions().filter(d=>d.status==='active'&&(!d.route_id||d.route_id===s.route_id)&& (d.blocked_stop_ids||[]).includes(s.stop_id)).map(d=>`<div class="incident">${esc(d.title)} · ${esc(s.route_id)}<small>${esc(d.source||'Simulation')}</small></div>`)).join('')||'No matching alerts in the loaded dataset.'}</div></section>
  <section class="transit-panel"><h2>Data coverage</h2><div class="metrics"><div><b>${feed.stops.length}</b><span>Stops</span></div><div><b>${feed.routes.length}</b><span>Routes</span></div><div><b>${feed.trips.length}</b><span>Trips</span></div></div><p class="hint">Station/stop data, trip order and directions can be imported from an authorized GTFS Schedule ZIP. Static data is a snapshot; automatic real-world changes require a trusted realtime feed and scheduled ingestion.</p><p><b>Data mode:</b> ${esc(mode)}<br><b>Generated:</b> ${esc(feed.metadata?.generated_at||'Not applicable')}</p></section></div></div>`;
  document.getElementById('trip').onchange=e=>{selectedTrip=e.target.value;activeStop='';display()};
  document.getElementById('boarding').onchange=e=>activeStop=e.target.value;
  document.getElementById('subscribe').onclick=()=>{const s={route_id:trip.route_id,stop_id:document.getElementById('boarding').value};if(!s.stop_id)return;saveSubscriptions([...subs.filter(x=>x.route_id!==s.route_id||x.stop_id!==s.stop_id),s]);display()};
  document.getElementById('permission').onclick=async()=>{if(!('Notification'in window))return alert('Notifications unsupported in this browser');const result=await Notification.requestPermission();alert('Notification permission: '+result+'; remote push delivery is not configured.')};
  document.querySelectorAll('.remove').forEach(b=>b.onclick=()=>{saveSubscriptions(subs.filter(s=>s.route_id!==b.dataset.route||s.stop_id!==b.dataset.stop));display()});
  document.getElementById('demo').onclick=()=>{const id=trip.stop_ids[Math.floor(trip.stop_ids.length/2)];localStorage.setItem('best-demo-disruptions',JSON.stringify([{id:'local-'+Date.now(),route_id:trip.route_id,blocked_stop_ids:[id],title:'Simulated stop closure',description:'Demonstration only. No official BEST diversion has been reported.',source:'LOCAL SIMULATION',status:'active'}]));display();const matching=subscriptions().some(s=>s.route_id===trip.route_id&&s.stop_id===id);if(matching&&Notification.permission==='granted')new Notification('SIMULATION: Stop disruption',{body:'Demo alert for '+(byId(id)?.stop_name||id)})};
  document.getElementById('clear').onclick=()=>{localStorage.removeItem('best-demo-disruptions');display()};
}
async function start(){try{const [a,b]=await Promise.all([fetch(config.dataUrl||'data/transit.json'),fetch(config.disruptionUrl||'data/disruptions.json')]);if(!a.ok||!b.ok)throw Error('Data fetch failed');feed=await a.json();disruptions=(await b.json()).disruptions||[];if(!Array.isArray(feed.stops)||!Array.isArray(feed.routes)||!Array.isArray(feed.trips))throw Error('Invalid feed schema');display();}catch(e){root.textContent='Transit dataset unavailable: '+e.message+' — verify config.js and the data/ folder.'}}
start();

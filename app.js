import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.0/+esm';

const PLAN_URL = './training-plan.json';
const LOCAL_KEY = 'veni-vici-local-sessions-v1';
const CACHE_KEY = 'veni-vici-cache-sessions-v1';
const INSTALL_DISMISS_KEY = 'veni-vici-install-dismissed-v1';
const STATUS_LABELS = { planned: 'Prévue', done: 'Faite', skipped: 'Sautée' };
const DAY_NAMES = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

const state = {
  plan: null,
  sessions: [],
  currentDate: localISO(new Date()),
  selectedWeek: 1,
  supabase: null,
  user: null,
  demoMode: false,
  offline: !navigator.onLine,
  installPrompt: null,
  currentView: 'todayView'
};

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function localISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function parseISO(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true; }
function isiOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isMobile(){ return window.matchMedia('(max-width: 820px)').matches; }
function installCardDismissed(){ return localStorage.getItem(INSTALL_DISMISS_KEY)==='1'; }
function dismissInstallCard(){ localStorage.setItem(INSTALL_DISMISS_KEY,'1'); updateInstallUI(); }
function addDays(s,n){ const d=parseISO(s); d.setDate(d.getDate()+n); return localISO(d); }
function formatDate(s, opts={weekday:'long',day:'numeric',month:'long'}){ return new Intl.DateTimeFormat('fr-FR',opts).format(parseISO(s)); }
function slotLabel(slot){ return slot === 'am' ? 'Matin' : 'Soir'; }
function num(v){ const n=Number(v); return Number.isFinite(n) ? n : 0; }
function sortSessions(a,b){ const order={am:0,pm:1}; return a.scheduled_date.localeCompare(b.scheduled_date) || (order[a.slot]??9)-(order[b.slot]??9) || (a.time_label||'').localeCompare(b.time_label||''); }
function planDay(date){ return state.plan?.days?.find(d => d.date === date) || null; }
function routineForDate(date){ const name=DAY_NAMES[parseISO(date).getDay()]; return state.plan?.resources?.eveningRoutine?.find(r => r.day === name); }
function weekForDate(date){ const d=planDay(date); if(d) return d.week; const start=parseISO(state.plan.meta.startDate); const target=parseISO(date); return Math.max(1, Math.min(12, Math.floor((target-start)/604800000)+1)); }
function dateForWeekDay(week, dayIndex){ return addDays(state.plan.meta.startDate,(week-1)*7+dayIndex); }
function configReady(){ const c=window.APP_CONFIG||{}; return c.supabaseUrl?.startsWith('https://') && !c.supabaseUrl.includes('YOUR-PROJECT') && c.supabasePublishableKey && !c.supabasePublishableKey.includes('REPLACE_ME'); }
function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.add('hidden'),2400); }
function updateConnectionBadge(){
  const el=$('connectionBadge');
  if(state.offline){ el.textContent='Hors ligne'; return; }
  if(state.demoMode){ el.textContent='Mode local'; return; }
  el.textContent=state.user ? 'Synchronisé' : 'Connexion';
}

async function init(){
  state.plan = await fetch(PLAN_URL,{cache:'no-store'}).then(r=>{ if(!r.ok) throw new Error('training-plan.json introuvable'); return r.json(); });
  state.currentDate = localISO(new Date());
  state.selectedWeek = weekForDate(state.currentDate);
  bindUI();
  registerPWA();

  if(!configReady()){
    state.demoMode=true;
    loadLocalSessions();
    updateConnectionBadge();
    renderAll();
    return;
  }

  const cfg=window.APP_CONFIG;
  state.supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true}});
  const {data:{session}}=await state.supabase.auth.getSession();
  if(session?.user){
    state.user=session.user;
    await loadSessions();
  } else {
    showAuth();
    const cached=readCache();
    if(cached.length) state.sessions=cached;
  }
  state.supabase.auth.onAuthStateChange(async(_event,sessionNow)=>{
    state.user=sessionNow?.user||null;
    if(state.user){ hideAuth(); await loadSessions(); }
    else showAuth();
    updateConnectionBadge(); renderAll();
  });
  updateConnectionBadge();
  renderAll();
}

function loadLocalSessions(){
  const saved=localStorage.getItem(LOCAL_KEY);
  if(saved){ try{ state.sessions=JSON.parse(saved); return; }catch{} }
  state.sessions=state.plan.sessions.map((s,i)=>({...s,id:`local-${i+1}`,user_id:'local'}));
  saveLocalSessions();
}
function saveLocalSessions(){ if(state.demoMode) localStorage.setItem(LOCAL_KEY,JSON.stringify(state.sessions)); localStorage.setItem(CACHE_KEY,JSON.stringify(state.sessions)); }
function readCache(){ try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'[]')}catch{return[]} }

async function loadSessions(){
  if(!state.user||!state.supabase) return;
  const {data,error}=await state.supabase.from('training_sessions').select('*').order('scheduled_date').order('slot');
  if(error){
    console.error(error);
    const cached=readCache();
    if(cached.length){ state.sessions=cached; toast('Données en cache : synchronisation indisponible'); }
    else toast(`Erreur Supabase : ${error.message}`);
    return;
  }
  if(!data.length){ await seedPlan(); return; }
  state.sessions=data.sort(sortSessions);
  saveLocalSessions();
  renderAll();
}

async function seedPlan(){
  if(state.demoMode){ loadLocalSessions(); renderAll(); return; }
  if(!state.user) return;
  const rows=state.plan.sessions.map(s=>({...s,user_id:state.user.id}));
  for(let i=0;i<rows.length;i+=50){
    const chunk=rows.slice(i,i+50);
    const {error}=await state.supabase.from('training_sessions').upsert(chunk,{onConflict:'user_id,source_key',ignoreDuplicates:false});
    if(error){ toast(`Import impossible : ${error.message}`); throw error; }
  }
  toast('Plan Excel importé');
  await loadSessions();
}

async function persistSession(id,updates){
  if(state.demoMode){
    const idx=state.sessions.findIndex(s=>s.id===id);
    if(idx>=0) state.sessions[idx]={...state.sessions[idx],...updates};
    saveLocalSessions(); renderAll(); return true;
  }
  if(state.offline){ toast('Modification impossible hors ligne'); return false; }
  const {data,error}=await state.supabase.from('training_sessions').update(updates).eq('id',id).select().single();
  if(error){ toast(`Erreur : ${error.message}`); return false; }
  const idx=state.sessions.findIndex(s=>s.id===id);
  if(idx>=0) state.sessions[idx]=data;
  state.sessions.sort(sortSessions); saveLocalSessions(); renderAll(); return true;
}

function isModified(s){
  const o=s.original_data||{};
  const fields=['scheduled_date','slot','time_label','title','duration_min','rpe','elevation_m','nutrition','instructions'];
  return fields.some(k=>String(s[k]??'')!==String(o[k]??''));
}
function isMoved(s){ const o=s.original_data||{}; return s.scheduled_date!==o.scheduled_date || s.slot!==o.slot; }

function getLibraryDetail(session){
  const title=(session.title||'').toLowerCase();
  const lib=state.plan.resources.sessionLibrary||[];
  const find=name=>lib.find(x=>x.name===name);
  if(title.includes('6×3') && title.includes('côte')) return find("VO2 côte 6×3'");
  if(title.includes('5×4') && title.includes('côte')) return find("VO2 côte 5×4'");
  if(title.includes('8×2') && title.includes('côte')) return find("VO2 côte 8×2' raides");
  if(title.includes('2×20') && title.includes('seuil')) return find("Seuil bas 2×20'");
  if(title.includes('3×15') && title.includes('seuil')) return find("Seuil 3×15'");
  if(title.includes('sortie longue')) return find('Sortie longue spécifique');
  if(title.includes('vélotaf')) return find('Vélotaf endurance');
  if(title.includes('home trainer') || /^ht\b/.test(title)) return find('HT récupération');
  if(title.includes('endurance') || title.includes('footing') || title.includes('récupération')) return find('Endurance facile');
  return null;
}
function getStrengthDetail(session){
  const title=(session.title||'').toLowerCase();
  if(!title.includes('force')&&!title.includes('renforcement')) return null;
  const referenceWeek=Number(session.original_data?.week ?? session.week);
  return state.plan.resources.strength.find(x=>x.week===referenceWeek)||null;
}
function getHeatDetail(session){
  const title=(session.title||'').toLowerCase();
  if(!(title.includes('chaleur')||num(session.heat_min)>0)) return null;
  const referenceWeek=Number(session.original_data?.week ?? session.week);
  const referenceDate=session.original_data?.original_date || session.original_date || session.scheduled_date;
  const day=session.original_data?.day_name || session.day_name || DAY_NAMES[parseISO(referenceDate).getDay()];
  return state.plan.resources.heat.find(x=>x.week===referenceWeek && (x.day===day || x.day.startsWith(day))) || null;
}
function getNutritionGuide(session){
  const rows=state.plan.resources.nutrition.session||[];
  const title=(session.title||'').toLowerCase();
  if(title.includes('chaleur')||num(session.heat_min)>0) return rows.find(x=>x.situation==='Chaleur');
  if(num(session.duration_min)>180||title.includes('sortie longue')) return rows.find(x=>x.situation==='Sortie >3 h');
  if(num(session.rpe)>=6||title.includes('seuil')||title.includes('côte')) return rows.find(x=>x.situation.includes('Intensité'));
  if(num(session.duration_min)>90) return rows.find(x=>x.situation.includes("90'–3 h"));
  return rows.find(x=>x.situation.includes("Footing <75'"));
}

function renderAll(){ updateConnectionBadge(); updateInstallUI(); renderToday(); renderWeek(); renderResources(); renderSettings(); }
function switchView(id){
  state.currentView=id;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  if(id==='weekView') renderWeek();
}

function renderToday(){
  if(!state.plan) return;
  const today=localISO(new Date());
  $('dayTitle').textContent=state.currentDate===today?"Aujourd'hui":DAY_NAMES[parseISO(state.currentDate).getDay()];
  $('dayDate').textContent=formatDate(state.currentDate,{day:'numeric',month:'long',year:'numeric'});
  const pd=planDay(state.currentDate);
  const week=weekForDate(state.currentDate);
  const items=state.sessions.filter(s=>s.scheduled_date===state.currentDate).sort(sortSessions);
  $('dayMeta').innerHTML=`<span class="pill red">S${week}</span>${pd?`<span class="pill">${esc(pd.phase)}</span>`:''}${pd&&pd.totalMin?`<span class="pill">${Math.floor(pd.totalMin/60)}h${String(pd.totalMin%60).padStart(2,'0')}</span>`:''}${pd&&pd.elevationM?`<span class="pill">D+ ${pd.elevationM} m</span>`:''}`;

  let html='';
  if(state.demoMode) html+='<div class="setup-note"><strong>Mode local.</strong> Renseigne <code>config.js</code> pour activer Supabase. Tes modifications restent pour l’instant dans ce navigateur.</div>';
  if(state.offline) html+='<div class="offline-note">Hors ligne : affichage du dernier planning en cache. Les modifications Supabase sont désactivées.</div>';
  if(!items.length){
    const next=state.sessions.filter(s=>s.scheduled_date>state.currentDate && s.status!=='skipped').sort(sortSessions)[0];
    html+=`<div class="empty-card"><strong>Aucune séance prévue ce jour.</strong>${next?`<p>Prochaine : ${esc(formatDate(next.scheduled_date,{weekday:'long',day:'numeric',month:'long'}))} — ${esc(next.title)}</p>`:''}</div>`;
  } else html+=items.map(sessionCard).join('');
  $('todaySessions').innerHTML=html;

  const routine=routineForDate(state.currentDate);
  $('eveningRoutine').innerHTML=routine?`<article class="routine-card"><span class="eyebrow">Ce soir · ${esc(routine.duration)}</span><h3>${esc(routine.type)}</h3><p><strong>${esc(routine.objective)}</strong></p><p>${esc(routine.content)}</p><p class="muted">${esc(routine.instruction)}</p></article>`:'';
  bindDynamicSessionButtons();
}

function sessionCard(s){
  const lib=getLibraryDetail(s), strength=getStrengthDetail(s), heat=getHeatDetail(s), ng=getNutritionGuide(s);
  const badges=[];
  if(s.duration_min) badges.push(`<span class="pill">${s.duration_min} min</span>`);
  if(num(s.rpe)>0) badges.push(`<span class="pill">RPE ${String(s.rpe).replace('.',',')}</span>`);
  if(num(s.elevation_m)>0) badges.push(`<span class="pill">D+ ${s.elevation_m} m</span>`);
  if(isMoved(s)) badges.push('<span class="pill amber">Déplacée</span>'); else if(isModified(s)) badges.push('<span class="pill amber">Modifiée</span>');
  if(s.status==='done') badges.push('<span class="pill green">✓ Faite</span>');
  if(s.status==='skipped') badges.push('<span class="pill red">Sautée</span>');
  const detail=renderReferenceDetail(lib,strength,heat,ng);
  return `<article class="session-card ${esc(s.status)}" data-session-id="${esc(s.id)}">
    <div class="session-main">
      <div class="session-top"><div><div class="session-slot">${slotLabel(s.slot)}</div><div class="session-time">${esc(s.time_label||'Horaire libre')}</div></div><span class="pill ${s.status==='done'?'green':''}">${STATUS_LABELS[s.status]||'Prévue'}</span></div>
      <div class="session-title">${esc(s.title)}</div>
      <div class="badges">${badges.join('')}</div>
      ${s.nutrition?`<div class="detail-block"><div class="detail-label">Nutrition du plan</div><div class="detail-text">${esc(s.nutrition)}</div></div>`:''}
      ${s.instructions?`<div class="detail-block"><div class="detail-label">Consignes clés</div><div class="detail-text">${esc(s.instructions)}</div></div>`:''}
      ${s.notes?`<div class="detail-block"><div class="detail-label">Mes notes</div><div class="detail-text">${esc(s.notes)}</div></div>`:''}
      ${detail}
    </div>
    <div class="session-actions">
      <button data-action="edit" data-id="${esc(s.id)}">Modifier</button>
      <button data-action="move" data-id="${esc(s.id)}">Déplacer</button>
      <button class="done-btn" data-action="done" data-id="${esc(s.id)}">${s.status==='done'?'Annuler ✓':'Fait ✓'}</button>
      <button class="skip-btn" data-action="skip" data-id="${esc(s.id)}">${s.status==='skipped'?'Rétablir':'Sauter'}</button>
    </div>
  </article>`;
}

function renderReferenceDetail(lib,strength,heat,ng){
  if(!lib&&!strength&&!heat&&!ng) return '';
  let blocks='';
  if(lib){
    blocks+=mini('Objectif',lib.objective)+mini('Échauffement',lib.warmup)+mini('Bloc principal',lib.mainBlock)+mini('Intensité',lib.intensity)+mini('Retour au calme',lib.cooldown)+mini('Adaptation',lib.adaptation);
  }
  if(strength){
    blocks+=mini(`Musculation S${strength.week}`,`Squat : ${strength.squat}\nSDT / RDL : ${strength.deadliftRdl}\nMollets : ${strength.calves}\nTractions : ${strength.pullups}\nGainage : ${strength.core}\nRenforcement léger : ${strength.lightSession}\nProgression : ${strength.progression}`);
  }
  if(heat){
    blocks+=mini('Protocole chaleur',`${heat.modality} · séance ${heat.sessionDuration} · exposition ${heat.heatExposure}\nIntensité : ${heat.intensity}\nHabillage : ${heat.clothing}\nHydratation : ${heat.hydration}\nContrôle : ${heat.control}\n${heat.decisionSafety}`);
  }
  if(ng){
    blocks+=mini('Repères nutritionnels',`Avant : ${ng.before}\nPendant : ${ng.duringCarbs}\nSodium : ${ng.sodium}\nLiquides : ${ng.fluids}\nAprès : ${ng.after}\nLimite : ${ng.limits}`);
  }
  return `<details class="session-details"><summary>Voir le détail de la séance</summary><div class="detail-grid">${blocks}</div></details>`;
}
function mini(label,text){ return text&&text!=='—'?`<div class="detail-mini"><div class="detail-label">${esc(label)}</div><div class="detail-text">${esc(text)}</div></div>`:''; }

function bindDynamicSessionButtons(){
  document.querySelectorAll('[data-action][data-id]').forEach(btn=>btn.onclick=async()=>{
    const s=state.sessions.find(x=>String(x.id)===btn.dataset.id); if(!s) return;
    const action=btn.dataset.action;
    if(action==='edit') openEdit(s,false);
    if(action==='move') openEdit(s,true);
    if(action==='done') await persistSession(s.id,{status:s.status==='done'?'planned':'done'});
    if(action==='skip') await persistSession(s.id,{status:s.status==='skipped'?'planned':'skipped'});
  });
}

function renderWeek(){
  if(!state.plan) return;
  state.selectedWeek=Math.max(1,Math.min(12,state.selectedWeek));
  const first=dateForWeekDay(state.selectedWeek,0), last=dateForWeekDay(state.selectedWeek,6);
  $('weekTitle').textContent=`Semaine ${state.selectedWeek} · ${formatDate(first,{day:'numeric',month:'short'})} → ${formatDate(last,{day:'numeric',month:'short'})}`;
  const phase=state.plan.days.find(d=>d.week===state.selectedWeek)?.phase||'';
  $('weekPhase').innerHTML=`<span class="pill red">S${state.selectedWeek}</span><span class="pill">${esc(phase)}</span>`;
  const today=localISO(new Date());
  let html='';
  for(let i=0;i<7;i++){
    const date=dateForWeekDay(state.selectedWeek,i);
    const items=state.sessions.filter(s=>s.scheduled_date===date).sort(sortSessions);
    html+=`<article class="day-card ${date===today?'today':''}" data-date="${date}"><div class="day-card-head"><strong>${esc(DAY_NAMES[parseISO(date).getDay()])}</strong><span>${esc(formatDate(date,{day:'numeric',month:'short'}))}</span></div>${items.length?items.map(s=>`<div class="week-session" data-open-id="${esc(s.id)}"><div class="week-time">${esc(s.time_label||slotLabel(s.slot))}</div><div><div class="week-session-title">${esc(s.title)}</div><div class="week-session-meta">${s.duration_min?`${s.duration_min} min · `:''}${s.rpe?`RPE ${String(s.rpe).replace('.',',')} · `:''}${isMoved(s)?'Déplacée · ':isModified(s)?'Modifiée · ':''}${STATUS_LABELS[s.status]}</div></div></div>`).join(''):'<div class="muted">Repos / aucune séance</div>'}</article>`;
  }
  $('weekDays').innerHTML=html;
  document.querySelectorAll('[data-open-id]').forEach(el=>el.onclick=()=>{const s=state.sessions.find(x=>String(x.id)===el.dataset.openId); if(s) openEdit(s,false);});
}

function renderResources(){
  if(!state.plan) return;
  const r=state.plan.resources;
  $('resourcesContent').innerHTML=`
    ${resourceDetails('Bibliothèque des séances',r.sessionLibrary.map(x=>`<div class="resource-item"><h4>${esc(x.name)}</h4><p><strong>Objectif :</strong> ${esc(x.objective)}</p><p><strong>Échauffement :</strong> ${esc(x.warmup)}</p><p><strong>Bloc :</strong> ${esc(x.mainBlock)}</p><p><strong>Intensité :</strong> ${esc(x.intensity)}</p><p><strong>Nutrition :</strong> ${esc(x.nutrition)}</p><p class="muted">${esc(x.adaptation)}</p></div>`).join(''))}
    ${resourceDetails('Musculation',r.strength.map(x=>`<div class="resource-item"><h4>Semaine ${x.week} · ${esc(x.session)}</h4><p>Squat : ${esc(x.squat)} · SDT/RDL : ${esc(x.deadliftRdl)} · Mollets : ${esc(x.calves)}</p><p>Tractions : ${esc(x.pullups)} · Gainage : ${esc(x.core)}</p><p>Renfo léger : ${esc(x.lightSession)}</p><p class="muted">${esc(x.progression)}</p></div>`).join('')+`<div class="resource-item"><p>${esc(r.strengthRule)}</p></div>`)}
    ${resourceDetails('Chaleur',r.heat.map(x=>`<div class="resource-item"><h4>S${x.week} · ${esc(x.day)} · ${esc(x.phase)}</h4><p>${esc(x.modality)} · ${esc(x.sessionDuration)} · exposition ${esc(x.heatExposure)}</p><p>${esc(x.intensity)}</p><p><strong>Hydratation :</strong> ${esc(x.hydration)}</p><p class="muted">${esc(x.decisionSafety)}</p></div>`).join('')+`<div class="resource-item"><p>${esc(r.heatRecovery)}</p></div>`)}
    ${resourceDetails('Nutrition',renderNutritionResources())}
    ${resourceDetails('Affûtage',r.taper.map(x=>`<div class="resource-item"><h4>${esc(x.j)} · ${esc(formatDate(x.date,{day:'numeric',month:'short'}))}</h4><p>${esc(x.session)} · ${esc(x.duration)}</p><p><strong>Nutrition :</strong> ${esc(x.nutrition)}</p><p class="muted">${esc(x.alertAdaptation)}</p></div>`).join(''))}
    ${resourceDetails('Routine du soir',r.eveningRoutine.map(x=>`<div class="resource-item"><h4>${esc(x.day)} · ${esc(x.type)} · ${esc(x.duration)}</h4><p>${esc(x.content)}</p><p class="muted">${esc(x.instruction)}</p></div>`).join(''))}
  `;
}
function resourceDetails(title,body){ return `<details class="resource-card"><summary>${esc(title)}</summary><div class="resource-body">${body}</div></details>`; }
function renderNutritionResources(){
  const n=state.plan.resources.nutrition;
  let h=`<div class="resource-item"><h4>Poids de référence Excel : ${esc(n.weightKg)} kg</h4></div>`;
  h+=n.session.map(x=>`<div class="resource-item"><h4>${esc(x.situation)}</h4><p><strong>Avant :</strong> ${esc(x.before)}</p><p><strong>Pendant :</strong> ${esc(x.duringCarbs)} · ${esc(x.sodium)} · ${esc(x.fluids)}</p><p><strong>Après :</strong> ${esc(x.after)}</p><p class="muted">${esc(x.limits)}</p></div>`).join('');
  h+=`<div class="resource-item"><h4>Test de sudation</h4><p>${esc(n.sweatTest.formula)}</p><p>${esc(n.sweatTest.interpretation)}</p><p>${esc(n.sweatTest.after)}</p></div>`;
  return h;
}

function renderSettings(){
  if(!state.plan) return;
  const mode=state.demoMode?'Mode local (Supabase non configuré)':state.user?`Connecté : ${esc(state.user.email)}`:'Non connecté';
  $('settingsContent').innerHTML=`
    <div class="settings-card"><h3>Synchronisation</h3><p>${mode}</p><p>Plan de référence : ${esc(state.plan.meta.sourceFile)}</p><p>${esc(formatDate(state.plan.meta.startDate,{day:'numeric',month:'long',year:'numeric'}))} → ${esc(formatDate(state.plan.meta.raceDate,{day:'numeric',month:'long',year:'numeric'}))}</p>${!state.demoMode&&state.user?'<button id="logoutBtn" class="secondary-btn full-btn">Se déconnecter</button>':''}</div>
    <div class="settings-card"><h3>Sauvegarde</h3><p>Exporte toutes les séances actuelles, y compris tes modifications et notes, au format JSON.</p><button id="exportBtn" class="secondary-btn full-btn">Exporter mes données</button></div>
    <div class="settings-card danger-zone"><h3>Réinitialisation</h3><p>Supprime les ajustements et recharge exactement le plan issu de l'Excel.</p><button id="resetPlanBtn" class="danger-btn full-btn">Réinitialiser depuis l'Excel</button></div>
  `;
  $('exportBtn').onclick=exportData;
  $('resetPlanBtn').onclick=resetPlan;
  if($('logoutBtn')) $('logoutBtn').onclick=()=>state.supabase.auth.signOut();
}

function openEdit(s,moveOnly=false){
  $('editTitle').textContent=moveOnly?'Déplacer la séance':'Modifier la séance';
  $('editId').value=s.id; $('editDate').value=s.scheduled_date; $('editSlot').value=s.slot; $('editTime').value=s.time_label||'';
  $('editSessionTitle').value=s.title||''; $('editDuration').value=s.duration_min??0; $('editRpe').value=s.rpe??0; $('editElevation').value=s.elevation_m??0;
  $('editNutrition').value=s.nutrition||''; $('editInstructions').value=s.instructions||''; $('editNotes').value=s.notes||''; $('editStatus').value=s.status||'planned';
  if(moveOnly){ $('editDate').focus(); }
  $('editModal').classList.remove('hidden');
}
function closeEdit(){ $('editModal').classList.add('hidden'); }

async function resetSingleSession(){
  const id=$('editId').value, s=state.sessions.find(x=>String(x.id)===id); if(!s) return;
  const o=s.original_data||{};
  if(!confirm('Revenir aux valeurs prévues dans le plan Excel pour cette séance ?')) return;
  const updates={scheduled_date:o.original_date||o.scheduled_date,slot:o.original_slot||o.slot,time_label:o.time_label||'',title:o.title||s.title,duration_min:num(o.duration_min),rpe:num(o.rpe),elevation_m:num(o.elevation_m),nutrition:o.nutrition||'',instructions:o.instructions||'',status:'planned',notes:''};
  if(await persistSession(s.id,updates)){ closeEdit(); toast('Séance restaurée'); }
}

async function resetPlan(){
  if(!confirm('Supprimer toutes tes modifications et réimporter le plan Excel ?')) return;
  if(state.demoMode){ localStorage.removeItem(LOCAL_KEY); loadLocalSessions(); renderAll(); toast('Plan local réinitialisé'); return; }
  if(state.offline||!state.user) return toast('Connexion nécessaire');
  const {error}=await state.supabase.from('training_sessions').delete().eq('user_id',state.user.id);
  if(error) return toast(`Erreur : ${error.message}`);
  await seedPlan();
}
function exportData(){
  const payload={exportedAt:new Date().toISOString(),meta:state.plan.meta,sessions:state.sessions};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`veni-vici-sauvegarde-${localISO(new Date())}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function showAuth(){ if(!state.demoMode) $('authModal').classList.remove('hidden'); }
function hideAuth(){ $('authModal').classList.add('hidden'); $('authMessage').textContent=''; }

async function triggerInstall(){
  if(state.installPrompt){
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt=null;
    localStorage.removeItem(INSTALL_DISMISS_KEY);
    updateInstallUI();
    return;
  }
  if(isiOS()) dismissInstallCard();
}

function updateInstallUI(){
  const card=$('installCard');
  const topBtn=$('installBtn');
  const cta=$('installCardBtn');
  const txt=$('installCardText');
  if(!card||!topBtn||!cta||!txt) return;
  if(isStandalone()){
    card.classList.add('hidden');
    topBtn.classList.add('hidden');
    return;
  }
  const canInstall=Boolean(state.installPrompt);
  const showCard=isMobile() && !installCardDismissed() && (canInstall || isiOS());
  card.classList.toggle('hidden',!showCard);
  topBtn.classList.toggle('hidden',!(canInstall && isMobile()));
  if(showCard && isiOS() && !canInstall){
    txt.textContent='Sur iPhone, ouvre le menu Partager puis choisis « Sur l’écran d’accueil » pour installer l’application.';
    cta.textContent='J'ai compris';
  } else {
    txt.textContent='Ajoute cette application sur ton téléphone pour ouvrir directement la séance du jour, même plus rapidement depuis l’écran d’accueil.';
    cta.textContent='Installer';
  }
}

function bindUI(){
  document.querySelectorAll('.nav-item').forEach(btn=>btn.onclick=()=>switchView(btn.dataset.view));
  $('prevDayBtn').onclick=()=>{state.currentDate=addDays(state.currentDate,-1);renderToday();};
  $('nextDayBtn').onclick=()=>{state.currentDate=addDays(state.currentDate,1);renderToday();};
  $('todayBtn').onclick=()=>{state.currentDate=localISO(new Date());state.selectedWeek=weekForDate(state.currentDate);renderToday();};
  if($('dismissInstallCardBtn')) $('dismissInstallCardBtn').onclick=dismissInstallCard;
  if($('installCardBtn')) $('installCardBtn').onclick=triggerInstall;
  if($('installBtn')) $('installBtn').onclick=triggerInstall;
  $('prevWeekBtn').onclick=()=>{state.selectedWeek=Math.max(1,state.selectedWeek-1);renderWeek();};
  $('nextWeekBtn').onclick=()=>{state.selectedWeek=Math.min(12,state.selectedWeek+1);renderWeek();};
  $('closeEditBtn').onclick=closeEdit;
  $('editModal').onclick=e=>{if(e.target===$('editModal'))closeEdit();};
  $('resetSessionBtn').onclick=resetSingleSession;
  $('editForm').onsubmit=async e=>{
    e.preventDefault();
    const id=$('editId').value, s=state.sessions.find(x=>String(x.id)===id); if(!s) return;
    const date=$('editDate').value;
    const updates={scheduled_date:date,slot:$('editSlot').value,time_label:$('editTime').value.trim(),title:$('editSessionTitle').value.trim(),duration_min:num($('editDuration').value),rpe:num($('editRpe').value),elevation_m:num($('editElevation').value),nutrition:$('editNutrition').value.trim(),instructions:$('editInstructions').value.trim(),notes:$('editNotes').value.trim(),status:$('editStatus').value,week:weekForDate(date),day_name:DAY_NAMES[parseISO(date).getDay()]};
    if(await persistSession(s.id,updates)){closeEdit();toast('Séance enregistrée');}
  };
  $('loginForm').onsubmit=async e=>{
    e.preventDefault(); $('authMessage').textContent='Connexion…';
    const {error}=await state.supabase.auth.signInWithPassword({email:$('emailInput').value.trim(),password:$('passwordInput').value});
    $('authMessage').textContent=error?error.message:'';
  };
  window.addEventListener('online',()=>{state.offline=false;updateConnectionBadge();if(state.user)loadSessions();else renderToday();});
  window.addEventListener('offline',()=>{state.offline=true;updateConnectionBadge();renderToday();});
}

function registerPWA(){
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
  updateInstallUI();
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    state.installPrompt=e;
    localStorage.removeItem(INSTALL_DISMISS_KEY);
    updateInstallUI();
  });
  window.addEventListener('appinstalled',()=>{
    state.installPrompt=null;
    localStorage.removeItem(INSTALL_DISMISS_KEY);
    updateInstallUI();
  });
  window.addEventListener('resize',updateInstallUI);
}

init().catch(err=>{console.error(err);document.body.innerHTML=`<main class="app-shell"><div class="empty-card"><strong>Erreur de démarrage</strong><p>${esc(err.message)}</p></div></main>`;});

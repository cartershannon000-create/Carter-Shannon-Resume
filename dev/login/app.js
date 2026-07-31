import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.2';

const SUPABASE_URL='https://dlturcdfemudmwylbpqe.supabase.co';
const SUPABASE_KEY='sb_publishable_oQF52rpJyHG0AC4iJm9Vvg_hUqOgUWS';
const sb=createClient(SUPABASE_URL,SUPABASE_KEY,{db:{schema:'cos'}});
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>new Intl.NumberFormat().format(Number(v||0));
const compact=v=>new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(Number(v||0));
const money=v=>{const n=Number(v||0);return n>=1000?`$${new Intl.NumberFormat('en',{maximumFractionDigits:0}).format(n)}`:n>=100?`$${n.toFixed(0)}`:`$${n.toFixed(2)}`};
const date=v=>v?new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Not available';
const dateOnly=v=>{if(!v)return 'Not available';const s=String(v).slice(0,10);const p=s.split('-').map(Number);if(p.length!==3||p.some(n=>!Number.isFinite(n)))return 'Not available';return new Date(p[0],p[1]-1,p[2]).toLocaleDateString([], {year:'numeric',month:'short',day:'numeric'})};
const duration=s=>{if(s==null)return '—';s=Number(s);if(s<90)return `${Math.round(s)}s`;if(s<5400)return `${(s/60).toFixed(0)} min`;if(s<172800)return `${(s/3600).toFixed(1)} h`;return `${(s/86400).toFixed(1)} d`};
const PCOLOR={claude:'var(--green)',codex:'var(--blue)'};
let state,officeState={clients:[],calendar:[]},agentGraph={agents:[],edges:[],recent_runs:[]};
let omniState={snapshot:null,freshness:{},sections:{},illustrative:[]};
/* These must match the data-tab / data-panel attributes in index.html exactly.
   activate() looks up [data-panel="<tab>"], so a name here that no longer
   exists in the markup silently activates nothing and renders a blank page --
   which is exactly what shipped when the OmniSupply panels were renamed and
   this table was not. assertTabsMatchMarkup() below now fails loudly instead. */
const APP_TABS={client:['clients','finances','calendar'],system:['overview','metrics','work','agents','usage','approvals','system'],omnisupply:['chats','reports','company','simulations','omni-system']};
const APP_DEFAULT={client:'clients',system:'overview',omnisupply:'chats'};
const LEGACY_TABS={clients:['client','clients'],money:['client','finances'],finances:['client','finances'],calendar:['client','calendar'],overview:['system','overview'],metrics:['system','metrics'],work:['system','work'],agents:['system','agents'],usage:['system','usage'],approvals:['system','approvals'],system:['system','system']};
const DRILL_LAYOUT_KEY='cos.drillLayout',DRILL_LAYOUTS=new Set(['side','below','popout']);
let drillLayout=(()=>{try{const saved=localStorage.getItem(DRILL_LAYOUT_KEY);return DRILL_LAYOUTS.has(saved)?saved:'side'}catch{return 'side'}})();
const CALENDAR_VIEW_KEY='cos.calendarView',CALENDAR_VIEWS=new Set(['month','week','list']);
let calendarView=(()=>{try{const saved=localStorage.getItem(CALENDAR_VIEW_KEY);return CALENDAR_VIEWS.has(saved)?saved:'month'}catch{return 'month'}})(),calendarCursor=new Date(),calendarCreatePreset=null;
const CALENDAR_DETAIL_LAYOUT_KEY='cos.calendarDetailLayout',CALENDAR_DETAIL_LAYOUTS=new Set(['popout','left','below']);
let calendarDetailLayout=(()=>{try{const saved=localStorage.getItem(CALENDAR_DETAIL_LAYOUT_KEY);return CALENDAR_DETAIL_LAYOUTS.has(saved)?saved:'popout'}catch{return 'popout'}})(),calendarDetailItemId=null,calendarDetailTrigger=null;
let clientView={tier:'',status:'',search:'',sort:'name'};

function pageHead(title,detail,right=''){return `<div class="page-head"><div><h2>${esc(title)}</h2><p>${esc(detail)}</p></div>${right?`<span class="quiet">${esc(right)}</span>`:''}</div>`}
function provider(name){return state.audit.providers.find(item=>item.provider===name)||{};}
function percent(value,max){return max?Math.max(3,Math.round(value/max*100)):0;}
function freshLine(){const f=state.freshness?.providers||[];if(!f.length)return '';return f.map(p=>`${p.provider==='claude'?'Claude':'Codex'} data through ${date(p.last_event_at)}`).join(' · ')}
function tokensAll(p){return Number(p.tokens_total||0)}

const METRIC_GUIDE={
  task_completion:{definition:'Share of durable tasks whose current status is completed.',numerator:'Completed tasks',denominator:'All tracked continuity tasks',relevance:'Shows whether tracked work reaches a durable finish instead of accumulating in the active queue.'},
  active_freshness:{definition:'Share of active tasks updated with a checkpoint in the last seven days.',numerator:'Fresh active tasks',denominator:'All active tasks',relevance:'Stale active work is an early warning for lost context, unclear ownership, or abandoned execution.'},
  blocker_rate:{definition:'Share of active tasks whose latest checkpoint records at least one blocker.',numerator:'Blocked active tasks',denominator:'All active tasks',relevance:'Shows how much current work cannot advance. Lower is better, but blockers should be recorded honestly.'},
  verified_outcomes:{definition:'Share of outcome records explicitly marked as verified.',numerator:'Verified outcome records',denominator:'All outcome records',relevance:'Separates evidence-backed results from activity or claims of completion.'},
  outcome_coverage:{definition:'Share of tracked tasks with at least one explicit outcome record.',numerator:'Tasks with outcomes',denominator:'All tracked continuity tasks',relevance:'Makes it possible to connect agent activity and estimated cost to delivered results.'},
  retry_rate:{definition:'Average number of recorded retries per outcome.',numerator:'Recorded retries',denominator:'Outcome records',relevance:'Highlights rework and specification friction. A low rate is useful only when retries are captured consistently.'},
  evidence_density:{definition:'Average number of artifact and test references attached to each checkpoint.',numerator:'Artifact + test references',denominator:'All checkpoints',relevance:'Measures auditability of the work trail. It is supporting evidence, not a quality score by itself.'},
  claude_token_coverage:{definition:'Share of Claude events that include token telemetry.',numerator:'Tokenized Claude events',denominator:'All Claude events',relevance:'Determines how confidently Claude usage and API-equivalent cost can be compared over time.'},
  codex_token_coverage:{definition:'Share of Codex events that include token telemetry.',numerator:'Tokenized Codex events',denominator:'All Codex events',relevance:'Determines how confidently Codex usage and API-equivalent cost can be compared over time.'},
  cost_per_outcome:{definition:'Estimated API-equivalent model cost divided by verified outcomes.',numerator:'Estimated model cost',denominator:'Verified outcomes',relevance:'Connects modeled resource use to results. It is directional until more outcomes are verified and is not an invoice.'},
  runner_availability:{definition:'Share of scheduled runner time with a healthy heartbeat.',numerator:'Healthy heartbeat minutes',denominator:'Expected scheduled minutes',relevance:'Shows whether approved work can actually execute. It remains unavailable until heartbeat history is retained.'},
  approval_latency:{definition:'Average elapsed time from an approval request to a human decision.',numerator:'Total decision wait time',denominator:'Decided approvals',relevance:'Surfaces delay at the human authority gate so execution bottlenecks are not misdiagnosed as agent failures.'}
};

function metricGuide(metric){return METRIC_GUIDE[metric.key]||{definition:metric.source||'Operational measure.',numerator:'Measured total',denominator:'Measured population',relevance:'Use this measure with its source and sample size.'}}
function metricNumerator(metric){if(metric.key==='approval_latency'&&metric.value!=null&&metric.denominator!=null)return Number(metric.value)*Number(metric.denominator);return metric.numerator}
function metricPart(value,unit='number'){if(value==null)return '—';if(unit==='seconds')return duration(value);if(unit==='usd')return money(value);return number(Math.round(Number(value)*100)/100)}
function metricInsight(metric){const guide=metricGuide(metric);if(!metric.available)return `${guide.relevance} ${metric.reason||'The required data is not yet available.'}`;if(metric.reason)return `${guide.relevance} Current read: ${metric.reason}.`;return guide.relevance}
function explainerCard(title,definition,numerator,denominator,relevance){return `<article class="explain-card"><h3>${esc(title)}</h3><p>${esc(definition)}</p><dl><div><dt>Numerator</dt><dd>${esc(numerator)}</dd></div><div><dt>Denominator</dt><dd>${esc(denominator)}</dd></div></dl><div class="insight-box"><strong>Why it matters</strong><span>${esc(relevance)}</span></div></article>`}

/* ── Drill-down panel ─────────────────────────────────────────────── */
function drillHeader(title,subtitle=''){return `<header class="drill-head"><div class="drill-heading"><h3 id="drill-title">${esc(title)}</h3>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><div class="drill-actions"><div class="drill-layout" role="group" aria-label="Drill-down layout">${[['side','Side'],['below','Below'],['popout','Popout']].map(([mode,label])=>`<button type="button" data-drill-layout="${mode}" aria-pressed="${drillLayout===mode}" title="Open ${label.toLowerCase()}">${label}</button>`).join('')}</div><button id="drill-close" type="button" aria-label="Close drill-down">✕</button></div></header>`}
function syncDrillLayout(persist=false){
  const drill=$('#drill'),backdrop=$('#drill-backdrop');if(!drill||!backdrop)return;
  if(drillLayout==='below')$('.dashboard').append(drill);else $('#app').append(drill);
  drill.dataset.layout=drillLayout;drill.setAttribute('aria-labelledby','drill-title');
  if(drillLayout==='popout')drill.setAttribute('role','dialog');else drill.removeAttribute('role');
  $$('[data-drill-layout]',drill).forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.drillLayout===drillLayout)));
  backdrop.classList.toggle('open',drill.classList.contains('open')&&drillLayout!=='below');
  if(persist)try{localStorage.setItem(DRILL_LAYOUT_KEY,drillLayout)}catch{}
}
function setDrillLayout(mode){if(!DRILL_LAYOUTS.has(mode))return;drillLayout=mode;syncDrillLayout(true);if(mode==='below'&&$('#drill').classList.contains('open'))$('#drill').scrollIntoView({behavior:'smooth',block:'start'})}
function bindDrillControls(){$('#drill-close').onclick=closeDrill;$$('[data-drill-layout]',$('#drill')).forEach(button=>button.onclick=()=>setDrillLayout(button.dataset.drillLayout))}
function showDrill(){$('#drill').classList.add('open');syncDrillLayout();bindDrillControls()}
function openDrill({title,subtitle='',stats=[],rows=[],rowsTitle='',note='',chart=''}){
  const max=Math.max(...rows.map(r=>Number(r.pctOf??0)),1);
  $('#drill-body').innerHTML=`
    ${drillHeader(title,subtitle)}
    ${stats.length?`<div class="drill-stats">${stats.map(s=>`<div><small>${esc(s.label)}</small><strong>${esc(s.value)}</strong>${s.sub?`<span>${esc(s.sub)}</span>`:''}</div>`).join('')}</div>`:''}
    ${chart}
    ${rows.length?`<div class="drill-rows">${rowsTitle?`<h4>${esc(rowsTitle)}</h4>`:''}${rows.map(r=>`
      <div class="drill-row"><div class="drill-row-top"><strong>${esc(r.label)}</strong><span>${esc(r.value)}</span></div>
      ${r.sub?`<p>${esc(r.sub)}</p>`:''}
      ${r.pctOf!=null?`<div class="bar"><i style="width:${percent(Number(r.pctOf),max)}%;background:${r.color||'var(--green)'}"></i></div>`:''}</div>`).join('')}</div>`:''}
    ${note?`<div class="notice">${esc(note)}</div>`:''}`;
  showDrill();
}
function closeDrill(){stopRunPoll();$('#drill').classList.remove('open');$('#drill-backdrop').classList.remove('open')}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCalendarDetail();closeDrill()}});

/* ── Live run view (GitHub Actions-style step log) ────────────────── */
let runPoll={timer:null,workId:null,seq:0};
const RUN_ACTIVE=new Set(['QUEUED','LEASED','RUNNING']);
const RELEASE_READY='READY_FOR_RELEASE_APPROVAL';
const STEP_ICON={phase:'◆',tool:'▸',text:'✎',result:'✓',error:'✕'};
function stopRunPoll(){if(runPoll.timer)clearTimeout(runPoll.timer);runPoll={timer:null,workId:null,seq:0}}
function clock(x){if(!x)return '';const d=new Date(x);return isNaN(d)?'':d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function releaseReadyWork(){return (state.operations.work||[]).filter(work=>work.state===RELEASE_READY)}
function qualityReview(workId){return (state.quality?.reviews||[]).find(item=>item.work_id===workId)||null}
function acceptanceContract(approvalId,workId){const row=(state.quality?.contracts||[]).find(item=>item.approval_id===approvalId)||(state.quality?.contracts||[]).find(item=>item.work_id===workId);return row?.acceptance_contract||{expected_benefits:[]}}
function benefitList(contract,review=null){const confirmed=new Map((review?.review?.benefits||[]).map(item=>[item.id,item]));const items=contract?.expected_benefits||[];return items.length?`<ul class="benefit-list">${items.map(item=>{const evidence=confirmed.get(item.id);return `<li><span>${evidence?'✓':'○'}</span><div><strong>${esc(item.statement)}</strong>${evidence?`<small>${esc(evidence.evidence||'Confirmed by independent reviewer')}</small>`:''}</div></li>`}).join('')}</ul>`:'<p class="quiet">No explicit benefit contract is available for this legacy work.</p>'}
function releaseEvidence(work){const review=qualityReview(work.work_id);if(!review)return `<div class="quality-evidence legacy"><strong>Legacy delivery</strong><span>This job predates the quality gate. Review its log directly before release.</span></div>`;const contract=acceptanceContract(null,work.work_id);return `<div class="quality-evidence ${review.gate_status}"><div class="quality-score"><strong>${number(review.score)}/20</strong><span>${esc(review.reviewer_provider)} reviewed ${esc(review.builder_provider)}</span></div><div><strong>${number(review.benefits_passed)}/${number(review.benefit_count)} benefits · ${number(review.checks_passed)}/${number(review.required_check_count)} checks</strong>${benefitList(contract,review)}${review.limitations?.length?`<p class="quality-limit"><b>Limitations:</b> ${esc(review.limitations.join(' · '))}</p>`:''}</div></div>`}
function runChip(state,active){const label=state===RELEASE_READY?'Awaiting release approval':state;return `<span class="run-chip ${active?'live':state==='FAILED'?'bad':'good'}">${active?'<i class="pulse"></i>':''}${esc(label||'—')}</span>`}
function stepRow(p){const tag=p.kind==='tool'?'code':'p';return `<div class="run-step ${esc(p.kind)}"><span class="step-icon">${STEP_ICON[p.kind]||'·'}</span><div class="step-body"><div class="step-top"><strong>${esc(p.label)}</strong><time>${clock(p.at)}</time></div>${p.detail?`<${tag} class="step-detail">${esc(p.detail)}</${tag}>`:''}</div></div>`}
function openRunView(workId,title){
  stopRunPoll();
  $('#drill-body').innerHTML=`
    ${drillHeader(title||'Run','')}<p class="run-meta" id="run-meta">Loading run…</p>
    <div class="run-log" id="run-log"><div class="empty-state"><strong>Fetching step log…</strong></div></div>`;
  showDrill();
  runPoll={timer:null,workId,seq:0};
  pollRun(workId);
}
async function pollRun(workId){
  if(runPoll.workId!==workId)return;
  let payload=null;
  try{
    const{data,error}=await sb.rpc('api_job_progress',{p_work_id:workId,p_after_seq:runPoll.seq});
    if(error)throw error;payload=data;
  }catch(err){
    const meta=$('#run-meta');if(meta)meta.textContent='Progress unavailable — retrying…';
    if(runPoll.workId===workId)runPoll.timer=setTimeout(()=>pollRun(workId),6000);
    return;
  }
  if(runPoll.workId!==workId)return;
  const job=payload.job,steps=payload.progress||[],active=!!job&&RUN_ACTIVE.has(job.state);
  const meta=$('#run-meta');
  if(meta)meta.innerHTML=job
    ?`${runChip(job.state,active)} ${esc(job.job_type)} · ${esc(job.mode||'—')} mode · started ${clock(job.created_at)}${payload.work_state?` · work ${esc(payload.work_state)}`:''}`
    :'No job has been enqueued for this work item yet.';
  const log=$('#run-log');
  if(log){
    if(runPoll.seq===0&&!steps.length)log.innerHTML=job
      ?'<div class="empty-state"><strong>No step log for this run</strong><p>Runs started before live progress shipped recorded no steps; the state above still updates.</p></div>'
      :'<div class="empty-state"><strong>Waiting for an approved plan to enqueue a job</strong></div>';
    if(steps.length){
      if(runPoll.seq===0)log.innerHTML='';
      const stick=log.scrollHeight-log.scrollTop-log.clientHeight<60;
      log.insertAdjacentHTML('beforeend',steps.map(stepRow).join(''));
      if(stick)log.scrollTop=log.scrollHeight;
      runPoll.seq=steps[steps.length-1].seq;
    }
  }
  if(active)runPoll.timer=setTimeout(()=>pollRun(workId),3500);
}

function stackedBar(parts){
  const total=parts.reduce((a,p)=>a+p.v,0)||1;
  return `<div class="stacked">${parts.filter(p=>p.v>0).map(p=>`<i style="width:${Math.max(1,p.v/total*100)}%;background:${p.c}" title="${esc(p.label)}: ${compact(p.v)}"></i>`).join('')}</div>
  <div class="stacked-legend">${parts.map(p=>`<span><b style="background:${p.c}"></b>${esc(p.label)} ${compact(p.v)}</span>`).join('')}</div>`;
}
function tokenParts(x){return [
  {label:'Cache read',v:Number(x.tokens_cache_read||0),c:'#9ebead'},
  {label:'Fresh input',v:Number(x.tokens_in||0),c:'var(--blue)'},
  {label:'Output',v:Number(x.tokens_out||0),c:'var(--green)'},
  {label:'Cache write',v:Number(x.tokens_cache_write||0),c:'var(--amber)'}]}

/* ── Drill builders ───────────────────────────────────────────────── */
function drillProvider(name){
  const p=provider(name);
  const weeks=(state.audit.weekly||[]).filter(w=>w.provider===name).slice(-8);
  const models=(state.audit.models||[]).filter(m=>m.provider===name);
  const maxC=Math.max(...weeks.map(w=>Number(w.est_cost||0)),0.01);
  openDrill({
    title:name==='claude'?'Claude':'Codex',
    subtitle:`${number(p.events)} exchanges across ${number(p.sessions)} sessions · data through ${date(p.last_event_at)}`,
    stats:[
      {label:'Est. cost (all time)',value:money(p.est_cost),sub:p.cost_is_estimate?'API-equivalent, estimated':'API list rates'},
      {label:'Est. cost (7 days)',value:money(p.est_cost_7d)},
      {label:'Total tokens',value:compact(tokensAll(p)),sub:`${Math.round((p.token_coverage||0)*100)}% of events have token data`},
      {label:'Cost per exchange',value:p.events?money(p.est_cost/p.events):'—'}],
    chart:`<div class="drill-section"><h4>Token composition</h4>${stackedBar(tokenParts(p))}</div>
    <div class="drill-section"><h4>Weekly est. cost</h4><div class="mini-chart">${weeks.map(w=>`<div class="mini-week"><i style="height:${Math.max(3,Number(w.est_cost||0)/maxC*100)}px;background:${PCOLOR[name]}"></i><small>${esc(String(w.week_start).slice(5))}</small></div>`).join('')||'<p class="quiet">No weekly data</p>'}</div></div>`,
    rowsTitle:'By model',
    rows:models.map(m=>({label:m.model,value:`${money(m.est_cost)} · ${compact(m.tokens_total)} tok`,sub:`${number(m.events)} exchanges · last ${date(m.last_event_at)}`,pctOf:m.est_cost,color:PCOLOR[name]})),
    note:'Costs are estimated API-equivalent value at list per-token rates. Actual spend runs through subscriptions, so treat this as workload value, not an invoice.'
  });
}
function drillModel(providerName,modelName){
  const m=(state.audit.models||[]).find(x=>x.provider===providerName&&x.model===modelName)||{};
  const weeks=(state.audit.model_weekly||[]).filter(x=>x.provider===providerName&&x.model===modelName).slice(-10);
  const maxT=Math.max(...weeks.map(w=>Number(w.tokens||0)),1);
  openDrill({
    title:modelName,
    subtitle:`${providerName} · ${number(m.events)} exchanges · ${number(m.sessions)} sessions`,
    stats:[
      {label:'Est. cost',value:money(m.est_cost),sub:m.cost_is_estimate?'estimated rates':'list rates'},
      {label:'Total tokens',value:compact(m.tokens_total)},
      {label:'Output tokens',value:compact(m.tokens_out)},
      {label:'Last used',value:date(m.last_event_at)}],
    chart:`<div class="drill-section"><h4>Token composition</h4>${stackedBar(tokenParts(m))}</div>
    <div class="drill-section"><h4>Weekly tokens</h4><div class="mini-chart">${weeks.map(w=>`<div class="mini-week"><i style="height:${Math.max(3,Number(w.tokens||0)/maxT*100)}px;background:${PCOLOR[providerName]}"></i><small>${esc(String(w.week_start).slice(5))}</small></div>`).join('')||'<p class="quiet">No weekly data</p>'}</div></div>`,
    rows:weeks.slice().reverse().map(w=>({label:`Week of ${w.week_start}`,value:`${money(w.est_cost)} · ${compact(w.tokens)} tok`,sub:`${number(w.events)} exchanges`,pctOf:w.tokens,color:PCOLOR[providerName]}))
  });
}
function drillProject(projectName){
  const p=(state.audit.projects||[]).find(x=>x.project===projectName)||{};
  const sess=(state.audit.sessions_recent||[]).filter(s=>s.project===projectName);
  openDrill({
    title:projectName,
    subtitle:`${number(p.events)} exchanges · ${number(p.sessions)} sessions · last activity ${date(p.last_event_at)}`,
    stats:[
      {label:'Est. cost',value:money(p.est_cost)},
      {label:'Tokens',value:compact(p.tokens)},
      {label:'Claude exchanges',value:number(p.claude_events)},
      {label:'Codex exchanges',value:number(p.codex_events)}],
    chart:`<div class="drill-section"><h4>Provider split</h4>${stackedBar([{label:'Claude',v:Number(p.claude_events||0),c:'var(--green)'},{label:'Codex',v:Number(p.codex_events||0),c:'var(--blue)'}])}</div>`,
    rowsTitle:sess.length?'Recent sessions (14 days)':'',
    rows:sess.map(s=>({label:`${s.provider} · ${s.session_id.slice(0,8)}…`,value:`${money(s.est_cost)}`,sub:`${number(s.events)} exchanges · ${compact(s.tokens)} tok · ${date(s.started_at)} → ${date(s.last_at)}`,pctOf:s.est_cost,color:PCOLOR[s.provider]})),
    note:sess.length?'':'No sessions in the last 14 days for this workspace.'
  });
}
function drillWeek(weekStart){
  const rows=(state.audit.weekly||[]).filter(w=>w.week_start===weekStart);
  const models=(state.audit.model_weekly||[]).filter(w=>w.week_start===weekStart).sort((a,b)=>b.est_cost-a.est_cost).slice(0,8);
  openDrill({
    title:`Week of ${weekStart}`,
    stats:rows.map(r=>({label:r.provider==='claude'?'Claude':'Codex',value:money(r.est_cost),sub:`${number(r.events)} exchanges · ${compact(r.tokens)} tok`})),
    rowsTitle:'Top models this week',
    rows:models.map(m=>({label:`${m.model}`,value:money(m.est_cost),sub:`${m.provider} · ${number(m.events)} exchanges · ${compact(m.tokens)} tok`,pctOf:m.est_cost,color:PCOLOR[m.provider]}))
  });
}
function drillCost(){
  const c=provider('claude'),x=provider('codex');
  const weeks=[...new Set((state.audit.weekly||[]).map(w=>w.week_start))].slice(-8);
  openDrill({
    title:'Estimated API-equivalent cost',
    subtitle:'What this usage would cost at list per-token rates',
    stats:[
      {label:'All time',value:money(state.overview.est_cost_total)},
      {label:'Last 7 days',value:money(state.overview.est_cost_7d)},
      {label:'Claude',value:money(c.est_cost),sub:'list rates'},
      {label:'Codex',value:money(x.est_cost),sub:'estimated rates'}],
    rowsTitle:'By week',
    rows:weeks.slice().reverse().map(w=>{const rows=(state.audit.weekly||[]).filter(y=>y.week_start===w);const total=rows.reduce((a,y)=>a+Number(y.est_cost||0),0);return {label:`Week of ${w}`,value:money(total),sub:rows.map(y=>`${y.provider} ${money(y.est_cost)}`).join(' · '),pctOf:total}}),
    note:'Cache reads dominate token volume; they bill at ~10% of the input rate, which is why cost concentrates in output tokens.'
  });
}
function drillTokens(){
  const c=provider('claude'),x=provider('codex');
  openDrill({
    title:'Captured tokens',
    subtitle:'All processed tokens, including prompt-cache reads and writes',
    stats:[
      {label:'Total',value:compact(state.overview.captured_tokens)},
      {label:'Claude',value:compact(tokensAll(c)),sub:`${Math.round((c.token_coverage||0)*100)}% coverage`},
      {label:'Codex',value:compact(tokensAll(x)),sub:`${Math.round((x.token_coverage||0)*100)}% coverage`}],
    chart:`<div class="drill-section"><h4>Claude composition</h4>${stackedBar(tokenParts(c))}</div>
    <div class="drill-section"><h4>Codex composition</h4>${stackedBar(tokenParts(x))}</div>`,
    note:'Coverage below 100% is pre-instrumentation history (sessions with no local log). Those events keep their original partial numbers and are never zero-filled.'
  });
}
function drillMetric(key){
  const m=(state.metrics||[]).find(x=>x.key===key);if(!m)return;
  const guide=metricGuide(m),numerator=metricNumerator(m);
  openDrill({
    title:m.label,
    subtitle:guide.definition,
    stats:[
      {label:'Current',value:metricValue(m)},
      {label:'Target',value:metricTarget(m)},
      {label:`Numerator · ${guide.numerator}`,value:metricPart(numerator,m.unit),sub:'What is counted'},
      {label:`Denominator · ${guide.denominator}`,value:metricPart(m.denominator),sub:'Population or divisor'}],
    note:`Why it matters: ${metricInsight(m)} Source: ${m.source||'Not instrumented'}.`
  });
}

/* ── Overview ─────────────────────────────────────────────────────── */
function attentionItems(){
  const o=state.overview,items=[];
  const releases=releaseReadyWork();
  const stale=(state.freshness?.providers||[]).filter(p=>(Date.now()-new Date(p.last_event_at))/36e5>48);
  if(o.pending_review>0)items.push(readyRow('!','Review pending recommendations',`${o.pending_review} audit improvements need human disposition`,'Review','warn'));
  if(o.pending_approvals>0)items.push(readyRow('!','Decide execution gates',`${o.pending_approvals} control-plane approval request${o.pending_approvals===1?'':'s'} waiting`,'Approve','warn'));
  if(releases.length)items.push(readyRow('!','Approve completed work',`${releases.length} finished work item${releases.length===1?' is':'s are'} waiting for your release decision`,'Release','warn'));
  if(state.control_plane.local_runner!=='connected')items.push(readyRow('○','Restore runner heartbeat','Registered runner has not checked in recently','Reconnect','off'));
  if(stale.length)items.push(readyRow('○','Refresh audit data',`${stale.map(p=>p.provider).join(' and ')} data is over 48h old — run the audit import`,'Import','off'));
  return items.length?items.join(''):'<div class="empty-state"><strong>Nothing needs attention</strong><p>All gates clear and data fresh.</p></div>';
}
function renderOverview(){
  const o=state.overview,claude=provider('claude'),codex=provider('codex'),tasks=state.continuity.tasks.filter(t=>t.status==='active');
  const allTasks=state.continuity.tasks||[],recommendations=state.audit.recommendations||[],tokenized=Number(claude.tokenized_events||0)+Number(codex.tokenized_events||0),allEvents=Number(claude.events||0)+Number(codex.events||0);
  const runnerConnected=state.control_plane.local_runner==='connected';
  const maxCost=Math.max(Number(claude.est_cost||0),Number(codex.est_cost||0));
  $('[data-panel="overview"]').innerHTML=pageHead('Operating overview','The current state of work, agents, cost, and execution readiness.',freshLine())+`
  <div class="kpi-grid">
    <article class="kpi clickable" data-drill="work-tab"><div class="kpi-top">Active work <i></i></div><strong>${o.active_work}</strong><span>Continuity tasks in progress</span></article>
    <article class="kpi clickable" data-drill="approvals-tab"><div class="kpi-top">Pending review <em class="delta">Human gate</em></div><strong>${o.pending_review}</strong><span>Recommendations awaiting disposition</span></article>
    <article class="kpi clickable" data-drill="cost"><div class="kpi-top">Est. cost · 7 days <i></i></div><strong>${money(o.est_cost_7d)}</strong><span>${money(o.est_cost_total)} all time · API-equivalent</span></article>
    <article class="kpi clickable" data-drill="tokens"><div class="kpi-top">Captured tokens <i></i></div><strong>${compact(o.captured_tokens)}</strong><span>Includes prompt-cache reads and writes</span></article>
  </div>
  <section class="explain-section"><div class="section-label"><strong>How to read the overview</strong><span>Definitions, calculation boundaries, and decision relevance</span></div><div class="explain-grid">
    ${explainerCard('Active work','Durable continuity tasks whose current status is active.',`${number(tasks.length)} active tasks`,'None — this is a count drawn from '+number(allTasks.length)+' tracked tasks','Shows the amount of work that currently needs ownership and a next action; it does not measure productivity.')}
    ${explainerCard('Pending review','Audit recommendations still awaiting a human disposition.',`${number(o.pending_review)} proposed recommendations`,'None — this is a count drawn from '+number(recommendations.length)+' recommendations','Makes the human decision backlog visible so useful recommendations do not remain inert.')}
    ${explainerCard('Estimated cost · 7 days','Sum of token components multiplied by each model’s API list-rate estimate during the last seven days. Subscription spend may differ.',`${money(o.est_cost_7d)} summed modeled cost`,'None — this is a total, not a ratio','Indicates workload intensity and routing mix. Use it for trend and allocation decisions, not as an invoice.')}
    ${explainerCard('Captured tokens','Input, output, cache-read, and cache-write tokens recorded across Claude and Codex.',`${compact(o.captured_tokens)} recorded tokens`,'None — this is a total; telemetry covers '+number(tokenized)+' of '+number(allEvents)+' events','Explains the scale and composition of model processing. Token volume alone is not a measure of value or quality.')}
  </div></section>
  <div class="grid-2"><article class="card"><div class="card-head"><div><h3>Execution readiness</h3><p>What exists today versus what still needs wiring.</p></div><button class="link-button" data-go="system">View system</button></div><div class="readiness">
    ${readyRow('✓','Website control surface','Authenticated seven-tab operating console','Operational','')}
    ${readyRow('✓','Control-plane database','Work, approvals, events, metrics, and continuity are live','Operational','')}
    ${readyRow(runnerConnected?'✓':'○','Local CoS runner',runnerConnected?'Heartbeat observed in the last five minutes':'Runner registered; heartbeat is currently stale',runnerConnected?'Connected':'Offline',runnerConnected?'':'off')}
    ${readyRow('✓','Token & cost telemetry','Claude and Codex token capture live, incl. cache and cost estimates','Operational','')}
  </div></article>
  <article class="card"><div class="card-head"><div><h3>Claude vs Codex</h3><p>Estimated API-equivalent cost. Click a provider to drill in.</p></div><button class="link-button" data-go="usage">Full usage</button></div><div class="provider-snapshot">
    ${providerLine('claude',claude.est_cost,maxCost,`${money(claude.est_cost)} · ${compact(tokensAll(claude))} tok`)}
    ${providerLine('codex',codex.est_cost,maxCost,`${money(codex.est_cost)} · ${compact(tokensAll(codex))} tok`)}
  </div><div class="usage-numbers" style="margin-top:14px">
    <div><small>Claude · 7d</small><strong>${money(claude.est_cost_7d)}</strong></div>
    <div><small>Codex · 7d</small><strong>${money(codex.est_cost_7d)}</strong></div>
    <div><small>Cost / exchange</small><strong>${claude.events?money(claude.est_cost/claude.events):'—'} vs ${codex.events?money(codex.est_cost/codex.events):'—'}</strong></div>
  </div></article></div>
  <div class="grid-even"><article class="card"><div class="card-head"><div><h3>Current work</h3><p>Latest immutable checkpoints.</p></div><button class="link-button" data-go="work">Open queue</button></div><div class="work-list">${tasks.slice(0,3).map(workRow).join('')||'<div class="empty-state"><strong>No active tasks</strong></div>'}</div></article>
  <article class="card"><div class="card-head"><div><h3>Attention needed</h3><p>Live gates and gaps, computed from the control plane.</p></div><button class="link-button" data-go="approvals">Review gates</button></div><div class="readiness">${attentionItems()}</div></article></div>`;
}
function readyRow(icon,title,detail,status,mode){return `<div class="ready-row ${mode}"><span class="ready-icon">${icon}</span><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div><span class="status ${mode}">${esc(status)}</span></div>`}
function providerLine(name,value,max,label){return `<div class="provider-line ${name} clickable" data-provider="${name}"><strong>${esc(name)}</strong><div class="bar"><i style="width:${percent(Number(value||0),max)}%"></i></div><span>${esc(label)}</span></div>`}
function workRow(task){return `<div class="work-row"><div><strong>${esc(task.objective)}</strong><p>${esc(task.next_action||'No next action recorded')}</p></div><time>v${task.checkpoint_version||0}<br>${date(task.updated_at)}</time></div>`}

/* ── Clients ──────────────────────────────────────────────────────── */
function relativeDate(value){
  if(!value)return 'No touches yet';
  const stamp=new Date(value).getTime();if(!Number.isFinite(stamp))return 'Not available';
  const seconds=Math.round((Date.now()-stamp)/1000),future=seconds<0,amount=Math.abs(seconds);
  let count,unit;
  if(amount<60){count=amount;unit='second'}else if(amount<3600){count=Math.round(amount/60);unit='minute'}else if(amount<86400){count=Math.round(amount/3600);unit='hour'}else if(amount<2592000){count=Math.round(amount/86400);unit='day'}else if(amount<31536000){count=Math.round(amount/2592000);unit='month'}else{count=Math.round(amount/31536000);unit='year'}
  return `${future?'in ':''}${count} ${unit}${count===1?'':'s'}${future?'':' ago'}`;
}
function latestTouch(client){return (client.touches||[]).reduce((latest,touch)=>!latest||new Date(touch.at)>new Date(latest.at)?touch:latest,null)}
function openOpportunityValue(client){return (client.opportunities||[]).filter(opp=>!['won','lost'].includes(opp.stage)).reduce((sum,opp)=>sum+Number(opp.value_estimate||0)*Number(opp.probability||0),0)}
function officeStatusChip(value,kind='client'){
  const normalized=String(value||'').toLowerCase();
  const good=kind==='client'?normalized==='active':kind==='opportunity'?normalized==='won':kind==='invoice'?normalized==='paid':['active','completed','won'].includes(normalized);
  const bad=kind==='client'?normalized==='lost':kind==='opportunity'?normalized==='lost':kind==='invoice'?normalized==='overdue':['lost','cancelled','canceled'].includes(normalized);
  return `<span class="run-chip ${bad?'bad':good?'good':'muted'}">${esc(value||'—')}</span>`;
}
function clientForm(client=null){
  const editing=!!client;
  return `<form class="office-form hidden" data-office-form="client" data-client-id="${esc(client?.client_id||'')}"><div class="office-form-grid">
    <label>Name<input name="name" value="${esc(client?.name||'')}" autocomplete="organization" required></label>
    <label>Tier<select name="tier"><option value="A"${client?.tier==='A'?' selected':''}>A</option><option value="B"${client?.tier==='B'?' selected':''}>B</option><option value="C"${client?.tier==='C'?' selected':''}>C</option></select></label>
    <label>Status<select name="status"><option value="lead"${!client||client.status==='lead'?' selected':''}>Lead</option><option value="active"${client?.status==='active'?' selected':''}>Active</option><option value="dormant"${client?.status==='dormant'?' selected':''}>Dormant</option><option value="lost"${client?.status==='lost'?' selected':''}>Lost</option></select></label>
    <label>Source<input name="source" value="${esc(client?.source||'')}" placeholder="Referral, inbound, network…"></label>
    <label class="office-form-wide">Notes<textarea name="notes" rows="3">${esc(client?.notes||'')}</textarea></label>
  </div><div class="office-form-actions action-buttons"><button class="action-button approve" type="submit">${editing?'Save client':'Add client'}</button><button class="action-button reject" type="button" data-office-cancel>Cancel</button></div><div class="office-form-error" role="alert"></div></form>`;
}
function contactForm(contact=null){const target=contact?.contact_id||'new';return `<form class="office-form hidden contact-form" data-office-form="contact" data-office-target="${esc(target)}" data-contact-id="${esc(contact?.contact_id||'')}"><div class="office-form-grid">
  <label>Name<input name="name" value="${esc(contact?.name||'')}" autocomplete="name" required></label><label>Role<input name="role" value="${esc(contact?.role||'')}"></label>
  <label>Email<input name="email" type="email" value="${esc(contact?.email||'')}" autocomplete="email"></label><label>Phone<input name="phone" type="tel" value="${esc(contact?.phone||'')}" autocomplete="tel"></label>
  <label class="office-form-wide">LinkedIn<input name="linkedin" value="${esc(contact?.linkedin||'')}" placeholder="linkedin.com/in/name"></label><label class="office-form-wide">Address<input name="address" value="${esc(contact?.address||'')}" autocomplete="street-address"></label>
  <label>City<input name="city" value="${esc(contact?.city||'')}" autocomplete="address-level2"></label><label>State<input name="state" value="${esc(contact?.state||'')}" autocomplete="address-level1"></label>
  </div><div class="office-form-actions action-buttons"><button class="action-button approve" type="submit">${contact?'Save contact':'Add contact'}</button><button class="action-button reject" type="button" data-office-cancel>Cancel</button></div><div class="office-form-error" role="alert"></div></form>`}
function touchForm(){return `<form class="office-form hidden" data-office-form="touch"><div class="office-form-grid">
  <label>Channel<input name="channel" placeholder="Email, call, meeting…" required></label><label>Direction<select name="direction"><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label>
  <label class="office-form-wide">Summary<textarea name="summary" rows="3" required></textarea></label><label>Follow-up due<input name="followup_due" type="datetime-local"></label>
  </div><div class="office-form-actions action-buttons"><button class="action-button approve" type="submit">Log touch</button><button class="action-button reject" type="button" data-office-cancel>Cancel</button></div><div class="office-form-error" role="alert"></div></form>`}
function opportunityForm(){return `<form class="office-form hidden" data-office-form="opportunity"><div class="office-form-grid">
  <label class="office-form-wide">Title<input name="title" required></label><label>Stage<select name="stage"><option value="identified">Identified</option><option value="contacted">Contacted</option><option value="proposal">Proposal</option><option value="won">Won</option><option value="lost">Lost</option></select></label>
  <label>Value estimate<input name="value_estimate" type="number" min="0" step="0.01" required></label><label>Probability (0–1)<input name="probability" type="number" min="0" max="1" step="0.01" required></label>
  <label>Next action<input name="next_action"></label><label>Next action due<input name="next_action_due" type="datetime-local"></label>
  </div><div class="office-form-actions action-buttons"><button class="action-button approve" type="submit">Add opportunity</button><button class="action-button reject" type="button" data-office-cancel>Cancel</button></div><div class="office-form-error" role="alert"></div></form>`}
function engagementForm(){return `<form class="office-form hidden" data-office-form="engagement"><div class="office-form-grid">
  <label class="office-form-wide">Scope<textarea name="scope" rows="3" required></textarea></label><label>Price<input name="price" type="number" min="0" step="0.01" required></label>
  <label>Pricing model<input name="pricing_model" placeholder="Fixed, hourly, retainer…" required></label><label>Status<input name="status" value="active" required></label>
  </div><div class="office-form-actions action-buttons"><button class="action-button approve" type="submit">Add engagement</button><button class="action-button reject" type="button" data-office-cancel>Cancel</button></div><div class="office-form-error" role="alert"></div></form>`}
function calendarKind(value){return ['meeting','reminder','note'].includes(value)?value:'meeting'}
function calendarInputDate(value){if(!value)return '';const stamp=new Date(value);if(!Number.isFinite(stamp.getTime()))return '';const pad=part=>String(part).padStart(2,'0');return `${stamp.getFullYear()}-${pad(stamp.getMonth()+1)}-${pad(stamp.getDate())}T${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`}
function calendarForm(item=null,presetClientId=null,reopenClientId=null,presetDate=null){
  const kind=calendarKind(item?.kind),target=item?.calendar_item_id||'new',selectedClient=item?.client_id??presetClientId??'',selectedAt=item?.at??presetDate??'';
  return `<form class="office-form hidden calendar-form" data-office-form="calendar" data-office-target="${esc(target)}" data-calendar-item-id="${esc(item?.calendar_item_id||'')}" data-reopen-client-id="${esc(reopenClientId||'')}"><div class="office-form-grid">
    <label>Kind<select name="kind" required><option value="meeting"${kind==='meeting'?' selected':''}>Meeting</option><option value="reminder"${kind==='reminder'?' selected':''}>Reminder</option><option value="note"${kind==='note'?' selected':''}>Note</option></select></label>
    <label>Date and time<input name="at" type="datetime-local" value="${esc(calendarInputDate(selectedAt))}" required></label>
    <label class="office-form-wide">Title<input name="title" value="${esc(item?.title||'')}" required></label>
    <label class="office-form-wide">Detail<textarea name="detail" rows="3">${esc(item?.detail||'')}</textarea></label>
    <label>Client<select name="client_id"><option value="">Standalone</option>${(officeState.clients||[]).map(client=>`<option value="${esc(client.client_id)}"${String(client.client_id)===String(selectedClient)?' selected':''}>${esc(client.name||'Unnamed client')}</option>`).join('')}</select></label>
    <label class="calendar-done"${item||kind==='reminder'?'':' hidden'}><span>Item status</span><span class="calendar-check"><input name="done" type="checkbox"${item?.done?' checked':''}> Done</span></label>
  </div><div class="office-form-actions action-buttons"><button class="action-button approve" type="submit">${item?'Save item':'Add item'}</button><button class="action-button reject" type="button" data-office-cancel>Cancel</button>${item?`<button class="link-button contact-delete" type="button" data-delete-calendar="${esc(item.calendar_item_id)}">Delete</button>`:''}</div><div class="office-form-error" role="alert"></div></form>`;
}
function officeRows(title,rows,emptyLabel){return `<div class="drill-section"><h4>${esc(title)}</h4>${rows.length?`<div class="drill-rows">${rows.map(row=>`<div class="drill-row"><div class="drill-row-top"><strong>${esc(row.label)}</strong>${row.chip?officeStatusChip(row.chip,row.kind):`<span>${esc(row.value||'')}</span>`}</div>${row.sub?`<p>${esc(row.sub)}</p>`:''}</div>`).join('')}</div>`:`<div class="empty-state"><strong>${esc(emptyLabel)}</strong></div>`}</div>`}
function externalContactUrl(value){if(!value)return '';try{const raw=String(value).trim(),url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw)?raw:`https://${raw}`);return ['http:','https:'].includes(url.protocol)?url.href:''}catch{return ''}}
function contactCard(contact){
  const name=contact.name||contact.email||'Unnamed contact',linkedin=externalContactUrl(contact.linkedin),location=[contact.address,[contact.city,contact.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  return `<article class="drill-row contact-row"><div class="drill-row-top"><div><strong>${esc(name)}</strong><span>${esc(contact.role||'Contact')}</span></div><div class="contact-actions"><button class="link-button" type="button" data-office-toggle="contact" data-office-target="${esc(contact.contact_id)}">Edit</button><button class="link-button contact-delete" type="button" data-delete-contact="${esc(contact.contact_id)}">Delete</button></div></div><div class="contact-links">${contact.phone?`<a href="tel:${esc(contact.phone)}">${esc(contact.phone)}</a>`:''}${contact.email?`<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>`:''}${linkedin?`<a href="${esc(linkedin)}" target="_blank" rel="noreferrer noopener">LinkedIn ↗</a>`:''}</div>${location?`<p>${esc(location)}</p>`:''}${contactForm(contact)}</article>`;
}
function contactSection(client){
  const contacts=client.contacts||[],atCap=contacts.length>=10;
  return `<div class="drill-section contact-section"><div class="drill-section-head"><h4>Contacts · ${contacts.length}/10</h4><button class="action-button approve" type="button" data-office-toggle="contact" data-office-target="new"${atCap?' title="The server will verify whether another contact can be added"':''}>Add contact</button></div>${atCap?'<p class="contact-cap">Maximum 10 contacts shown. You can still try to add one; the server will confirm the current limit.</p>':''}${contacts.length?`<div class="drill-rows">${contacts.map(contactCard).join('')}</div>`:'<div class="empty-state"><strong>No contacts recorded</strong></div>'}${contactForm()}</div>`;
}
function clientCalendarSection(client){
  const items=(officeState.calendar||[]).filter(item=>item.client_id!=null&&item.client_id!==''&&client.client_id!=null&&client.client_id!==''&&String(item.client_id)===String(client.client_id)).sort((a,b)=>Number(b.overdue)-Number(a.overdue)||new Date(a.at)-new Date(b.at)),shown=items.slice(0,4);
  return `<div class="drill-section client-calendar"><div class="drill-section-head"><h4>Calendar · ${items.length}</h4><button class="action-button approve" type="button" data-office-toggle="calendar" data-office-target="new">Add calendar item</button></div>${shown.length?`<div class="drill-rows">${shown.map(item=>{const kind=calendarKind(item.kind);return `<div class="drill-row${item.done?' calendar-completed':''}${item.overdue&&!item.done?' calendar-overdue-row':''}"><div class="drill-row-top"><strong>${esc(item.title||'Untitled item')}</strong><span>${esc(date(item.at))}</span></div><p><span class="chip calendar-kind kind-${kind}">${esc(kind)}</span>${item.done?' · Completed':item.overdue?' · Overdue':''}</p></div>`}).join('')}</div>`:'<div class="empty-state"><strong>No calendar items</strong></div>'}${items.length>shown.length?`<p class="quiet calendar-more">${items.length-shown.length} more in Calendar</p>`:''}${calendarForm(null,client.client_id,client.client_id)}</div>`;
}
function clientDrillContent(client){
  const opportunities=(client.opportunities||[]).map(opp=>({label:opp.title||'Untitled opportunity',chip:opp.stage,kind:'opportunity',sub:[`${money(opp.value_estimate)} estimated`,`${Math.round(Number(opp.probability||0)*100)}% probability`,opp.next_action?`Next: ${opp.next_action}`:'',opp.next_action_due?`due ${dateOnly(opp.next_action_due)}`:''].filter(Boolean).join(' · ')}));
  const touches=(client.touches||[]).slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).map(touch=>({label:[touch.channel,touch.direction].filter(Boolean).join(' · ')||'Touch',value:date(touch.at),sub:[touch.summary,touch.followup_due?`Follow up ${dateOnly(touch.followup_due)}`:''].filter(Boolean).join(' · ')}));
  const engagements=(client.engagements||[]).map(engagement=>({label:engagement.scope||'Engagement',chip:engagement.status,kind:'engagement',sub:[money(engagement.price),engagement.pricing_model].filter(Boolean).join(' · ')}));
  return `${contactSection(client)}${clientCalendarSection(client)}${officeRows('Opportunities',opportunities,'No opportunities recorded')}${officeRows('Touches',touches,'No touches recorded')}${officeRows('Engagements',engagements,'No engagements recorded')}
  <div class="drill-section client-update"><h4>Update client</h4><div class="action-buttons"><button class="action-button approve" type="button" data-office-toggle="touch">Log touch</button><button class="action-button approve" type="button" data-office-toggle="opportunity">Add opportunity</button><button class="action-button approve" type="button" data-office-toggle="engagement">Add engagement</button><button class="link-button" type="button" data-office-toggle="client">Edit details</button></div>${touchForm()}${opportunityForm()}${engagementForm()}${clientForm(client)}</div>`;
}
function openClientDrill(clientId){
  const client=(officeState.clients||[]).find(item=>String(item.client_id)===String(clientId));if(!client)return;
  const last=latestTouch(client);
  openDrill({title:client.name,subtitle:client.source?`Source: ${client.source}`:'Client record',stats:[
    {label:'Tier',value:client.tier||'—'},{label:'Status',value:client.status||'—'},{label:'Open value',value:money(openOpportunityValue(client)),sub:'Probability-weighted'},{label:'Last touch',value:relativeDate(last?.at),sub:last?date(last.at):'No activity recorded'}],
    chart:clientDrillContent(client),note:client.notes||''});
  bindOfficeForms($('#drill-body'),client.client_id);
}
function visibleClientGroups(){
  const search=clientView.search.trim().toLowerCase(),matches=client=>(!clientView.tier||client.tier===clientView.tier)&&(!clientView.status||client.status===clientView.status)&&(!search||String(client.name||'').toLowerCase().includes(search)),all=officeState?.clients||[];
  const pinned=all.filter(client=>client.starred).filter(matches).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))),rest=all.filter(client=>!client.starred).filter(matches);
  const tiers={A:0,B:1,C:2};rest.sort((a,b)=>clientView.sort==='tier'?(tiers[a.tier]??3)-(tiers[b.tier]??3)||String(a.name||'').localeCompare(String(b.name||'')):clientView.sort==='value'?openOpportunityValue(b)-openOpportunityValue(a)||String(a.name||'').localeCompare(String(b.name||'')):String(a.name||'').localeCompare(String(b.name||'')));
  return {pinned,rest};
}
function visibleClients(){const{pinned,rest}=visibleClientGroups();return [...pinned,...rest]}
function clientCard(client){
  const last=latestTouch(client),name=client.name||'Unnamed client';
  return `<article class="kpi client-row clickable" data-client="${esc(client.client_id)}"><button class="client-star" type="button" data-client-star="${esc(client.client_id)}" data-starred="${client.starred?'true':'false'}" aria-label="${client.starred?'Unpin':'Pin'} ${esc(name)}" aria-pressed="${client.starred?'true':'false'}" title="${client.starred?'Remove from Pinned':'Add to Pinned'}">${client.starred?'★':'☆'}</button><div class="client-identity"><div class="client-chips"><span class="chip">Tier ${esc(client.tier||'—')}</span>${officeStatusChip(client.status,'client')}</div><h3>${esc(name)}</h3><span>${esc(client.source||'Source not recorded')}</span></div><div class="client-measure"><small>Last touch</small><strong>${esc(relativeDate(last?.at))}</strong><span>${esc(last?date(last.at):'No activity recorded')}</span></div><div class="client-measure"><small>Open opportunity value</small><strong>${esc(money(openOpportunityValue(client)))}</strong><span>Probability-weighted pipeline</span></div></article>`;
}
function clientSection(title,clients){return clients.length?`<section class="client-section"><h3>${esc(title)}</h3><div class="client-list">${clients.map(clientCard).join('')}</div></section>`:''}
function clientResultsMarkup(){
  const all=officeState?.clients||[],{pinned,rest}=visibleClientGroups();if(!pinned.length&&!rest.length)return all.length?'<div class="empty-state client-empty"><strong>No clients match</strong><p>Adjust the search, tier, or status filters to see more relationships.</p></div>':'<div class="empty-state client-empty"><strong>No clients yet</strong><p>Add the first client to begin tracking contacts, opportunities, touches, and engagements.</p></div>';
  return `${clientSection('Pinned',pinned)}${clientSection(pinned.length?'Clients':'All clients',rest)}`;
}
function bindClientCards(scope=document){
  $$('[data-client]',scope).forEach(el=>el.onclick=()=>openClientDrill(el.dataset.client));
  $$('[data-client-star]',scope).forEach(button=>button.onclick=event=>setClientStar(event,button.dataset.clientStar,button.dataset.starred!=='true',button));
}
function renderClientResults(){const results=$('#client-results');if(!results)return;const clients=visibleClients();results.innerHTML=clientResultsMarkup();const count=$('#client-result-count');if(count)count.textContent=`${clients.length} shown`;bindClientCards(results)}
function renderClients(){
  const clients=officeState?.clients||[];$('#client-count').textContent=clients.length;
  $('[data-panel="clients"]').innerHTML=pageHead('Clients','Relationships, pipeline, touches, and active engagements in one operating view.',`${clients.filter(client=>client.status==='active').length} active · ${clients.length} total`)+`
  <article class="card client-create"><div class="card-head"><div><h3>Client directory</h3><p>Add a relationship, then use its drill-down to log activity and commercial work.</p></div><button class="action-button approve" type="button" data-office-toggle="client">Add client</button></div>${clientForm()}</article>
  <div class="card client-controls"><div class="client-filter-grid"><label>Search<input type="search" data-client-filter="search" value="${esc(clientView.search)}" placeholder="Client name"></label><label>Tier<select data-client-filter="tier"><option value="">All tiers</option><option value="A"${clientView.tier==='A'?' selected':''}>Tier A</option><option value="B"${clientView.tier==='B'?' selected':''}>Tier B</option><option value="C"${clientView.tier==='C'?' selected':''}>Tier C</option></select></label><label>Status<select data-client-filter="status"><option value="">All statuses</option><option value="lead"${clientView.status==='lead'?' selected':''}>Lead</option><option value="active"${clientView.status==='active'?' selected':''}>Active</option><option value="dormant"${clientView.status==='dormant'?' selected':''}>Dormant</option><option value="lost"${clientView.status==='lost'?' selected':''}>Lost</option></select></label><label>Sort by<select data-client-filter="sort"><option value="name"${clientView.sort==='name'?' selected':''}>Name</option><option value="tier"${clientView.sort==='tier'?' selected':''}>Tier</option><option value="value"${clientView.sort==='value'?' selected':''}>Open value (high to low)</option></select></label></div><span class="quiet" id="client-result-count">${visibleClients().length} shown</span></div>
  <div id="client-results">${clientResultsMarkup()}</div>`;
}
function officeValue(form,name){return form.elements[name]?.value.trim()||null}
function officeDate(form,name){const value=officeValue(form,name);return value?new Date(value).toISOString():null}
async function mutateOffice(form,rpc,args,reopenClientId=null){
  const errorBox=$('.office-form-error',form),button=$('[type="submit"]',form),original=button.textContent;errorBox.textContent='';button.disabled=true;button.textContent='Saving…';
  try{const{data,error}=await sb.rpc(rpc,args);if(error)throw error;if(data?.ok===false)throw new Error(data.error||'The office update was not accepted.');await reloadOffice(reopenClientId)}catch(error){errorBox.textContent=`Action failed: ${error.message}`;button.disabled=false;button.textContent=original}
}
function submitClient(event){event.preventDefault();const form=event.currentTarget,clientId=form.dataset.clientId||null;return mutateOffice(form,'api_upsert_client',{p_client_id:clientId,p_name:officeValue(form,'name'),p_tier:officeValue(form,'tier'),p_status:officeValue(form,'status'),p_source:officeValue(form,'source'),p_notes:officeValue(form,'notes')},clientId)}
function submitContact(event,clientId){event.preventDefault();const form=event.currentTarget;return mutateOffice(form,'api_upsert_contact',{p_contact_id:form.dataset.contactId||null,p_client_id:clientId,p_name:officeValue(form,'name'),p_email:officeValue(form,'email'),p_phone:officeValue(form,'phone'),p_role:officeValue(form,'role'),p_linkedin:officeValue(form,'linkedin'),p_address:officeValue(form,'address'),p_city:officeValue(form,'city'),p_state:officeValue(form,'state')},clientId)}
function submitTouch(event,clientId){event.preventDefault();const form=event.currentTarget;return mutateOffice(form,'api_log_touch',{p_client_id:clientId,p_channel:officeValue(form,'channel'),p_direction:officeValue(form,'direction'),p_summary:officeValue(form,'summary'),p_followup_due:officeDate(form,'followup_due')},clientId)}
function submitOpportunity(event,clientId){event.preventDefault();const form=event.currentTarget;return mutateOffice(form,'api_upsert_opportunity',{p_opp_id:null,p_client_id:clientId,p_title:officeValue(form,'title'),p_stage:officeValue(form,'stage'),p_value_estimate:Number(officeValue(form,'value_estimate')),p_probability:Number(officeValue(form,'probability')),p_next_action:officeValue(form,'next_action'),p_next_action_due:officeDate(form,'next_action_due'),p_owner_agent:null},clientId)}
function submitEngagement(event,clientId){event.preventDefault();const form=event.currentTarget;return mutateOffice(form,'api_upsert_engagement',{p_engagement_id:null,p_client_id:clientId,p_scope:officeValue(form,'scope'),p_price:Number(officeValue(form,'price')),p_pricing_model:officeValue(form,'pricing_model'),p_status:officeValue(form,'status')},clientId)}
function submitInvoice(event){event.preventDefault();const form=event.currentTarget;return mutateOffice(form,'api_upsert_invoice',{p_invoice_id:null,p_engagement_id:officeValue(form,'engagement_id'),p_amount:Number(officeValue(form,'amount')),p_issued_at:officeDate(form,'issued_at'),p_due_at:officeDate(form,'due_at'),p_paid_at:null,p_status:officeValue(form,'status')})}
function submitExpense(event){event.preventDefault();const form=event.currentTarget;return mutateOffice(form,'api_log_expense',{p_at:officeDate(form,'at'),p_amount:Number(officeValue(form,'amount')),p_category:officeValue(form,'category'),p_source:officeValue(form,'source'),p_memo:officeValue(form,'memo')})}
function submitCalendar(event){event.preventDefault();const form=event.currentTarget,kind=calendarKind(officeValue(form,'kind'));return mutateOffice(form,'api_upsert_calendar_item',{p_calendar_item_id:form.dataset.calendarItemId||null,p_client_id:officeValue(form,'client_id'),p_kind:kind,p_title:officeValue(form,'title'),p_detail:officeValue(form,'detail'),p_at:officeDate(form,'at'),p_done:!!form.elements.done?.checked},form.dataset.reopenClientId||null)}
function submitCalendarDone(event,itemId,reopenClientId=null){
  event.preventDefault();const form=event.currentTarget,item=(officeState.calendar||[]).find(entry=>String(entry.calendar_item_id)===String(itemId));if(!item)return;
  return mutateOffice(form,'api_upsert_calendar_item',{p_calendar_item_id:item.calendar_item_id,p_client_id:item.client_id,p_kind:calendarKind(item.kind),p_title:item.title,p_detail:item.detail,p_at:item.at,p_done:!item.done},reopenClientId);
}
function markInvoicePaid(event){
  event.preventDefault();
  const form=event.currentTarget,invoice=(officeState.invoices||[]).find(item=>String(item.invoice_id)===form.dataset.invoiceId);if(!invoice)return;
  return mutateOffice(form,'api_upsert_invoice',{p_invoice_id:invoice.invoice_id,p_engagement_id:invoice.engagement_id,p_amount:Number(invoice.amount||0),p_issued_at:invoice.issued_at,p_due_at:invoice.due_at,p_paid_at:new Date().toISOString(),p_status:'paid'});
}
async function deleteContact(event,contactId,clientId){
  event.preventDefault();if(!confirm('Delete this contact?'))return;const button=event.currentTarget;button.disabled=true;
  try{const{data,error}=await sb.rpc('api_delete_contact',{p_contact_id:contactId});if(error)throw error;if(data?.ok===false)throw new Error(data.error||'The contact could not be deleted.');await reloadOffice(clientId)}catch(error){button.disabled=false;alert(`Action failed: ${error.message}`)}
}
async function deleteCalendarItem(event,itemId,reopenClientId=null){
  event.preventDefault();if(!confirm('Delete this calendar item?'))return;const button=event.currentTarget;button.disabled=true;
  try{const{data,error}=await sb.rpc('api_delete_calendar_item',{p_calendar_item_id:itemId});if(error)throw error;if(data?.ok===false)throw new Error(data.error||'The calendar item could not be deleted.');await reloadOffice(reopenClientId)}catch(error){button.disabled=false;alert(`Action failed: ${error.message}`)}
}
async function setClientStar(event,clientId,starred,button){
  event.preventDefault();event.stopPropagation();button.disabled=true;
  try{const{data,error}=await sb.rpc('api_set_client_star',{p_client_id:clientId,p_starred:starred});if(error)throw error;if(data?.ok===false)throw new Error(data.error||'The client pin could not be updated.');await reloadOffice()}catch(error){button.disabled=false;alert(`Action failed: ${error.message}`)}
}
function bindOfficeForms(scope,clientId=null){
  if(!scope)return;
  $$('[data-office-toggle]',scope).forEach(button=>button.onclick=()=>{$$('[data-office-form]',scope).forEach(form=>form.classList.toggle('hidden',form.dataset.officeForm!==button.dataset.officeToggle||(button.dataset.officeTarget&&form.dataset.officeTarget!==button.dataset.officeTarget)));const target=$$('[data-office-form]',scope).find(form=>form.dataset.officeForm===button.dataset.officeToggle&&(!button.dataset.officeTarget||form.dataset.officeTarget===button.dataset.officeTarget));if(target&&button.dataset.officeToggle==='calendar'&&button.dataset.officeTarget==='new'){calendarCreatePreset=button.dataset.calendarDay?calendarDateAt(button.dataset.calendarDay):null;target.elements.at.value=calendarInputDate(calendarCreatePreset)}target?.querySelector('input,select,textarea')?.focus()});
  $$('[data-office-cancel]',scope).forEach(button=>button.onclick=()=>button.closest('.office-form').classList.add('hidden'));
  const client=$('[data-office-form="client"]',scope);if(client)client.onsubmit=submitClient;
  $$('[data-office-form="contact"]',scope).forEach(contact=>contact.onsubmit=event=>submitContact(event,clientId));
  $$('[data-delete-contact]',scope).forEach(button=>button.onclick=event=>deleteContact(event,button.dataset.deleteContact,clientId));
  const touch=$('[data-office-form="touch"]',scope);if(touch)touch.onsubmit=event=>submitTouch(event,clientId);
  const opportunity=$('[data-office-form="opportunity"]',scope);if(opportunity)opportunity.onsubmit=event=>submitOpportunity(event,clientId);
  const engagement=$('[data-office-form="engagement"]',scope);if(engagement)engagement.onsubmit=event=>submitEngagement(event,clientId);
  const invoice=$('[data-office-form="invoice"]',scope);if(invoice)invoice.onsubmit=submitInvoice;
  const expense=$('[data-office-form="expense"]',scope);if(expense)expense.onsubmit=submitExpense;
  $$('[data-office-form="calendar"]',scope).forEach(form=>{form.onsubmit=submitCalendar;const kind=form.elements.kind,done=$('.calendar-done',form),sync=()=>{if(done){done.hidden=!form.dataset.calendarItemId&&kind.value!=='reminder';if(done.hidden&&form.elements.done)form.elements.done.checked=false}};kind.onchange=sync;sync()});
  $$('[data-mark-paid]',scope).forEach(form=>form.onsubmit=markInvoicePaid);
  $$('[data-calendar-done]',scope).forEach(form=>form.onsubmit=event=>submitCalendarDone(event,form.dataset.calendarDone,form.dataset.reopenClientId||null));
  $$('[data-delete-calendar]',scope).forEach(button=>button.onclick=event=>deleteCalendarItem(event,button.dataset.deleteCalendar,button.dataset.reopenClientId||null));
}
async function reloadOffice(reopenClientId=null){const{data:office,error}=await sb.rpc('api_office_state');if(error)throw error;officeState=office||{clients:[],calendar:[]};renderClients();renderFinances();renderCalendar();bindNavigation();if(reopenClientId)openClientDrill(reopenClientId);if(calendarDetailItemId!=null)openCalendarDetail(calendarDetailItemId,false)}

/* ── Finances ─────────────────────────────────────────────────────── */
function financeEngagements(){return (officeState.clients||[]).flatMap(client=>(client.engagements||[]).map(engagement=>({...engagement,clientName:client.name||''})))}
function invoiceForm(engagements){
  const today=new Date().toISOString().slice(0,10);
  return `<form class="office-form hidden" data-office-form="invoice"><div class="office-form-grid">
    <label class="office-form-wide">Engagement<select name="engagement_id" required><option value="">Select an engagement</option>${engagements.map(item=>`<option value="${esc(item.engagement_id)}">${esc([item.clientName,item.scope||item.engagement_id].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>
    <label>Amount<input name="amount" type="number" min="0" step="0.01" required></label><label>Status<select name="status"><option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="void">Void</option></select></label>
    <label>Issued<input name="issued_at" type="date" value="${today}" required></label><label>Due<input name="due_at" type="date" required></label>
  </div><div class="office-form-actions action-buttons"><button class="action-button approve" type="submit">Add invoice</button><button class="action-button reject" type="button" data-office-cancel>Cancel</button></div><div class="office-form-error" role="alert"></div></form>`;
}
function expenseForm(){
  const today=new Date().toISOString().slice(0,10);
  return `<form class="office-form hidden" data-office-form="expense"><div class="office-form-grid">
    <label>Date<input name="at" type="date" value="${today}" required></label><label>Amount<input name="amount" type="number" min="0" step="0.01" required></label>
    <label>Category<input name="category" required></label><label>Source<select name="source"><option value="manual">Manual</option><option value="ai_spend">AI spend</option><option value="bank_import">Bank import</option></select></label>
    <label class="office-form-wide">Memo<textarea name="memo" rows="3"></textarea></label>
  </div><div class="office-form-actions action-buttons"><button class="action-button approve" type="submit">Log expense</button><button class="action-button reject" type="button" data-office-cancel>Cancel</button></div><div class="office-form-error" role="alert"></div></form>`;
}
function renderFinances(){
  const invoices=officeState.invoices||[],expenses=officeState.expenses||[],rollups=officeState.rollups||{},engagements=financeEngagements();
  const engagementById=new Map(engagements.map(item=>[String(item.engagement_id),item]));
  const month=rollups.month_start?`Month starting ${dateOnly(rollups.month_start)}`:'Current month';
  const margins=rollups.engagement_margins||[];
  $('[data-panel="finances"]').innerHTML=pageHead('Finances','Invoices, collections, engagement margins, and operating expenses in one view.',month)+`
  <div class="kpi-grid">
    <article class="kpi"><div class="kpi-top">Billed <i></i></div><strong>${money(rollups.month_billed)}</strong><span>${esc(month)}</span></article>
    <article class="kpi"><div class="kpi-top">Collected <i></i></div><strong>${money(rollups.month_collected)}</strong><span>${esc(month)}</span></article>
    <article class="kpi"><div class="kpi-top">Spent <i></i></div><strong>${money(rollups.month_spent)}</strong><span>${esc(month)}</span></article>
    <article class="kpi"><div class="kpi-top">Net <i></i></div><strong>${money(Number(rollups.month_billed||0)-Number(rollups.month_spent||0))}</strong><span>Billed less spent · ${esc(month)}</span></article>
  </div>
  <article class="card" style="margin-top:14px"><div class="card-head"><div><h3>Invoices</h3><p>Issued work, collection status, and recorded payments.</p></div><button class="action-button approve" type="button" data-office-toggle="invoice"${engagements.length?'':' disabled'}>Add invoice</button></div>${invoiceForm(engagements)}${invoices.length?`<table class="queue-table"><thead><tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Issued</th><th>Due</th><th>Paid</th></tr></thead><tbody>${invoices.map(invoice=>{const engagement=engagementById.get(String(invoice.engagement_id)),payments=invoice.payments||[],paidTotal=payments.reduce((sum,payment)=>sum+Number(payment.amount||0),0),methods=[...new Set(payments.map(payment=>payment.method).filter(Boolean))];return `<tr><td><strong>${esc(engagement?.scope||invoice.engagement_id||invoice.invoice_id||'Invoice')}</strong><small>${esc(invoice.invoice_id||'')}</small></td><td>${money(invoice.amount)}</td><td>${officeStatusChip(invoice.status,'invoice')}${!['paid','void'].includes(invoice.status)?`<form class="action-buttons" data-mark-paid data-invoice-id="${esc(invoice.invoice_id)}"><button class="link-button" type="submit">Mark paid</button><span class="office-form-error" role="alert"></span></form>`:''}</td><td>${esc(dateOnly(invoice.issued_at))}</td><td>${esc(dateOnly(invoice.due_at))}</td><td>${esc(dateOnly(invoice.paid_at))}${payments.length?`<small>${money(paidTotal)} · ${payments.length} payment${payments.length===1?'':'s'}${methods.length?` · ${esc(methods.join(', '))}`:''}</small>`:''}</td></tr>`}).join('')}</tbody></table>`:'<div class="empty-state"><strong>No invoices yet</strong><p>Add an invoice once an engagement is ready to bill.</p></div>'}</article>
  <article class="card" style="margin-top:14px"><div class="card-head"><div><h3>Engagement margins</h3><p>Invoiced revenue less attributed AI spend.</p></div></div>${margins.length?`<table class="queue-table"><thead><tr><th>Scope</th><th>Invoiced</th><th>AI spend</th><th>Margin</th></tr></thead><tbody>${margins.map(item=>`<tr><td><strong>${esc(item.scope||engagementById.get(String(item.engagement_id))?.scope||item.engagement_id||'Engagement')}</strong></td><td>${money(item.invoiced)}</td><td>${money(item.ai_spend)}</td><td>${money(item.margin)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state"><strong>No margin data yet</strong><p>Margins appear after invoices or attributed AI spend are recorded.</p></div>'}<p class="quiet" style="margin:12px 0 0">AI spend ≈ $0 under fixed-cost plans.</p></article>
  <article class="card" style="margin-top:14px"><div class="card-head"><div><h3>Expenses</h3><p>Manual entries, attributed AI spend, and imported bank activity.</p></div><button class="action-button approve" type="button" data-office-toggle="expense">Log expense</button></div>${expenseForm()}${expenses.length?`<table class="queue-table"><thead><tr><th>Date</th><th>Category</th><th>Source</th><th>Amount</th><th>Memo</th></tr></thead><tbody>${expenses.map(expense=>`<tr><td>${esc(dateOnly(expense.at))}</td><td><strong>${esc(expense.category||'Uncategorized')}</strong></td><td>${officeStatusChip(expense.source,'expense')}</td><td>${money(expense.amount)}</td><td>${esc(expense.memo||'—')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state"><strong>No expenses yet</strong><p>Log the first expense to begin tracking operating spend.</p></div>'}</article>`;
}

/* ── Calendar ─────────────────────────────────────────────────────── */
function calendarStamp(item){const stamp=new Date(item.at).getTime();return Number.isFinite(stamp)?stamp:Number.MAX_SAFE_INTEGER}
function localDayKey(value){const stamp=value instanceof Date?value:new Date(value);if(!Number.isFinite(stamp.getTime()))return '';const pad=part=>String(part).padStart(2,'0');return `${stamp.getFullYear()}-${pad(stamp.getMonth()+1)}-${pad(stamp.getDate())}`}
function calendarDateAt(key,hour=9){const parts=String(key||'').split('-').map(Number);return parts.length===3&&parts.every(Number.isFinite)?new Date(parts[0],parts[1]-1,parts[2],hour):null}
function calendarDay(year,month,day){return new Date(year,month,day,12)}
function calendarAddDays(value,amount){const next=new Date(value);next.setDate(next.getDate()+amount);return next}
function calendarWeekStart(value){return calendarAddDays(calendarDay(value.getFullYear(),value.getMonth(),value.getDate()),-value.getDay())}
function nthWeekday(year,month,weekday,n){const first=calendarDay(year,month,1);return calendarDay(year,month,1+(7+weekday-first.getDay())%7+(n-1)*7)}
function lastWeekday(year,month,weekday){const last=calendarDay(year,month+1,0);return calendarAddDays(last,-(7+last.getDay()-weekday)%7)}
function bankFixedHoliday(year,month,day,name){const actual=calendarDay(year,month,day),observed=actual.getDay()===0;return {date:observed?calendarAddDays(actual,1):actual,name,observed}}
function usBankHolidays(year){
  return [
    bankFixedHoliday(year,0,1,"New Year's Day"),
    {date:nthWeekday(year,0,1,3),name:'Martin Luther King Jr. Day'},
    {date:nthWeekday(year,1,1,3),name:"Washington's Birthday"},
    {date:lastWeekday(year,4,1),name:'Memorial Day'},
    bankFixedHoliday(year,5,19,'Juneteenth'),
    bankFixedHoliday(year,6,4,'Independence Day'),
    {date:nthWeekday(year,8,1,1),name:'Labor Day'},
    {date:nthWeekday(year,9,1,2),name:'Columbus Day'},
    bankFixedHoliday(year,10,11,'Veterans Day'),
    {date:nthWeekday(year,10,4,4),name:'Thanksgiving Day'},
    bankFixedHoliday(year,11,25,'Christmas Day')
  ].sort((a,b)=>a.date-b.date);
}
function calendarHolidayMap(days){const years=[...new Set(days.map(day=>day.getFullYear()))],map=new Map();years.flatMap(usBankHolidays).forEach(holiday=>{const key=localDayKey(holiday.date),list=map.get(key)||[];list.push(holiday);map.set(key,list)});return map}
function calendarBuckets(items){const map=new Map();items.slice().sort((a,b)=>calendarStamp(a)-calendarStamp(b)).forEach(item=>{const key=localDayKey(item.at),list=map.get(key)||[];if(key){list.push(item);map.set(key,list)}});return map}
function calendarTime(value){const stamp=new Date(value);return Number.isFinite(stamp.getTime())?stamp.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'Time unavailable'}
function calendarStatus(item){return item.done?{key:'completed',label:'Completed'}:item.overdue?{key:'overdue',label:'Overdue'}:item.due_today?{key:'due-today',label:'Due today'}:{key:'upcoming',label:'Upcoming'}}
function calendarDetailHeader(item){
  const kind=calendarKind(item.kind),title=item.title||'Untitled item';
  return `<header class="calendar-detail-head"><div class="calendar-detail-heading"><span class="chip calendar-kind kind-${kind}">${esc(kind)}</span><h3 id="calendar-detail-title">${esc(title)}</h3></div><div class="calendar-detail-head-actions"><div class="calendar-detail-layout" role="group" aria-label="Calendar detail position">${[['popout','Popout'],['left','Left'],['below','Below']].map(([mode,label])=>`<button type="button" data-calendar-detail-layout="${mode}" aria-pressed="${calendarDetailLayout===mode}" aria-label="Position details ${label.toLowerCase()}">${label}</button>`).join('')}</div><button id="calendar-detail-close" type="button" aria-label="Close calendar item details">✕</button></div></header>`;
}
function calendarDetailMarkup(item){
  const status=calendarStatus(item),client=item.client_name?item.client_id!=null&&item.client_id!==''?`<a class="calendar-detail-client" href="#client/clients" data-calendar-detail-client="${esc(item.client_id)}">${esc(item.client_name)}</a>`:`<span>${esc(item.client_name)}</span>`:'<span>Standalone</span>';
  return `${calendarDetailHeader(item)}<div class="calendar-detail-readonly"><dl class="calendar-detail-facts"><div><dt>Date &amp; time</dt><dd>${esc(date(item.at))}</dd></div><div><dt>Linked client</dt><dd>${client}</dd></div><div><dt>Status</dt><dd><span class="calendar-detail-status ${esc(status.key)}">${status.key==='completed'?'<span aria-hidden="true">✓</span> ':''}${esc(status.label)}</span></dd></div></dl><section class="calendar-detail-copy" aria-labelledby="calendar-detail-copy-title"><h4 id="calendar-detail-copy-title">Detail</h4><p>${item.detail?esc(item.detail):'<span class="quiet">No detail added.</span>'}</p></section><div class="calendar-detail-actions"><button class="action-button approve" type="button" data-calendar-detail-edit aria-label="Edit ${esc(item.title||'Untitled item')}">Edit</button><form class="calendar-detail-done" data-calendar-done="${esc(item.calendar_item_id)}"><button class="action-button calendar-done-button" type="submit" aria-label="${item.done?'Reopen':'Mark done'} ${esc(item.title||'Untitled item')}">${item.done?'Reopen':'Done'}</button><span class="office-form-error" role="alert"></span></form><button class="action-button reject" type="button" data-delete-calendar="${esc(item.calendar_item_id)}" aria-label="Delete ${esc(item.title||'Untitled item')}">Delete</button></div></div>${calendarForm(item)}`;
}
function syncCalendarDetailLayout(persist=false){
  const detail=$('#calendar-detail'),backdrop=$('#calendar-detail-backdrop');if(!detail||!backdrop)return;
  const calendarPanel=$('[data-panel="calendar"]');if(calendarDetailLayout==='below'&&calendarPanel)calendarPanel.append(detail);else $('#app').append(detail);
  detail.dataset.layout=calendarDetailLayout;detail.setAttribute('aria-labelledby','calendar-detail-title');detail.setAttribute('role',calendarDetailLayout==='popout'?'dialog':'region');
  if(calendarDetailLayout==='popout')detail.setAttribute('aria-modal','true');else detail.removeAttribute('aria-modal');
  $$('[data-calendar-detail-layout]',detail).forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calendarDetailLayout===calendarDetailLayout)));
  backdrop.hidden=detail.hidden||calendarDetailLayout!=='popout';
  if(persist)try{localStorage.setItem(CALENDAR_DETAIL_LAYOUT_KEY,calendarDetailLayout)}catch{}
}
function setCalendarDetailLayout(mode){if(!CALENDAR_DETAIL_LAYOUTS.has(mode))return;calendarDetailLayout=mode;syncCalendarDetailLayout(true);if(mode==='below'&&!$('#calendar-detail').hidden)$('#calendar-detail').scrollIntoView({behavior:'smooth',block:'start'})}
function closeCalendarDetail(restoreFocus=true){
  const detail=$('#calendar-detail'),backdrop=$('#calendar-detail-backdrop');if(!detail||detail.hidden)return;
  detail.hidden=true;detail.classList.remove('editing');backdrop.hidden=true;calendarDetailItemId=null;
  const trigger=calendarDetailTrigger;calendarDetailTrigger=null;if(restoreFocus&&trigger?.isConnected)trigger.focus();
}
function bindCalendarDetailControls(){
  const detail=$('#calendar-detail'),body=$('#calendar-detail-body'),backdrop=$('#calendar-detail-backdrop');if(!detail||!body)return;
  if(backdrop)backdrop.onclick=()=>closeCalendarDetail();
  $('#calendar-detail-close',detail).onclick=()=>closeCalendarDetail();
  $$('[data-calendar-detail-layout]',detail).forEach(button=>button.onclick=()=>setCalendarDetailLayout(button.dataset.calendarDetailLayout));
  const edit=$('[data-calendar-detail-edit]',detail),readonly=$('.calendar-detail-readonly',detail),form=$('[data-office-form="calendar"]',detail);
  if(edit&&form)edit.onclick=()=>{readonly.classList.add('hidden');form.classList.remove('hidden');detail.classList.add('editing');form.querySelector('input,select,textarea')?.focus()};
  bindOfficeForms(body);
  $$('[data-office-cancel]',detail).forEach(button=>button.onclick=()=>{form?.classList.add('hidden');readonly?.classList.remove('hidden');detail.classList.remove('editing');edit?.focus()});
  $$('[data-calendar-detail-client]',detail).forEach(link=>link.onclick=event=>{event.preventDefault();const clientId=link.dataset.calendarDetailClient;closeCalendarDetail(false);activate('clients');openClientDrill(clientId)});
}
function openCalendarDetail(itemId,captureFocus=true){
  const item=(officeState.calendar||[]).find(entry=>String(entry.calendar_item_id)===String(itemId));if(!item){closeCalendarDetail(false);return}
  if(captureFocus)calendarDetailTrigger=document.activeElement;calendarDetailItemId=item.calendar_item_id;
  const detail=$('#calendar-detail');$('#calendar-detail-body').innerHTML=calendarDetailMarkup(item);detail.hidden=false;syncCalendarDetailLayout();bindCalendarDetailControls();
  if(captureFocus)$('#calendar-detail-close',detail)?.focus();
}
function calendarGridChip(item,overflow=false){const kind=calendarKind(item.kind),title=item.title||'Untitled item',overdue=item.overdue&&!item.done,client=item.client_name?` · ${item.client_name}`:'',status=calendarStatus(item);return `<button class="chip calendar-kind calendar-grid-item kind-${kind}${overdue?' calendar-grid-overdue':''}${item.done?' calendar-completed':''}${overflow?' calendar-overflow':''}" type="button" data-calendar-detail="${esc(item.calendar_item_id)}" aria-label="View details for ${esc(title)}${esc(client)} at ${esc(calendarTime(item.at))}, ${esc(status.label.toLowerCase())}"><span>${esc(title)}</span></button>`}
function calendarHolidayPills(holidays){return holidays.map(holiday=>`<span class="calendar-holiday" aria-label="${esc(holiday.name)} bank holiday${holiday.observed?', observed':''}">${esc(holiday.name)}${holiday.observed?' · observed':''}</span>`).join('')}
function calendarDayCell(day,items,holidays,currentMonth=null,mode='month'){
  const key=localDayKey(day),today=key===localDayKey(new Date()),other=currentMonth!=null&&day.getMonth()!==currentMonth,limit=mode==='month'?3:items.length,hidden=Math.max(0,items.length-limit),label=day.toLocaleDateString([], {weekday:'long',month:'long',day:'numeric',year:'numeric'});
  return `<article class="calendar-day${today?' calendar-today':''}${other?' calendar-other-month':''}" role="gridcell" tabindex="0" data-calendar-day-cell="${esc(key)}" aria-label="${esc(label)}${today?', today':''}"${today?' aria-current="date"':''}><header><button type="button" data-office-toggle="calendar" data-office-target="new" data-calendar-day="${esc(key)}" aria-label="Add item on ${esc(label)}"${today?' aria-current="date"':''}>${mode==='week'?`<span>${esc(day.toLocaleDateString([], {weekday:'short'}))}</span><strong>${esc(day.getDate())}</strong>`:`<strong>${esc(day.getDate())}</strong>`}</button></header>${calendarHolidayPills(holidays)}<div class="calendar-day-items">${items.map((item,index)=>calendarGridChip(item,index>=limit)).join('')}</div>${hidden?`<button class="calendar-more-items" type="button" data-calendar-more="${hidden}" aria-expanded="false">+${hidden} more</button>`:''}<button class="calendar-day-add" type="button" data-office-toggle="calendar" data-office-target="new" data-calendar-day="${esc(key)}" aria-label="Add item on ${esc(label)}">＋</button></article>`;
}
function calendarToolbar(label){return `<div class="calendar-toolbar"><div class="calendar-nav"><button class="calendar-nav-button" type="button" data-calendar-shift="-1" aria-label="Previous ${esc(calendarView)}">‹</button><button class="calendar-today-button" type="button" data-calendar-today>Today</button><button class="calendar-nav-button" type="button" data-calendar-shift="1" aria-label="Next ${esc(calendarView)}">›</button></div><strong class="calendar-period" aria-live="polite">${esc(label)}</strong><label class="calendar-view-select"><span>Calendar view</span><select data-calendar-view aria-label="Calendar view">${['month','week','list'].map(view=>`<option value="${view}"${calendarView===view?' selected':''}>${view[0].toUpperCase()+view.slice(1)}</option>`).join('')}</select></label></div>`}
function calendarPeriodLabel(){
  if(calendarView==='month')return calendarDay(calendarCursor.getFullYear(),calendarCursor.getMonth(),1).toLocaleDateString([], {month:'long',year:'numeric'});
  if(calendarView==='list')return 'All items';
  const start=calendarWeekStart(calendarCursor),end=calendarAddDays(start,6),sameYear=start.getFullYear()===end.getFullYear(),format=day=>day.toLocaleDateString([], {month:'short',day:'numeric',year:sameYear?undefined:'numeric'});
  return `Week of ${format(start)} – ${format(end)}${sameYear?`, ${end.getFullYear()}`:''}`;
}
function calendarMonthView(items){
  const month=calendarCursor.getMonth(),first=calendarDay(calendarCursor.getFullYear(),month,1),daysInMonth=calendarDay(calendarCursor.getFullYear(),month+1,0).getDate(),weeks=Math.ceil((first.getDay()+daysInMonth)/7),start=calendarAddDays(first,-first.getDay()),days=Array.from({length:weeks*7},(_,index)=>calendarAddDays(start,index)),buckets=calendarBuckets(items),holidays=calendarHolidayMap(days),label=first.toLocaleDateString([], {month:'long',year:'numeric'});
  return `<div class="calendar-grid-scroll"><div class="calendar-grid" style="--calendar-weeks:${weeks}" role="grid" aria-label="${esc(label)} calendar">${[['SUN','Sunday'],['MON','Monday'],['TUE','Tuesday'],['WED','Wednesday'],['THU','Thursday'],['FRI','Friday'],['SAT','Saturday']].map(([short,long])=>`<div class="calendar-weekday" role="columnheader" aria-label="${long}">${short}</div>`).join('')}${days.map(day=>calendarDayCell(day,buckets.get(localDayKey(day))||[],holidays.get(localDayKey(day))||[],month)).join('')}</div></div>`;
}
function calendarWeekView(items){
  const start=calendarWeekStart(calendarCursor),days=Array.from({length:7},(_,index)=>calendarAddDays(start,index)),label=calendarPeriodLabel(),buckets=calendarBuckets(items),holidays=calendarHolidayMap(days);
  return `<div class="calendar-grid-scroll"><div class="calendar-week-grid" role="grid" aria-label="${esc(label)}">${days.map(day=>calendarDayCell(day,buckets.get(localDayKey(day))||[],holidays.get(localDayKey(day))||[],null,'week')).join('')}</div></div>`;
}
function calendarRow(item){
  const kind=calendarKind(item.kind),overdue=item.overdue&&!item.done,status=calendarStatus(item),client=item.client_name?`<span>${esc(item.client_name)}</span>`:'<span class="quiet">Standalone</span>',title=item.title||'Untitled item';
  return `<article class="calendar-row${overdue?' calendar-overdue-row':''}${item.done?' calendar-completed':''}" data-calendar-detail="${esc(item.calendar_item_id)}" tabindex="0" role="button" aria-label="View details for ${esc(title)}, ${esc(status.label.toLowerCase())}"><div class="calendar-row-main"><div class="calendar-row-meta"><span class="chip calendar-kind kind-${kind}">${esc(kind)}</span><span class="calendar-row-status ${esc(status.key)}">${status.key==='completed'?'✓ ':''}${esc(status.label)}</span><time>${esc(date(item.at))}</time>${client}</div><h3>${esc(title)}</h3>${item.detail?`<p>${esc(item.detail)}</p>`:''}</div><span class="calendar-row-open" aria-hidden="true">View details →</span></article>`;
}
function calendarGroup(title,items,mode=''){
  if(!items.length)return '';
  return `<section class="calendar-group ${mode}"><h3>${esc(title)} <span>${items.length}</span></h3><div class="calendar-list">${items.map(calendarRow).join('')}</div></section>`;
}
function renderCalendar(){
  const items=(officeState.calendar||[]).slice(),ascending=(a,b)=>calendarStamp(a)-calendarStamp(b),overdue=items.filter(item=>item.overdue&&!item.done).sort(ascending),upcoming=items.filter(item=>!item.done&&!item.overdue).sort(ascending),done=items.filter(item=>item.done).sort((a,b)=>calendarStamp(b)-calendarStamp(a));
  const view=calendarView==='month'?calendarMonthView(items):calendarView==='week'?calendarWeekView(items):items.length?`${calendarGroup('Overdue',overdue,'overdue')}${calendarGroup('Upcoming',upcoming)}${calendarGroup('Done / past',done,'done')}`:'<div class="empty-state calendar-empty"><strong>No calendar items yet</strong><p>Add a meeting, reminder, or note to start running the week here.</p></div>',panel=$('[data-panel="calendar"]'),detail=$('#calendar-detail');
  if(detail&&detail.parentElement===panel)$('#app').append(detail);
  panel.innerHTML=`<article class="card calendar-panel"><header class="calendar-panel-header"><div class="calendar-heading"><span class="calendar-title-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M8 3v4M16 3v4M3 10h18"></path></svg></span><div><h2>Schedule</h2><p>Add a standalone item or link it directly to a client.</p></div></div><button class="calendar-add-item" type="button" data-office-toggle="calendar" data-office-target="new">＋ Add Item</button></header>${calendarForm(null,null,null,calendarCreatePreset)}${calendarToolbar(calendarPeriodLabel())}<div class="calendar-view-content${calendarView==='list'?' calendar-list-content':''}">${view}</div></article>`;
  if(calendarDetailItemId!=null)syncCalendarDetailLayout();
}

function bindCalendarControls(){
  const panel=$('[data-panel="calendar"]');if(!panel)return;
  $$('[data-calendar-view]',panel).forEach(select=>select.onchange=()=>{if(!CALENDAR_VIEWS.has(select.value))return;calendarView=select.value;try{localStorage.setItem(CALENDAR_VIEW_KEY,calendarView)}catch{}renderCalendar();bindCalendarControls()});
  $$('[data-calendar-shift]',panel).forEach(button=>button.onclick=()=>{const amount=Number(button.dataset.calendarShift);calendarCursor=calendarView==='month'?calendarDay(calendarCursor.getFullYear(),calendarCursor.getMonth()+amount,1):calendarAddDays(calendarCursor,amount*7);renderCalendar();bindCalendarControls()});
  $$('[data-calendar-today]',panel).forEach(button=>button.onclick=()=>{calendarCursor=new Date();renderCalendar();bindCalendarControls()});
  $$('[data-calendar-more]',panel).forEach(button=>button.onclick=()=>{const cell=button.closest('.calendar-day'),expanded=cell.classList.toggle('calendar-expanded');button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?'Show fewer':`+${button.dataset.calendarMore} more`});
  $$('[data-calendar-day-cell]',panel).forEach(cell=>{const open=event=>{if(event.target!==cell&&!event.target.classList.contains('calendar-day-items'))return;$('[data-calendar-day]',cell)?.click()};cell.onclick=open;cell.onkeydown=event=>{if((event.key==='Enter'||event.key===' ')&&event.target===cell){event.preventDefault();$('[data-calendar-day]',cell)?.click()}}});
  $$('[data-calendar-detail]',panel).forEach(control=>{control.onclick=event=>{event.stopPropagation();openCalendarDetail(control.dataset.calendarDetail)};control.onkeydown=event=>{if((event.key==='Enter'||event.key===' ')&&control.tagName!=='BUTTON'){event.preventDefault();openCalendarDetail(control.dataset.calendarDetail)}}});
  bindClientCards(panel);bindOfficeForms(panel);
}

/* ── Work / Agents (largely unchanged) ────────────────────────────── */
function renderWork(){const tasks=state.continuity.tasks,live=state.operations.work||[];$('[data-panel="work"]').innerHTML=pageHead('Work queue','Durable continuity tasks and executable control-plane work in one view.',`${tasks.filter(t=>t.status==='active').length} active · ${live.length} control-plane`)+`<article class="card"><div class="card-head"><div><h3>Durable work</h3><p>Latest immutable checkpoint and evidence for every continuity task.</p></div></div><table class="queue-table"><thead><tr><th>Work item</th><th>Owner</th><th>Status</th><th>Checkpoint</th><th>Evidence</th></tr></thead><tbody>${tasks.map(task=>`<tr><td><strong>${esc(task.objective)}</strong><small>Next: ${esc(task.next_action||'Not recorded')}</small></td><td>${esc(task.owner_agent)}</td><td><span class="chip">${esc(task.status)}</span></td><td>v${task.checkpoint_version||0}<small>${date(task.checkpoint_at)}</small></td><td>${task.artifacts?.length||0} artifacts<small>${task.tests?.length||0} checks · ${task.blockers?.length||0} blockers</small></td></tr>`).join('')}</tbody></table></article><article class="card" style="margin-top:14px"><div class="card-head"><div><h3>Execution ledger</h3><p>Typed work items that can move through plan, lease, run, review, and release gates.</p></div></div>${live.length?`<table class="queue-table"><thead><tr><th>Work item</th><th>Project</th><th>Priority</th><th>State</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${live.map(w=>{const running=RUN_ACTIVE.has(w.state),release=w.state===RELEASE_READY;return `<tr class="clickable" data-run="${esc(w.work_id)}" data-run-title="${esc(w.title)}"><td><strong>${esc(w.title)}</strong><small>${esc(w.description||w.work_id)}</small></td><td>${esc(w.project||'—')}</td><td>${esc(w.priority)}</td><td>${runChip(w.state,running)}</td><td>${date(w.updated_at)}</td><td><div class="work-actions">${release?`<button class="action-button approve" data-release-work="${esc(w.work_id)}" data-release-title="${esc(w.title)}">Approve release</button>`:''}<span class="run-open">${running?'Watch live':'View log'} →</span></div></td></tr>`}).join('')}</tbody></table>`:'<div class="empty-state"><strong>No executable work yet</strong><p>Continuity tracking remains available above.</p></div>'}</article>`}

const AGENT_KINDS=['cos','builder','reviewer','watchdog','persona'];
const AGENT_KIND_COLOR={cos:'var(--green)',builder:'var(--blue)',reviewer:'var(--amber)',watchdog:'var(--muted)',persona:'var(--purple)'};
const AGENT_EDGE_COLOR={directs:'var(--green)',reviews:'var(--amber)',built:'var(--blue)'};
function agentKind(agent){return AGENT_KINDS.includes(agent.kind)?agent.kind:'watchdog'}
function agentRadius(agent){return Math.min(34,16+Math.sqrt(Math.max(0,Number(agent.run_count||0)))*2.3)}
function agentPercent(value){const n=Number(value);if(!Number.isFinite(n))return '—';return `${Math.round((n<=1?n*100:n)*10)/10}%`}
function agentDecimal(value){const n=Number(value);return Number.isFinite(n)?n.toFixed(1):'—'}
function agentQuality(agent){const q=agent.quality;if(agent.kind!=='builder'||!q)return '—';return `FPY ${agentPercent(q.fpy)} · ${agentDecimal(q.mean_attempts)} att · ${agentDecimal(q.avg_score)}/20`}
function agentGraphLayout(agents){
  const columns=new Map(AGENT_KINDS.map(kind=>[kind,[]]));
  agents.forEach(agent=>columns.get(agentKind(agent)).push(agent));
  const height=Math.max(440,Math.max(...[...columns.values()].map(items=>items.length),1)*124+76);
  const positions=new Map();
  AGENT_KINDS.forEach((kind,columnIndex)=>{
    const items=columns.get(kind),x=90+columnIndex*230;
    items.forEach((agent,index)=>{
      const y=items.length===1?height/2:92+index*(height-174)/(items.length-1);
      positions.set(String(agent.agent_id),{x,y,r:agentRadius(agent),kind});
    });
  });
  return {height,positions};
}
function renderAgentGraph(agents,edges){
  if(!agents.length)return '<div class="empty-state"><strong>No agent activity yet — the graph fills in as the runner processes real jobs.</strong></div>';
  const{height,positions}=agentGraphLayout(agents);
  const paths=edges.map(edge=>{
    const from=positions.get(String(edge.from)),to=positions.get(String(edge.to));if(!from||!to)return '';
    const count=Math.max(0,Number(edge.run_count||0)),width=Math.min(6,1.5+Math.log1p(count)*1.15),opacity=Math.min(.82,.28+Math.log1p(count)*.13);
    const dir=to.x>=from.x?1:-1,x1=from.x+dir*from.r,x2=to.x-dir*(to.r+9),curve=Math.max(60,Math.abs(x2-x1)*.42),color=AGENT_EDGE_COLOR[edge.edge_type]||'var(--muted)',marker=AGENT_EDGE_COLOR[edge.edge_type]?edge.edge_type:'other';
    return `<path d="M${x1} ${from.y}C${x1+dir*curve} ${from.y} ${x2-dir*curve} ${to.y} ${x2} ${to.y}" fill="none" stroke="${color}" stroke-width="${width.toFixed(2)}" opacity="${opacity.toFixed(2)}" marker-end="url(#agent-arrow-${marker})"/>`;
  }).join('');
  const nodes=agents.map(agent=>{
    const point=positions.get(String(agent.agent_id));if(!point)return '';
    const size=point.r*2,color=AGENT_KIND_COLOR[point.kind],initial=String(agent.name||agent.agent_id||'?').trim().slice(0,1).toUpperCase();
    return `<button class="agent-graph-node" type="button" data-agent="${esc(agent.agent_id)}" aria-label="Open ${esc(agent.name||agent.agent_id)} agent details" style="left:${point.x}px;top:${point.y}px;width:${size}px;height:${size}px;--agent-node-color:${color}"><span class="agent-node-mark" aria-hidden="true">${esc(initial)}</span><span class="agent-node-label"><strong>${esc(agent.name||agent.agent_id||'Unnamed agent')}</strong><small>${esc(agent.model||agent.provider||'Model unavailable')}</small></span></button>`;
  }).join('');
  const headings=AGENT_KINDS.map((kind,index)=>`<text class="agent-column-label" x="${90+index*230}" y="30" text-anchor="middle">${esc(kind)}</text>`).join('');
  return `<div class="agent-graph-scroll"><div class="system-board agent-graph-board" style="height:${height}px"><svg class="system-svg" viewBox="0 0 1100 ${height}" aria-hidden="true"><defs><marker id="agent-arrow-directs" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L7 3L0 6Z" fill="var(--green)"/></marker><marker id="agent-arrow-reviews" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L7 3L0 6Z" fill="var(--amber)"/></marker><marker id="agent-arrow-built" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L7 3L0 6Z" fill="var(--blue)"/></marker><marker id="agent-arrow-other" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L7 3L0 6Z" fill="var(--muted)"/></marker></defs>${headings}${paths}</svg>${nodes}</div></div>`;
}
function openAgentDrill(agentId){
  const agent=(agentGraph.agents||[]).find(item=>String(item.agent_id)===String(agentId));if(!agent)return;
  const q=agent.quality,stats=[
    {label:'Kind',value:agent.kind||'—'},{label:'Model',value:[agent.provider,agent.model].filter(Boolean).join(' · ')||'—'},
    {label:'Status',value:agent.status||'—'},{label:'Runs',value:number(agent.run_count)},{label:'Total cost',value:money(agent.total_cost)}
  ];
  if(agent.kind==='builder')stats.push({label:'First-pass yield',value:q?agentPercent(q.fpy):'—'},{label:'Mean attempts',value:q?agentDecimal(q.mean_attempts):'—'},{label:'Average score',value:q?`${agentDecimal(q.avg_score)}/20`:'—'});
  const rows=(agentGraph.recent_runs||[]).filter(run=>String(run.agent_id)===String(agent.agent_id)).map(run=>({label:run.work_id||run.job_id||'Run',value:money(run.cost),sub:[run.outcome||'Outcome unavailable',date(run.created_at)].join(' · ')}));
  openDrill({title:agent.name||agent.agent_id||'Agent',subtitle:[agent.kind,agent.model].filter(Boolean).join(' · '),stats,rows,rowsTitle:'Recent runs',note:rows.length?'':'No recent runs are available for this agent.'});
}
function renderAgentRoster(agents){
  if(!agents.length)return '<div class="empty-state"><strong>No workforce activity yet</strong><p>Agents appear here after the runner processes real jobs.</p></div>';
  return `<table class="queue-table"><thead><tr><th>Agent</th><th>Model</th><th>Status</th><th>Runs</th><th>Cost</th><th>Quality</th></tr></thead><tbody>${agents.map(agent=>`<tr><td><strong>${esc(agent.name||agent.agent_id||'Unnamed agent')}</strong><small><span class="chip agent-kind kind-${agentKind(agent)}">${esc(agent.kind||'unknown')}</span></small></td><td>${esc(agent.model||'—')}<small>${esc(agent.provider||'')}</small></td><td><span class="run-chip ${agent.status==='retired'?'muted':''}">${esc(agent.status||'—')}</span></td><td>${number(agent.run_count)}</td><td>${money(agent.total_cost)}</td><td>${esc(agentQuality(agent))}</td></tr>`).join('')}</tbody></table>`;
}

function renderAgents(){const c=provider('claude'),x=provider('codex'),agents=agentGraph.agents||[],edges=agentGraph.edges||[];$('[data-panel="agents"]').innerHTML=pageHead('Agents','Model roles, observed activity, and the planned orchestration hierarchy.','Runtime status is distinct from historical usage')+`<div class="agent-grid">
  ${agentCard('O','CoS Orchestrator','Claude Opus 4.8','Architecture, decomposition, arbitration, acceptance, and escalation.','primary','Configured','Not running')}
  ${agentCard('C','Claude','Opus / Sonnet / Haiku',`${number(c.events)} completed exchanges across ${number(c.sessions)} sessions.`,'',`${money(c.est_cost)} est.`,`${compact(tokensAll(c))} tokens`)}
  ${agentCard('X','Codex','GPT-5.x repository worker',`${number(x.events)} recorded events across ${number(x.sessions)} sessions.`,'',`${money(x.est_cost)} est.`,`${compact(tokensAll(x))} tokens`)}
  </div><div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Model routing</h3><p>Use the least expensive model that can satisfy the packet and verification contract.</p></div></div><div class="routing-grid">
  <div class="route"><strong>Opus 4.8</strong><p>Orchestration, ambiguous architecture, conflict resolution, high-risk acceptance.</p></div><div class="route"><strong>Sonnet</strong><p>Implementation, synthesis, review, and surgical revision.</p></div><div class="route"><strong>Haiku</strong><p>Narrow recon, extraction, inventory, and deterministic tool work.</p></div><div class="route"><strong>Codex</strong><p>Repository editing, terminal execution, tests, and coding-agent workflows.</p></div>
  </div></div><article class="card" style="margin-top:14px"><div class="card-head"><div><h3>Agent org graph</h3><p>Derived from real executions — who directs, builds, and reviews whom.</p></div></div>${renderAgentGraph(agents,edges)}</article><article class="card" style="margin-top:14px"><div class="card-head"><div><h3>Workforce</h3><p>Live roster, execution volume, spend, and builder quality.</p></div></div>${renderAgentRoster(agents)}</article>`}
function agentCard(icon,title,model,detail,mode,a,b){return `<article class="agent-card ${mode}"><span class="agent-icon">${icon}</span><h3>${esc(title)}</h3><p>${esc(detail)}</p><div class="agent-meta"><div><small>Model / role</small><strong>${esc(model)}</strong></div><div><small>Est. cost</small><strong>${esc(a)}</strong></div><div><small>Volume</small><strong>${esc(b)}</strong></div><div><small>Authority</small><strong>${title==='CoS Orchestrator'?'Human-gated':'Task packet'}</strong></div></div></article>`}

/* ── Metrics ──────────────────────────────────────────────────────── */
function statusLabel(s){return s==='on_target'?'On target':s==='needs_attention'?'Needs attention':s==='baseline'?'Baseline':'Unavailable'}
function metricValue(metric){if(!metric.available)return '—';if(metric.unit==='ratio')return `${Math.round(metric.value*100)}%`;if(metric.unit==='seconds')return duration(metric.value);if(metric.unit==='usd')return money(metric.value);return Number(metric.value).toFixed(1)}
function metricTarget(metric){if(!metric.available)return 'No target';if(metric.target==null)return 'Baseline measurement';const value=metric.unit==='ratio'?`${Math.round(metric.target*100)}%`:metric.target;return `Target ${metric.direction==='lower'?'≤':'≥'} ${value}`}
function metricBar(metric){if(!metric.available||metric.target==null)return metric.available?55:0;if(metric.direction==='lower')return metric.value===0?100:Math.min(100,metric.target/metric.value*100);return Math.min(100,metric.value/metric.target*100)}
function metricCard(metric){const guide=metricGuide(metric),numerator=metricNumerator(metric);return `<article class="tracker ${metric.status} clickable" data-metric="${esc(metric.key)}"><header><span>${esc(metric.domain)}</span><span class="tracker-status">${statusLabel(metric.status)}</span></header><h3>${esc(metric.label)}</h3><div class="tracker-value"><strong>${metricValue(metric)}</strong><small>${esc(metricTarget(metric))}</small></div><p class="metric-definition">${esc(guide.definition)}</p><div class="metric-formula"><div class="formula-part"><small>Numerator</small><strong>${metricPart(numerator,metric.unit)}</strong><span>${esc(guide.numerator)}</span></div><b aria-hidden="true">÷</b><div class="formula-part"><small>Denominator</small><strong>${metricPart(metric.denominator)}</strong><span>${esc(guide.denominator)}</span></div></div><div class="insight-box"><strong>Why it matters</strong><span>${esc(metricInsight(metric))}</span></div><div class="metric-source"><span>Source</span>${esc(metric.source||metric.reason||'Not instrumented')}</div><div class="target-bar"><i style="width:${metricBar(metric)}%"></i></div></article>`}
function whereToBuild(){
  const projects=state.audit.projects||[];const tasks=state.continuity.tasks||[];
  const tracked=new Set(tasks.map(t=>(t.objective||'').toLowerCase()));
  const hot=projects.slice(0,5).filter(p=>p.project!=='Unassigned');
  const untracked=hot.filter(p=>![...tracked].some(t=>t.includes(p.project.toLowerCase())));
  const c=provider('claude'),x=provider('codex');
  const items=[];
  if(untracked.length)items.push({n:1,title:`Track ${untracked[0].project} as durable work`,detail:`${number(untracked[0].events)} exchanges and ${money(untracked[0].est_cost)} of estimated effort with no continuity task or checkpoints — the highest-activity untracked workspace.`});
  if((state.overview.pending_review||0)>0)items.push({n:items.length+1,title:'Clear the recommendation queue',detail:`${state.overview.pending_review} audit recommendations are proposed but undecided; approving or dismissing them updates agent memory.`});
  if((state.overview.verified_outcomes||0)<3)items.push({n:items.length+1,title:'Record outcomes as you finish work',detail:'Only '+number(state.overview.verified_outcomes)+' verified outcome recorded — cost-per-outcome stays noise until completions are logged.'});
  if(c.events&&x.events){const cpe=c.est_cost/c.events,xpe=x.est_cost/x.events;if(cpe>3*xpe)items.push({n:items.length+1,title:'Route routine edits to Codex or Haiku',detail:`Claude averages ${money(cpe)} per exchange vs ${money(xpe)} on Codex — heavy Opus usage on routine work is the main cost driver.`})}
  items.push({n:items.length+1,title:'Restore the runner heartbeat',detail:'Approved work cannot execute until the local CoS runner reconnects.'});
  return items.slice(0,4).map(i=>`<div class="instrument"><span>${i.n}</span><strong>${esc(i.title)}</strong><p>${esc(i.detail)}</p></div>`).join('');
}
function renderMetrics(){const measured=state.metrics.filter(m=>m.available),on=measured.filter(m=>m.status==='on_target'),attention=measured.filter(m=>m.status==='needs_attention'),unavailable=state.metrics.filter(m=>!m.available),outcomes=state.audit.outcomes||{},evidence=state.continuity.evidence||{},skills=state.quality?.skill_summary||{},skillWeekly=state.quality?.skill_weekly||[];$('[data-panel="metrics"]').innerHTML=pageHead('Performance metrics','Every tracker includes its definition, current calculation, and decision relevance. Click one for a focused view.','Provisional targets · refine after 30 days')+`
  <div class="tracker-summary"><div class="summary-card"><small>Measured trackers</small><strong>${measured.length}</strong><span>Deterministic evidence available</span></div><div class="summary-card"><small>On provisional target</small><strong>${on.length}</strong><span>Baseline targets currently met</span></div><div class="summary-card"><small>Needs attention</small><strong>${attention.length}</strong><span>Measured gaps to address</span></div><div class="summary-card"><small>Not instrumented</small><strong>${unavailable.length}</strong><span>Never rendered as zero</span></div></div>
  <div class="tracker-grid">${state.metrics.map(metricCard).join('')}</div>
  <div class="grid-2"><article class="card"><div class="card-head"><div><h3>Evidence and outcomes</h3><p>Explicit operational proof, not inferred productivity.</p></div></div><div class="usage-numbers"><div><small>Checkpoints</small><strong>${number(evidence.checkpoints)}</strong></div><div><small>Artifacts</small><strong>${number(evidence.artifacts)}</strong></div><div><small>Tests recorded</small><strong>${number(evidence.tests)}</strong></div></div><div class="usage-numbers"><div><small>Outcome records</small><strong>${number(outcomes.records)}</strong></div><div><small>Retries</small><strong>${number(outcomes.retries)}</strong></div><div><small>Recoveries</small><strong>${number(outcomes.recoveries)}</strong></div></div></article><article class="card"><div class="card-head"><div><h3>Checkpoint cadence</h3><p>Immutable checkpoints written by week.</p></div></div>${checkpointChart(state.continuity.checkpoint_weekly||[])}</article></div>
  <div class="card skill-effectiveness" style="margin-top:14px"><div class="card-head"><div><h3>Skill effectiveness vs no-skill baseline</h3><p>Automatically recorded runner jobs, matched only within the same provider and task type.</p></div><span class="chip">${number(skills.observations)} observations</span></div><div class="usage-numbers"><div><small>Skill observations</small><strong>${number(skills.skill_observations)}</strong></div><div><small>No-skill baselines</small><strong>${number(skills.no_skill_baselines)}</strong></div><div><small>Verified observations</small><strong>${number(skills.verified)}</strong></div></div>${skillWeekly.length?`<table class="model-table"><thead><tr><th>Week / skill</th><th>Provider / task</th><th>Invocations</th><th>Baseline</th><th>Verification delta</th><th>Est. time saved</th></tr></thead><tbody>${skillWeekly.map(row=>`<tr><td><strong>${esc(row.week_start)}</strong><br>${esc(row.skill_name||'No skill')} ${esc(row.skill_version||'')}</td><td>${esc(row.provider)}<br>${esc(row.task_type)}</td><td>${number(row.invocation_count)}</td><td>${number(row.baseline_samples)} prior</td><td>${row.verification_success_rate_delta==null?'—':`${Math.round(Number(row.verification_success_rate_delta)*100)} pts`}</td><td>${row.estimated_total_minutes_saved==null?'—':`${Number(row.estimated_total_minutes_saved).toFixed(1)} min`}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state"><strong>No comparable skill data yet</strong><p>The runner now records real skill and explicit no-skill observations automatically. This stays empty until a skill version has matched earlier baseline work; no effectiveness claim is inferred.</p></div>'}<div class="insight-box"><strong>Why it matters</strong><span>Compares completion, retries, verification, and elapsed time against earlier no-skill work without mixing providers or task types. Estimated time saved is observational, not causal proof.</span></div></div>
  <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Where to build next</h3><p>Computed from live activity, cost, and outcome coverage.</p></div></div><div class="instrument-grid">${whereToBuild()}</div></div>`}
function checkpointChart(items){if(!items.length)return '<div class="empty-state"><strong>No checkpoints yet</strong></div>';const max=Math.max(...items.map(x=>x.checkpoints),1);return `<div class="mini-chart">${items.slice(-10).map(x=>`<div class="mini-week"><i style="height:${Math.max(3,x.checkpoints/max*100)}px"></i><small>${esc(String(x.week).slice(5))}</small></div>`).join('')}</div><p class="quiet" style="margin-top:8px">${items.length===1?'One week of history — the cadence chart fills in as weeks accumulate.':''}</p>`}

/* ── Usage ────────────────────────────────────────────────────────── */
let usageMode='cost';
function usageProviderInsight(p,totalCost,totalEvents){const costShare=totalCost?Math.round(Number(p.est_cost||0)/totalCost*100):0,eventShare=totalEvents?Math.round(Number(p.events||0)/totalEvents*100):0;return `${p.provider==='claude'?'Claude':'Codex'} represents ${eventShare}% of recorded exchanges and ${costShare}% of modeled cost. Use the difference to review routing mix, not to rank agent quality.`}
function renderUsage(){const providers=state.audit.providers,totalCost=providers.reduce((a,p)=>a+Number(p.est_cost||0),0),totalEvents=providers.reduce((a,p)=>a+Number(p.events||0),0),totalTokenized=providers.reduce((a,p)=>a+Number(p.tokenized_events||0),0);$('[data-panel="usage"]').innerHTML=pageHead('Usage & telemetry','Definitions and calculation boundaries for model activity, tokens, and estimated cost. Click anything to drill in.',freshLine())+`
  <section class="explain-section usage-explain"><div class="section-label"><strong>How to interpret usage</strong><span>These measures describe processing and routing; they do not measure productivity by themselves</span></div><div class="explain-grid three">
    ${explainerCard('Estimated API-equivalent cost','Recorded token components multiplied by model-specific API list rates; Codex model mappings may be estimated.',`${money(totalCost)} summed modeled cost`,'None — this is a total, not a ratio','Useful for workload and routing trends. Actual subscription or contract spend may be different.')}
    ${explainerCard('Total tokens','Fresh input + output + cache reads + cache writes recorded in local session telemetry.',`${compact(providers.reduce((a,p)=>a+tokensAll(p),0))} processed tokens`,'None — this is a total, not a ratio','Explains processing scale and cache behavior. More tokens can reflect task complexity, context size, or inefficiency.')}
    ${explainerCard('Token coverage','Share of recorded exchanges that include usable token telemetry.',`${number(totalTokenized)} tokenized exchanges`,`${number(totalEvents)} total exchanges`,'Tells you whether provider, model, and cost comparisons rest on complete enough data.')}
  </div></section>
  <div class="usage-hero">${providers.map(p=>`<article class="usage-provider clickable" data-provider="${esc(p.provider)}"><header><strong>${esc(p.provider)}</strong><span>${p.cost_is_estimate?'Estimated rates':'List rates'} · ${Math.round((p.token_coverage||0)*100)}% token coverage</span></header><div class="usage-numbers"><div><small>Est. cost</small><strong>${money(p.est_cost)}</strong></div><div><small>Last 7 days</small><strong>${money(p.est_cost_7d)}</strong></div><div><small>Exchanges</small><strong>${number(p.events)}</strong></div><div><small>Sessions</small><strong>${number(p.sessions)}</strong></div><div><small>Total tokens</small><strong>${compact(tokensAll(p))}</strong></div><div><small>Output tokens</small><strong>${compact(p.tokens_out)}</strong></div></div><div class="provider-formulas"><div><small>Cost per exchange</small><strong>${p.events?money(p.est_cost/p.events):'—'}</strong><span>${money(p.est_cost)} ÷ ${number(p.events)} exchanges</span></div><div><small>Token coverage</small><strong>${Math.round((p.token_coverage||0)*100)}%</strong><span>${number(p.tokenized_events)} tokenized ÷ ${number(p.events)} exchanges</span></div></div><div class="coverage">Token composition${stackedBar(tokenParts(p))}</div><div class="insight-box"><strong>Why it matters</strong><span>${esc(usageProviderInsight(p,totalCost,totalEvents))}</span></div></article>`).join('')}</div>
  <div class="grid-2"><article class="card"><div class="card-head"><div><h3>Weekly activity</h3><p>Click a week for its provider and model breakdown.</p></div><div class="mode-toggle">${['cost','tokens','events'].map(m=>`<button class="${usageMode===m?'active':''}" data-mode="${m}">${m[0].toUpperCase()+m.slice(1)}</button>`).join('')}</div></div>${weeklyChart(state.audit.weekly)}</article><article class="card"><div class="card-head"><div><h3>Telemetry coverage</h3><p>What can be compared safely today.</p></div></div><div class="readiness">${readyRow('✓','Claude tokens & cost','Full usage incl. cache reads/writes from session logs','Comparable','')}${readyRow('✓','Codex tokens & cost','Backfilled from Codex session logs; ~95% coverage','Comparable','')}${readyRow('!','Pre-capture history',`${(provider('claude').events||0)-(provider('claude').tokenized_events||0)} Claude events predate local logs; kept at partial values`,'Partial','warn')}${readyRow('○','Outcome linkage','Model calls are not yet tied to task and run IDs','Missing','off')}</div></article></div>
  <div class="grid-2"><article class="card"><div class="card-head"><div><h3>Model usage</h3><p>Click a model for its weekly trend and token mix.</p></div></div>${modelTable(state.audit.models||[])}</article><article class="card"><div class="card-head"><div><h3>Project activity</h3><p>Click a workspace for provider split and sessions.</p></div></div>${projectBars(state.audit.projects||[])}</article></div>
  <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Recent sessions by cost</h3><p>Highest estimated-cost sessions of the last 14 days.</p></div></div>${sessionTable(state.audit.sessions_recent||[])}</div>`}
function weeklyChart(items){const weeks=[...new Set(items.map(x=>x.week_start))].slice(-10);const field=usageMode==='cost'?'est_cost':usageMode==='tokens'?'tokens':'events';const by=(w,p)=>Number(items.find(x=>x.week_start===w&&x.provider===p)?.[field]||0);const max=Math.max(...weeks.flatMap(w=>[by(w,'claude'),by(w,'codex')]),0.001);const fmt=usageMode==='cost'?money:compact;return `<div class="chart">${weeks.map(w=>`<div class="week clickable" data-week="${esc(w)}" title="Week of ${esc(w)}: Claude ${fmt(by(w,'claude'))} · Codex ${fmt(by(w,'codex'))}"><div class="week-bars"><i style="height:${Math.max(2,by(w,'claude')/max*130)}px"></i><i class="codex" style="height:${Math.max(2,by(w,'codex')/max*130)}px"></i></div><small>${esc(String(w).slice(5))}</small></div>`).join('')}</div><div class="legend-line"><span style="color:var(--green)">● Claude</span> <span style="color:var(--blue)">● Codex</span></div>`}
function modelTable(items){return `<table class="model-table"><thead><tr><th>Provider / model</th><th>Exchanges</th><th>Output</th><th>Cache read</th><th>Total tokens</th><th>Est. cost</th></tr></thead><tbody>${items.map(m=>`<tr class="clickable" data-model="${esc(m.model)}" data-model-provider="${esc(m.provider)}"><td><strong>${esc(m.provider)}</strong><br>${esc(m.model)}</td><td>${number(m.events)}</td><td>${compact(m.tokens_out)}</td><td>${compact(m.tokens_cache_read)}</td><td>${compact(m.tokens_total)}</td><td>${money(m.est_cost)}${m.cost_is_estimate?'<small> est</small>':''}</td></tr>`).join('')}</tbody></table><p class="table-note"><strong>Exchange</strong> = one recorded agent event. <strong>Total tokens</strong> = fresh input + output + cache read + cache write. <strong>Est. cost</strong> = those components × the model rate.</p>`}
function projectBars(items){const max=Math.max(...items.map(x=>Number(x.est_cost||0)),0.001),total=items.reduce((a,x)=>a+Number(x.est_cost||0),0);return `<div class="project-bars">${items.map(p=>`<div class="project-bar clickable" data-project="${esc(p.project)}"><strong>${esc(p.project)}</strong><div class="bar"><i style="width:${percent(Number(p.est_cost||0),max)}%;background:var(--green)"></i></div><span>${money(p.est_cost)}<small>${total?Math.round(Number(p.est_cost||0)/total*100):0}% of total</small></span></div>`).join('')}</div><p class="table-note"><strong>Numerator:</strong> each project’s modeled cost. <strong>Denominator:</strong> ${money(total)} modeled cost across the displayed portfolio.</p>`}
function sessionTable(items){if(!items.length)return '<div class="empty-state"><strong>No sessions in the last 14 days</strong></div>';return `<table class="model-table"><thead><tr><th>Session</th><th>Project</th><th>Exchanges</th><th>Tokens</th><th>Est. cost</th><th>Last active</th></tr></thead><tbody>${items.map(s=>`<tr class="clickable" data-project="${esc(s.project)}"><td><strong>${esc(s.provider)}</strong><br>${esc(s.session_id.slice(0,13))}…</td><td>${esc(s.project)}</td><td>${number(s.events)}</td><td>${compact(s.tokens)}</td><td>${money(s.est_cost)}</td><td>${date(s.last_at)}</td></tr>`).join('')}</tbody></table>`}

/* ── Approvals & System ───────────────────────────────────────────── */
function renderApprovals(){
  const recs=state.audit.recommendations.filter(r=>r.status==='proposed');
  const decided=state.audit.recommendations.filter(r=>r.status!=='proposed');
  const gates=state.operations.approvals||[];
  const releases=releaseReadyWork();
  $('[data-panel="approvals"]').innerHTML=pageHead(
    'Approvals & human gates',
    'Start approved work, review finished results, and close release gates from one place.',
    `${recs.length} recommendations · ${gates.length} execution gates · ${releases.length} release gates`)+`
  <div class="card release-card"><div class="card-head"><div><h3>Release approvals</h3><p>Review the independent score, promised benefits, checks, limitations, and run log before confirming.</p></div><span class="chip">${releases.length} waiting</span></div>${releases.length?`<div class="approval-list">${releases.map(work=>`<div class="release-item"><div class="approval-row"><i class="priority-dot high"></i><div><strong>${esc(work.title||work.work_id)}</strong><p>Finished ${date(work.updated_at)} · approving marks the ledger completed</p></div><div class="action-buttons"><button class="link-button" data-run="${esc(work.work_id)}" data-run-title="${esc(work.title)}">View run log</button><button class="action-button approve" data-release-work="${esc(work.work_id)}" data-release-title="${esc(work.title)}">Approve release</button></div></div>${releaseEvidence(work)}</div>`).join('')}</div>`:'<div class="empty-state"><strong>No release approvals waiting</strong><p>Finished work appears here only after its evidence passes independent review.</p></div>'}<div class="notice release-notice">For quality-gated jobs, the database refuses release unless every benefit and required check passed with a score of at least 17/20 and no critical or major finding.</div></div>
  <div class="card recovery-card"><div class="card-head"><div><h3>Agent recovery protocol</h3><p>You choose the starting model; the fallback remains bounded.</p></div><span class="chip">Human-routed</span></div><div class="gate-grid recovery-protocol">
    <div class="gate"><span>1</span><strong>Choose the start model</strong><p>Select Claude or Codex on each execution approval. Claude remains the default.</p></div>
    <div class="gate"><span>2</span><strong>One quota-only handoff</strong><p>Only a provider usage-window or quota limit transfers the same approved job to the other model.</p></div>
    <div class="gate"><span>3</span><strong>Pause and re-approve</strong><p>If both models are unavailable—or either agent fails the work—you are notified and a fresh recovery approval appears below.</p></div>
  </div><div class="notice">Build, test, timeout, configuration, and runtime failures never trigger an automatic provider retry. They stop and return to your approval queue with a new plan hash.</div></div>
  <div class="grid-2"><article class="card"><div class="card-head"><div><h3>Execution approvals</h3><p>Review the benefit contract, select the starting model, then approve. Both are bound to the attempt hash.</p></div></div>${gates.length?`<div class="approval-list">${gates.map(a=>`<div class="approval-item"><div class="approval-row"><i class="priority-dot ${a.gate_type==='recovery'?'critical':'high'}"></i><div><strong>${esc(a.title||a.work_id)}</strong><p>${esc(a.gate_type)} gate · hash ${esc((a.payload_hash||'').slice(0,12))}… · ${date(a.requested_at)}</p></div><div class="approval-controls"><label class="model-choice">Start model<select data-start-provider><option value="claude" selected>Claude</option><option value="codex">Codex</option></select></label><div class="action-buttons"><button class="action-button approve" data-approval="${esc(a.approval_id)}" data-decision="true">${a.gate_type==='recovery'?'Approve retry':'Approve & run'}</button><button class="action-button reject" data-approval="${esc(a.approval_id)}" data-decision="false">Reject</button></div></div></div><div class="acceptance-contract"><small>Expected benefits</small>${benefitList(acceptanceContract(a.approval_id,a.work_id))}</div></div>`).join('')}</div>`:'<div class="empty-state"><strong>No execution approvals waiting</strong><p>Accept a recommendation to create one.</p></div>'}</article>
  <article class="card"><div class="card-head"><div><h3>Recommendation review queue</h3><p>Create work ships it through the pipeline; Dismiss records why.</p></div></div><div class="approval-list">${recs.map(r=>`<div class="approval-row"><i class="priority-dot ${esc(r.priority)}"></i><div><strong>${esc(r.title)}</strong><p>${esc(r.category)} · ${esc(r.priority)} priority${r.proposed_action?` — ${esc(String(r.proposed_action).slice(0,140))}${String(r.proposed_action).length>140?'…':''}`:''}</p></div><div class="action-buttons"><button class="action-button approve" data-rec="${esc(r.recommendation_id)}" data-rec-action="accept">Create work</button><button class="action-button reject" data-rec="${esc(r.recommendation_id)}" data-rec-action="dismiss">Dismiss</button></div></div>`).join('')||'<div class="empty-state"><strong>Queue clear</strong><p>New recommendations arrive with each weekly audit run.</p></div>'}</div>${decided.length?`<p class="quiet" style="margin-top:10px">${decided.length} previously decided · ${decided.filter(r=>r.status==='accepted').length} accepted · ${decided.filter(r=>['dismissed','rejected'].includes(r.status)).length} dismissed · ${decided.filter(r=>r.status==='resolved').length} resolved</p>`:''}</article></div>
  <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Gate model</h3><p>Plan, recovery, sensitive-action, and release authority remain human-controlled.</p></div></div><div class="gate-grid"><div class="gate"><span>1</span><strong>Plan or recovery</strong><p>Approving a hash-bound plan enqueues exactly one new job.</p></div><div class="gate"><span>2</span><strong>Sensitive action</strong><p>Credentials, production data, external messages, financial, or destructive steps.</p></div><div class="gate"><span>3</span><strong>Release approval</strong><p>Merging the work's PR ships it to production; you get an iMessage on release.</p></div></div></div>`;
}

function renderSystem(){const connected=state.control_plane.local_runner==='connected',runners=state.operations.runners||[],events=state.operations.events||[];$('[data-panel="system"]').innerHTML=pageHead('System architecture','The website controls authority. The database coordinates. The local computer executes.','Website ↔ Database ↔ Local')+`<div class="system-board"><svg class="system-svg" viewBox="0 0 1100 520" aria-hidden="true"><defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L7 3L0 6Z" fill="#2e6b3f"/></marker><marker id="b" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L7 3L0 6Z" fill="#477c9b"/></marker></defs><path d="M300 155C470 70 650 68 790 115" fill="none" stroke="#2e6b3f" stroke-width="2.5" marker-end="url(#a)"/><path d="M790 178C620 245 475 250 300 205" fill="none" stroke="#b87332" stroke-width="2.5"/><path d="M255 250C320 340 430 370 520 382" fill="none" stroke="#477c9b" stroke-width="2.5" marker-end="url(#b)"/></svg><div class="sys-node db"><small>Durable go-between</small><strong>Supabase Control Plane</strong><span>Typed jobs, approvals, leases, decisions, artifacts, usage, and outcomes.</span></div><div class="sys-node web"><small>Human authority</small><strong>CS Ventures Website</strong><span>Create work, approve plans, monitor progress, review evidence, authorize release.</span></div><div class="sys-node local"><small>Trusted execution</small><strong>Local CoS Runner</strong><span>Claims approved jobs and invokes Claude and Codex through local tools.</span></div><div class="system-note">× No direct website-to-laptop command channel</div></div><div class="grid-even"><article class="card"><div class="card-head"><div><h3>Current readiness</h3><p>Measured from the live control plane.</p></div></div><div class="readiness">${readyRow('✓','Website console','Authenticated dashboard is Supabase-backed','Operational','')}${readyRow('✓','Database control plane','Typed ledger and owner-gated APIs are deployed','Operational','')}${readyRow(connected?'✓':'○','Local runner',connected?'Heartbeat is current':`${runners.length} runner registered; latest heartbeat is stale`,connected?'Connected':'Offline',connected?'':'off')}</div></article><article class="card"><div class="card-head"><div><h3>Recent control-plane events</h3><p>Append-only transitions from the execution ledger.</p></div></div><div class="event-list">${events.length?events.slice(0,8).map(e=>`<div class="event-row"><time>${date(e.created_at)}</time> · ${esc(e.actor)} · <strong>${esc(e.event_type)}</strong>${e.prior_state?` · ${esc(e.prior_state)} → ${esc(e.new_state)}`:''}</div>`).join(''):'<div class="empty-state"><strong>No events yet</strong></div>'}</div></article></div>`}

/* ── Navigation / interactivity ───────────────────────────────────── */
/* ── OmniSupply ───────────────────────────────────────────────────────
   Freight disruption exposure, precomputed by `sckg publish` and served by
   cos.api_omnisupply_state().

   Two rules from DEMO-BUILD.md are enforced here, not just observed:

   1. No number renders without its provenance. `figureTile` always prints the
      source, the as_of and the basis under the value. There is no branch that
      draws a bare figure, so a panel cannot show an unattributed number even
      if a query somehow returned one.

   2. Real and synthetic never share a panel. The RPC returns them under
      separate top-level keys (`sections` vs `illustrative`); the Company tab
      reads only `illustrative` and every other tab reads only `sections`.
      Nothing merges them. */
const CONFIDENCE_LABEL={
  measured:'High confidence',
  derived:'Moderate confidence',
  estimate:'Low confidence',
  unvetted:'Moderate confidence',
  illustrative:'Scenario only'
};
const CONFIDENCE_LEVEL={
  measured:'high',derived:'moderate',estimate:'low',
  unvetted:'moderate',illustrative:'scenario'
};
const CONFIDENCE_HINT={
  measured:'High confidence — reviewed catalog result from published data or a straightforward aggregation.',
  derived:'Moderate confidence — a documented method applied to measured inputs with a judgment call.',
  estimate:'Low confidence — depends on an input that was not directly published.',
  unvetted:'Moderate confidence — a data-backed ad-hoc query that has not yet been reviewed as a reusable catalog model.',
  illustrative:'Scenario only — synthetic output for exploration, not a claim about the world.'
};
function confidenceLabel(basis){
  const key=String(basis||'measured');
  return CONFIDENCE_LABEL[key]||'Confidence unavailable';
}
function confidenceChip(basis){
  const key=String(basis||'measured'),level=CONFIDENCE_LEVEL[key]||'low';
  const label=confidenceLabel(key),hint=CONFIDENCE_HINT[key]||'Confidence has not been classified.';
  return `<span class="confidence-chip confidence-${esc(level)}" data-basis="${esc(key)}" title="${esc(hint)}" aria-label="${esc(hint)}">${esc(label)}</span>`;
}

/* Units come off the catalog's Figure, so formatting is driven by data rather
   than by a per-panel special case. */
function figureValue(f){
  const v=f.value,unit=String(f.unit||''),p=Number(f.precision||0);
  if(v==null||v==='')return '—';
  if(typeof v==='string')return esc(v);
  const n=Number(v);
  if(unit==='USD'||unit==='USD (2017)')return money(n);
  if(unit==='%')return `${n.toFixed(p||1)}%`;
  if(unit==='x')return `${n.toFixed(p||1)}×`;
  if(unit==='sd'||unit==='pp')return n.toFixed(p||2);
  if(Math.abs(n)>=1e6)return compact(n);
  return number(p?Math.round(n*10**p)/10**p:Math.round(n));
}
function figureUnit(f){const unit=String(f.unit||'');return ['USD','USD (2017)','%','x',''].includes(unit)?'':unit}
function figureTile(f){
  return `<div class="omni-figure">
    <small>${esc(f.label)}</small>
    <strong>${figureValue(f)}${figureUnit(f)?`<em>${esc(figureUnit(f))}</em>`:''}</strong>
    <span class="omni-prov">${confidenceChip(f.basis)}<span>${esc(f.source)} · as of ${esc(f.as_of)}</span></span>
    ${f.method?`<span class="omni-method">${esc(f.method)}</span>`:''}
  </div>`;
}

/* Rows are arbitrary objects from the catalog, so the table derives its own
   headers. Anything nested renders as JSON rather than "[object Object]". */
/* Years are numbers that must not be formatted as quantities: a thousands
   separator turns 2022 into "2,022", which reads as a bug on a slide. Keyed on
   the column name because the value alone cannot tell a year from a count. */
const YEAR_KEY=/(^|_)year$|^year(_|$)/;
function cellText(v,key=''){
  if(v==null)return '—';
  if(YEAR_KEY.test(key))return String(v);
  if(Array.isArray(v))return v.join(', ');
  if(typeof v==='object')return JSON.stringify(v);
  if(typeof v==='number')return Math.abs(v)>=1e6?compact(v):number(Math.round(v*10)/10);
  return String(v);
}
function headerText(k){return k.replace(/_/g,' ').replace(/\busd\b/gi,'USD').replace(/\bpct\b/gi,'%').replace(/^./,c=>c.toUpperCase())}
function dataTable(rows,limit=8){
  if(!rows||!rows.length)return '';
  const keys=Object.keys(rows[0]).filter(k=>k!=='uid');
  const shown=rows.slice(0,limit);
  return `<table class="queue-table omni-table"><thead><tr>${keys.map(k=>`<th>${esc(headerText(k))}</th>`).join('')}</tr></thead>
    <tbody>${shown.map(r=>`<tr>${keys.map(k=>`<td>${esc(cellText(r[k],k))}</td>`).join('')}</tr>`).join('')}</tbody></table>
    ${rows.length>shown.length?`<p class="quiet omni-more">${number(rows.length-shown.length)} more rows — open for the full table</p>`:''}`;
}

function answerCard(a){
  const illustrative=a.basis==='illustrative';
  return `<article class="card omni-answer${illustrative?' omni-illustrative':''}" data-omni-answer="${esc(a.key)}">
    <div class="card-head">
      <div><h3>${esc(a.title)}</h3><p>${esc((a.sources||[]).join(' · '))}</p></div>
      <div class="omni-head-meta">${confidenceChip(a.basis)}<span class="quiet">as of ${esc(a.as_of)}</span></div>
    </div>
    ${a.figures?.length?`<div class="omni-figures">${a.figures.map(figureTile).join('')}</div>`:''}
    ${a.rows?.length?dataTable(a.rows):''}
    ${a.note?`<div class="notice omni-note">${esc(a.note)}</div>`:''}
  </article>`;
}

function omniAnswer(key){
  const all=[...Object.values(omniState.sections||{}).flat(),...(omniState.illustrative||[])];
  return all.find(a=>a.key===key)||null;
}
function openOmniDrill(key){
  const a=omniAnswer(key);if(!a)return;
  openDrill({
    title:a.title,
    subtitle:`${confidenceLabel(a.basis)} · as of ${a.as_of} · ${(a.sources||[]).join(' · ')}`,
    stats:(a.figures||[]).map(f=>({label:f.label,value:`${figureValue(f)}${figureUnit(f)?' '+figureUnit(f):''}`,sub:`${confidenceLabel(f.basis)} · ${f.source}`})),
    chart:a.rows?.length?`<div class="drill-table">${dataTable(a.rows,200)}</div>`:'',
    note:a.note
  });
}

function freshnessStrip(){
  const f=omniState.freshness||{};const keys=Object.keys(f);
  if(!keys.length)return '';
  return `<article class="card omni-freshness"><div class="card-head"><div><h3>Data currency</h3>
    <p>Every source carries the date of its own newest record, not the date this page loaded.</p></div></div>
    <div class="omni-fresh-grid">${keys.map(k=>`<div><small>${esc(k)}</small><strong>${esc(f[k])}</strong></div>`).join('')}</div>
    <div class="notice">This is a weather product built on freight data that is months lagged. The alert feed is current to the hour; T-100 runs to ${esc(f['T-100 domestic segment']||'—')} and County Business Patterns is a ${esc(f['County Business Patterns']||'—')} survey.</div>
  </article>`;
}

/* ── The thinking panel ────────────────────────────────────────────────
   A chat turn takes a minute or more: the runner has to reach Neo4j, read
   parquet, and compose an answer. A spinner for that long reads as a hang, so
   the wait is given its own segmented panel that shows what is being consulted.

   WHAT IS REAL AND WHAT IS STYLISED, because the distinction matters even in a
   loading state. The node labels, the relationship types and the counts are
   read from `graph_stats` on the published snapshot -- they are the actual
   contents of the graph. The *animation* is a paced sequence, not a trace of
   the query engine: nothing here claims that IMPACTS was traversed at the
   instant its edge lights up. Real runner steps stream in underneath as they
   arrive, and those are labelled separately.

   The composer stays enabled throughout. Polling lives outside the render, so
   switching tabs or typing the next question does not interrupt a turn in
   flight. */

/* A jittered grid, not a random scatter. Pure `Math.random()` positions clump
   and leave holes -- the eye reads that as noise. Offsetting each cell of a
   grid by up to ~44% of its size keeps coverage even while destroying the
   lattice, which is what makes the field look organic and evenly weighted at
   the same time. Seeded so the layout is identical on every render; a field
   that reshuffles mid-thought looks like a glitch. */
function mulberry32(seed){
  return function(){
    seed|=0; seed=seed+0x6D2B79F5|0;
    let t=Math.imul(seed^seed>>>15,1|seed);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}

/* The viewBox aspect must match the rendered box. With `slice` and a
   mismatched ratio the SVG crops top and bottom, which ate the hub labels;
   with `meet` and a mismatch it letterboxes. Matching the ratio to the 150px
   strip means neither happens. */
const FIELD_W=640,FIELD_H=100;

/* Hubs carry the real graph labels and counts. The surrounding field is
   schematic -- there is no claim that a given dot is a given county. */
const HUBS=[
  {id:'Carrier',        phase:1,x:0.11,y:0.36},
  {id:'Event',          phase:2,x:0.35,y:0.32},
  {id:'Region',         phase:3,x:0.58,y:0.70},
  {id:'Site',           phase:4,x:0.85,y:0.38},
  {id:'BorderCrossing', phase:5,x:0.32,y:0.78},
];

function buildField(){
  const rand=mulberry32(20260727);
  const cols=32,rows=6,cw=FIELD_W/cols,ch=FIELD_H/rows;
  const nodes=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    // Skip a few cells so the field has breathing room rather than reading
    // as a filled rectangle.
    if(rand()<0.14)continue;
    nodes.push({
      x:(c+0.5)*cw+(rand()-0.5)*cw*0.88,
      y:(r+0.5)*ch+(rand()-0.5)*ch*0.88,
      r:1.5+rand()*1.4,
      drift:(rand()*7).toFixed(2),      // animation-delay, seconds
      dur:(6+rand()*5).toFixed(2),      // animation-duration
    });
  }
  const hubs=HUBS.map(h=>({...h,px:h.x*FIELD_W,py:h.y*FIELD_H}));
  // Each field node joins its nearest hub. That produces the radial bursts
  // without hand-drawing them, and gives every phase a coherent cluster.
  for(const n of nodes){
    let best=0,bestD=Infinity;
    hubs.forEach((h,i)=>{
      const d=(n.x-h.px)**2+(n.y-h.py)**2;
      if(d<bestD){bestD=d;best=i}
    });
    n.hub=best;
    n.dist=Math.sqrt(bestD);
  }
  // Spokes: only the nearer members, or every hub becomes a starburst filling
  // the whole panel and the clusters stop being distinguishable.
  const spokes=nodes.filter(n=>n.dist<86);
  return {nodes,hubs,spokes};
}
const FIELD=buildField();

const THINKING_PHASES=[
  {label:'Reading the question',                    detail:'Working out which lanes, places and event families are in scope',graph:false},
  {label:'Checking airline and carrier data',       detail:'T-100 segments, carrier networks and station-level freight',graph:true},
  {label:'Checking weather and disruption events',  detail:'NOAA storm episodes and the counties each one covered',graph:true},
  {label:'Tracing lane-level flows',                detail:'FAF5 origin-destination-commodity movement and modal substitution',graph:true},
  {label:'Cross-referencing industrial exposure',   detail:'County Business Patterns establishments and employment in the footprint',graph:true},
  {label:'Checking border and intermodal capacity', detail:'Land ports of entry, rail ramps and drayage reach',graph:true},
  {label:'Composing the answer with sources',       detail:'Attaching source, as-of and basis to every figure',graph:false},
];

let thinking={timer:null,phase:0,jobId:null};
const THINK_OPEN_KEY='cos.thinkGraphOpen';
let thinkOpen=(()=>{try{return localStorage.getItem(THINK_OPEN_KEY)!=='0'}catch{return true}})();

function graphCount(label){
  const row=(omniState.snapshot?.graph_stats?.by_label||[]).find(r=>r.label===label);
  return row?row.count:null;
}

function thinkingGraph(){
  const spokes=FIELD.spokes.map(n=>{
    const h=FIELD.hubs[n.hub];
    return `<line class="tg-spoke" data-phase="${h.phase}"
      x1="${h.px.toFixed(1)}" y1="${h.py.toFixed(1)}" x2="${n.x.toFixed(1)}" y2="${n.y.toFixed(1)}"/>`;
  }).join('');
  const dots=FIELD.nodes.map(n=>{
    const h=FIELD.hubs[n.hub];
    return `<circle class="tg-dot" data-phase="${h.phase}" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}"
      r="${n.r.toFixed(2)}" style="--d:${n.drift}s;--t:${n.dur}s"/>`;
  }).join('');
  const hubs=FIELD.hubs.map(h=>{
    const count=graphCount(h.id);
    return `<g class="tg-hub" data-phase="${h.phase}" transform="translate(${h.px.toFixed(1)} ${h.py.toFixed(1)})">
      <circle class="tg-hub-halo" r="9"/>
      <circle class="tg-hub-dot" r="3.6"/>
      <text class="tg-hub-label" y="-11">${esc(h.id)}${count!=null?` · ${compact(count)}`:''}</text>
    </g>`;
  }).join('');
  return `<svg class="think-graph" viewBox="0 0 ${FIELD_W} ${FIELD_H}" preserveAspectRatio="xMidYMid meet"
    role="img" aria-label="Knowledge graph being consulted">${spokes}${dots}${hubs}</svg>`;
}

function thinkingPanel(){
  return `<div class="think" id="think" data-open="${thinkOpen?'1':'0'}">
    <div class="think-head">
      <span class="chat-dots"><i></i><i></i><i></i></span>
      <strong id="think-label">${esc(THINKING_PHASES[0].label)}</strong>
      <span class="think-elapsed" id="think-elapsed">0s</span>
      <button type="button" class="think-toggle" id="think-toggle"
        aria-expanded="${thinkOpen?'true':'false'}">${thinkOpen?'Hide':'Show'} graph</button>
    </div>
    <p class="think-detail" id="think-detail">${esc(THINKING_PHASES[0].detail)}</p>
    <div class="think-graph-wrap" id="think-graph-wrap">
      ${thinkingGraph()}
      <div class="think-legend">
        <span>${compact(omniState.snapshot?.graph_stats?.nodes||0)} nodes ·
        ${compact(omniState.snapshot?.graph_stats?.relationships||0)} relationships</span>
        <span class="think-note">Hubs and counts are real; the field is schematic and the sequence is paced, not traced.</span>
      </div>
    </div>
    <div class="think-steps" id="chat-steps"></div>
  </div>`;
}

function paintPhase(){
  const box=$('#think');if(!box)return;
  const phase=thinking.phase,spec=THINKING_PHASES[phase];
  $('#think-label').textContent=spec.label;
  $('#think-detail').textContent=spec.detail;
  // The graph is only shown while the graph is actually the thing being
  // consulted. Reading the question and composing the answer are not graph
  // work, and animating a knowledge graph through them would be theatre.
  box.dataset.graph=spec.graph?'1':'0';
  $$('.tg-dot,.tg-spoke,.tg-hub',box).forEach(el=>{
    const p=Number(el.dataset.phase);
    el.classList.toggle('lit',spec.graph&&p===phase);
    el.classList.toggle('seen',spec.graph&&p<phase);
  });
}

function setThinkOpen(open){
  thinkOpen=open;
  try{localStorage.setItem(THINK_OPEN_KEY,open?'1':'0')}catch{}
  const box=$('#think');if(!box)return;
  box.dataset.open=open?'1':'0';
  const button=$('#think-toggle');
  if(button){button.textContent=`${open?'Hide':'Show'} graph`;button.setAttribute('aria-expanded',String(open))}
}

function startThinking(jobId){
  stopThinking();
  thinking={timer:null,phase:0,jobId};
  const started=Date.now();
  paintPhase();
  thinking.timer=setInterval(()=>{
    const seconds=Math.round((Date.now()-started)/1000);
    const elapsed=$('#think-elapsed');
    if(!elapsed){stopThinking();return}
    elapsed.textContent=`${seconds}s`;
    // Hold on the last phase rather than looping: a turn that takes four
    // minutes should not appear to start over.
    const next=Math.min(Math.floor(seconds/7)+1,THINKING_PHASES.length-1);
    if(next!==thinking.phase){thinking.phase=next;paintPhase()}
  },1000);
}
function stopThinking(){if(thinking.timer)clearInterval(thinking.timer);thinking={timer:null,phase:0,jobId:null}}

/* ── Chats ─────────────────────────────────────────────────────────────
   The primary surface. A question goes to cos.api_chat_send(), which enqueues
   a job the local runner claims; the runner streams its steps into
   cos.job_progress, which is the same feed the work queue's run view reads.
   So a chat turn shows its working -- which catalog query it called, which
   ad-hoc query it wrote -- rather than spinning until an answer appears. */
let chatState={conversations:[],archived_conversations:[]},chatThread=null,
  chatPoll={timer:null,jobId:null,conversationId:null,seq:0,tick:null,inFlight:false,retryCount:0},
  chatPollToken=0,chatSending=false,chatSearch='',chatView='active',
  chatActionBusy=false,chatNotice=null;

function conversationList(){
  const source=chatView==='archived'
    ?(chatState.archived_conversations||[])
    :(chatState.conversations||[]);
  const query=chatSearch.trim().toLowerCase();
  const items=query
    ?source.filter(c=>[c.title,c.opening_question].some(value=>String(value||'').toLowerCase().includes(query)))
    :source;
  if(!source.length)return `<div class="chat-list-empty"><strong>${chatView==='archived'?'No archived conversations':'No conversations yet'}</strong><p>${chatView==='archived'?'Archived conversations will appear here.':'Ask something to start one.'}</p></div>`;
  if(!items.length)return `<div class="chat-list-empty"><strong>No matches</strong><p>Try a different search.</p></div>`;
  return `<div class="chat-list">${items.map(c=>`
    <div class="chat-list-row${chatThread?.conversation?.conversation_id===c.conversation_id?' active':''}">
      <button type="button" class="chat-list-item" data-conversation="${esc(c.conversation_id)}">
        <strong>${esc(c.title||'Untitled')}</strong>
        <small>${esc(c.opening_question||'')}</small>
        <span>${date(c.last_message_at||c.updated_at)} · ${number(c.message_count)} messages</span>
      </button>
      <div class="chat-list-actions">
        <button type="button" data-chat-archive="${esc(c.conversation_id)}" data-archived="${chatView==='archived'?'false':'true'}" title="${chatView==='archived'?'Restore':'Archive'} conversation" aria-label="${chatView==='archived'?'Restore':'Archive'} ${esc(c.title||'conversation')}">${chatView==='archived'?'↩':'⌑'}</button>
        <button type="button" class="danger" data-chat-delete="${esc(c.conversation_id)}" title="Delete conversation" aria-label="Delete ${esc(c.title||'conversation')}">×</button>
      </div>
    </div>`).join('')}</div>`;
}

function chatReportForConversation(conversationId){
  return (reportState?.reports||[]).find(report=>report.conversation_id===conversationId)||null;
}
function chatThreadToolbar(){
  const conversation=chatThread?.conversation;if(!conversation)return '';
  const archived=Boolean(conversation.archived);
  const completed=(chatThread.messages||[]).filter(message=>message.role==='assistant'&&message.status==='complete').length;
  const report=chatReportForConversation(conversation.conversation_id);
  return `<header class="chat-thread-toolbar">
    <div><strong>${esc(conversation.title||'Untitled conversation')}</strong>
      <small>${number(chatThread.messages?.length||0)} messages${archived?' · archived':''}</small></div>
    <div class="chat-thread-actions">
      <button type="button" class="primary" data-chat-report="${esc(conversation.conversation_id)}"${completed||report?'':' disabled'}>${report?'Update report':'Generate report'}</button>
      <button type="button" data-chat-archive="${esc(conversation.conversation_id)}" data-archived="${archived?'false':'true'}">${archived?'Restore':'Archive'}</button>
      <button type="button" class="danger" data-chat-delete="${esc(conversation.conversation_id)}">Delete</button>
    </div>
  </header>`;
}

function messageBubble(m){
  if(m.role==='user')return `<div class="chat-turn user"><div class="chat-bubble">${esc(m.content)}</div></div>`;
  if(m.status==='pending'||m.status==='streaming')
    return `<div class="chat-turn assistant"><div class="chat-bubble working">${chatModelChips(m)}${thinkingPanel()}</div></div>`;
  if(m.status==='failed'){
    const failure=chatFailureCopy(m);
    return `<div class="chat-turn assistant"><div class="chat-bubble failed">
      ${chatModelChips(m)}
      <strong>${esc(failure.title)}</strong>
      <p>${esc(failure.message)}</p>
      <details class="chat-error-details">
        <summary>Technical details</summary>
        <code>${esc(m.error||m.failure_detail||'No additional detail was recorded.')}</code>
        ${m.job_id?`<small>Job ${esc(m.job_id)}${m.job_state?` · ${esc(m.job_state)}`:''}</small>`:''}
      </details></div></div>`;
  }
  const figures=m.figures||[];
  return `<div class="chat-turn assistant"><div class="chat-bubble">
    <div class="chat-answer">${esc(m.content).replace(/\n/g,'<br>')}</div>
    ${figures.length?`<div class="omni-figures chat-figures">${figures.map(figureTile).join('')}</div>`:''}
    <div class="chat-meta">${confidenceChip(m.basis)}${chatModelChips(m)}${(m.citations||[]).map(c=>`<code>${esc(c)}</code>`).join('')}</div>
  </div></div>`;
}

const CHAT_MODELS=[
  {value:'claude-opus-5',label:'Claude Opus 5',provider:'claude'},
  {value:'claude-sonnet-5',label:'Claude Sonnet 5',provider:'claude'},
  {value:'gpt-5.6-sol',label:'GPT-5.6 Sol',provider:'codex'},
  {value:'gpt-5.6-terra',label:'GPT-5.6 Terra',provider:'codex'},
  {value:'gpt-5.6-luna',label:'GPT-5.6 Luna',provider:'codex'},
];
const CHAT_EFFORTS=['low','medium','high','xhigh','max'];
// Canonical Q1–Q6 wording from SCKG/DEMO-SCRIPT.md. These submit as-is so
// rehearsal clicks exercise the same questions the verified answers cover.
const CHAT_USE_CASES=[
  'What happens to us in a Texas ice storm?',
  "A big request comes from South Carolina. What's our exposure if we deploy there instead of holding the border?",
  'Heavy rain / a hurricane hits Texas next week. Where do we put the planes to catch the demand from cross-border trucking delays?',
  'How did we actually do against the market the last two years?',
  'A winter system is coming through the Midwest. Which end of our network is actually exposed?',
  'Two aircraft need a 3-month engine overhaul this year. Which months?',
];
let chatModel='gpt-5.6-sol',chatEffort='high';
function selectedChatModel(){return CHAT_MODELS.find(item=>item.value===chatModel)||CHAT_MODELS[0]}
function chatModelLabel(model,provider){
  return CHAT_MODELS.find(item=>item.value===model)?.label||
    (provider==='codex'?'Codex':'Claude');
}
function chatModelChips(message){
  if(!message.provider&&!message.model)return '';
  const effort=message.effort?`<span class="chip">${esc(message.effort)} effort</span>`:'';
  return `<span class="chip">${esc(chatModelLabel(message.model,message.provider))}</span>${effort}`;
}

function chatFailureCopy(message){
  const failures={
    configuration:[
      'The chat runner needs attention.',
      'The selected model or runner configuration prevented this question from starting.',
    ],
    provider_exhausted:[
      'The selected model is temporarily unavailable.',
      'Its usage window was exhausted before an answer could be recorded.',
    ],
    execution_timeout:[
      'The analysis took too long.',
      'The runner reached its time limit before an answer could be recorded.',
    ],
    runner_error:[
      'The analysis stopped unexpectedly.',
      'The runner encountered an internal error. The details below identify the failed job.',
    ],
    execution_failed:[
      'The model could not finish this answer.',
      'The attempt ended before a validated answer reached the conversation.',
    ],
  };
  const [title,messageText]=failures[message.failure_kind]||[
    'That question could not be answered.',
    'The attempt ended before a validated answer reached the conversation.',
  ];
  return{title,message:messageText};
}

function renderChats(){
  const panel=$('[data-panel="chats"]');if(!panel)return;
  const messages=chatThread?.messages||[];
  const archived=Boolean(chatThread?.conversation?.archived);
  const activeCount=(chatState.conversations||[]).length;
  const archivedCount=(chatState.archived_conversations||[]).length;
  panel.innerHTML=pageHead('Chats','Ask about disruption exposure. Every number comes back with its source.',
      `${activeCount} active · ${archivedCount} archived`)+`
    <div class="chat-layout">
      <aside class="chat-sidebar">
        <button type="button" class="chat-new" id="chat-new">＋ New conversation</button>
        <label class="chat-search"><span aria-hidden="true">⌕</span>
          <input type="search" id="chat-search" value="${esc(chatSearch)}" placeholder="Search conversations" aria-label="Search conversations">
        </label>
        <div class="chat-list-tabs" role="tablist" aria-label="Conversation status">
          <button type="button" data-chat-view="active" class="${chatView==='active'?'active':''}" aria-selected="${chatView==='active'}">Active <span>${number(activeCount)}</span></button>
          <button type="button" data-chat-view="archived" class="${chatView==='archived'?'active':''}" aria-selected="${chatView==='archived'}">Archived <span>${number(archivedCount)}</span></button>
        </div>
        <div id="chat-list-results">${conversationList()}</div>
      </aside>
      <section class="chat-main">
        ${chatThreadToolbar()}
        ${chatNotice?`<div class="chat-notice ${esc(chatNotice.tone||'info')}"><span>${chatNotice.tone==='error'?'!':'✓'}</span><p>${esc(chatNotice.message)}</p><button type="button" id="chat-notice-close" aria-label="Dismiss">×</button></div>`:''}
        ${chatThread?`<div class="chat-thread" id="chat-thread">${messages.map(messageBubble).join('')}</div>`
          :`<div class="chat-empty">
              <h3>${esc(greeting())}, Carter.</h3>
              <p>How can I help?</p>
            </div>`}
        ${chatThread?'':`<div class="chat-presets">
          <p>Six operational questions</p>
          <div class="chat-suggestions">
            ${CHAT_USE_CASES.map((q,index)=>`<button type="button" class="chat-suggestion" data-ask="${esc(q)}"><span>${String(index+1).padStart(2,'0')}</span><strong>${esc(q)}</strong></button>`).join('')}
          </div>
        </div>`}
        ${archived?`<div class="chat-archived-note"><strong>This conversation is archived.</strong><span>Restore it to continue the thread.</span><button type="button" data-chat-archive="${esc(chatThread.conversation.conversation_id)}" data-archived="false">Restore conversation</button></div>`:`<form class="chat-composer" id="chat-composer">
          <textarea id="chat-input" rows="3" placeholder="Ask about lanes, events, exposure, or what the data cannot answer…"></textarea>
          <div class="chat-composer-bar">
            <div class="chat-composer-config">
              <label class="chat-provider">Model
                <select id="chat-model" aria-label="Chat model">
                  ${CHAT_MODELS.map(item=>`<option value="${esc(item.value)}"${chatModel===item.value?' selected':''}>${esc(item.label)}</option>`).join('')}
                </select>
              </label>
              <label class="chat-provider">Effort
                <select id="chat-effort" aria-label="Thinking effort">
                  ${CHAT_EFFORTS.map(effort=>`<option value="${effort}"${chatEffort===effort?' selected':''}>${effort}</option>`).join('')}
                </select>
              </label>
            </div>
            <button type="submit" id="chat-submit" disabled aria-hidden="true">Ask <span aria-hidden="true">↑</span></button>
          </div>
        </form>`}
        <p class="chat-note">Answers are produced on the local runner. If it is offline, questions queue until it reconnects.</p>
      </section>
    </div>`;
  const thread=$('#chat-thread');if(thread)thread.scrollTop=thread.scrollHeight;
}

async function openConversation(conversationId){
  if(chatPoll.conversationId&&chatPoll.conversationId!==conversationId)stopChatPoll();
  const{data,error}=await sb.rpc('api_chat_messages',{p_conversation_id:conversationId});
  if(error){console.error(error);return}
  chatThread=data;renderChats();bindNavigation();
  const pending=[...(data.messages||[])].reverse().find(m=>m.status==='pending'||m.status==='streaming');
  if(pending?.job_id)startChatPoll(pending.job_id,conversationId);
  else if(chatPoll.conversationId===conversationId)stopChatPoll();
}

function stopChatPoll(){
  if(chatPoll.timer)clearTimeout(chatPoll.timer);
  chatPollToken+=1;
  chatPoll={timer:null,jobId:null,conversationId:null,seq:0,tick:null,inFlight:false,retryCount:0};
}
function chatPollIsActive(token,jobId,conversationId){
  return token===chatPollToken&&chatPoll.jobId===jobId&&chatPoll.conversationId===conversationId;
}
function showChatPollRetry(error,label='Connection interrupted — retrying automatically'){
  const box=$('#chat-steps');if(!box)return;
  const detail=String(error?.message||error||'The latest update could not be loaded.');
  box.innerHTML=`<div class="think-steps-head">Live status</div>
    <div class="chat-step warning"><span>↻</span><div>${esc(label)}<small>${esc(detail)}</small></div></div>`;
}
function resumeChatPoll(){
  if(document.visibilityState==='hidden')return;
  if(chatPoll.jobId&&chatPoll.tick){
    if(chatPoll.timer)clearTimeout(chatPoll.timer);
    chatPoll.timer=null;
    chatPoll.tick();
    return;
  }
  const pending=[...(chatThread?.messages||[])].reverse().find(m=>m.status==='pending'||m.status==='streaming');
  if(pending?.job_id&&chatThread?.conversation?.conversation_id)
    startChatPoll(pending.job_id,chatThread.conversation.conversation_id);
}

/* Reads the exact chat job's rows from the runner's shared progress log. */
async function startChatPoll(jobId,conversationId){
  if(chatPoll.jobId===jobId&&chatPoll.conversationId===conversationId){
    resumeChatPoll();return;
  }
  stopChatPoll();
  const token=chatPollToken;
  chatPoll={timer:null,jobId,conversationId,seq:0,tick:null,inFlight:false,retryCount:0};
  startThinking(jobId);
  const tick=async()=>{
    if(!chatPollIsActive(token,jobId,conversationId)||chatPoll.inFlight)return;
    chatPoll.inFlight=true;
    let delay=2500,progressError=null;
    try{
      // Real runner steps stream in beneath the paced phases and are labelled
      // as observed, not simulated. Progress and message reads are independent:
      // losing the optional step feed must never stop answer delivery.
      try{
        const result=await sb.rpc('api_chat_job_progress',{
          p_job_id:jobId,p_after_seq:chatPoll.seq
        });
        if(!chatPollIsActive(token,jobId,conversationId))return;
        progressError=result.error;
        if(!result.error&&result.data?.steps?.length){
          chatPoll.seq=result.data.steps[result.data.steps.length-1].seq;
          const box=$('#chat-steps');
          if(box)box.innerHTML=`<div class="think-steps-head">Runner steps</div>`+
            result.data.steps.slice(-6).map(s=>`<div class="chat-step ${esc(s.kind)}"><span>${STEP_ICON[s.kind]||'·'}</span><div>${esc(s.label)}${s.detail?`<small>${esc(s.detail)}</small>`:''}</div></div>`).join('');
        }
      }catch(error){progressError=error}

      const result=await sb.rpc('api_chat_messages',{p_conversation_id:conversationId});
      if(!chatPollIsActive(token,jobId,conversationId))return;
      if(result.error)throw result.error;
      const thread=result.data,last=(thread?.messages||[]).slice(-1)[0];
      chatPoll.retryCount=0;
      if(last&&last.status!=='pending'&&last.status!=='streaming'){
        chatThread=thread;stopChatPoll();stopThinking();chatSending=false;
        // Paint the completed answer before refreshing the sidebar. A slow or
        // failed list refresh must not hide a result already returned by the
        // conversation RPC.
        renderChats();bindNavigation();
        try{await refreshChatList()}catch(error){console.error(error)}
        if(chatThread?.conversation?.conversation_id===conversationId){
          renderChats();bindNavigation();
        }
        return;
      }
      if(progressError)showChatPollRetry(
        progressError,
        'Progress details are reconnecting — answer tracking is still active',
      );
    }catch(error){
      if(!chatPollIsActive(token,jobId,conversationId))return;
      chatPoll.retryCount+=1;
      delay=Math.min(10000,2500*(2**Math.min(chatPoll.retryCount,2)));
      showChatPollRetry(error);
      console.warn('Chat polling retry',error);
    }finally{
      if(chatPollIsActive(token,jobId,conversationId)){
        chatPoll.inFlight=false;
        if(chatPoll.timer)clearTimeout(chatPoll.timer);
        chatPoll.timer=setTimeout(tick,delay);
      }
    }
    // Deliberately does NOT re-render the panel: a re-render on every poll
    // would blow away what is being typed in the composer and reset the
    // animation. Only the thinking box is touched, above.
  };
  chatPoll.tick=tick;
  tick();
}

async function refreshChatList(){
  const{data}=await sb.rpc('api_chat_state');
  chatState=data||{conversations:[],archived_conversations:[]};
  const badge=$('#chat-count');if(badge)badge.textContent=(chatState.conversations||[]).length||'—';
}

function chatConversationRecord(conversationId){
  return [...(chatState.conversations||[]),...(chatState.archived_conversations||[])]
    .find(conversation=>conversation.conversation_id===conversationId)||
    (chatThread?.conversation?.conversation_id===conversationId?chatThread.conversation:null);
}
function setChatActionButtonBusy(button,label){
  if(!button)return;
  button.disabled=true;
  button.setAttribute('aria-busy','true');
  button.classList.add('busy');
  button.textContent=button.closest('.chat-list-actions')?'…':label;
}
function resetChatActionButton(button,label){
  if(!button)return;
  button.disabled=false;
  button.removeAttribute('aria-busy');
  button.classList.remove('busy');
  button.textContent=label;
}
async function setChatArchived(conversationId,archived,button){
  if(chatActionBusy)return;
  chatActionBusy=true;
  const original=button?.textContent;
  setChatActionButtonBusy(button,archived?'Archiving…':'Restoring…');
  const{error}=await sb.rpc('api_chat_set_archived',{
    p_conversation_id:conversationId,p_archived:archived
  });
  chatActionBusy=false;
  if(error){
    chatNotice={tone:'error',message:`Could not ${archived?'archive':'restore'} the conversation: ${error.message}`};
    resetChatActionButton(button,original);
    renderChats();bindNavigation();return;
  }
  const wasOpen=chatThread?.conversation?.conversation_id===conversationId;
  if(wasOpen&&archived){stopChatPoll();stopThinking();chatThread=null;chatSending=false}
  chatNotice={tone:'success',message:archived?'Conversation archived. You can restore it from Archived.':'Conversation restored.'};
  await refreshChatList();
  if(wasOpen&&!archived){
    chatView='active';
    await openConversation(conversationId);
  }else{
    renderChats();bindNavigation();
  }
}
async function deleteChatConversation(conversationId,button){
  if(chatActionBusy)return;
  const conversation=chatConversationRecord(conversationId);
  const title=conversation?.title||'this conversation';
  if(!confirm(`Permanently delete “${title}”?\n\nThe conversation and its messages will be removed. Any generated report will remain available.`))return;
  chatActionBusy=true;
  const original=button?.textContent;
  setChatActionButtonBusy(button,'Deleting…');
  const{error}=await sb.rpc('api_chat_delete',{p_conversation_id:conversationId});
  chatActionBusy=false;
  if(error){
    chatNotice={tone:'error',message:`Could not delete the conversation: ${error.message}`};
    resetChatActionButton(button,original);
    renderChats();bindNavigation();return;
  }
  if(chatThread?.conversation?.conversation_id===conversationId){
    stopChatPoll();stopThinking();chatThread=null;chatSending=false;
  }
  chatNotice={tone:'success',message:'Conversation deleted permanently. Existing reports were preserved.'};
  await refreshChatList();
  renderChats();bindNavigation();
}
async function generateConversationReport(conversationId,button){
  if(chatActionBusy)return;
  chatActionBusy=true;
  const original=button?.textContent;
  if(button){button.disabled=true;button.textContent='Generating…'}
  const{data,error}=await sb.rpc('api_report_from_conversation',{
    p_conversation_id:conversationId,p_title:null
  });
  if(error){
    chatActionBusy=false;
    chatNotice={tone:'error',message:`Could not generate the report: ${error.message}`};
    if(button){button.disabled=false;button.textContent=original}
    renderChats();bindNavigation();return;
  }
  const result=await sb.rpc('api_reports_state');
  chatActionBusy=false;
  if(result.error){
    chatNotice={tone:'error',message:`The report was generated, but could not be opened: ${result.error.message}`};
    renderChats();bindNavigation();return;
  }
  reportState=result.data||{reports:[]};
  openReportId=data.report_id;
  renderReports();renderChats();bindNavigation();
  activate('reports');
}

function missingProviderChatRpc(error){
  const message=String(error?.message||'');
  return error?.code==='PGRST202'||
    message.includes('api_chat_send(p_conversation_id, p_provider');
}

async function sendChat(text){
  const question=(text||'').trim();if(!question||chatSending)return;
  chatSending=true;renderChats();bindNavigation();
  const selection=selectedChatModel();
  let{data,error}=await sb.rpc('api_chat_send',{
    p_conversation_id:chatThread?.conversation?.conversation_id||null,
    p_text:question,p_title:null,p_provider:selection.provider,
    p_model:selection.value,p_effort:chatEffort});
  if(error&&missingProviderChatRpc(error)){
    ({data,error}=await sb.rpc('api_chat_send',{
      p_conversation_id:chatThread?.conversation?.conversation_id||null,
      p_text:question,p_title:null,p_provider:selection.provider
    }));
    if(error&&missingProviderChatRpc(error)){
      if(selection.provider==='claude'){
        ({data,error}=await sb.rpc('api_chat_send',{
        p_conversation_id:chatThread?.conversation?.conversation_id||null,
        p_text:question,p_title:null
        }));
      }else{
        error={message:'This model is not enabled in production yet. Apply the chat model migration, then try again.'};
      }
    }
  }
  if(error){chatSending=false;console.error(error);
    alert(`Could not send: ${error.message}`);renderChats();bindNavigation();
    const box=$('#chat-input');if(box){box.value=question;box.focus();syncChatComposer()}return}
  chatSending=false;
  await refreshChatList();
  await openConversation(data.conversation_id);
}

/* ── Reports ───────────────────────────────────────────────────────────
   A chat turn is ephemeral; a report is the durable artifact. Sections reuse
   the answer renderer, so a report and a published snapshot look identical --
   which they should, because they are the same shape. */
let reportState={reports:[]},openReportId=null;

function renderReports(){
  const panel=$('[data-panel="reports"]');if(!panel)return;
  const reports=reportState.reports||[];
  const badge=$('#report-count');if(badge)badge.textContent=reports.length||'—';
  if(!reports.length){
    panel.innerHTML=pageHead('Reports','Findings consolidated into durable, citable artifacts.','')+
      `<div class="empty-state"><strong>No reports yet</strong><p>Publish a snapshot with <code>sckg publish</code>, or consolidate a conversation.</p></div>`;
    return;
  }
  const open=reports.find(r=>r.report_id===openReportId);
  panel.innerHTML=pageHead('Reports','Findings consolidated into durable, citable artifacts.',`${reports.length} reports`)+
    (open?`<button type="button" class="link-button report-back" id="report-back">← All reports</button>
      <article class="card report-head">
        <div class="card-head"><div><h3>${esc(open.title)}</h3><p>${esc(open.summary)}</p></div>
        <div class="omni-head-meta">${confidenceChip(open.basis)}<span class="quiet">as of ${esc(open.as_of)}</span></div></div>
      </article>
      ${(open.sections||[]).map(answerCard).join('')}`
    :`<div class="report-grid">${reports.map(r=>`
        <button type="button" class="card report-card" data-report="${esc(r.report_id)}">
          <div class="report-card-top">${confidenceChip(r.basis)}${r.pinned?'<span class="report-pin">Pinned</span>':''}</div>
          <h3>${esc(r.title)}</h3><p>${esc(r.summary)}</p>
          <span class="quiet">${number((r.sections||[]).length)} sections · as of ${esc(r.as_of)} · ${date(r.created_at)}</span>
        </button>`).join('')}</div>
       ${freshnessStrip()}`);
}

/* ── Company Info ──────────────────────────────────────────────────────
   Live ADS-B. Drawn as inline SVG on an equirectangular projection rather
   than a tile map: no external tile host, no API key, nothing to fail on a
   conference-room network, and it matches the house style already used for
   the system diagram. */
let fleetState={aircraft:[],trails:{},coverage:{}};
let fleetRefreshPromise=null,fleetShowHistoric=false,fleetMapView=null;

async function refreshFleetOnView(){
  if(fleetRefreshPromise)return fleetRefreshPromise;
  fleetRefreshPromise=(async()=>{
    const{error}=await sb.functions.invoke('fleet-refresh',{
      body:{reason:'dashboard_view'}
    });
    if(error)console.warn('Fleet refresh unavailable; showing last known state',error);
    const{data:fleet,error:fleetError}=await sb.rpc('api_fleet_state',{p_trail_minutes:120});
    if(!fleetError&&fleet){fleetState=fleet;fleetMapView=null}
    renderCompany();bindNavigation();
  })().finally(()=>{fleetRefreshPromise=null});
  return fleetRefreshPromise;
}

/* Lower-48 state outlines as [lon,lat] rings, keyed by state FIPS.
   Generated from the Census county shapefile in data/raw/census_county_shapes. */
const STATE_RINGS={"01":[[[-87.597,30.988],[-87.627,30.848],[-87.396,30.65],[-87.448,30.51],[-87.367,30.437],[-87.505,30.324],[-87.452,30.3],[-87.801,30.229],[-88.028,30.224],[-87.747,30.288],[-87.906,30.409],[-87.919,30.636],[-88.011,30.685],[-88.138,30.313],[-88.338,30.405],[-88.395,30.369],[-88.473,31.894],[-88.098,34.892],[-88.203,35.008],[-85.605,34.985],[-85.184,32.861],[-84.963,32.424],[-85.007,32.328],[-84.889,32.261],[-85.061,32.134],[-85.141,31.857],[-85.041,31.541],[-85.108,31.186],[-85.002,31.001],[-87.597,30.988]]],"05":[[[-91.128,33.034],[-94.043,33.019],[-94.043,33.552],[-94.184,33.595],[-94.382,33.544],[-94.472,33.603],[-94.431,35.392],[-94.618,36.499],[-90.152,36.498],[-90.064,36.303],[-90.378,35.996],[-89.733,36.001],[-89.644,35.89],[-89.743,35.911],[-89.774,35.868],[-89.696,35.821],[-89.958,35.727],[-89.851,35.65],[-89.957,35.591],[-89.909,35.514],[-90.038,35.55],[-90.003,35.43],[-90.054,35.389],[-90.101,35.478],[-90.169,35.422],[-90.079,35.381],[-90.169,35.279],[-90.065,35.139],[-90.167,35.124],[-90.207,35.026],[-90.297,35.038],[-90.241,34.919],[-90.307,34.846],[-90.439,34.825],[-90.481,34.881],[-90.448,34.739],[-90.544,34.792],[-90.572,34.713],[-90.463,34.684],[-90.532,34.627],[-90.57,34.693],[-90.586,34.409],[-90.669,34.313],[-90.676,34.371],[-90.764,34.364],[-90.738,34.289],[-90.832,34.277],[-90.847,34.206],[-90.936,34.238],[-90.808,34.162],[-90.959,34.135],[-90.871,34.081],[-90.988,34.019],[-90.966,33.965],[-91.086,34.006],[-91.01,33.932],[-91.07,33.845],[-90.988,33.785],[-91.149,33.731],[-91.031,33.679],[-91.231,33.677],[-91.129,33.608],[-91.233,33.563],[-91.183,33.499],[-91.235,33.439],[-91.168,33.498],[-91.118,33.458],[-91.208,33.402],[-91.058,33.447],[-91.142,33.349],[-91.106,33.242],[-91.044,33.275],[-91.086,33.137],[-91.202,33.123],[-91.128,33.034]]],"06":[[[-122.337,37.117],[-122.514,37.781],[-122.41,37.809],[-122.379,37.606],[-122.039,37.455],[-122.168,37.677],[-122.332,37.782],[-122.311,37.896],[-122.43,37.963],[-122.263,38.045],[-122.317,38.112],[-122.498,38.115],[-122.447,37.984],[-122.505,37.936],[-122.438,37.882],[-122.504,37.894],[-122.5,37.821],[-122.882,38.025],[-123.024,37.995],[-122.949,38.154],[-122.977,38.268],[-123.728,38.919],[-123.691,39.051],[-123.828,39.348],[-123.766,39.553],[-123.852,39.832],[-124.363,40.261],[-124.409,40.443],[-124.137,40.926],[-124.165,41.13],[-124.063,41.44],[-124.147,41.718],[-124.255,41.778],[-124.208,41.888],[-124.212,41.998],[-119.999,41.995],[-120.001,39.0],[-117.5,37.22],[-114.633,35.002],[-114.634,34.873],[-114.47,34.711],[-114.387,34.458],[-114.131,34.263],[-114.434,34.087],[-114.535,33.935],[-114.525,33.552],[-114.726,33.404],[-114.706,33.088],[-114.511,33.023],[-114.469,32.845],[-114.616,32.728],[-117.124,32.534],[-117.161,32.666],[-117.243,32.665],[-117.313,33.087],[-117.47,33.296],[-118.133,33.753],[-118.41,33.741],[-118.391,33.839],[-118.524,34.031],[-118.807,34.0],[-119.129,34.101],[-119.279,34.267],[-119.564,34.415],[-120.471,34.448],[-120.649,34.577],[-120.6,34.705],[-120.672,34.903],[-120.646,35.144],[-120.856,35.206],[-120.885,35.43],[-121.287,35.666],[-121.501,35.998],[-121.903,36.306],[-121.977,36.579],[-121.837,36.635],[-121.792,36.815],[-121.906,36.969],[-122.127,36.964],[-122.337,37.117]]],"08":[[[-102.042,36.993],[-109.045,36.999],[-109.05,41.001],[-102.052,41.002],[-102.042,36.993]]],"10":[[[-75.312,38.945],[-75.191,38.807],[-75.092,38.804],[-75.049,38.451],[-75.694,38.46],[-75.789,39.722],[-75.663,39.821],[-75.423,39.807],[-75.614,39.606],[-75.312,38.945]]],"12":[[[-83.077,29.255],[-83.638,29.886],[-84.024,30.103],[-84.262,30.104],[-84.342,29.97],[-84.438,29.988],[-84.349,29.897],[-84.522,29.914],[-84.888,29.722],[-84.871,29.797],[-84.993,29.715],[-85.352,29.667],[-85.375,29.692],[-85.398,29.743],[-85.417,29.82],[-85.412,29.86],[-85.361,29.679],[-85.303,29.809],[-85.405,29.938],[-86.189,30.334],[-86.713,30.395],[-87.518,30.28],[-87.367,30.44],[-87.448,30.51],[-87.407,30.675],[-87.635,30.866],[-87.599,30.997],[-85.002,31.001],[-84.865,30.712],[-82.215,30.569],[-82.162,30.358],[-82.037,30.378],[-82.045,30.728],[-81.95,30.828],[-81.426,30.7],[-81.456,30.513],[-81.254,29.777],[-80.966,29.148],[-80.574,28.585],[-80.525,28.459],[-80.604,28.355],[-80.572,28.112],[-80.031,26.796],[-80.153,25.672],[-80.203,25.748],[-80.305,25.616],[-80.305,25.388],[-80.398,25.277],[-80.417,25.199],[-80.253,25.338],[-80.385,25.121],[-80.566,24.957],[-80.658,24.897],[-80.433,25.108],[-80.443,25.192],[-80.519,25.223],[-80.652,25.193],[-80.634,25.176],[-80.674,25.138],[-80.809,25.184],[-81.084,25.116],[-81.141,25.157],[-81.122,25.376],[-81.29,25.688],[-81.605,25.892],[-81.685,25.847],[-81.883,26.403],[-81.998,26.533],[-82.106,26.484],[-82.184,26.695],[-82.082,26.654],[-82.054,26.94],[-82.183,26.936],[-82.146,26.783],[-82.262,26.717],[-82.692,27.437],[-82.746,27.539],[-82.641,27.526],[-82.392,27.846],[-82.462,27.939],[-82.472,27.823],[-82.534,27.833],[-82.544,27.956],[-82.687,28.03],[-82.726,27.936],[-82.588,27.819],[-82.737,27.613],[-82.852,27.886],[-82.786,28.048],[-82.822,28.054],[-82.834,28.064],[-82.836,28.092],[-82.783,28.053],[-82.799,28.185],[-82.664,28.45],[-82.655,28.68],[-82.739,28.825],[-82.689,28.906],[-82.814,29.163],[-83.053,29.127],[-83.077,29.255]],[[-81.802,24.563],[-81.722,24.607],[-81.754,24.654],[-81.444,24.813],[-81.297,24.655],[-81.506,24.655],[-81.802,24.563]]],"13":[[[-82.215,30.569],[-84.865,30.712],[-85.108,31.186],[-85.041,31.541],[-85.134,31.891],[-85.061,32.134],[-84.889,32.261],[-85.007,32.328],[-84.963,32.424],[-85.184,32.861],[-85.605,34.985],[-83.11,35.001],[-83.113,34.935],[-83.307,34.815],[-83.343,34.683],[-83.033,34.483],[-82.859,34.455],[-82.557,33.945],[-81.926,33.463],[-81.94,33.345],[-81.754,33.151],[-81.492,33.009],[-81.418,32.628],[-81.187,32.464],[-81.115,32.115],[-80.84,32.003],[-80.984,31.94],[-80.93,31.908],[-80.993,31.858],[-81.065,31.877],[-81.036,31.81],[-81.204,31.719],[-81.131,31.696],[-81.16,31.57],[-81.298,31.534],[-81.179,31.518],[-81.294,31.369],[-81.29,31.218],[-81.494,30.978],[-81.403,30.958],[-81.444,30.71],[-81.901,30.83],[-82.022,30.788],[-82.05,30.362],[-82.193,30.379],[-82.215,30.569]]],"16":[[[-117.026,42.0],[-117.032,43.834],[-116.936,43.987],[-116.977,44.085],[-116.896,44.171],[-117.217,44.288],[-117.225,44.482],[-117.062,44.727],[-116.852,44.888],[-116.848,45.023],[-116.464,45.616],[-116.547,45.751],[-116.86,45.907],[-116.982,46.085],[-116.922,46.168],[-117.063,46.353],[-117.032,48.999],[-116.049,49.001],[-116.049,47.977],[-115.723,47.695],[-115.689,47.594],[-115.756,47.548],[-115.63,47.48],[-115.759,47.424],[-115.32,47.257],[-114.925,46.919],[-114.895,46.802],[-114.785,46.78],[-114.767,46.697],[-114.665,46.739],[-114.605,46.636],[-114.321,46.648],[-114.471,46.266],[-114.444,46.169],[-114.527,46.146],[-114.387,45.888],[-114.566,45.773],[-114.495,45.703],[-114.565,45.558],[-114.33,45.46],[-113.935,45.694],[-113.807,45.603],[-113.834,45.521],[-113.767,45.521],[-113.692,45.263],[-113.452,45.059],[-113.455,44.865],[-113.342,44.785],[-113.132,44.773],[-113.005,44.454],[-112.855,44.36],[-112.78,44.485],[-112.387,44.448],[-112.286,44.569],[-111.468,44.539],[-111.516,44.644],[-111.385,44.755],[-111.049,44.474],[-111.047,42.002],[-117.026,42.0]]],"17":[[[-90.355,38.364],[-90.109,38.844],[-90.44,38.967],[-90.546,38.874],[-90.628,38.892],[-90.73,39.256],[-91.368,39.729],[-91.512,40.147],[-91.467,40.334],[-91.373,40.399],[-91.405,40.555],[-91.124,40.669],[-91.093,40.821],[-90.963,40.925],[-90.947,41.097],[-91.114,41.241],[-91.046,41.414],[-90.461,41.524],[-90.343,41.588],[-90.311,41.742],[-90.181,41.809],[-90.163,42.117],[-90.391,42.225],[-90.444,42.355],[-90.656,42.492],[-87.802,42.493],[-87.829,42.27],[-87.525,41.724],[-87.532,39.348],[-87.62,39.307],[-87.575,39.218],[-87.659,39.136],[-87.512,38.954],[-87.553,38.862],[-87.496,38.742],[-87.839,38.282],[-87.988,38.257],[-87.911,38.162],[-88.042,38.046],[-88.013,37.967],[-88.07,37.927],[-88.013,37.895],[-88.098,37.902],[-88.028,37.799],[-88.16,37.658],[-88.065,37.489],[-88.47,37.396],[-88.516,37.284],[-88.424,37.152],[-88.461,37.074],[-88.975,37.23],[-89.168,37.074],[-89.133,36.982],[-89.255,37.072],[-89.308,37.07],[-89.292,36.992],[-89.518,37.285],[-89.421,37.388],[-89.517,37.537],[-89.514,37.69],[-89.843,37.905],[-89.951,37.882],[-89.925,37.96],[-90.243,38.113],[-90.36,38.225],[-90.355,38.364]]],"18":[[[-86.815,37.999],[-87.034,37.906],[-87.111,37.782],[-87.59,37.975],[-87.615,37.832],[-87.679,37.903],[-87.892,37.928],[-87.949,37.772],[-88.092,37.822],[-88.026,37.833],[-88.098,37.902],[-88.013,37.895],[-88.07,37.927],[-88.013,37.967],[-88.042,38.046],[-87.957,38.086],[-88.017,38.097],[-87.911,38.162],[-87.988,38.257],[-87.839,38.282],[-87.496,38.742],[-87.553,38.862],[-87.512,38.954],[-87.659,39.136],[-87.575,39.218],[-87.62,39.307],[-87.532,39.348],[-87.524,41.708],[-87.299,41.619],[-86.825,41.76],[-84.806,41.76],[-84.82,39.105],[-84.897,39.057],[-84.83,38.969],[-84.877,38.909],[-84.785,38.88],[-84.813,38.786],[-85.173,38.688],[-85.436,38.728],[-85.422,38.533],[-85.604,38.441],[-85.684,38.295],[-85.829,38.277],[-85.926,38.022],[-86.038,37.96],[-86.267,38.057],[-86.273,38.141],[-86.358,38.199],[-86.324,38.138],[-86.463,38.119],[-86.507,37.931],[-86.626,37.847],[-86.815,37.999]]],"19":[[[-91.729,40.614],[-95.766,40.585],[-95.883,40.718],[-95.809,40.891],[-95.882,41.06],[-95.841,41.175],[-95.927,41.202],[-95.875,41.307],[-95.957,41.345],[-95.92,41.452],[-96.012,41.476],[-96.005,41.543],[-96.092,41.534],[-96.121,41.689],[-96.065,41.793],[-96.162,41.902],[-96.13,41.972],[-96.242,42.001],[-96.418,42.351],[-96.386,42.474],[-96.477,42.491],[-96.639,42.735],[-96.437,43.121],[-96.585,43.269],[-96.522,43.386],[-96.599,43.5],[-91.218,43.501],[-91.207,43.353],[-91.058,43.255],[-91.179,43.067],[-91.065,42.751],[-90.706,42.634],[-90.654,42.479],[-90.444,42.355],[-90.391,42.225],[-90.163,42.117],[-90.181,41.809],[-90.311,41.742],[-90.343,41.588],[-90.656,41.462],[-91.046,41.414],[-91.114,41.241],[-90.947,41.097],[-90.952,40.954],[-91.093,40.821],[-91.124,40.669],[-91.405,40.555],[-91.388,40.385],[-91.482,40.382],[-91.729,40.614]]],"04":[[[-111.075,31.332],[-114.814,32.494],[-114.809,32.617],[-114.702,32.746],[-114.539,32.75],[-114.469,32.845],[-114.511,33.023],[-114.706,33.088],[-114.672,33.258],[-114.731,33.302],[-114.725,33.405],[-114.525,33.552],[-114.535,33.935],[-114.416,34.108],[-114.131,34.263],[-114.387,34.458],[-114.47,34.711],[-114.635,34.875],[-114.647,35.102],[-114.569,35.183],[-114.679,35.499],[-114.712,35.806],[-114.662,35.871],[-114.755,36.085],[-114.409,36.147],[-114.242,36.015],[-114.146,36.027],[-114.044,36.193],[-114.051,37.0],[-109.045,36.999],[-109.05,31.333],[-111.075,31.332]]],"20":[[[-102.042,36.993],[-102.052,40.003],[-95.308,40.0],[-95.128,39.874],[-94.93,39.889],[-94.876,39.813],[-94.935,39.776],[-94.863,39.743],[-94.965,39.739],[-95.109,39.542],[-94.885,39.39],[-94.824,39.21],[-94.588,39.15],[-94.618,36.999],[-102.042,36.993]]],"21":[[[-89.378,36.608],[-89.237,36.567],[-89.159,36.666],[-89.2,36.734],[-89.119,36.76],[-89.179,36.831],[-89.099,36.961],[-89.181,37.046],[-89.03,37.211],[-88.461,37.074],[-88.477,37.387],[-88.068,37.486],[-88.159,37.662],[-88.028,37.799],[-87.907,37.808],[-87.905,37.925],[-87.679,37.903],[-87.646,37.826],[-87.596,37.975],[-87.511,37.906],[-87.413,37.945],[-87.111,37.782],[-87.034,37.906],[-86.82,37.999],[-86.638,37.843],[-86.507,37.931],[-86.463,38.119],[-86.324,38.138],[-86.358,38.199],[-86.267,38.057],[-86.038,37.96],[-85.926,38.022],[-85.829,38.277],[-85.684,38.295],[-85.604,38.441],[-85.422,38.533],[-85.436,38.728],[-85.173,38.688],[-84.813,38.786],[-84.785,38.88],[-84.877,38.909],[-84.83,38.969],[-84.897,39.057],[-84.751,39.147],[-84.62,39.073],[-84.45,39.118],[-84.305,39.006],[-84.213,38.806],[-83.873,38.762],[-83.671,38.627],[-83.521,38.703],[-83.294,38.597],[-82.879,38.751],[-82.844,38.591],[-82.604,38.46],[-82.575,38.264],[-82.645,38.165],[-82.464,37.983],[-82.502,37.933],[-82.312,37.765],[-82.304,37.676],[-82.175,37.648],[-82.133,37.553],[-81.965,37.543],[-82.351,37.267],[-82.722,37.12],[-82.879,36.89],[-83.073,36.855],[-83.136,36.743],[-83.691,36.583],[-88.071,36.678],[-88.053,36.497],[-89.417,36.499],[-89.378,36.608]]],"22":[[[-93.927,29.79],[-93.699,30.059],[-93.74,30.54],[-93.555,30.823],[-93.578,31.0],[-93.508,31.032],[-93.533,31.184],[-93.589,31.166],[-93.687,31.305],[-93.639,31.372],[-93.749,31.469],[-93.712,31.513],[-93.835,31.586],[-93.823,31.775],[-94.042,31.992],[-94.043,33.019],[-91.166,33.004],[-91.208,32.915],[-91.145,32.905],[-91.107,32.989],[-91.064,32.906],[-91.165,32.751],[-91.054,32.722],[-91.151,32.616],[-91.014,32.64],[-91.08,32.556],[-90.987,32.496],[-91.094,32.549],[-91.116,32.483],[-90.97,32.439],[-90.994,32.354],[-90.876,32.372],[-90.995,32.192],[-91.039,32.242],[-91.164,32.197],[-91.163,32.133],[-91.004,32.146],[-91.08,32.048],[-91.16,32.07],[-91.076,32.017],[-91.185,31.966],[-91.256,31.813],[-91.346,31.843],[-91.366,31.762],[-91.263,31.754],[-91.372,31.743],[-91.401,31.62],[-91.515,31.63],[-91.405,31.576],[-91.523,31.522],[-91.479,31.365],[-91.576,31.41],[-91.516,31.278],[-91.654,31.256],[-91.56,31.054],[-91.637,30.999],[-89.73,31.004],[-89.852,30.661],[-89.683,30.452],[-89.616,30.223],[-89.528,30.189],[-89.718,30.025],[-89.818,30.046],[-89.846,29.956],[-89.729,29.958],[-89.65,29.862],[-89.484,30.079],[-89.373,30.05],[-89.458,29.998],[-89.37,29.892],[-89.248,29.997],[-89.232,29.93],[-89.342,29.883],[-89.24,29.879],[-89.386,29.835],[-89.286,29.763],[-89.395,29.79],[-89.446,29.652],[-89.525,29.727],[-89.5,29.634],[-89.662,29.646],[-89.601,29.584],[-89.684,29.625],[-89.683,29.549],[-89.523,29.456],[-89.561,29.395],[-89.188,29.342],[-89.122,29.202],[-89.004,29.18],[-89.112,29.16],[-89.04,29.135],[-89.147,29.071],[-89.143,28.992],[-89.252,29.083],[-89.418,28.929],[-89.295,29.199],[-89.4,29.124],[-89.64,29.291],[-89.843,29.319],[-89.595,29.356],[-89.815,29.4],[-89.852,29.476],[-89.992,29.451],[-90.042,29.361],[-89.979,29.347],[-90.108,29.265],[-90.048,29.19],[-90.223,29.087],[-90.305,29.268],[-90.354,29.305],[-90.403,29.234],[-90.44,29.349],[-90.598,29.303],[-90.562,29.235],[-90.836,29.066],[-90.952,29.183],[-91.288,29.256],[-91.34,29.31],[-91.265,29.361],[-91.163,29.321],[-91.154,29.255],[-91.166,29.254],[-91.172,29.241],[-91.168,29.234],[-91.118,29.255],[-91.126,29.333],[-91.266,29.476],[-91.541,29.526],[-91.555,29.636],[-91.648,29.635],[-91.628,29.741],[-91.881,29.711],[-91.831,29.829],[-91.971,29.834],[-92.144,29.716],[-92.132,29.766],[-92.203,29.753],[-92.169,29.7],[-92.104,29.699],[-92.106,29.612],[-92.035,29.632],[-92.009,29.613],[-92.323,29.531],[-93.213,29.776],[-93.838,29.691],[-93.927,29.79]],[[-92.005,29.603],[-91.903,29.637],[-91.708,29.569],[-91.822,29.474],[-92.005,29.603]]],"23":[[[-70.379,43.507],[-70.333,43.446],[-70.554,43.322],[-70.59,43.165],[-70.704,43.06],[-70.827,43.127],[-70.81,43.225],[-70.986,43.38],[-71.084,45.305],[-70.952,45.339],[-70.857,45.229],[-70.798,45.427],[-70.635,45.384],[-70.723,45.513],[-70.259,45.891],[-70.318,46.019],[-70.237,46.145],[-70.293,46.192],[-70.191,46.35],[-70.057,46.415],[-69.997,46.695],[-69.224,47.46],[-69.043,47.427],[-69.05,47.256],[-68.9,47.178],[-68.379,47.288],[-68.355,47.357],[-68.155,47.325],[-67.791,47.068],[-67.75,45.918],[-67.818,45.694],[-67.43,45.584],[-67.416,45.502],[-67.504,45.489],[-67.419,45.377],[-67.489,45.281],[-67.346,45.126],[-67.284,45.192],[-67.158,45.161],[-66.951,44.815],[-67.189,44.646],[-67.273,44.664],[-67.246,44.626],[-67.326,44.657],[-67.299,44.706],[-67.395,44.695],[-67.368,44.625],[-67.543,44.627],[-67.565,44.532],[-67.688,44.537],[-67.713,44.494],[-67.755,44.547],[-67.848,44.563],[-67.899,44.396],[-68.027,44.483],[-67.959,44.399],[-68.023,44.408],[-68.049,44.331],[-68.121,44.479],[-68.211,44.52],[-68.366,44.435],[-68.338,44.422],[-68.247,44.433],[-68.174,44.345],[-68.317,44.294],[-68.334,44.221],[-68.431,44.299],[-68.354,44.401],[-68.393,44.435],[-68.431,44.397],[-68.425,44.498],[-68.462,44.379],[-68.48,44.454],[-68.565,44.399],[-68.523,44.228],[-68.624,44.302],[-68.739,44.333],[-68.827,44.312],[-68.778,44.485],[-68.806,44.524],[-68.875,44.43],[-68.998,44.426],[-68.95,44.34],[-69.124,43.979],[-69.274,43.914],[-69.268,43.944],[-69.325,43.971],[-69.375,43.925],[-69.362,43.994],[-69.438,43.976],[-69.503,43.838],[-69.639,43.848],[-69.656,43.781],[-69.677,43.927],[-69.722,43.782],[-69.837,43.7],[-69.873,43.778],[-70.045,43.737],[-69.945,43.86],[-70.019,43.859],[-70.194,43.769],[-70.251,43.685],[-70.201,43.561],[-70.379,43.507]]],"24":[[[-77.258,38.522],[-76.909,38.893],[-77.041,38.995],[-77.12,38.934],[-77.461,39.075],[-77.527,39.146],[-77.46,39.228],[-77.76,39.337],[-77.766,39.496],[-77.889,39.556],[-77.838,39.606],[-77.946,39.585],[-78.177,39.696],[-78.566,39.519],[-78.76,39.582],[-78.766,39.648],[-78.957,39.44],[-79.103,39.476],[-79.473,39.202],[-79.477,39.721],[-75.789,39.722],[-75.694,38.46],[-75.049,38.451],[-75.242,38.027],[-75.747,37.988],[-75.885,37.912],[-75.873,38.032],[-75.843,38.027],[-75.774,38.077],[-75.879,38.076],[-75.788,38.146],[-75.96,38.137],[-75.801,38.254],[-75.92,38.264],[-75.85,38.366],[-75.97,38.234],[-76.017,38.309],[-75.957,38.348],[-76.011,38.377],[-76.032,38.217],[-76.225,38.395],[-76.126,38.239],[-76.226,38.31],[-76.334,38.482],[-76.22,38.532],[-76.278,38.533],[-76.286,38.626],[-76.027,38.567],[-76.213,38.682],[-76.225,38.76],[-76.313,38.749],[-76.34,38.671],[-76.335,38.773],[-76.255,38.862],[-76.216,38.787],[-76.175,38.754],[-76.155,38.772],[-76.21,38.946],[-76.334,38.918],[-76.368,38.836],[-76.362,38.939],[-76.305,39.039],[-76.257,38.975],[-76.164,39.0],[-76.134,39.104],[-76.208,39.096],[-76.201,39.014],[-76.216,39.01],[-76.275,39.165],[-76.17,39.332],[-75.986,39.379],[-76.041,39.394],[-75.954,39.594],[-76.096,39.537],[-76.128,39.487],[-76.06,39.448],[-76.227,39.35],[-76.241,39.461],[-76.282,39.3],[-76.307,39.385],[-76.357,39.394],[-76.329,39.315],[-76.409,39.312],[-76.442,39.195],[-76.586,39.261],[-76.394,39.013],[-76.48,38.978],[-76.56,38.763],[-76.506,38.505],[-76.381,38.385],[-76.476,38.314],[-76.375,38.299],[-76.322,38.038],[-76.439,38.161],[-76.473,38.103],[-76.594,38.216],[-76.779,38.228],[-76.827,38.347],[-76.842,38.254],[-76.924,38.29],[-77.016,38.446],[-77.217,38.363],[-77.258,38.522]]],"25":[[[-71.328,41.781],[-71.381,42.019],[-72.817,41.998],[-73.508,42.086],[-73.265,42.746],[-71.294,42.697],[-70.903,42.887],[-70.817,42.872],[-70.776,42.691],[-70.591,42.64],[-70.875,42.544],[-70.836,42.49],[-70.983,42.424],[-70.953,42.344],[-71.051,42.373],[-71.039,42.285],[-70.766,42.255],[-70.598,42.005],[-70.651,42.046],[-70.71,42.0],[-70.539,41.927],[-70.494,41.774],[-70.428,41.748],[-70.296,41.734],[-70.274,41.724],[-70.396,41.728],[-70.357,41.703],[-70.251,41.707],[-70.008,41.801],[-70.096,42.033],[-70.245,42.064],[-70.083,42.055],[-69.969,41.912],[-69.93,41.692],[-70.004,41.541],[-70.014,41.672],[-70.657,41.515],[-70.618,41.701],[-70.719,41.736],[-70.716,41.675],[-70.822,41.655],[-70.855,41.582],[-70.93,41.613],[-70.929,41.54],[-71.038,41.481],[-71.121,41.497],[-71.133,41.66],[-71.328,41.781]],[[-70.812,41.356],[-70.604,41.482],[-70.446,41.396],[-70.776,41.301],[-70.812,41.356]]],"26":[[[-87.871,45.371],[-87.781,45.68],[-88.129,45.809],[-88.103,45.922],[-88.515,46.02],[-88.671,45.989],[-89.092,46.139],[-90.12,46.337],[-90.217,46.502],[-90.418,46.566],[-90.028,46.674],[-89.789,46.818],[-89.425,46.841],[-88.973,47.002],[-88.218,47.45],[-87.801,47.473],[-87.712,47.401],[-87.957,47.387],[-87.943,47.336],[-88.35,47.076],[-88.497,46.755],[-88.143,46.967],[-88.283,46.823],[-88.082,46.92],[-87.817,46.891],[-87.59,46.782],[-87.583,46.731],[-87.503,46.647],[-87.434,46.592],[-87.377,46.59],[-87.359,46.503],[-87.005,46.534],[-86.875,46.437],[-86.75,46.479],[-86.645,46.411],[-86.162,46.669],[-85.501,46.676],[-84.956,46.772],[-85.03,46.685],[-85.015,46.48],[-84.631,46.485],[-84.583,46.414],[-84.129,46.53],[-84.098,46.257],[-84.273,46.201],[-84.03,46.135],[-84.072,46.092],[-83.895,45.986],[-84.267,45.991],[-84.382,45.934],[-84.423,46.002],[-84.532,45.969],[-84.657,46.053],[-84.752,45.84],[-85.014,46.011],[-85.336,46.093],[-85.506,46.096],[-85.659,45.966],[-86.276,45.944],[-86.347,45.797],[-86.581,45.712],[-86.614,45.6],[-86.718,45.68],[-86.56,45.772],[-86.535,45.886],[-86.782,45.86],[-86.789,45.772],[-86.968,45.668],[-86.978,45.906],[-87.038,45.742],[-87.197,45.639],[-87.592,45.095],[-87.737,45.173],[-87.657,45.369],[-87.871,45.371]],[[-89.235,47.878],[-89.179,47.935],[-88.788,48.063],[-88.633,48.149],[-88.418,48.18],[-89.005,47.899],[-88.912,47.891],[-89.162,47.824],[-89.235,47.878]],[[-84.806,41.76],[-86.825,41.76],[-86.622,41.892],[-86.356,42.254],[-86.207,42.702],[-86.255,43.083],[-86.538,43.618],[-86.43,43.828],[-86.515,44.058],[-86.269,44.345],[-86.255,44.692],[-86.09,44.742],[-86.067,44.906],[-85.807,44.95],[-85.541,45.211],[-85.614,45.128],[-85.567,45.044],[-85.649,44.975],[-85.599,44.989],[-85.652,44.849],[-85.595,44.767],[-85.475,44.992],[-85.577,44.76],[-85.527,44.748],[-85.389,44.948],[-85.372,45.271],[-84.915,45.396],[-85.115,45.539],[-84.944,45.71],[-85.014,45.76],[-84.729,45.788],[-84.479,45.657],[-84.216,45.635],[-84.09,45.494],[-83.49,45.358],[-83.382,45.27],[-83.413,45.239],[-83.315,45.053],[-83.262,45.025],[-83.385,45.077],[-83.464,45.003],[-83.316,44.881],[-83.27,44.709],[-83.334,44.337],[-83.538,44.248],[-83.58,44.049],[-83.875,43.962],[-83.956,43.761],[-83.913,43.678],[-83.685,43.584],[-83.49,43.703],[-83.325,43.884],[-83.405,43.915],[-82.964,44.068],[-82.793,44.023],[-82.615,43.779],[-82.523,43.225],[-82.413,42.977],[-82.523,42.607],[-82.679,42.522],[-82.656,42.592],[-82.713,42.598],[-82.631,42.673],[-82.806,42.649],[-82.772,42.593],[-82.874,42.524],[-82.882,42.405],[-83.097,42.29],[-83.132,42.09],[-83.44,41.813],[-83.428,41.742],[-84.806,41.696],[-84.806,41.76]],[[-83.873,45.993],[-83.845,46.027],[-83.806,45.984],[-83.689,46.036],[-83.676,46.071],[-83.729,46.092],[-83.635,46.104],[-83.473,45.984],[-83.565,45.913],[-83.873,45.993]]],"27":[[[-91.218,43.501],[-96.453,43.5],[-96.453,45.298],[-96.693,45.417],[-96.858,45.606],[-96.583,45.82],[-96.555,46.084],[-96.6,46.33],[-96.798,46.629],[-96.753,46.925],[-96.84,47.007],[-96.851,47.598],[-97.147,48.143],[-97.127,48.52],[-97.175,48.562],[-97.09,48.685],[-97.234,48.998],[-95.154,48.999],[-95.153,49.384],[-94.957,49.37],[-94.816,49.321],[-94.645,48.744],[-93.844,48.63],[-93.794,48.516],[-93.468,48.546],[-93.255,48.643],[-92.955,48.631],[-92.635,48.543],[-92.713,48.463],[-92.456,48.414],[-92.369,48.22],[-92.27,48.248],[-92.262,48.355],[-92.055,48.359],[-91.958,48.233],[-91.559,48.108],[-91.567,48.044],[-91.266,48.079],[-90.885,48.246],[-90.752,48.091],[-90.136,48.112],[-89.897,47.988],[-89.494,48.005],[-89.625,47.995],[-90.777,47.606],[-92.094,46.788],[-92.015,46.706],[-92.117,46.749],[-92.207,46.652],[-92.291,46.668],[-92.294,46.074],[-92.708,45.895],[-92.869,45.718],[-92.884,45.575],[-92.77,45.567],[-92.647,45.442],[-92.762,45.287],[-92.807,44.75],[-92.548,44.568],[-92.336,44.554],[-92.232,44.445],[-91.97,44.366],[-91.875,44.201],[-91.433,43.997],[-91.244,43.775],[-91.218,43.501]]],"28":[[[-89.728,31.002],[-91.637,30.999],[-91.56,31.054],[-91.654,31.256],[-91.516,31.278],[-91.576,31.41],[-91.479,31.365],[-91.523,31.522],[-91.405,31.576],[-91.515,31.63],[-91.401,31.62],[-91.372,31.743],[-91.263,31.754],[-91.366,31.762],[-91.346,31.843],[-91.256,31.813],[-91.185,31.966],[-91.076,32.017],[-91.16,32.07],[-91.08,32.048],[-91.004,32.146],[-91.163,32.133],[-91.164,32.197],[-91.039,32.242],[-90.995,32.192],[-90.876,32.372],[-90.994,32.354],[-90.97,32.439],[-91.116,32.483],[-91.094,32.549],[-90.987,32.496],[-91.08,32.556],[-91.014,32.64],[-91.154,32.626],[-91.055,32.719],[-91.165,32.751],[-91.064,32.901],[-91.087,32.976],[-91.152,32.902],[-91.214,32.927],[-91.12,33.055],[-91.2,33.129],[-91.088,33.135],[-91.045,33.265],[-91.142,33.3],[-91.058,33.447],[-91.149,33.379],[-91.209,33.406],[-91.132,33.482],[-91.235,33.439],[-91.183,33.499],[-91.233,33.563],[-91.129,33.608],[-91.228,33.688],[-91.034,33.674],[-91.149,33.731],[-90.988,33.785],[-91.07,33.845],[-91.01,33.932],[-91.086,34.006],[-90.966,33.965],[-90.988,34.019],[-90.871,34.081],[-90.959,34.135],[-90.808,34.162],[-90.936,34.238],[-90.847,34.206],[-90.832,34.277],[-90.738,34.289],[-90.764,34.364],[-90.676,34.371],[-90.669,34.313],[-90.586,34.409],[-90.57,34.693],[-90.532,34.627],[-90.463,34.684],[-90.572,34.713],[-90.544,34.792],[-90.475,34.724],[-90.476,34.886],[-90.439,34.825],[-90.307,34.846],[-90.241,34.919],[-90.308,34.996],[-88.2,34.996],[-88.098,34.892],[-88.473,31.894],[-88.395,30.35],[-88.729,30.343],[-88.858,30.43],[-89.286,30.303],[-89.336,30.374],[-89.458,30.178],[-89.574,30.182],[-89.852,30.663],[-89.728,31.002]]],"29":[[[-90.152,36.498],[-94.618,36.499],[-94.588,39.15],[-94.824,39.21],[-94.885,39.39],[-95.109,39.542],[-94.965,39.739],[-94.863,39.743],[-94.935,39.776],[-94.876,39.813],[-94.93,39.889],[-95.128,39.874],[-95.407,40.033],[-95.478,40.243],[-95.657,40.311],[-95.656,40.547],[-95.757,40.526],[-95.766,40.585],[-91.729,40.614],[-91.419,40.378],[-91.51,40.128],[-91.37,39.733],[-90.73,39.256],[-90.663,38.927],[-90.567,38.869],[-90.406,38.963],[-90.109,38.844],[-90.368,38.34],[-90.354,38.214],[-89.925,37.96],[-89.951,37.882],[-89.843,37.905],[-89.517,37.693],[-89.517,37.537],[-89.421,37.388],[-89.518,37.285],[-89.384,37.046],[-89.279,36.989],[-89.308,37.068],[-89.255,37.072],[-89.099,36.961],[-89.217,36.576],[-89.366,36.625],[-89.464,36.457],[-89.479,36.568],[-89.567,36.564],[-89.51,36.374],[-89.62,36.323],[-89.535,36.253],[-89.704,36.243],[-89.592,36.144],[-89.707,36.001],[-90.378,35.996],[-90.064,36.303],[-90.152,36.498]]],"30":[[[-111.388,44.753],[-111.516,44.644],[-111.468,44.539],[-112.286,44.569],[-112.387,44.448],[-112.78,44.485],[-112.855,44.36],[-113.005,44.454],[-113.132,44.773],[-113.342,44.785],[-113.455,44.865],[-113.452,45.059],[-113.692,45.263],[-113.767,45.521],[-113.834,45.521],[-113.807,45.603],[-113.935,45.694],[-114.33,45.46],[-114.565,45.558],[-114.495,45.703],[-114.566,45.773],[-114.387,45.888],[-114.527,46.146],[-114.444,46.169],[-114.471,46.266],[-114.321,46.648],[-114.605,46.636],[-114.665,46.739],[-114.767,46.697],[-114.785,46.78],[-114.895,46.802],[-114.925,46.919],[-115.32,47.257],[-115.759,47.424],[-115.63,47.48],[-115.756,47.548],[-115.689,47.594],[-115.723,47.695],[-116.049,47.977],[-116.049,49.001],[-104.049,49.0],[-104.04,44.998],[-111.055,45.001],[-111.056,44.477],[-111.388,44.753]]],"31":[[[-102.052,40.003],[-102.052,41.002],[-104.053,41.001],[-104.053,43.001],[-98.499,42.999],[-98.035,42.764],[-97.845,42.868],[-97.232,42.851],[-96.691,42.656],[-96.611,42.506],[-96.386,42.474],[-96.418,42.351],[-96.329,42.255],[-96.348,42.167],[-96.241,41.999],[-96.13,41.972],[-96.162,41.902],[-96.065,41.796],[-96.121,41.689],[-96.092,41.534],[-96.0,41.539],[-96.012,41.476],[-95.92,41.452],[-95.957,41.345],[-95.875,41.307],[-95.927,41.202],[-95.841,41.175],[-95.882,41.06],[-95.809,40.891],[-95.885,40.721],[-95.75,40.607],[-95.763,40.528],[-95.656,40.547],[-95.657,40.311],[-95.478,40.243],[-95.414,40.038],[-95.308,40.0],[-102.052,40.003]]],"34":[[[-74.964,38.968],[-74.9,39.173],[-75.151,39.19],[-75.536,39.461],[-75.559,39.63],[-75.354,39.84],[-75.144,39.885],[-75.127,39.961],[-74.722,40.15],[-75.059,40.418],[-75.069,40.542],[-75.192,40.574],[-75.204,40.691],[-75.051,40.866],[-75.131,40.991],[-74.695,41.357],[-73.894,40.997],[-74.023,40.72],[-74.144,40.644],[-74.102,40.702],[-74.121,40.717],[-74.273,40.488],[-74.006,40.411],[-73.986,40.454],[-74.099,39.757],[-74.794,38.994],[-74.92,38.929],[-74.964,38.968]]],"36":[[[-75.36,41.999],[-79.761,41.999],[-79.762,42.27],[-79.149,42.554],[-79.047,42.691],[-78.853,42.784],[-78.919,42.947],[-79.02,42.995],[-78.999,43.056],[-79.074,43.078],[-79.07,43.262],[-78.486,43.375],[-77.76,43.341],[-77.54,43.235],[-76.784,43.312],[-76.418,43.521],[-76.21,43.56],[-76.213,43.754],[-76.297,43.856],[-76.203,43.851],[-76.059,43.986],[-76.2,43.968],[-76.119,44.034],[-76.202,44.079],[-76.281,43.961],[-76.295,44.058],[-76.371,44.1],[-76.313,44.199],[-75.913,44.368],[-75.283,44.849],[-74.827,45.016],[-73.343,45.011],[-73.39,44.618],[-73.294,44.441],[-73.438,44.045],[-73.351,43.772],[-73.431,43.588],[-73.306,43.628],[-73.242,43.535],[-73.265,42.746],[-73.508,42.086],[-73.551,41.295],[-73.483,41.213],[-73.728,41.101],[-73.656,40.98],[-73.818,40.864],[-73.814,40.826],[-73.756,40.766],[-73.731,40.865],[-73.649,40.829],[-73.633,40.903],[-73.469,40.866],[-73.485,40.946],[-73.358,40.893],[-73.402,40.954],[-73.228,40.906],[-73.118,40.977],[-72.636,40.982],[-72.279,41.159],[-72.339,41.115],[-72.276,41.037],[-72.16,41.054],[-72.102,40.992],[-71.856,41.071],[-73.055,40.666],[-73.941,40.544],[-73.879,40.575],[-74.042,40.626],[-74.0,40.664],[-73.894,40.997],[-74.696,41.357],[-74.738,41.431],[-74.983,41.481],[-75.116,41.845],[-75.261,41.864],[-75.36,41.999]]],"37":[[[-83.109,35.001],[-84.322,34.988],[-84.29,35.226],[-84.053,35.27],[-84.023,35.412],[-83.88,35.519],[-83.498,35.563],[-83.159,35.765],[-82.984,35.778],[-82.92,35.928],[-82.805,35.927],[-82.637,36.066],[-82.558,35.954],[-82.355,36.116],[-82.033,36.12],[-81.908,36.302],[-81.707,36.335],[-81.678,36.588],[-75.868,36.55],[-75.536,35.793],[-75.73,36.007],[-75.843,36.42],[-76.003,36.537],[-76.032,36.482],[-75.925,36.425],[-75.797,36.073],[-75.923,36.246],[-75.969,36.264],[-75.925,36.165],[-76.215,36.301],[-76.064,36.144],[-76.277,36.191],[-76.234,36.098],[-76.455,36.193],[-76.304,36.095],[-76.58,36.011],[-76.692,36.066],[-76.672,36.272],[-76.7,36.285],[-76.728,35.934],[-76.063,35.991],[-76.011,35.954],[-76.038,35.646],[-75.947,35.96],[-75.836,35.971],[-75.728,35.825],[-75.717,35.694],[-75.781,35.688],[-75.736,35.625],[-75.778,35.58],[-75.833,35.572],[-75.89,35.641],[-75.882,35.576],[-76.152,35.331],[-76.345,35.393],[-76.342,35.342],[-76.412,35.346],[-76.396,35.432],[-76.532,35.401],[-76.587,35.509],[-76.485,35.507],[-76.465,35.558],[-76.638,35.513],[-76.578,35.388],[-77.053,35.535],[-76.966,35.434],[-76.47,35.281],[-76.565,35.229],[-76.527,35.185],[-76.634,35.174],[-76.54,35.155],[-76.569,35.098],[-76.804,34.964],[-77.06,35.147],[-76.936,34.973],[-76.761,34.916],[-76.484,34.988],[-76.463,35.076],[-76.423,34.951],[-76.319,34.966],[-76.364,35.037],[-76.247,34.987],[-76.513,34.72],[-76.604,34.79],[-76.619,34.704],[-76.842,34.729],[-77.126,34.685],[-77.583,34.401],[-77.829,34.163],[-77.963,33.842],[-77.996,33.906],[-78.239,33.917],[-78.542,33.853],[-79.675,34.805],[-80.798,34.82],[-80.782,34.936],[-80.935,35.107],[-81.041,35.045],[-81.044,35.15],[-82.393,35.215],[-83.109,35.001]]],"38":[[[-104.045,45.945],[-104.049,49.0],[-97.229,49.001],[-97.09,48.685],[-97.175,48.562],[-97.127,48.52],[-97.147,48.143],[-96.851,47.598],[-96.84,47.007],[-96.753,46.925],[-96.798,46.629],[-96.6,46.33],[-96.555,46.084],[-96.564,45.935],[-104.045,45.945]]],"39":[[[-83.712,38.641],[-83.873,38.762],[-84.213,38.806],[-84.305,39.006],[-84.455,39.12],[-84.82,39.105],[-84.806,41.696],[-83.455,41.733],[-83.48,41.682],[-83.336,41.705],[-82.957,41.52],[-82.84,41.587],[-82.712,41.536],[-83.04,41.464],[-83.009,41.428],[-82.687,41.491],[-82.481,41.381],[-82.012,41.516],[-81.739,41.489],[-81.284,41.762],[-80.519,41.977],[-80.519,40.639],[-80.668,40.582],[-80.6,40.318],[-80.88,39.621],[-81.217,39.388],[-81.376,39.342],[-81.456,39.409],[-81.57,39.268],[-81.684,39.271],[-81.747,39.095],[-81.814,39.079],[-81.763,38.924],[-81.899,38.875],[-81.933,38.988],[-82.038,39.024],[-82.222,38.787],[-82.177,38.604],[-82.291,38.579],[-82.33,38.444],[-82.579,38.408],[-82.844,38.591],[-82.889,38.756],[-83.294,38.597],[-83.521,38.703],[-83.712,38.641]]],"45":[[[-79.887,32.683],[-80.472,32.497],[-80.453,32.322],[-80.633,32.257],[-80.753,32.307],[-80.669,32.217],[-80.89,32.038],[-81.115,32.115],[-81.187,32.464],[-81.418,32.628],[-81.492,33.009],[-81.754,33.151],[-81.94,33.345],[-81.926,33.463],[-82.557,33.945],[-82.859,34.455],[-83.033,34.483],[-83.341,34.681],[-83.307,34.815],[-83.113,34.935],[-83.11,35.001],[-82.393,35.215],[-81.044,35.15],[-81.041,35.045],[-80.935,35.107],[-80.782,34.936],[-80.798,34.82],[-79.675,34.805],[-78.547,33.856],[-78.957,33.621],[-79.135,33.404],[-79.192,33.173],[-79.362,33.009],[-79.532,33.035],[-79.618,32.953],[-79.581,32.906],[-79.726,32.806],[-79.923,32.782],[-79.887,32.683]]],"40":[[[-98.09,34.128],[-98.366,34.157],[-98.486,34.063],[-98.6,34.161],[-98.757,34.125],[-98.987,34.221],[-99.19,34.214],[-99.207,34.338],[-99.359,34.456],[-99.403,34.373],[-99.695,34.378],[-99.923,34.575],[-100.0,34.561],[-100.0,36.5],[-103.002,36.5],[-103.002,37.0],[-94.618,36.999],[-94.618,36.499],[-94.431,35.392],[-94.492,33.625],[-94.736,33.692],[-94.764,33.76],[-94.869,33.746],[-94.969,33.861],[-95.218,33.963],[-95.289,33.873],[-95.545,33.88],[-95.594,33.943],[-95.771,33.845],[-96.148,33.838],[-96.348,33.686],[-96.629,33.845],[-96.588,33.895],[-96.667,33.917],[-96.762,33.824],[-96.981,33.956],[-97.126,33.717],[-97.211,33.916],[-97.426,33.819],[-97.46,33.904],[-97.581,33.9],[-97.672,33.991],[-97.834,33.858],[-97.968,33.882],[-97.946,33.99],[-98.085,34.003],[-98.09,34.128]]],"41":[[[-117.026,42.0],[-124.291,42.044],[-124.354,42.104],[-124.361,42.181],[-124.414,42.252],[-124.412,42.307],[-124.433,42.324],[-124.401,42.627],[-124.566,42.836],[-124.447,43.032],[-124.403,43.306],[-124.232,43.562],[-124.15,43.911],[-124.074,44.798],[-123.958,45.278],[-124.008,45.337],[-123.937,45.656],[-123.994,45.946],[-123.929,46.042],[-124.013,46.237],[-123.855,46.157],[-123.501,46.271],[-123.371,46.146],[-123.116,46.185],[-122.814,45.961],[-122.764,45.657],[-122.295,45.544],[-121.811,45.707],[-121.338,45.705],[-121.168,45.606],[-120.635,45.746],[-120.404,45.699],[-119.601,45.92],[-118.941,46.001],[-116.916,45.995],[-116.783,45.825],[-116.547,45.751],[-116.464,45.616],[-116.848,45.023],[-116.852,44.888],[-117.062,44.727],[-117.243,44.397],[-117.198,44.274],[-116.976,44.243],[-116.894,44.16],[-116.977,44.085],[-116.936,43.987],[-117.033,43.83],[-117.026,42.0]]],"42":[[[-80.519,39.721],[-80.519,41.977],[-79.762,42.27],[-79.761,41.999],[-75.36,41.999],[-75.261,41.864],[-75.072,41.814],[-75.075,41.606],[-74.983,41.481],[-74.69,41.364],[-75.131,40.991],[-75.051,40.866],[-75.204,40.691],[-75.192,40.574],[-75.069,40.542],[-75.059,40.418],[-74.722,40.15],[-75.127,39.961],[-75.144,39.885],[-75.415,39.802],[-75.635,39.83],[-75.774,39.722],[-80.519,39.721]]],"46":[[[-98.499,42.999],[-104.053,43.001],[-104.045,45.945],[-96.564,45.935],[-96.583,45.82],[-96.858,45.606],[-96.693,45.417],[-96.453,45.298],[-96.453,43.5],[-96.599,43.5],[-96.603,43.45],[-96.522,43.386],[-96.569,43.232],[-96.477,43.222],[-96.437,43.121],[-96.639,42.735],[-96.446,42.491],[-96.626,42.514],[-96.698,42.659],[-97.307,42.868],[-97.845,42.868],[-98.017,42.762],[-98.499,42.999]]],"47":[[[-84.322,34.988],[-90.31,35.003],[-90.065,35.139],[-90.169,35.279],[-90.081,35.386],[-90.179,35.385],[-90.108,35.477],[-90.054,35.389],[-90.003,35.43],[-90.035,35.553],[-89.905,35.519],[-89.958,35.587],[-89.851,35.657],[-89.958,35.727],[-89.696,35.821],[-89.774,35.868],[-89.743,35.911],[-89.644,35.89],[-89.733,36.001],[-89.592,36.15],[-89.705,36.24],[-89.535,36.253],[-89.62,36.323],[-89.513,36.36],[-89.539,36.498],[-88.053,36.497],[-88.071,36.678],[-83.691,36.583],[-81.647,36.612],[-81.742,36.411],[-81.707,36.335],[-81.908,36.302],[-82.033,36.12],[-82.355,36.116],[-82.558,35.954],[-82.637,36.066],[-82.805,35.927],[-82.92,35.928],[-82.992,35.774],[-83.159,35.765],[-83.498,35.563],[-83.88,35.519],[-84.023,35.412],[-84.053,35.27],[-84.29,35.226],[-84.322,34.988]]],"48":[[[-101.401,29.77],[-102.116,29.792],[-102.315,29.88],[-102.388,29.761],[-102.674,29.745],[-102.884,29.348],[-102.868,29.223],[-102.996,29.178],[-103.115,28.985],[-103.283,28.977],[-103.784,29.265],[-104.038,29.32],[-104.509,29.633],[-104.683,29.929],[-104.706,30.235],[-104.86,30.39],[-104.923,30.604],[-105.4,30.853],[-105.954,31.365],[-106.207,31.466],[-106.381,31.732],[-106.646,31.896],[-106.618,32.0],[-103.064,32.001],[-103.042,36.5],[-100.0,36.5],[-100.0,34.561],[-99.923,34.575],[-99.695,34.378],[-99.403,34.373],[-99.37,34.459],[-99.207,34.338],[-99.19,34.214],[-98.987,34.221],[-98.757,34.125],[-98.6,34.161],[-98.486,34.063],[-98.366,34.157],[-98.109,34.154],[-98.088,34.005],[-97.946,33.99],[-97.968,33.882],[-97.834,33.858],[-97.672,33.991],[-97.581,33.9],[-97.46,33.904],[-97.426,33.819],[-97.211,33.916],[-97.126,33.717],[-96.981,33.956],[-96.762,33.824],[-96.667,33.917],[-96.588,33.895],[-96.629,33.845],[-96.348,33.686],[-96.148,33.838],[-95.771,33.845],[-95.594,33.943],[-95.545,33.88],[-95.289,33.873],[-95.218,33.963],[-94.861,33.742],[-94.449,33.643],[-94.386,33.545],[-94.184,33.595],[-94.043,33.552],[-94.042,31.992],[-93.823,31.775],[-93.835,31.586],[-93.712,31.513],[-93.749,31.469],[-93.639,31.372],[-93.687,31.305],[-93.589,31.166],[-93.533,31.184],[-93.508,31.032],[-93.578,31.0],[-93.555,30.823],[-93.74,30.54],[-93.699,30.059],[-93.928,29.81],[-93.838,29.679],[-94.096,29.661],[-94.779,29.361],[-94.471,29.557],[-94.779,29.53],[-94.689,29.693],[-94.726,29.795],[-94.901,29.658],[-94.943,29.698],[-95.017,29.707],[-95.021,29.552],[-94.909,29.497],[-94.952,29.468],[-94.864,29.371],[-95.042,29.207],[-95.157,29.195],[-95.124,29.071],[-95.384,28.87],[-96.342,28.419],[-96.443,28.318],[-96.813,28.094],[-97.046,27.84],[-96.88,28.131],[-96.441,28.343],[-96.416,28.414],[-96.665,28.31],[-96.706,28.405],[-96.815,28.475],[-96.765,28.413],[-96.86,28.413],[-96.785,28.23],[-96.913,28.12],[-96.967,28.123],[-96.918,28.269],[-96.98,28.125],[-97.017,28.203],[-97.223,28.077],[-97.122,28.021],[-97.025,28.113],[-97.075,27.919],[-97.08,27.976],[-97.201,27.821],[-97.225,27.827],[-97.221,27.85],[-97.264,27.881],[-97.517,27.871],[-97.379,27.836],[-97.368,27.742],[-97.344,27.724],[-97.253,27.698],[-97.244,27.689],[-97.414,27.322],[-97.508,27.275],[-97.544,27.284],[-97.481,27.34],[-97.494,27.391],[-97.613,27.285],[-97.709,27.386],[-97.655,27.305],[-97.74,27.268],[-97.423,27.262],[-97.446,26.609],[-97.281,26.281],[-97.313,26.12],[-97.196,26.047],[-97.15,26.064],[-97.147,25.953],[-97.348,25.931],[-97.373,25.84],[-97.522,25.886],[-97.663,26.038],[-98.194,26.053],[-98.443,26.224],[-98.669,26.236],[-98.807,26.369],[-99.085,26.399],[-99.269,26.843],[-99.446,27.023],[-99.442,27.25],[-99.538,27.316],[-99.512,27.568],[-99.877,27.797],[-99.932,27.981],[-100.291,28.275],[-100.334,28.499],[-100.5,28.662],[-100.675,29.1],[-101.06,29.459],[-101.255,29.52],[-101.25,29.624],[-101.306,29.578],[-101.401,29.77]],[[-97.279,26.565],[-97.398,26.868],[-97.362,27.359],[-97.121,27.785],[-97.135,27.825],[-97.057,27.842],[-97.357,27.241],[-97.371,26.911],[-97.279,26.565]]],"49":[[[-109.045,36.999],[-114.051,37.0],[-114.041,41.994],[-111.047,42.002],[-111.047,40.998],[-109.05,41.001],[-109.045,36.999]]],"51":[[[-75.868,36.55],[-83.675,36.601],[-83.136,36.743],[-83.073,36.855],[-82.879,36.89],[-82.722,37.12],[-82.351,37.267],[-81.968,37.538],[-81.926,37.357],[-81.678,37.201],[-81.362,37.338],[-81.225,37.235],[-80.901,37.315],[-80.86,37.43],[-80.77,37.372],[-80.309,37.503],[-80.329,37.564],[-80.221,37.628],[-80.296,37.692],[-80.257,37.756],[-79.789,38.269],[-79.649,38.592],[-79.477,38.457],[-79.283,38.418],[-78.998,38.847],[-78.869,38.763],[-78.404,39.167],[-78.347,39.466],[-77.828,39.132],[-77.73,39.316],[-77.567,39.306],[-77.458,39.225],[-77.52,39.121],[-77.041,38.871],[-77.043,38.719],[-77.13,38.635],[-77.236,38.66],[-77.317,38.384],[-77.24,38.331],[-77.042,38.4],[-77.056,38.317],[-76.962,38.214],[-76.612,38.149],[-76.555,38.025],[-76.237,37.889],[-76.34,37.656],[-76.28,37.615],[-76.469,37.696],[-76.51,37.642],[-76.929,38.069],[-76.927,37.982],[-76.549,37.621],[-76.298,37.56],[-76.36,37.519],[-76.256,37.453],[-76.276,37.311],[-76.413,37.418],[-76.47,37.371],[-76.355,37.272],[-76.509,37.239],[-76.387,37.228],[-76.412,37.161],[-76.299,37.13],[-76.304,37.001],[-76.341,37.015],[-76.425,36.966],[-76.65,37.221],[-76.947,37.228],[-76.737,37.146],[-76.687,37.197],[-76.663,37.046],[-76.489,36.96],[-76.492,36.881],[-76.355,36.923],[-76.371,36.834],[-76.302,36.85],[-76.326,36.963],[-75.996,36.922],[-75.868,36.55]],[[-76.013,37.279],[-75.924,37.602],[-75.795,37.727],[-75.816,37.789],[-75.733,37.786],[-75.673,37.847],[-75.757,37.902],[-75.624,37.994],[-75.242,38.027],[-75.359,37.865],[-75.406,37.899],[-75.527,37.789],[-75.835,37.175],[-75.97,37.117],[-76.013,37.279]]],"53":[[[-122.764,45.657],[-122.904,46.084],[-123.116,46.185],[-123.371,46.146],[-123.475,46.268],[-123.701,46.305],[-123.876,46.24],[-124.001,46.313],[-124.078,46.272],[-124.064,46.641],[-124.015,46.379],[-123.954,46.379],[-123.993,46.489],[-123.893,46.54],[-123.961,46.636],[-123.829,46.713],[-124.092,46.742],[-124.138,46.906],[-124.073,46.861],[-123.839,46.954],[-123.859,46.968],[-124.012,46.985],[-124.122,47.042],[-124.106,46.938],[-124.174,46.927],[-124.209,47.218],[-124.319,47.356],[-124.425,47.738],[-124.676,47.967],[-124.733,48.163],[-124.659,48.331],[-124.726,48.386],[-123.981,48.165],[-123.333,48.113],[-123.102,48.185],[-123.142,48.157],[-123.021,48.033],[-122.916,48.095],[-122.885,47.99],[-122.827,48.046],[-122.885,48.105],[-122.755,48.144],[-122.801,48.088],[-122.74,48.031],[-122.748,48.072],[-122.688,48.101],[-122.699,47.919],[-122.61,47.887],[-122.694,47.868],[-122.785,47.687],[-122.833,47.692],[-122.798,47.826],[-122.865,47.805],[-122.904,47.646],[-123.114,47.463],[-123.16,47.354],[-123.03,47.351],[-122.875,47.414],[-123.12,47.386],[-122.965,47.585],[-122.752,47.668],[-122.574,47.858],[-122.617,47.939],[-122.525,47.912],[-122.472,47.75],[-122.631,47.707],[-122.592,47.595],[-122.698,47.527],[-122.555,47.59],[-122.495,47.511],[-122.576,47.326],[-122.548,47.285],[-122.696,47.281],[-122.626,47.376],[-122.684,47.365],[-122.772,47.167],[-122.833,47.243],[-122.769,47.341],[-122.827,47.406],[-122.871,47.277],[-122.848,47.131],[-122.815,47.179],[-122.713,47.093],[-122.591,47.178],[-122.53,47.283],[-122.547,47.318],[-122.437,47.262],[-122.325,47.349],[-122.421,47.576],[-122.34,47.599],[-122.437,47.662],[-122.219,48.02],[-122.362,48.12],[-122.384,48.227],[-122.479,48.176],[-122.359,48.055],[-122.511,48.132],[-122.531,48.25],[-122.372,48.299],[-122.534,48.376],[-122.55,48.448],[-122.674,48.425],[-122.685,48.509],[-122.47,48.469],[-122.561,48.582],[-122.425,48.6],[-122.536,48.776],[-122.673,48.733],[-122.647,48.785],[-122.793,48.893],[-122.749,48.935],[-122.822,48.941],[-122.758,49.002],[-117.032,48.999],[-117.063,46.354],[-116.922,46.168],[-116.982,46.089],[-116.916,45.995],[-118.987,46.0],[-119.126,45.933],[-119.601,45.92],[-120.211,45.726],[-120.635,45.746],[-121.168,45.606],[-121.338,45.705],[-121.811,45.707],[-122.267,45.544],[-122.764,45.657]],[[-122.763,48.215],[-122.665,48.402],[-122.585,48.395],[-122.506,48.298],[-122.732,48.226],[-122.606,48.208],[-122.542,48.018],[-122.525,48.097],[-122.376,48.034],[-122.377,47.906],[-122.473,47.988],[-122.547,47.967],[-122.61,48.152],[-122.763,48.215]]],"54":[[[-81.98,37.485],[-81.926,37.514],[-82.133,37.553],[-82.175,37.648],[-82.304,37.676],[-82.312,37.765],[-82.502,37.933],[-82.464,37.983],[-82.645,38.165],[-82.575,38.264],[-82.596,38.418],[-82.33,38.444],[-82.291,38.579],[-82.177,38.604],[-82.222,38.787],[-82.038,39.024],[-81.933,38.988],[-81.899,38.875],[-81.763,38.924],[-81.814,39.079],[-81.747,39.095],[-81.684,39.271],[-81.57,39.268],[-81.456,39.409],[-81.376,39.342],[-81.217,39.388],[-80.88,39.621],[-80.6,40.318],[-80.627,40.62],[-80.519,40.639],[-80.519,39.721],[-79.477,39.721],[-79.487,39.206],[-79.103,39.476],[-78.957,39.44],[-78.766,39.648],[-78.689,39.546],[-78.471,39.516],[-78.395,39.584],[-78.43,39.623],[-78.265,39.619],[-78.171,39.696],[-77.946,39.585],[-77.838,39.606],[-77.866,39.518],[-77.766,39.496],[-77.803,39.437],[-77.72,39.321],[-77.828,39.132],[-78.347,39.466],[-78.404,39.167],[-78.869,38.763],[-78.998,38.847],[-79.283,38.418],[-79.477,38.457],[-79.649,38.592],[-79.789,38.269],[-80.296,37.692],[-80.221,37.628],[-80.329,37.564],[-80.3,37.508],[-80.465,37.426],[-80.511,37.482],[-80.77,37.372],[-80.86,37.43],[-80.901,37.315],[-81.225,37.235],[-81.362,37.338],[-81.678,37.201],[-81.854,37.288],[-81.98,37.485]]],"55":[[[-87.802,42.493],[-90.643,42.508],[-90.709,42.636],[-91.065,42.751],[-91.179,43.067],[-91.058,43.255],[-91.215,43.366],[-91.244,43.775],[-91.367,43.937],[-91.875,44.201],[-91.964,44.362],[-92.232,44.445],[-92.336,44.554],[-92.548,44.568],[-92.808,44.751],[-92.762,45.287],[-92.647,45.442],[-92.77,45.567],[-92.884,45.575],[-92.869,45.718],[-92.708,45.895],[-92.294,46.074],[-92.292,46.666],[-92.207,46.652],[-92.117,46.749],[-91.79,46.695],[-90.856,46.962],[-90.751,46.888],[-90.944,46.588],[-90.693,46.66],[-90.753,46.704],[-90.217,46.502],[-90.12,46.337],[-89.092,46.139],[-88.671,45.989],[-88.515,46.02],[-88.103,45.922],[-88.129,45.809],[-87.782,45.683],[-87.793,45.5],[-87.888,45.355],[-87.657,45.369],[-87.737,45.173],[-87.587,45.087],[-87.631,44.984],[-87.839,44.933],[-88.05,44.566],[-88.002,44.539],[-87.754,44.651],[-87.61,44.838],[-87.433,44.893],[-87.386,44.831],[-87.405,44.912],[-87.238,45.168],[-87.17,45.153],[-87.067,45.296],[-86.972,45.284],[-87.085,45.145],[-87.048,45.088],[-87.124,45.067],[-87.468,44.552],[-87.545,44.321],[-87.513,44.193],[-87.648,44.104],[-87.736,43.881],[-87.703,43.688],[-87.912,43.25],[-87.897,43.02],[-87.758,42.782],[-87.802,42.493]]],"56":[[[-111.047,40.998],[-111.055,45.001],[-104.058,44.998],[-104.053,41.001],[-111.047,40.998]]],"09":[[[-72.913,41.297],[-73.178,41.167],[-73.368,41.107],[-73.477,41.036],[-73.501,41.047],[-73.529,41.017],[-73.535,41.032],[-73.57,41.002],[-73.604,41.015],[-73.64,41.003],[-73.657,40.988],[-73.728,41.101],[-73.483,41.213],[-73.551,41.295],[-73.487,42.05],[-71.801,42.024],[-71.798,41.417],[-71.857,41.321],[-72.351,41.312],[-72.706,41.244],[-72.762,41.268],[-72.895,41.243],[-72.913,41.297]]],"35":[[[-109.05,31.333],[-109.045,36.999],[-103.002,37.0],[-103.064,32.001],[-106.618,32.0],[-106.636,31.866],[-106.528,31.783],[-108.208,31.784],[-108.209,31.333],[-109.05,31.333]]],"11":[[[-77.12,38.934],[-77.041,38.995],[-76.909,38.893],[-77.039,38.792],[-77.12,38.934]]],"44":[[[-71.852,41.325],[-71.798,41.417],[-71.799,42.008],[-71.381,42.019],[-71.382,41.893],[-71.238,41.666],[-71.301,41.65],[-71.391,41.784],[-71.357,41.717],[-71.45,41.686],[-71.404,41.589],[-71.481,41.36],[-71.852,41.325]],[[-71.24,41.476],[-71.317,41.478],[-71.272,41.624],[-71.133,41.66],[-71.121,41.497],[-71.194,41.456],[-71.218,41.626],[-71.24,41.476]]],"32":[[[-118.501,37.949],[-120.001,39.0],[-119.999,41.995],[-114.041,41.994],[-114.044,36.193],[-114.151,36.023],[-114.261,36.025],[-114.374,36.144],[-114.753,36.09],[-114.662,35.871],[-114.712,35.806],[-114.679,35.499],[-114.569,35.183],[-114.647,35.102],[-114.633,35.002],[-118.501,37.949]]],"33":[[[-72.554,42.86],[-72.444,43.006],[-72.38,43.574],[-72.032,44.079],[-72.065,44.277],[-71.577,44.503],[-71.535,44.587],[-71.632,44.752],[-71.495,44.904],[-71.541,44.985],[-71.465,45.014],[-71.505,45.051],[-71.398,45.204],[-71.443,45.238],[-71.284,45.302],[-71.148,45.239],[-71.084,45.305],[-70.988,43.39],[-70.712,43.044],[-70.817,42.872],[-71.031,42.859],[-71.294,42.697],[-72.459,42.727],[-72.554,42.86]]],"50":[[[-72.38,43.574],[-72.444,43.006],[-72.557,42.853],[-72.459,42.727],[-73.276,42.746],[-73.242,43.535],[-73.306,43.628],[-73.431,43.588],[-73.351,43.772],[-73.438,44.045],[-73.294,44.441],[-73.39,44.618],[-73.343,45.011],[-71.465,45.014],[-71.536,44.995],[-71.495,44.904],[-71.632,44.752],[-71.535,44.587],[-71.577,44.503],[-72.065,44.277],[-72.032,44.079],[-72.38,43.574]]]};
const MAP_BOX={lamin:24,lamax:50,lomin:-125,lomax:-66};
const MAP_W=1100,MAP_H=520;
/* dx/dy nudge the label off the marker. Willow Run and Detroit Metro are 12
   miles apart, so at this scale their labels sit on top of each other and read
   as one word -- and they are exactly the pair the demo contrasts, charter
   against scheduled, so neither can be dropped. */
const AIRPORTS=[
  {iata:'YIP',name:'Willow Run',lat:42.2408,lon:-83.5304,dx:9,dy:-4},
  {iata:'DTW',name:'Detroit',lat:42.2124,lon:-83.3534,dx:9,dy:12},
  {iata:'LRD',name:'Laredo',lat:27.5438,lon:-99.4616,dx:9,dy:4},
  {iata:'ELP',name:'El Paso',lat:31.8072,lon:-106.3781,dx:9,dy:4},
  {iata:'SDF',name:'Louisville',lat:38.1744,lon:-85.7360,dx:9,dy:4},
  {iata:'IND',name:'Indianapolis',lat:39.7173,lon:-86.2944,dx:9,dy:4},
  {iata:'BQK',name:'Brunswick',lat:31.2590,lon:-81.4663,dx:9,dy:4},
  {iata:'OSC',name:'Oscoda',lat:44.4515,lon:-83.3942,dx:9,dy:4},
];
const project=(lat,lon)=>[
  (lon-MAP_BOX.lomin)/(MAP_BOX.lomax-MAP_BOX.lomin)*MAP_W,
  (MAP_BOX.lamax-lat)/(MAP_BOX.lamax-MAP_BOX.lamin)*MAP_H,
];
const inBox=(lat,lon)=>lat>=MAP_BOX.lamin&&lat<=MAP_BOX.lamax&&lon>=MAP_BOX.lomin&&lon<=MAP_BOX.lomax;

function isFleetActive(aircraft){return aircraft.active_recent===true}
function visibleFleet(){
  const aircraft=fleetState.aircraft||[];
  return fleetShowHistoric?aircraft:aircraft.filter(isFleetActive);
}
function localFleetTime(value){
  if(!value)return 'No public flight found';
  return new Intl.DateTimeFormat(undefined,{
    year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',
    timeZoneName:'short'
  }).format(new Date(value));
}
function fleetStatus(aircraft){
  if(aircraft.live_now&&!aircraft.on_ground)return 'Airborne now';
  if(aircraft.live_now&&aircraft.on_ground)return 'On ground now';
  if(aircraft.last_arrival_airport)return `Last arrived ${aircraft.last_arrival_airport}`;
  if(aircraft.last_adsb_at)return 'Last observed in flight';
  return aircraft.service_status==='retired'?'Retired':
    aircraft.service_status==='parts_donor'?'Parts donor':'No recent public flight';
}
function clampFleetView(view){
  const width=Math.min(MAP_W,Math.max(180,view.width));
  const height=Math.min(MAP_H,Math.max(90,view.height));
  return{
    x:Math.min(MAP_W-width,Math.max(0,view.x)),
    y:Math.min(MAP_H-height,Math.max(0,view.y)),
    width,height
  };
}
function fittedFleetView(aircraft=visibleFleet()){
  const points=aircraft.filter(a=>a.lat!=null&&a.lon!=null&&inBox(a.lat,a.lon))
    .map(a=>project(a.lat,a.lon));
  if(!points.length)return{x:0,y:0,width:MAP_W,height:MAP_H};
  const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
  let width=Math.max(330,Math.max(...xs)-Math.min(...xs)+150);
  let height=Math.max(180,Math.max(...ys)-Math.min(...ys)+110);
  const aspect=2;
  if(width/height>aspect)height=width/aspect;
  else width=height*aspect;
  return clampFleetView({
    x:(Math.min(...xs)+Math.max(...xs)-width)/2,
    y:(Math.min(...ys)+Math.max(...ys)-height)/2,
    width,height
  });
}
function setFleetMapView(view){
  fleetMapView=clampFleetView(view);
  const map=$('#fleet-map');
  if(map)map.setAttribute('viewBox',`${fleetMapView.x} ${fleetMapView.y} ${fleetMapView.width} ${fleetMapView.height}`);
}
function zoomFleetMap(factor,anchorX=.5,anchorY=.5){
  const view=fleetMapView||fittedFleetView();
  const width=view.width*factor,height=view.height*factor;
  setFleetMapView({
    x:view.x+(view.width-width)*anchorX,
    y:view.y+(view.height-height)*anchorY,
    width,height
  });
}

function fleetMap(){
  const shown=visibleFleet();
  const aircraft=shown.filter(a=>a.lat!=null&&a.lon!=null&&inBox(a.lat,a.lon));
  const trails=fleetState.trails||{};
  if(!fleetMapView)fleetMapView=fittedFleetView(shown);
  /* Real coastlines and state borders, derived from the Census county
     shapefile already on disk. The browser changes only the SVG viewBox, so
     pan and zoom add no map vendor, API key, or new failure mode. */
  const land=Object.values(STATE_RINGS).flat().map(ring=>{
    const d=ring.map((pt,i)=>{const[x,y]=project(pt[1],pt[0]);
      return `${i?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)}`}).join('')+'Z';
    return `<path class="map-land" d="${d}"/>`;
  }).join('');
  const activeIds=new Set(shown.map(a=>a.icao24));
  const clusters=new Map();
  const markers=aircraft.map(a=>{
    const key=`${Number(a.lat).toFixed(2)},${Number(a.lon).toFixed(2)}`;
    const index=clusters.get(key)||0;clusters.set(key,index+1);
    const angle=index*2.4,radius=index?10+Math.floor(index/5)*6:0;
    const[x0,y0]=project(a.lat,a.lon);
    const x=x0+Math.cos(angle)*radius,y=y0+Math.sin(angle)*radius;
    return `<g class="map-aircraft${a.on_ground?' grounded':''}${a.live_now?' live':''}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <title>${esc(`${a.tail} · ${fleetStatus(a)} · ${localFleetTime(a.seen_at)}`)}</title>
        <g transform="rotate(${Number(a.heading_deg||0).toFixed(0)})"><path d="M0 -7 L5 6 L0 3 L-5 6 Z"/></g>
        <text x="8" y="-7">${esc(a.tail||a.callsign||'')}</text>
      </g>`;
  }).join('');
  const view=fleetMapView;
  return `<div class="fleet-map-shell">
    <div class="fleet-map-controls" aria-label="Map controls">
      <button type="button" data-fleet-zoom="in" aria-label="Zoom in">＋</button>
      <button type="button" data-fleet-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" data-fleet-map-reset>Fit fleet</button>
    </div>
    <svg class="fleet-map" id="fleet-map" viewBox="${view.x} ${view.y} ${view.width} ${view.height}" role="img" aria-label="Movable map of last-known aircraft positions">
      <rect width="${MAP_W}" height="${MAP_H}" class="map-sea"/>
      ${land}
      ${AIRPORTS.map(a=>{const[x,y]=project(a.lat,a.lon);return `
        <g class="map-airport"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"/>
        <text x="${(x+a.dx).toFixed(1)}" y="${(y+a.dy).toFixed(1)}">${esc(a.iata)}</text></g>`}).join('')}
      ${Object.entries(trails).filter(([icao])=>activeIds.has(icao)).map(([,points])=>{
        const path=(points||[]).filter(p=>p.lat!=null&&inBox(p.lat,p.lon))
          .map((p,i)=>{const[x,y]=project(p.lat,p.lon);return `${i?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)}`}).join(' ');
        return path?`<path class="map-trail" d="${path}"/>`:''}).join('')}
      ${markers}
    </svg>
    <span class="fleet-map-hint">Drag to move · scroll or use +/− to zoom</span>
  </div>`;
}

function fleetRosterTable(aircraft){
  if(!aircraft.length)return '<div class="empty-state"><strong>No matching aircraft</strong></div>';
  return `<div class="fleet-table-wrap"><table class="queue-table fleet-table">
    <thead><tr><th>Tail</th><th>Aircraft</th><th>Operational status</th><th>Latest public activity</th><th>Evidence</th></tr></thead>
    <tbody>${aircraft.map(a=>`<tr class="${isFleetActive(a)?'':'fleet-historic'}">
      <td><a href="${esc(a.source_url||`https://www.flightaware.com/live/flight/${a.tail}`)}" target="_blank" rel="noopener"><strong>${esc(a.tail||'—')}</strong></a><small>${esc(a.callsign||'')}</small></td>
      <td>${esc(a.model||'—')}<small>${esc(a.aircraft_family||'')}</small></td>
      <td><span class="fleet-status ${a.live_now?'live':isFleetActive(a)?'active':'historic'}">${esc(fleetStatus(a))}</span><small>${isFleetActive(a)?'Flight evidence within 2 months':esc(a.status_note||'No flight evidence within 2 months')}</small></td>
      <td>${esc(localFleetTime(a.latest_activity_at))}<small>${a.last_arrival_airport?`Last arrival ${esc(a.last_arrival_airport)}`:'No confirmed arrival airport'}</small></td>
      <td>${a.source_url?`<a href="${esc(a.source_url)}" target="_blank" rel="noopener">Open FlightAware ↗</a>`:'No public flight link'}<small>${esc(a.position_source||a.status_source||a.roster_source||'Registry only')}</small></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderCompany(){
  const panel=$('[data-panel="company"]');if(!panel)return;
  const aircraft=fleetState.aircraft||[],coverage=fleetState.coverage||{};
  const active=aircraft.filter(isFleetActive),historical=aircraft.filter(a=>!isFleetActive(a));
  const shown=visibleFleet();
  const airborne=active.filter(a=>a.live_now&&!a.on_ground);
  const positioned=shown.filter(a=>a.lat!=null&&a.lon!=null);
  const provenance={source:coverage.source||'airplanes.live ADS-B',
    as_of:coverage.latest_fix_at?localFleetTime(coverage.latest_fix_at):'no fixes yet',
    basis:'measured'};
  const tile=(label,value,unit)=>figureTile({label,value,unit,precision:0,...provenance});

  panel.innerHTML=pageHead('Company Info','USA Jet fleet activity and last-known positions from public flight evidence.',
      coverage.latest_fix_at?`Last fix ${localFleetTime(coverage.latest_fix_at)}`:'')+`
    <div class="omni-figures">
      ${tile('Active fleet',active.length,'airframes')}
      ${tile('Airborne now',airborne.length,'aircraft')}
      ${tile('Historical / inactive',historical.length,'airframes')}
    </div>
    <article class="card fleet-card">
      <div class="card-head"><div><h3>${positioned.length?'Fleet position':'Fleet'}</h3>
        <p>USA Jet (JUS). The map fits the displayed fleet automatically; drag or zoom to inspect a cluster.</p></div>
        <div class="omni-head-meta">${confidenceChip('measured')}<span class="quiet">Public tracking, last known</span>
          <button type="button" class="action-button" id="fleet-refresh">Refresh positions</button></div></div>
      ${positioned.length?fleetMap():`<div class="fleet-quiet">
          <strong>No public position is available for the displayed fleet.</strong>
          <p>The roster remains available below. Active membership comes from flight evidence, not from whether an aircraft is transmitting at this moment.</p>
        </div>`}
      <p class="quiet fleet-caption">A marker is “airborne now” only when its ADS-B fix is less than 15 minutes old. Otherwise the map uses the latest confirmed FlightAware arrival. Times are formatted in this computer’s local time zone.</p>
    </article>
    <article class="card">
      <div class="card-head"><div><h3>Fleet roster</h3>
        <p>Active means at least one public flight observation in the preceding two months.</p></div>
        <label class="fleet-history-toggle"><input type="checkbox" id="fleet-show-history"${fleetShowHistoric?' checked':''}><span>Show historical tails</span><small>${historical.length} hidden</small></label></div>
      ${fleetRosterTable(shown.slice().sort((a,b)=>
        Number(b.live_now)-Number(a.live_now)||
        Number(b.active_recent)-Number(a.active_recent)||
        String(a.tail||'').localeCompare(String(b.tail||''))))}
    </article>`;
}

function bindFleetMapControls(){
  const history=$('#fleet-show-history');
  if(history)history.onchange=()=>{
    fleetShowHistoric=history.checked;fleetMapView=null;renderCompany();bindNavigation();
  };
  $$('[data-fleet-zoom]').forEach(button=>button.onclick=()=>zoomFleetMap(
    button.dataset.fleetZoom==='in'?.72:1.38
  ));
  const reset=$('[data-fleet-map-reset]');
  if(reset)reset.onclick=()=>setFleetMapView(fittedFleetView());
  const map=$('#fleet-map');if(!map)return;
  let drag=null;
  map.onpointerdown=event=>{
    if(event.button!==0)return;
    drag={x:event.clientX,y:event.clientY,view:{...(fleetMapView||fittedFleetView())}};
    map.setPointerCapture(event.pointerId);map.classList.add('dragging');
  };
  map.onpointermove=event=>{
    if(!drag)return;
    const rect=map.getBoundingClientRect();
    setFleetMapView({
      ...drag.view,
      x:drag.view.x-(event.clientX-drag.x)*drag.view.width/rect.width,
      y:drag.view.y-(event.clientY-drag.y)*drag.view.height/rect.height
    });
  };
  const finish=()=>{drag=null;map.classList.remove('dragging')};
  map.onpointerup=finish;map.onpointercancel=finish;
  map.addEventListener('wheel',event=>{
    event.preventDefault();
    const rect=map.getBoundingClientRect();
    zoomFleetMap(event.deltaY<0?.82:1.22,
      (event.clientX-rect.left)/rect.width,
      (event.clientY-rect.top)/rect.height);
  },{passive:false});
}

function renderOmniSystem(){
  const panel=$('[data-panel="omni-system"]');if(!panel)return;
  const runnerConnected=state?.control_plane?.local_runner==='connected';
  panel.innerHTML=pageHead(
    'OmniSupply system',
    'How a question becomes a sourced freight decision through the hosted control plane and local analysis runner.',
    'Question → analysis → durable answer'
  )+`
    <section class="omni-system-map" aria-label="OmniSupply question and response architecture">
      <div class="omni-system-status">
        <span><i class="online"></i>Supabase live</span>
        <span><i class="${runnerConnected?'online':'offline'}"></i>Local runner ${runnerConnected?'connected':'offline'}</span>
      </div>
      <div class="omni-architecture">
        <article class="omni-system-node website">
          <div class="omni-node-icon">Q</div>
          <small>Human interface</small>
          <h3>CS-Ventures.us</h3>
          <p>Carter asks a freight question, chooses the model and effort, and watches the run.</p>
          <span class="omni-node-chip">Authenticated dashboard</span>
        </article>
        <div class="omni-system-link request" aria-hidden="true">
          <span>1 · question</span><b>⇄</b><small>4 · answer</small>
        </div>
        <article class="omni-system-node database">
          <div class="omni-node-icon">D</div>
          <small>Durable coordination</small>
          <h3>Supabase</h3>
          <p>Stores the conversation, typed job, progress, evidence, failure state, and final answer.</p>
          <span class="omni-node-chip">Source of truth</span>
        </article>
        <div class="omni-system-link execution" aria-hidden="true">
          <span>2 · approved job</span><b>⇄</b><small>3 · steps + result</small>
        </div>
        <article class="omni-system-node runner">
          <div class="omni-node-icon">L</div>
          <small>Trusted execution</small>
          <h3>Local LLM runner</h3>
          <p>Claims work on demand, invokes the selected model, queries SCKG, and validates provenance.</p>
          <span class="omni-node-chip">${runnerConnected?'Ready for work':'Waiting for laptop'}</span>
        </article>
      </div>
      <div class="omni-process-strip" aria-label="Four system steps">
        <div><b>01</b><span><strong>Ask</strong>The website writes the question and model settings to Supabase.</span></div>
        <div><b>02</b><span><strong>Trigger</strong>The local runner claims the durable job when the laptop is available.</span></div>
        <div><b>03</b><span><strong>Analyze</strong>The model uses SCKG data and tools; live steps and issues stream back.</span></div>
        <div><b>04</b><span><strong>Publish</strong>A validated answer—or a visible failure—is stored and shown in chat.</span></div>
      </div>
      <div class="omni-boundary-note">
        <strong>Security boundary</strong>
        <span>The browser never commands the laptop directly. Supabase is the durable, auditable handoff in both directions.</span>
      </div>
    </section>

    <section class="omni-enrichment">
      <div class="omni-enrichment-head">
        <div><small>Model enrichment path</small><h3>From point-in-time answers to placement optimization</h3></div>
        <span>Proposed analytical layer</span>
      </div>
      <div class="omni-enrichment-flow">
        <article>
          <div class="omni-enrichment-number">1</div>
          <h4>Simulation environment</h4>
          <p>Replay operating choices across one day, one week, or one month.</p>
          <ul><li>Loaded and empty trips</li><li>Maintenance events</li><li>Weather and disruption events</li></ul>
        </article>
        <div class="omni-enrichment-arrow" aria-hidden="true">→</div>
        <article>
          <div class="omni-enrichment-number">2</div>
          <h4>History + economics</h4>
          <p>Blend peak-demand history with financial and operating constraints.</p>
          <ul><li>Client and supplier response</li><li>Positioning cost</li><li>Service and revenue tradeoffs</li></ul>
        </article>
        <div class="omni-enrichment-arrow" aria-hidden="true">→</div>
        <article class="outcome">
          <div class="omni-enrichment-number">3</div>
          <h4>Peak analysis</h4>
          <p>Recommend aircraft placement with measurable business impact.</p>
          <ul><li>Monthly reruns</li><li>Greater placement accuracy</li><li>Explicit ROI</li></ul>
        </article>
      </div>
    </section>

    <section class="omni-film">
      <div class="omni-film-head">
        <div><small>Walkthrough</small><h3>Seventy-two seconds, end to end</h3>
          <p>Every screen in the film is a capture of this app rendering live data. The figures,
             the fleet positions and the graph counts are read off the running system.</p></div>
        <span>72 seconds &middot; no sound required</span>
      </div>
      <video class="omni-film-video" src="/media/sckg-omnisupply-film.mp4"
             poster="/media/sckg-omnisupply-film-poster.jpg" controls playsinline preload="none"
             aria-label="A seventy-two second film of OmniSupply: asking a disruption question in chat, generating a report, reviewing the USA Jet fleet on the map, the knowledge graph and its provenance rules, running a placement simulation, and the resulting positioning recommendation."></video>
      <p class="omni-film-note">The placement simulator is the product's synthetic sandbox and is
         labelled as such on screen. Everything else is measured or derived public data.</p>
    </section>`;
}

/* ── Placement Simulations ────────────────────────────────────────────
   This is deliberately a browser-only UX sandbox. It does not read fleet,
   lane, weather, revenue, cost, or maintenance data, and it does not write a
   result to Supabase. The fake loop gives the future backend a stable visual
   contract without letting synthetic activity leak into the sourced product. */
const SIM_DEMO_ONLY=true;
const SIM_NODES=[
  {iata:'YIP',name:'Willow Run',lat:42.2408,lon:-83.5304},
  {iata:'LRD',name:'Laredo',lat:27.5438,lon:-99.4616},
  {iata:'ELP',name:'El Paso',lat:31.8072,lon:-106.3781},
  {iata:'SDF',name:'Louisville',lat:38.1744,lon:-85.7360},
  {iata:'MCI',name:'Kansas City',lat:39.2976,lon:-94.7139},
  {iata:'GSP',name:'Greenville–Spartanburg',lat:34.8957,lon:-82.2189},
  {iata:'GSO',name:'Piedmont Triad',lat:36.0978,lon:-79.9373},
  {iata:'AFW',name:'Fort Worth Alliance',lat:32.9876,lon:-97.3188},
  {iata:'IND',name:'Indianapolis',lat:39.7173,lon:-86.2944},
  {iata:'IAG',name:'Niagara Falls',lat:43.1073,lon:-78.9462},
  {iata:'CLE',name:'Cleveland',lat:41.4117,lon:-81.8498},
  {iata:'MQY',name:'Smyrna',lat:36.0089,lon:-86.5201},
];
const SIM_TAILS=[
  {id:'DEMO-01',type:'Falcon 20',start:'YIP'},
  {id:'DEMO-02',type:'Falcon 20',start:'LRD'},
  {id:'DEMO-03',type:'MD-83',start:'YIP'},
  {id:'DEMO-04',type:'MD-88',start:'LRD'},
  {id:'DEMO-05',type:'MD-88',start:'SDF'},
  {id:'DEMO-06',type:'Boeing 727',start:'MCI'},
];
const SIM_NODE_MAP=new Map(SIM_NODES.map(node=>[node.iata,node]));
const SIM_ROUTE=['YIP','LRD','ELP','SDF','MCI','GSP','GSO','AFW','IND','IAG','CLE','MQY'];
const SIM_HOURS={day:24,week:168,month:720};
const SIM_FRAMES={day:36,week:72,month:108};
let simMapView=null,simTimer=null;
let simState={
  status:'ready',frame:0,events:[],
  config:{
    horizon:'week',runs:100,trips:8,zeroChance:15,strategy:'yip',
    weather:true,maintenance:true,speed:2,
    enabled:Object.fromEntries(SIM_TAILS.map(tail=>[tail.id,true])),
    custom:Object.fromEntries(SIM_TAILS.map(tail=>[tail.id,tail.start])),
  }
};

function simStrategyLabel(value=simState.config.strategy){
  return {random:'Random placement',lrd:'LRD focused',yip:'YIP focused',custom:'Custom by aircraft'}[value]||value;
}
function simResetState(){
  if(simTimer)clearInterval(simTimer);simTimer=null;
  simState.status='ready';simState.frame=0;
  simState.events=[{frame:0,kind:'system',text:'Synthetic scenario ready. No operational data loaded.'}];
}
function simRouteFor(index){
  const strategy=simState.config.strategy,tail=SIM_TAILS[index];
  if(strategy==='lrd'||strategy==='yip'){
    const hub=strategy.toUpperCase();
    const destinations=SIM_ROUTE.filter(code=>code!==hub);
    const rotated=destinations.slice(index).concat(destinations.slice(0,index));
    return rotated.slice(0,5).flatMap(code=>[hub,code]).concat(hub);
  }
  const start=strategy==='custom'?(simState.config.custom[tail.id]||tail.start):SIM_ROUTE[index%SIM_ROUTE.length];
  const remaining=SIM_ROUTE.filter(code=>code!==start);
  const shift=(index*2)%remaining.length;
  return [start,...remaining.slice(shift),...remaining.slice(0,shift),start];
}
function simTailSnapshot(frame,index){
  const tail=SIM_TAILS[index],route=simRouteFor(index),legFrames=7;
  const shifted=Math.max(0,frame+index*2),leg=Math.floor(shifted/legFrames);
  const phase=(shifted%legFrames)/legFrames;
  const from=route[leg%route.length],to=route[(leg+1)%route.length];
  const a=SIM_NODE_MAP.get(from),b=SIM_NODE_MAP.get(to);
  const weather=simState.config.weather&&((frame+index*11)%61>=56);
  const maintenance=simState.config.maintenance&&((frame+index*17)%83>=78);
  let state,progress;
  if(maintenance){state='MAINTENANCE';progress=0}
  else if(weather){state='WEATHER HOLD';progress=0}
  else if(phase<.7){state=leg%3===1?'DEADHEAD':'LOADED';progress=phase/.7}
  else if(phase<.88){state='TURNAROUND';progress=1}
  else{state='AVAILABLE';progress=1}
  const eased=progress*progress*(3-2*progress);
  const lat=maintenance||weather?a.lat:a.lat+(b.lat-a.lat)*eased;
  const lon=maintenance||weather?a.lon:a.lon+(b.lon-a.lon)*eased;
  const[x,y]=project(lat,lon);
  const[ax,ay]=project(a.lat,a.lon),[bx,by]=project(b.lat,b.lon);
  const heading=Math.atan2(by-ay,bx-ax)*180/Math.PI+90;
  return{...tail,state,from,to,x,y,ax,ay,bx,by,heading};
}
function simEnabledTails(){
  return SIM_TAILS.map((tail,index)=>({tail,index})).filter(({tail})=>simState.config.enabled[tail.id]);
}
function simMetrics(){
  const total=SIM_FRAMES[simState.config.horizon],progress=total?simState.frame/total:0;
  const days=SIM_HOURS[simState.config.horizon]/24;
  const opportunities=Math.round(progress*days*simState.config.trips);
  const policy={random:0,lrd:.03,yip:.07,custom:.05}[simState.config.strategy]||0;
  const disruption=(simState.config.weather?.04:0)+(simState.config.maintenance?.025:0);
  const served=Math.max(0,Math.min(opportunities,Math.round(opportunities*(.77+policy-disruption))));
  const passed=Math.max(0,opportunities-served);
  const empty=Math.max(8,Math.round(({random:18,lrd:34,yip:31,custom:23}[simState.config.strategy]||22)+(progress*5)));
  const utilization=Math.min(96,Math.round(18+progress*61+policy*50));
  const revenue=served?Math.round(49+progress*24+policy*80):0;
  const cost=served?Math.round(40+progress*13+empty*.18):0;
  return{progress,opportunities,served,passed,empty,utilization,revenue,cost,margin:revenue-cost};
}
function simClock(){
  const metrics=simMetrics(),hours=Math.round(metrics.progress*SIM_HOURS[simState.config.horizon]);
  const day=Math.floor(hours/24)+1,hour=hours%24;
  return `Day ${day} · ${String(hour).padStart(2,'0')}:00`;
}
function simStatusLabel(){
  return {ready:'Ready to run',running:'Simulation running',paused:'Stopped',complete:'Run complete'}[simState.status];
}
function simStatusClass(){return simState.status==='complete'?'complete':simState.status}
function simLandMarkup(){
  return Object.values(STATE_RINGS).flat().map(ring=>{
    const d=ring.map((point,index)=>{const[x,y]=project(point[1],point[0]);
      return `${index?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)}`}).join('')+'Z';
    return `<path class="map-land" d="${d}"/>`;
  }).join('');
}
function fittedSimView(){
  const points=SIM_NODES.map(node=>project(node.lat,node.lon));
  const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
  let width=Math.max(...xs)-Math.min(...xs)+180,height=Math.max(...ys)-Math.min(...ys)+130;
  const aspect=1.85;if(width/height>aspect)height=width/aspect;else width=height*aspect;
  return clampFleetView({x:(Math.min(...xs)+Math.max(...xs)-width)/2,
    y:(Math.min(...ys)+Math.max(...ys)-height)/2,width,height});
}
function setSimMapView(view){
  simMapView=clampFleetView(view);
  const map=$('#sim-map');if(map)map.setAttribute('viewBox',`${simMapView.x} ${simMapView.y} ${simMapView.width} ${simMapView.height}`);
}
function zoomSimMap(factor,anchorX=.5,anchorY=.5){
  const view=simMapView||fittedSimView(),width=view.width*factor,height=view.height*factor;
  setSimMapView({x:view.x+(view.width-width)*anchorX,y:view.y+(view.height-height)*anchorY,width,height});
}
function simMapMarkup(){
  if(!simMapView)simMapView=fittedSimView();
  const tails=simEnabledTails();
  return `<div class="sim-map-shell">
    <div class="fleet-map-controls" aria-label="Simulation map controls">
      <button type="button" data-sim-zoom="in" aria-label="Zoom in">＋</button>
      <button type="button" data-sim-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" data-sim-map-reset>Fit network</button>
    </div>
    <div class="sim-map-clock"><span id="sim-clock">${esc(simClock())}</span><strong id="sim-run-number">Run 1 of ${number(simState.config.runs)}</strong></div>
    <svg class="fleet-map sim-map" id="sim-map" viewBox="${simMapView.x} ${simMapView.y} ${simMapView.width} ${simMapView.height}" role="img" aria-label="Synthetic aircraft placement replay">
      <rect width="${MAP_W}" height="${MAP_H}" class="map-sea"/>
      ${simLandMarkup()}
      <g class="sim-route-layer">${tails.map(({tail})=>`<line data-sim-leg="${esc(tail.id)}" class="sim-active-leg"/>`).join('')}</g>
      ${SIM_NODES.map(node=>{const[x,y]=project(node.lat,node.lon);return `<g class="sim-airport">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/><text x="${(x+9).toFixed(1)}" y="${(y-7).toFixed(1)}">${esc(node.iata)}</text>
        <title>${esc(`${node.iata} · ${node.name} · synthetic network node`)}</title></g>`}).join('')}
      ${tails.map(({tail,index})=>{const snapshot=simTailSnapshot(simState.frame,index);return `
        <g class="sim-aircraft" data-sim-tail="${esc(tail.id)}" transform="translate(${snapshot.x.toFixed(1)} ${snapshot.y.toFixed(1)})">
          <title>${esc(`${tail.id} · synthetic demo aircraft`)}</title>
          <g data-sim-plane="${esc(tail.id)}" transform="rotate(${snapshot.heading.toFixed(0)})"><path d="M0 -8 L5 7 L0 4 L-5 7 Z"/></g>
          <text x="9" y="-8">${esc(tail.id)}</text>
        </g>`}).join('')}
    </svg>
    <span class="fleet-map-hint">Drag to move · scroll or use +/− to zoom</span>
  </div>`;
}
function simEventMarkup(){
  return simState.events.slice().reverse().map((event,index)=>`<div class="sim-event ${esc(event.kind)}${index===0?' latest':''}">
    <span>${event.kind==='weather'?'◌':event.kind==='maintenance'?'◇':event.kind==='served'?'↗':event.kind==='deadhead'?'↘':'·'}</span>
    <div><strong>${esc(event.text)}</strong><small>${esc(simFrameTime(event.frame))}</small></div>
  </div>`).join('');
}
function simFrameTime(frame){
  const total=SIM_FRAMES[simState.config.horizon],hours=Math.round((frame/total)*SIM_HOURS[simState.config.horizon]);
  return `Day ${Math.floor(hours/24)+1}, ${String(hours%24).padStart(2,'0')}:00`;
}
function simComparisonMarkup(){
  const rows=[
    {id:'random',score:61,served:72,empty:18},
    {id:'lrd',score:67,served:77,empty:34},
    {id:'yip',score:74,served:82,empty:31},
    {id:'custom',score:70,served:80,empty:23},
  ];
  return rows.map(row=>`<div class="sim-compare-row${row.id===simState.config.strategy?' selected':''}">
    <div><strong>${esc(simStrategyLabel(row.id))}</strong><span>${row.served}% served · ${row.empty}% empty leg</span></div>
    <div class="sim-score-track"><i style="width:${row.score}%"></i></div><b>${row.score}</b>
  </div>`).join('');
}
function simFleetMarkup(){
  const custom=simState.config.strategy==='custom';
  return `<div class="sim-fleet-list">${SIM_TAILS.map(tail=>`<div class="sim-fleet-row">
    <label><input type="checkbox" data-sim-tail-enabled="${esc(tail.id)}"${simState.config.enabled[tail.id]?' checked':''}><span><strong>${esc(tail.id)}</strong><small>${esc(tail.type)} · placeholder</small></span></label>
    <select data-sim-tail-start="${esc(tail.id)}"${custom?'':' disabled'} aria-label="Starting airport for ${esc(tail.id)}">
      ${SIM_NODES.map(node=>`<option value="${esc(node.iata)}"${simState.config.custom[tail.id]===node.iata?' selected':''}>${esc(node.iata)}</option>`).join('')}
    </select>
  </div>`).join('')}</div>`;
}
function renderSimulations(){
  const panel=$('[data-panel="simulations"]');if(!panel)return;
  const config=simState.config,metrics=simMetrics();
  panel.innerHTML=pageHead('Placement Simulations','Configure and replay a synthetic aircraft-placement scenario before the operating model is connected.','Front-end sandbox · nothing is saved')+`
    <div class="sim-demo-banner">
      <span>DEMO</span><div><strong>Synthetic UI sandbox</strong><p>Placeholder aircraft, routes, events, and index scores. No live fleet, lane, weather, maintenance, revenue, cost, or Supabase data is used.</p></div>
    </div>
    <article class="card sim-config-card">
      <div class="card-head"><div><p class="sim-eyebrow">BUILD A SCENARIO</p><h3>Simulation setup</h3>
        <p>Choose the controls the future engine will receive. Changes reset the current replay.</p></div>
        <span class="sim-status ${simStatusClass()}" id="sim-status"><i></i>${esc(simStatusLabel())}</span></div>
      <div class="sim-settings-grid">
        <fieldset class="sim-field"><legend>Horizon</legend><div class="sim-segmented">
          ${['day','week','month'].map(value=>`<button type="button" data-sim-horizon="${value}" class="${config.horizon===value?'active':''}">${value[0].toUpperCase()+value.slice(1)}</button>`).join('')}
        </div></fieldset>
        <label class="sim-field"><span>Simulation runs</span><select id="sim-runs" data-sim-config>
          ${[25,100,500].map(value=>`<option value="${value}"${config.runs===value?' selected':''}>${value} ${value===25?'· quick':value===100?'· standard':'· deep'}</option>`).join('')}
        </select></label>
        <label class="sim-field sim-range"><span>Trips per day <output id="sim-trip-value">${config.trips}</output></span>
          <input id="sim-trips" data-sim-config type="range" min="0" max="20" value="${config.trips}"><small>Synthetic · hard cap 20</small></label>
        <label class="sim-field sim-range"><span>Zero-trip chance <output id="sim-zero-value">${config.zeroChance}%</output></span>
          <input id="sim-zero" data-sim-config type="range" min="0" max="60" step="5" value="${config.zeroChance}"><small>Synthetic daily probability</small></label>
      </div>
      <fieldset class="sim-strategy"><legend>Placement strategy</legend><div class="sim-strategy-grid">
        ${[
          ['random','Random placement','Scatter aircraft across the demo network.'],
          ['lrd','LRD focused','Return available aircraft toward Laredo.'],
          ['yip','YIP focused','Return available aircraft toward Willow Run.'],
          ['custom','Custom by aircraft','Choose a starting airport for each tail.'],
        ].map(([id,title,detail])=>`<button type="button" data-sim-strategy="${id}" class="${config.strategy===id?'active':''}" aria-pressed="${config.strategy===id}">
          <i></i><strong>${title}</strong><span>${detail}</span></button>`).join('')}
      </div></fieldset>
      <div class="sim-config-lower">
        <div><div class="sim-section-label"><strong>Demo fleet</strong><span>${simEnabledTails().length} of ${SIM_TAILS.length} enabled</span></div>${simFleetMarkup()}</div>
        <div><div class="sim-section-label"><strong>Synthetic disruptions</strong><span>UI behavior only</span></div>
          <label class="sim-switch"><input id="sim-weather" data-sim-config type="checkbox"${config.weather?' checked':''}><span><i></i><strong>Routine weather</strong><small>Occasional demo holds and cancellations</small></span></label>
          <label class="sim-switch"><input id="sim-maintenance" data-sim-config type="checkbox"${config.maintenance?' checked':''}><span><i></i><strong>Rare maintenance</strong><small>Temporary placeholder aircraft downtime</small></span></label>
          <div class="sim-assumption-note"><strong>What is frozen for this demo</strong><p>The airport sequence, event timing, service decisions, and economics indexes are deterministic presentation fixtures.</p></div>
        </div>
      </div>
    </article>
    <article class="card sim-results-card">
      <div class="sim-run-head"><div><p class="sim-eyebrow">LIVE REPLAY</p><h3>${esc(simStrategyLabel())}</h3><p>YIP → LRD → ELP → SDF → MCI → GSP → GSO and the wider placeholder network.</p></div>
        <div class="sim-run-actions">
          <label>Playback<select id="sim-speed"><option value="1"${config.speed===1?' selected':''}>1×</option><option value="2"${config.speed===2?' selected':''}>2×</option><option value="4"${config.speed===4?' selected':''}>4×</option></select></label>
          <button type="button" class="sim-button primary" id="sim-start">${simState.status==='complete'?'Run again':'Run simulation'}</button>
          <button type="button" class="sim-button" id="sim-pause"${simState.status==='ready'||simState.status==='complete'?' disabled':''}>${simState.status==='paused'?'Resume':'Stop'}</button>
          <button type="button" class="sim-button quiet-button" id="sim-reset">Reset</button>
        </div></div>
      <div class="sim-kpis">
        ${[
          ['Served','sim-served',metrics.served,'trips'],
          ['Passed','sim-passed',metrics.passed,'trips'],
          ['Empty leg','sim-empty',metrics.empty,'%'],
          ['Utilization','sim-utilization',metrics.utilization,'%'],
          ['Revenue index','sim-revenue',metrics.revenue,'demo'],
          ['Operating index','sim-cost',metrics.cost,'demo'],
          ['Margin index','sim-margin',metrics.margin,'demo'],
        ].map(([label,id,value,unit])=>`<div><small>${label}</small><strong id="${id}">${value}</strong><span>${unit}</span></div>`).join('')}
      </div>
      <div class="sim-replay-grid">
        <div>${simMapMarkup()}
          <div class="sim-timeline"><div class="sim-progress"><i id="sim-progress" style="width:${(metrics.progress*100).toFixed(1)}%"></i></div>
            <input id="sim-scrub" type="range" min="0" max="${SIM_FRAMES[config.horizon]}" value="${simState.frame}" aria-label="Simulation replay position">
            <div><span>Start</span><strong id="sim-timeline-label">${esc(simClock())}</strong><span>${config.horizon==='day'?'24 hours':config.horizon==='week'?'7 days':'30 days'}</span></div>
          </div>
        </div>
        <aside class="sim-live-panel"><div class="sim-live-head"><div><strong>Event stream</strong><span>Most recent first</span></div><i class="${simState.status==='running'?'live':''}"></i></div>
          <div class="sim-events" id="sim-events">${simEventMarkup()}</div>
          <div class="sim-tail-status"><strong>Aircraft state</strong>
            ${simEnabledTails().map(({tail,index})=>{const snapshot=simTailSnapshot(simState.frame,index);return `<div><span><i class="${snapshot.state.toLowerCase().replace(' ','-')}"></i>${esc(tail.id)}</span><b data-sim-tail-state="${esc(tail.id)}">${esc(snapshot.state)}</b></div>`}).join('')}
          </div>
        </aside>
      </div>
    </article>
    <div class="sim-analysis-grid">
      <article class="card"><div class="card-head"><div><h3>Strategy comparison</h3><p>Static demo scores show how a backend comparison will read.</p></div><span class="confidence-chip confidence-scenario">Scenario only</span></div>
        <div class="sim-comparison">${simComparisonMarkup()}</div><p class="quiet sim-caption">All values are presentation fixtures, not operational findings.</p></article>
      <article class="card"><div class="card-head"><div><h3>Result contract</h3><p>What the real engine will eventually replace.</p></div></div>
        <dl class="sim-contract"><div><dt>Inputs</dt><dd>Frozen fleet, strategy, horizon, assumptions, and seeds</dd></div>
          <div><dt>Outputs</dt><dd>Served, passed, utilization, empty legs, index margin, and replay</dd></div>
          <div><dt>Comparison</dt><dd>Median and P10–P90 range over identical event tapes</dd></div>
          <div><dt>Persistence</dt><dd>Not connected in this sandbox</dd></div></dl></article>
    </div>`;
  simUpdateDynamic();
}
function simAddEvent(frame){
  const enabled=simEnabledTails();if(!enabled.length)return;
  const entry=enabled[(Math.floor(frame/4)-1)%enabled.length],snapshot=simTailSnapshot(frame,entry.index);
  let kind='served',text=`${entry.tail.id} accepted synthetic ${snapshot.from} → ${snapshot.to} trip`;
  if(snapshot.state==='MAINTENANCE'){kind='maintenance';text=`${entry.tail.id} entered a synthetic maintenance hold`}
  else if(snapshot.state==='WEATHER HOLD'){kind='weather';text=`Synthetic weather hold applied at ${snapshot.from}`}
  else if(snapshot.state==='DEADHEAD'){kind='deadhead';text=`${entry.tail.id} repositioning empty ${snapshot.from} → ${snapshot.to}`}
  simState.events.push({frame,kind,text});
  if(simState.events.length>24)simState.events.shift();
}
function simUpdateDynamic(){
  const panel=$('[data-panel="simulations"]');if(!panel)return;
  const total=SIM_FRAMES[simState.config.horizon],metrics=simMetrics();
  const put=(selector,value)=>{const el=$(selector,panel);if(el)el.textContent=value};
  put('#sim-served',metrics.served);put('#sim-passed',metrics.passed);put('#sim-empty',metrics.empty);
  put('#sim-utilization',metrics.utilization);put('#sim-revenue',metrics.revenue);put('#sim-cost',metrics.cost);put('#sim-margin',metrics.margin);
  put('#sim-clock',simClock());put('#sim-timeline-label',simClock());
  put('#sim-run-number',`Run ${Math.min(simState.config.runs,Math.floor(metrics.progress*simState.config.runs)+1)} of ${number(simState.config.runs)}`);
  const status=$('#sim-status',panel);if(status){status.className=`sim-status ${simStatusClass()}`;status.innerHTML=`<i></i>${esc(simStatusLabel())}`}
  const progress=$('#sim-progress',panel);if(progress)progress.style.width=`${metrics.progress*100}%`;
  const scrub=$('#sim-scrub',panel);if(scrub){scrub.max=total;scrub.value=simState.frame}
  simEnabledTails().forEach(({tail,index})=>{
    const snapshot=simTailSnapshot(simState.frame,index),marker=$(`[data-sim-tail="${tail.id}"]`,panel);
    if(marker){marker.setAttribute('transform',`translate(${snapshot.x.toFixed(1)} ${snapshot.y.toFixed(1)})`);
      marker.className.baseVal=`sim-aircraft ${snapshot.state.toLowerCase().replace(' ','-')}`}
    const plane=$(`[data-sim-plane="${tail.id}"]`,panel);if(plane)plane.setAttribute('transform',`rotate(${snapshot.heading.toFixed(0)})`);
    const leg=$(`[data-sim-leg="${tail.id}"]`,panel);if(leg){leg.setAttribute('x1',snapshot.ax);leg.setAttribute('y1',snapshot.ay);leg.setAttribute('x2',snapshot.bx);leg.setAttribute('y2',snapshot.by)}
    put(`[data-sim-tail-state="${tail.id}"]`,snapshot.state);
  });
  const events=$('#sim-events',panel);if(events)events.innerHTML=simEventMarkup();
  const start=$('#sim-start',panel),pause=$('#sim-pause',panel);
  if(start){start.disabled=simState.status==='running';start.textContent=simState.status==='complete'?'Run again':simState.status==='running'?'Simulation running':'Run simulation'}
  if(pause){pause.disabled=simState.status==='ready'||simState.status==='complete';pause.textContent=simState.status==='paused'?'Resume':'Stop'}
  $$('[data-sim-config], [data-sim-horizon], [data-sim-strategy], [data-sim-tail-enabled], [data-sim-tail-start]',panel)
    .forEach(control=>control.disabled=simState.status==='running'||(control.matches('[data-sim-tail-start]')&&simState.config.strategy!=='custom'));
}
function simTick(){
  const total=SIM_FRAMES[simState.config.horizon];
  simState.frame=Math.min(total,simState.frame+1);
  if(simState.frame%4===0)simAddEvent(simState.frame);
  if(simState.frame>=total){
    if(simTimer)clearInterval(simTimer);simTimer=null;simState.status='complete';
    simState.events.push({frame:simState.frame,kind:'system',text:`Synthetic ${simStrategyLabel()} comparison complete`});
  }
  simUpdateDynamic();
}
function simStart(){
  if(simState.status==='complete')simResetState();
  if(!simEnabledTails().length)return;
  if(simTimer)clearInterval(simTimer);
  simState.status='running';
  if(!simState.events.length)simState.events.push({frame:simState.frame,kind:'system',text:'Synthetic scenario started'});
  else simState.events.push({frame:simState.frame,kind:'system',text:simState.frame?'Synthetic scenario resumed':'Synthetic scenario started'});
  simTimer=setInterval(simTick,Math.max(120,760/simState.config.speed));
  simUpdateDynamic();
}
function simPause(){
  if(simState.status==='paused'){simStart();return}
  if(simState.status!=='running')return;
  if(simTimer)clearInterval(simTimer);simTimer=null;simState.status='paused';
  simState.events.push({frame:simState.frame,kind:'system',text:'Replay stopped by user'});
  simUpdateDynamic();
}
function simConfigChanged(){
  simResetState();simMapView=null;renderSimulations();bindNavigation();
}
function bindSimulationMap(){
  $$('[data-sim-zoom]').forEach(button=>button.onclick=()=>zoomSimMap(button.dataset.simZoom==='in'?.72:1.38));
  const reset=$('[data-sim-map-reset]');if(reset)reset.onclick=()=>setSimMapView(fittedSimView());
  const map=$('#sim-map');if(!map)return;
  let drag=null;
  map.onpointerdown=event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,view:{...(simMapView||fittedSimView())}};
    map.setPointerCapture(event.pointerId);map.classList.add('dragging')};
  map.onpointermove=event=>{if(!drag)return;const rect=map.getBoundingClientRect();setSimMapView({...drag.view,
    x:drag.view.x-(event.clientX-drag.x)*drag.view.width/rect.width,
    y:drag.view.y-(event.clientY-drag.y)*drag.view.height/rect.height})};
  const finish=()=>{drag=null;map.classList.remove('dragging')};map.onpointerup=finish;map.onpointercancel=finish;
  map.addEventListener('wheel',event=>{event.preventDefault();const rect=map.getBoundingClientRect();
    zoomSimMap(event.deltaY<0?.82:1.22,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height)},{passive:false});
}
function bindSimulationControls(){
  const panel=$('[data-panel="simulations"]');if(!panel)return;
  $$('[data-sim-horizon]',panel).forEach(button=>button.onclick=()=>{simState.config.horizon=button.dataset.simHorizon;simConfigChanged()});
  $$('[data-sim-strategy]',panel).forEach(button=>button.onclick=()=>{simState.config.strategy=button.dataset.simStrategy;simConfigChanged()});
  const runs=$('#sim-runs',panel);if(runs)runs.onchange=()=>{simState.config.runs=Number(runs.value);simConfigChanged()};
  const trips=$('#sim-trips',panel);if(trips)trips.oninput=()=>{simState.config.trips=Number(trips.value);putSimRange('#sim-trip-value',trips.value)};
  if(trips)trips.onchange=simConfigChanged;
  const zero=$('#sim-zero',panel);if(zero)zero.oninput=()=>{simState.config.zeroChance=Number(zero.value);putSimRange('#sim-zero-value',`${zero.value}%`)};
  if(zero)zero.onchange=simConfigChanged;
  const weather=$('#sim-weather',panel);if(weather)weather.onchange=()=>{simState.config.weather=weather.checked;simConfigChanged()};
  const maintenance=$('#sim-maintenance',panel);if(maintenance)maintenance.onchange=()=>{simState.config.maintenance=maintenance.checked;simConfigChanged()};
  $$('[data-sim-tail-enabled]',panel).forEach(input=>input.onchange=()=>{simState.config.enabled[input.dataset.simTailEnabled]=input.checked;simConfigChanged()});
  $$('[data-sim-tail-start]',panel).forEach(select=>select.onchange=()=>{simState.config.custom[select.dataset.simTailStart]=select.value;simConfigChanged()});
  const speed=$('#sim-speed',panel);if(speed)speed.onchange=()=>{simState.config.speed=Number(speed.value);if(simState.status==='running')simStart()};
  const start=$('#sim-start',panel);if(start)start.onclick=simStart;
  const pause=$('#sim-pause',panel);if(pause)pause.onclick=simPause;
  const reset=$('#sim-reset',panel);if(reset)reset.onclick=()=>{simResetState();renderSimulations();bindNavigation()};
  const scrub=$('#sim-scrub',panel);if(scrub)scrub.oninput=()=>{if(simState.status==='running')simPause();
    simState.frame=Number(scrub.value);simState.status=simState.frame?simState.frame>=Number(scrub.max)?'complete':'paused':'ready';simUpdateDynamic()};
  bindSimulationMap();
}
function putSimRange(selector,value){const output=$(selector);if(output)output.textContent=value}

function renderOmnisupply(){renderChats();renderReports();renderCompany();renderSimulations();renderOmniSystem()}
function syncChatComposer(){
  const composer=$('#chat-composer'),box=$('#chat-input'),submit=$('#chat-submit');
  if(!composer||!box||!submit)return;
  const hasText=Boolean(box.value.trim());
  composer.classList.toggle('has-text',hasText);
  submit.disabled=!hasText||chatSending;
  submit.setAttribute('aria-hidden',String(!hasText));
}
function bindChatConversationControls(scope=document){
  $$('[data-conversation]',scope).forEach(el=>el.onclick=()=>openConversation(el.dataset.conversation));
  $$('[data-chat-archive]',scope).forEach(button=>button.onclick=()=>setChatArchived(
    button.dataset.chatArchive,button.dataset.archived==='true',button
  ));
  $$('[data-chat-delete]',scope).forEach(button=>button.onclick=()=>deleteChatConversation(
    button.dataset.chatDelete,button
  ));
  $$('[data-chat-report]',scope).forEach(button=>button.onclick=()=>generateConversationReport(
    button.dataset.chatReport,button
  ));
}
function bindNavigation(){
  $$('[data-app-link]').forEach(button=>button.onclick=()=>selectApp(button.dataset.appLink));
  $$('[data-omni-answer]').forEach(el=>el.onclick=()=>openOmniDrill(el.dataset.omniAnswer));
  bindChatConversationControls();
  $$('[data-ask]').forEach(el=>el.onclick=()=>sendChat(el.dataset.ask));
  $$('[data-report]').forEach(el=>el.onclick=()=>{openReportId=el.dataset.report;renderReports();bindNavigation()});
  const chatNew=$('#chat-new');
  if(chatNew)chatNew.onclick=()=>{stopChatPoll();chatThread=null;chatSending=false;chatView='active';chatSearch='';chatNotice=null;renderChats();bindNavigation()};
  const chatSearchInput=$('#chat-search');
  if(chatSearchInput)chatSearchInput.oninput=()=>{
    chatSearch=chatSearchInput.value;
    const results=$('#chat-list-results');if(!results)return;
    results.innerHTML=conversationList();
    bindChatConversationControls(results);
  };
  $$('[data-chat-view]').forEach(button=>button.onclick=()=>{
    if(chatView===button.dataset.chatView)return;
    chatView=button.dataset.chatView;chatSearch='';renderChats();bindNavigation();
  });
  const chatNoticeClose=$('#chat-notice-close');
  if(chatNoticeClose)chatNoticeClose.onclick=()=>{chatNotice=null;renderChats();bindNavigation()};
  const reportBack=$('#report-back');
  if(reportBack)reportBack.onclick=()=>{openReportId=null;renderReports();bindNavigation()};
  const thinkToggle=$('#think-toggle');
  if(thinkToggle)thinkToggle.onclick=()=>setThinkOpen(!thinkOpen);
  const composer=$('#chat-composer');
  const model=$('#chat-model'),effort=$('#chat-effort');
  if(model)model.onchange=()=>{chatModel=model.value};
  if(effort)effort.onchange=()=>{chatEffort=effort.value};
  const fleetRefresh=$('#fleet-refresh');
  if(fleetRefresh)fleetRefresh.onclick=async()=>{
    fleetRefresh.disabled=true;fleetRefresh.textContent='Refreshing…';
    await refreshFleetOnView();
  };
  bindFleetMapControls();
  bindSimulationControls();
  if(composer){
    composer.onsubmit=event=>{event.preventDefault();const box=$('#chat-input');const text=box.value;box.value='';sendChat(text)};
    const box=$('#chat-input');
    // Enter sends, Shift+Enter newlines -- the convention every chat UI uses,
    // and the one people type without thinking about it.
    if(box)box.onkeydown=event=>{
      if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();composer.requestSubmit()}
    };
    if(box)box.oninput=syncChatComposer;
    syncChatComposer();
  }
  $$('[data-tab]').forEach(button=>button.onclick=()=>activate(button.dataset.tab));
  $$('[data-go]').forEach(button=>button.onclick=()=>activate(button.dataset.go));
  $$('[data-approval]').forEach(button=>button.onclick=()=>decideApproval(button.dataset.approval,button.dataset.decision==='true',button.closest('.approval-row')?.querySelector('[data-start-provider]')?.value||'claude'));
  $$('[data-release-work]').forEach(button=>button.onclick=event=>{event.stopPropagation();approveRelease(button.dataset.releaseWork,button.dataset.releaseTitle,button)});
  $$('[data-rec]').forEach(button=>button.onclick=()=>decideRecommendation(button.dataset.rec,button.dataset.recAction));
  $$('[data-provider]').forEach(el=>el.onclick=()=>drillProvider(el.dataset.provider));
  $$('[data-model]').forEach(el=>el.onclick=()=>drillModel(el.dataset.modelProvider,el.dataset.model));
  $$('[data-project]').forEach(el=>el.onclick=()=>drillProject(el.dataset.project));
  $$('[data-week]').forEach(el=>el.onclick=()=>drillWeek(el.dataset.week));
  $$('[data-metric]').forEach(el=>el.onclick=()=>drillMetric(el.dataset.metric));
  $$('[data-run]').forEach(el=>el.onclick=()=>openRunView(el.dataset.run,el.dataset.runTitle));
  bindClientCards();
  $$('[data-client-filter]').forEach(control=>control.oninput=()=>{clientView[control.dataset.clientFilter]=control.value;renderClientResults()});
  $$('[data-agent]').forEach(el=>el.onclick=()=>openAgentDrill(el.dataset.agent));
  $$('[data-mode]').forEach(el=>el.onclick=()=>{usageMode=el.dataset.mode;renderUsage();bindNavigation()});
  $$('[data-drill]').forEach(el=>el.onclick=()=>{const d=el.dataset.drill;if(d==='cost')drillCost();else if(d==='tokens')drillTokens();else if(d==='work-tab')activate('work');else if(d==='approvals-tab')activate('approvals')});
  bindOfficeForms($('[data-panel="clients"]'));
  bindOfficeForms($('[data-panel="finances"]'));
  bindCalendarControls();
  $('#drill-backdrop').onclick=closeDrill;
}
/* The routing table and the markup are two lists of the same names, kept in
   sync by hand. When they drift, activate() finds no panel and the app renders
   a blank page with working tabs -- a failure that looks like a data problem
   and is not. This turns that into a console error naming both sides. */
function assertTabsMatchMarkup(){
  const routed=new Set(Object.values(APP_TABS).flat());
  const panels=new Set($$('[data-panel]').map(el=>el.dataset.panel));
  const buttons=new Set($$('[data-tab]').map(el=>el.dataset.tab));
  const missingPanel=[...routed].filter(t=>!panels.has(t));
  const missingButton=[...routed].filter(t=>!buttons.has(t));
  const orphanPanel=[...panels].filter(t=>!routed.has(t));
  if(missingPanel.length||missingButton.length||orphanPanel.length){
    console.error('[routing] APP_TABS and the markup disagree.',
      {routedWithNoPanel:missingPanel,routedWithNoButton:missingButton,panelNotRouted:orphanPanel});
    return false;
  }
  return true;
}
function appForTab(tab){return Object.keys(APP_TABS).find(app=>APP_TABS[app].includes(tab))}
function resolveRoute(value){
  const route=String(value||'');
  if(!route||route==='home')return {app:'home'};
  if(LEGACY_TABS[route])return {app:LEGACY_TABS[route][0],tab:LEGACY_TABS[route][1]};
  if(APP_DEFAULT[route])return {app:route,tab:APP_DEFAULT[route]};
  const parts=route.split('/');if(parts.length!==2||!APP_TABS[parts[0]])return {app:'home'};
  const tab=parts[1]==='money'?'finances':parts[1];
  return APP_TABS[parts[0]].includes(tab)?{app:parts[0],tab}:{app:'home'};
}
function setActiveApp(app){$$('[data-app-link]').forEach(button=>{const active=button.dataset.appLink===app;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')})}
function showHome(updateHash=true){closeCalendarDetail(false);closeDrill();document.body.classList.remove('calendar-active');$('#home').hidden=false;$('.tabs').hidden=true;$('#loading').hidden=true;$$('[data-tab]').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-selected','false');button.tabIndex=-1});$$('[data-panel]').forEach(panel=>{panel.classList.remove('active');panel.hidden=true});setActiveApp('home');if(updateHash)history.replaceState(null,'','#home');window.scrollTo({top:0,behavior:'smooth'})}
function activate(tab,updateHash=true){const app=appForTab(tab);if(!app){showHome(updateHash);return}if(tab!=='calendar')closeCalendarDetail(false);closeDrill();document.body.classList.toggle('calendar-active',tab==='calendar');$('#home').hidden=true;$('.tabs').hidden=false;$$('[data-tab]').forEach(button=>{const active=button.dataset.tab===tab;button.hidden=button.dataset.dashboard!==app;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=button.hidden?-1:0});$$('[data-panel]').forEach(panel=>{const active=panel.dataset.panel===tab;panel.classList.toggle('active',active);panel.setAttribute('aria-hidden',String(!active));panel.hidden=!active});$('#loading').hidden=!!state;setActiveApp(app);if(updateHash)history.replaceState(null,'',`#${app}/${tab}`);window.scrollTo({top:0,behavior:'smooth'});if(tab==='company'&&state)refreshFleetOnView();if(tab==='simulations')simUpdateDynamic()}
function selectApp(app){if(app==='home'){showHome();return}if(APP_DEFAULT[app])activate(APP_DEFAULT[app]);else showHome()}
function routeLocation(updateHash=true){const route=resolveRoute(location.hash.slice(1));if(route.app==='home')showHome(updateHash);else activate(route.tab,updateHash)}
function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening'}
function render(){
  $('#loading').hidden=true;$('#updated-at').textContent=date(state.generated_at);$('#work-count').textContent=state.overview.active_work;$('#approval-count').textContent=state.overview.pending_review+state.overview.pending_approvals+releaseReadyWork().length;$('#metric-count').textContent=state.metrics.filter(m=>m.status==='needs_attention').length;
  const h1=$('.welcome h1');if(h1)h1.textContent=`${greeting()}, Carter.`;
  const connected=state.control_plane.local_runner==='connected';$('#runner-pill').classList.toggle('connected',connected);$('#runner-pill').innerHTML=`<i></i> ${connected?'Local runner connected':'Local runner offline'}`;
  assertTabsMatchMarkup();
  renderOverview();renderClients();renderFinances();renderCalendar();renderMetrics();renderWork();renderAgents();renderUsage();renderApprovals();renderSystem();renderOmnisupply();bindNavigation();routeLocation(false);
}
async function load(){
  const[dashboard,quality,officeResult,agentGraphResult,omniResult,chatResult,reportResult,fleetResult]=await Promise.all([
    sb.rpc('api_dashboard_state'),sb.rpc('api_quality_state'),sb.rpc('api_office_state'),sb.rpc('api_agent_graph'),
    sb.rpc('api_omnisupply_state'),sb.rpc('api_chat_state'),sb.rpc('api_reports_state'),sb.rpc('api_fleet_state',{p_trail_minutes:120})]);
  const{data:office,error:officeError}=officeResult,{data:agentGraphData,error:agentGraphError}=agentGraphResult;
  if(dashboard.error)throw dashboard.error;if(quality.error)throw quality.error;if(officeError)throw officeError;if(agentGraphError)throw agentGraphError;
  officeState=office||{clients:[],calendar:[]};
  agentGraph=agentGraphData||{agents:[],edges:[],recent_runs:[]};
  // OmniSupply is a demo surface, not part of the operating console. A missing
  // snapshot or a migration that has not run yet must degrade to an empty tab
  // rather than take the whole dashboard down with it.
  omniState=omniResult.error?{snapshot:null,freshness:{},sections:{},illustrative:[]}:(omniResult.data||{snapshot:null,freshness:{},sections:{},illustrative:[]});
  chatState=chatResult.error?{conversations:[],archived_conversations:[]}:(chatResult.data||{conversations:[],archived_conversations:[]});
  reportState=reportResult.error?{reports:[]}:(reportResult.data||{reports:[]});
  fleetState=fleetResult.error?{aircraft:[],trails:{},coverage:{}}:(fleetResult.data||{aircraft:[],trails:{},coverage:{}});
  state={...dashboard.data,quality:quality.data||{reviews:[],contracts:[],skill_summary:{},skill_weekly:[]}};
  render();
}
async function decideApproval(id,approved,startProvider='claude'){const model=startProvider==='codex'?'Codex':'Claude';if(!confirm(`${approved?`Approve this plan and start with ${model}? Its job is queued for the runner immediately.`:'Reject this execution gate?'}`))return;const{error}=await sb.rpc('api_decide_approval',{p_approval_id:id,p_approved:approved,p_note:`Decided from CS Ventures control dashboard${approved?`; start model: ${model}`:''}`,p_start_provider:startProvider});if(error){alert(`Action failed: ${error.message}`);return}await load()}
async function approveRelease(workId,title,button){if(!confirm(`Approve release for "${title||workId}"?\n\nThis records your acceptance and marks the work completed. It will not rerun an agent, merge a pull request, or deploy code.`))return;const original=button?.textContent;if(button){button.disabled=true;button.textContent='Approving…'}const{error}=await sb.rpc('api_release',{p_work_id:workId,p_note:'Release approved from CS Ventures control dashboard'});if(error){if(button){button.disabled=false;button.textContent=original}alert(`Release failed: ${error.message}`);return}await load()}
async function decideRecommendation(id,action){const msg=action==='accept'?'Turn this recommendation into a work item? You will still approve its plan before anything runs.':'Dismiss this recommendation?';if(!confirm(msg))return;const{data,error}=await sb.rpc('api_decide_recommendation',{p_recommendation_id:id,p_action:action,p_note:'Decided from CS Ventures control dashboard'});if(error){alert(`Action failed: ${error.message}`);return}if(action==='accept'&&data?.work_id)console.log('created',data.work_id);await load()}
function showApp(session){$('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#who').textContent=session.user.email;bindNavigation();routeLocation();load().catch(error=>{const loading=$('#loading');loading.className='loading-error';loading.textContent=`Could not load dashboard data: ${error.message}`;loading.hidden=!$('#home').hidden})}
function authCard(id){$('#app').classList.add('hidden');$('#login').classList.remove('hidden');['loginForm','mfaForm','enrollForm'].forEach(f=>$(`#${f}`).classList.toggle('hidden',f!==id))}
function showLogin(){authCard('loginForm')}

// Two-factor (TOTP) flow: verified factor -> ask for a code; none -> enroll one.
let mfaFactorId=null,enrollFactorId=null;
async function routeAfterAuth(){
  const{data:{session}}=await sb.auth.getSession();
  if(!session){showLogin();return}
  const{data:aal}=await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if(aal?.currentLevel==='aal2'){showApp(session);return}
  const{data:factors,error}=await sb.auth.mfa.listFactors();
  if(error){$('#loginErr').textContent=`Two-factor check failed: ${error.message}`;showLogin();return}
  const verified=(factors?.totp||[]).filter(f=>f.status==='verified');
  if(verified.length){mfaFactorId=verified[0].id;$('#mfaCode').value='';$('#mfaErr').textContent='';authCard('mfaForm');$('#mfaCode').focus()}
  else await startEnroll(factors?.all||[]);
}
async function startEnroll(existing){
  for(const f of existing){if(f.status!=='verified')await sb.auth.mfa.unenroll({factorId:f.id}).catch(()=>{})}
  const{data,error}=await sb.auth.mfa.enroll({factorType:'totp',friendlyName:'CS Ventures authenticator',issuer:'CS Ventures Control Plane'});
  if(error){$('#loginErr').textContent=`Could not start two-factor setup: ${error.message}`;showLogin();return}
  enrollFactorId=data.id;
  const qr=data.totp?.qr_code||'';
  const box=$('#enrollQr');box.textContent='';
  let svg=qr;
  if(qr.startsWith('data:')){svg=qr.slice(qr.indexOf(',')+1);try{svg=decodeURIComponent(svg)}catch{}}
  if(svg.includes('<svg')){
    box.innerHTML=svg;
    const el=box.querySelector('svg');
    if(el){
      if(!el.getAttribute('viewBox')){
        const w=parseFloat(el.getAttribute('width'))||219,h=parseFloat(el.getAttribute('height'))||w;
        el.setAttribute('viewBox',`0 0 ${w} ${h}`);
      }
      el.removeAttribute('width');el.removeAttribute('height');
    }
  }
  else{const img=document.createElement('img');img.src=qr;img.alt='Authenticator QR code';box.appendChild(img)}
  $('#enrollSecret').textContent=data.totp?.secret||'';
  $('#enrollCode').value='';$('#enrollErr').textContent='';
  authCard('enrollForm');$('#enrollCode').focus();
}
$('#loginForm').addEventListener('submit',async event=>{event.preventDefault();$('#loginErr').textContent='';const{error}=await sb.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});if(error){$('#loginErr').textContent='Invalid email or password.';return}await routeAfterAuth()});
$('#mfaForm').addEventListener('submit',async event=>{event.preventDefault();$('#mfaErr').textContent='';const{error}=await sb.auth.mfa.challengeAndVerify({factorId:mfaFactorId,code:$('#mfaCode').value.trim()});if(error){$('#mfaErr').textContent='That code did not work. Enter the current 6-digit code from your authenticator (codes rotate every 30 seconds).';return}await routeAfterAuth()});
$('#enrollForm').addEventListener('submit',async event=>{event.preventDefault();$('#enrollErr').textContent='';const{error}=await sb.auth.mfa.challengeAndVerify({factorId:enrollFactorId,code:$('#enrollCode').value.trim()});if(error){$('#enrollErr').textContent='That code did not work. This QR is new each visit: delete any old CS Ventures entry in your authenticator, re-scan this QR, and enter its current code without reloading.';return}await routeAfterAuth()});
$('#mfaCancel').addEventListener('click',async()=>{await sb.auth.signOut();showLogin()});
$('#enrollCancel').addEventListener('click',async()=>{await sb.auth.signOut();showLogin()});
$('#signout').addEventListener('click',async()=>{await sb.auth.signOut();showLogin()});
$('#refresh').addEventListener('click',async()=>{const b=$('#refresh');b.textContent='Refreshing…';try{await load();b.textContent='Data refreshed'}catch(error){b.textContent='Refresh failed'}setTimeout(()=>b.textContent='Refresh data',1200)});
window.addEventListener('hashchange',()=>{if(!$('#app').classList.contains('hidden'))routeLocation()});
window.addEventListener('focus',resumeChatPoll);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumeChatPoll()});
await routeAfterAuth();

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
let state,officeState={clients:[]},agentGraph={agents:[],edges:[],recent_runs:[]};
const APP_TABS={client:['clients','finances'],system:['overview','metrics','work','agents','usage','approvals','system']};
const APP_DEFAULT={client:'clients',system:'overview'};
const LEGACY_TABS={clients:['client','clients'],money:['client','finances'],finances:['client','finances'],overview:['system','overview'],metrics:['system','metrics'],work:['system','work'],agents:['system','agents'],usage:['system','usage'],approvals:['system','approvals'],system:['system','system']};
const DRILL_LAYOUT_KEY='cos.drillLayout',DRILL_LAYOUTS=new Set(['side','below','popout']);
let drillLayout=(()=>{try{const saved=localStorage.getItem(DRILL_LAYOUT_KEY);return DRILL_LAYOUTS.has(saved)?saved:'side'}catch{return 'side'}})();
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
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrill()});

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
function clientDrillContent(client){
  const opportunities=(client.opportunities||[]).map(opp=>({label:opp.title||'Untitled opportunity',chip:opp.stage,kind:'opportunity',sub:[`${money(opp.value_estimate)} estimated`,`${Math.round(Number(opp.probability||0)*100)}% probability`,opp.next_action?`Next: ${opp.next_action}`:'',opp.next_action_due?`due ${dateOnly(opp.next_action_due)}`:''].filter(Boolean).join(' · ')}));
  const touches=(client.touches||[]).slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).map(touch=>({label:[touch.channel,touch.direction].filter(Boolean).join(' · ')||'Touch',value:date(touch.at),sub:[touch.summary,touch.followup_due?`Follow up ${dateOnly(touch.followup_due)}`:''].filter(Boolean).join(' · ')}));
  const engagements=(client.engagements||[]).map(engagement=>({label:engagement.scope||'Engagement',chip:engagement.status,kind:'engagement',sub:[money(engagement.price),engagement.pricing_model].filter(Boolean).join(' · ')}));
  return `${contactSection(client)}${officeRows('Opportunities',opportunities,'No opportunities recorded')}${officeRows('Touches',touches,'No touches recorded')}${officeRows('Engagements',engagements,'No engagements recorded')}
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
function markInvoicePaid(event){
  event.preventDefault();
  const form=event.currentTarget,invoice=(officeState.invoices||[]).find(item=>String(item.invoice_id)===form.dataset.invoiceId);if(!invoice)return;
  return mutateOffice(form,'api_upsert_invoice',{p_invoice_id:invoice.invoice_id,p_engagement_id:invoice.engagement_id,p_amount:Number(invoice.amount||0),p_issued_at:invoice.issued_at,p_due_at:invoice.due_at,p_paid_at:new Date().toISOString(),p_status:'paid'});
}
async function deleteContact(event,contactId,clientId){
  event.preventDefault();if(!confirm('Delete this contact?'))return;const button=event.currentTarget;button.disabled=true;
  try{const{data,error}=await sb.rpc('api_delete_contact',{p_contact_id:contactId});if(error)throw error;if(data?.ok===false)throw new Error(data.error||'The contact could not be deleted.');await reloadOffice(clientId)}catch(error){button.disabled=false;alert(`Action failed: ${error.message}`)}
}
async function setClientStar(event,clientId,starred,button){
  event.preventDefault();event.stopPropagation();button.disabled=true;
  try{const{data,error}=await sb.rpc('api_set_client_star',{p_client_id:clientId,p_starred:starred});if(error)throw error;if(data?.ok===false)throw new Error(data.error||'The client pin could not be updated.');await reloadOffice()}catch(error){button.disabled=false;alert(`Action failed: ${error.message}`)}
}
function bindOfficeForms(scope,clientId=null){
  if(!scope)return;
  $$('[data-office-toggle]',scope).forEach(button=>button.onclick=()=>{$$('[data-office-form]',scope).forEach(form=>form.classList.toggle('hidden',form.dataset.officeForm!==button.dataset.officeToggle||(button.dataset.officeTarget&&form.dataset.officeTarget!==button.dataset.officeTarget)));const target=$$('[data-office-form]',scope).find(form=>form.dataset.officeForm===button.dataset.officeToggle&&(!button.dataset.officeTarget||form.dataset.officeTarget===button.dataset.officeTarget));target?.querySelector('input,select,textarea')?.focus()});
  $$('[data-office-cancel]',scope).forEach(button=>button.onclick=()=>button.closest('.office-form').classList.add('hidden'));
  const client=$('[data-office-form="client"]',scope);if(client)client.onsubmit=submitClient;
  $$('[data-office-form="contact"]',scope).forEach(contact=>contact.onsubmit=event=>submitContact(event,clientId));
  $$('[data-delete-contact]',scope).forEach(button=>button.onclick=event=>deleteContact(event,button.dataset.deleteContact,clientId));
  const touch=$('[data-office-form="touch"]',scope);if(touch)touch.onsubmit=event=>submitTouch(event,clientId);
  const opportunity=$('[data-office-form="opportunity"]',scope);if(opportunity)opportunity.onsubmit=event=>submitOpportunity(event,clientId);
  const engagement=$('[data-office-form="engagement"]',scope);if(engagement)engagement.onsubmit=event=>submitEngagement(event,clientId);
  const invoice=$('[data-office-form="invoice"]',scope);if(invoice)invoice.onsubmit=submitInvoice;
  const expense=$('[data-office-form="expense"]',scope);if(expense)expense.onsubmit=submitExpense;
  $$('[data-mark-paid]',scope).forEach(form=>form.onsubmit=markInvoicePaid);
}
async function reloadOffice(reopenClientId=null){const{data:office,error}=await sb.rpc('api_office_state');if(error)throw error;officeState=office||{clients:[]};renderClients();renderFinances();bindNavigation();if(reopenClientId)openClientDrill(reopenClientId)}

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
function bindNavigation(){
  $$('[data-app-link]').forEach(button=>button.onclick=()=>selectApp(button.dataset.appLink));
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
  $('#drill-backdrop').onclick=closeDrill;
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
function showHome(updateHash=true){closeDrill();$('#home').hidden=false;$('.tabs').hidden=true;$('#loading').hidden=true;$$('[data-tab]').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-selected','false');button.tabIndex=-1});$$('[data-panel]').forEach(panel=>{panel.classList.remove('active');panel.hidden=true});setActiveApp('home');if(updateHash)history.replaceState(null,'','#home');window.scrollTo({top:0,behavior:'smooth'})}
function activate(tab,updateHash=true){const app=appForTab(tab);if(!app){showHome(updateHash);return}closeDrill();$('#home').hidden=true;$('.tabs').hidden=false;$$('[data-tab]').forEach(button=>{const active=button.dataset.tab===tab;button.hidden=button.dataset.dashboard!==app;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=button.hidden?-1:0});$$('[data-panel]').forEach(panel=>{const active=panel.dataset.panel===tab;panel.classList.toggle('active',active);panel.hidden=!active});$('#loading').hidden=!!state;setActiveApp(app);if(updateHash)history.replaceState(null,'',`#${app}/${tab}`);window.scrollTo({top:0,behavior:'smooth'})}
function selectApp(app){if(app==='home'){showHome();return}if(APP_DEFAULT[app])activate(APP_DEFAULT[app]);else showHome()}
function routeLocation(updateHash=true){const route=resolveRoute(location.hash.slice(1));if(route.app==='home')showHome(updateHash);else activate(route.tab,updateHash)}
function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening'}
function render(){
  $('#loading').hidden=true;$('#updated-at').textContent=date(state.generated_at);$('#work-count').textContent=state.overview.active_work;$('#approval-count').textContent=state.overview.pending_review+state.overview.pending_approvals+releaseReadyWork().length;$('#metric-count').textContent=state.metrics.filter(m=>m.status==='needs_attention').length;
  const h1=$('.welcome h1');if(h1)h1.textContent=`${greeting()}, Carter.`;
  const connected=state.control_plane.local_runner==='connected';$('#runner-pill').classList.toggle('connected',connected);$('#runner-pill').innerHTML=`<i></i> ${connected?'Local runner connected':'Local runner offline'}`;
  renderOverview();renderClients();renderFinances();renderMetrics();renderWork();renderAgents();renderUsage();renderApprovals();renderSystem();bindNavigation();routeLocation(false);
}
async function load(){const[dashboard,quality,officeResult,agentGraphResult]=await Promise.all([sb.rpc('api_dashboard_state'),sb.rpc('api_quality_state'),sb.rpc('api_office_state'),sb.rpc('api_agent_graph')]);const{data:office,error:officeError}=officeResult,{data:agentGraphData,error:agentGraphError}=agentGraphResult;if(dashboard.error)throw dashboard.error;if(quality.error)throw quality.error;if(officeError)throw officeError;if(agentGraphError)throw agentGraphError;officeState=office||{clients:[]};agentGraph=agentGraphData||{agents:[],edges:[],recent_runs:[]};state={...dashboard.data,quality:quality.data||{reviews:[],contracts:[],skill_summary:{},skill_weekly:[]}};render()}
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
await routeAfterAuth();

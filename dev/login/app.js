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
const duration=s=>{if(s==null)return '—';s=Number(s);if(s<90)return `${Math.round(s)}s`;if(s<5400)return `${(s/60).toFixed(0)} min`;if(s<172800)return `${(s/3600).toFixed(1)} h`;return `${(s/86400).toFixed(1)} d`};
const PCOLOR={claude:'var(--green)',codex:'var(--blue)'};
let state;

function pageHead(title,detail,right=''){return `<div class="page-head"><div><h2>${esc(title)}</h2><p>${esc(detail)}</p></div>${right?`<span class="quiet">${esc(right)}</span>`:''}</div>`}
function provider(name){return state.audit.providers.find(item=>item.provider===name)||{};}
function percent(value,max){return max?Math.max(3,Math.round(value/max*100)):0;}
function freshLine(){const f=state.freshness?.providers||[];if(!f.length)return '';return f.map(p=>`${p.provider==='claude'?'Claude':'Codex'} data through ${date(p.last_event_at)}`).join(' · ')}
function tokensAll(p){return Number(p.tokens_total||0)}

/* ── Drill-down panel ─────────────────────────────────────────────── */
function openDrill({title,subtitle='',stats=[],rows=[],rowsTitle='',note='',chart=''}){
  const max=Math.max(...rows.map(r=>Number(r.pctOf??0)),1);
  $('#drill-body').innerHTML=`
    <header class="drill-head"><div><h3>${esc(title)}</h3>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><button id="drill-close" aria-label="Close">✕</button></header>
    ${stats.length?`<div class="drill-stats">${stats.map(s=>`<div><small>${esc(s.label)}</small><strong>${esc(s.value)}</strong>${s.sub?`<span>${esc(s.sub)}</span>`:''}</div>`).join('')}</div>`:''}
    ${chart}
    ${rows.length?`<div class="drill-rows">${rowsTitle?`<h4>${esc(rowsTitle)}</h4>`:''}${rows.map(r=>`
      <div class="drill-row"><div class="drill-row-top"><strong>${esc(r.label)}</strong><span>${esc(r.value)}</span></div>
      ${r.sub?`<p>${esc(r.sub)}</p>`:''}
      ${r.pctOf!=null?`<div class="bar"><i style="width:${percent(Number(r.pctOf),max)}%;background:${r.color||'var(--green)'}"></i></div>`:''}</div>`).join('')}</div>`:''}
    ${note?`<div class="notice">${esc(note)}</div>`:''}`;
  $('#drill').classList.add('open');$('#drill-backdrop').classList.add('open');
  $('#drill-close').onclick=closeDrill;
}
function closeDrill(){$('#drill').classList.remove('open');$('#drill-backdrop').classList.remove('open')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrill()});

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
  openDrill({
    title:m.label,
    subtitle:`${m.domain} · ${m.available?statusLabel(m.status):'Not instrumented'}`,
    stats:[
      {label:'Current',value:metricValue(m)},
      {label:'Target',value:metricTarget(m)},
      {label:'Numerator',value:m.numerator!=null?number(Math.round(Number(m.numerator)*100)/100):'—'},
      {label:'Denominator',value:m.denominator!=null?number(m.denominator):'—'}],
    note:m.available?`Source: ${m.source}${m.reason?` — ${m.reason}`:''}`:(m.reason||'Not measured yet.')
  });
}

/* ── Overview ─────────────────────────────────────────────────────── */
function attentionItems(){
  const o=state.overview,items=[];
  const stale=(state.freshness?.providers||[]).filter(p=>(Date.now()-new Date(p.last_event_at))/36e5>48);
  if(o.pending_review>0)items.push(readyRow('!','Review pending recommendations',`${o.pending_review} audit improvements need human disposition`,'Review','warn'));
  if(o.pending_approvals>0)items.push(readyRow('!','Decide execution gates',`${o.pending_approvals} control-plane approval request${o.pending_approvals===1?'':'s'} waiting`,'Approve','warn'));
  if(state.control_plane.local_runner!=='connected')items.push(readyRow('○','Restore runner heartbeat','Registered runner has not checked in recently','Reconnect','off'));
  if(stale.length)items.push(readyRow('○','Refresh audit data',`${stale.map(p=>p.provider).join(' and ')} data is over 48h old — run the audit import`,'Import','off'));
  return items.length?items.join(''):'<div class="empty-state"><strong>Nothing needs attention</strong><p>All gates clear and data fresh.</p></div>';
}
function renderOverview(){
  const o=state.overview,claude=provider('claude'),codex=provider('codex'),tasks=state.continuity.tasks.filter(t=>t.status==='active');
  const runnerConnected=state.control_plane.local_runner==='connected';
  const maxCost=Math.max(Number(claude.est_cost||0),Number(codex.est_cost||0));
  $('[data-panel="overview"]').innerHTML=pageHead('Operating overview','The current state of work, agents, cost, and execution readiness.',freshLine())+`
  <div class="kpi-grid">
    <article class="kpi clickable" data-drill="work-tab"><div class="kpi-top">Active work <i></i></div><strong>${o.active_work}</strong><span>Continuity tasks in progress</span></article>
    <article class="kpi clickable" data-drill="approvals-tab"><div class="kpi-top">Pending review <em class="delta">Human gate</em></div><strong>${o.pending_review}</strong><span>Recommendations awaiting disposition</span></article>
    <article class="kpi clickable" data-drill="cost"><div class="kpi-top">Est. cost · 7 days <i></i></div><strong>${money(o.est_cost_7d)}</strong><span>${money(o.est_cost_total)} all time · API-equivalent</span></article>
    <article class="kpi clickable" data-drill="tokens"><div class="kpi-top">Captured tokens <i></i></div><strong>${compact(o.captured_tokens)}</strong><span>Includes prompt-cache reads and writes</span></article>
  </div>
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

/* ── Work / Agents (largely unchanged) ────────────────────────────── */
function renderWork(){const tasks=state.continuity.tasks,live=state.operations.work||[];$('[data-panel="work"]').innerHTML=pageHead('Work queue','Durable continuity tasks and executable control-plane work in one view.',`${tasks.filter(t=>t.status==='active').length} active · ${live.length} control-plane`)+`<article class="card"><div class="card-head"><div><h3>Durable work</h3><p>Latest immutable checkpoint and evidence for every continuity task.</p></div></div><table class="queue-table"><thead><tr><th>Work item</th><th>Owner</th><th>Status</th><th>Checkpoint</th><th>Evidence</th></tr></thead><tbody>${tasks.map(task=>`<tr><td><strong>${esc(task.objective)}</strong><small>Next: ${esc(task.next_action||'Not recorded')}</small></td><td>${esc(task.owner_agent)}</td><td><span class="chip">${esc(task.status)}</span></td><td>v${task.checkpoint_version||0}<small>${date(task.checkpoint_at)}</small></td><td>${task.artifacts?.length||0} artifacts<small>${task.tests?.length||0} checks · ${task.blockers?.length||0} blockers</small></td></tr>`).join('')}</tbody></table></article><article class="card" style="margin-top:14px"><div class="card-head"><div><h3>Execution ledger</h3><p>Typed work items that can move through plan, lease, run, review, and release gates.</p></div></div>${live.length?`<table class="queue-table"><thead><tr><th>Work item</th><th>Project</th><th>Priority</th><th>State</th><th>Updated</th></tr></thead><tbody>${live.map(w=>`<tr><td><strong>${esc(w.title)}</strong><small>${esc(w.description||w.work_id)}</small></td><td>${esc(w.project||'—')}</td><td>${esc(w.priority)}</td><td><span class="chip">${esc(w.state)}</span></td><td>${date(w.updated_at)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state"><strong>No executable work yet</strong><p>Continuity tracking remains available above.</p></div>'}</article>`}

function renderAgents(){const c=provider('claude'),x=provider('codex');$('[data-panel="agents"]').innerHTML=pageHead('Agents','Model roles, observed activity, and the planned orchestration hierarchy.','Runtime status is distinct from historical usage')+`<div class="agent-grid">
  ${agentCard('O','CoS Orchestrator','Claude Opus 4.8','Architecture, decomposition, arbitration, acceptance, and escalation.','primary','Configured','Not running')}
  ${agentCard('C','Claude','Opus / Sonnet / Haiku',`${number(c.events)} completed exchanges across ${number(c.sessions)} sessions.`,'',`${money(c.est_cost)} est.`,`${compact(tokensAll(c))} tokens`)}
  ${agentCard('X','Codex','GPT-5.x repository worker',`${number(x.events)} recorded events across ${number(x.sessions)} sessions.`,'',`${money(x.est_cost)} est.`,`${compact(tokensAll(x))} tokens`)}
  </div><div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Model routing</h3><p>Use the least expensive model that can satisfy the packet and verification contract.</p></div></div><div class="routing-grid">
  <div class="route"><strong>Opus 4.8</strong><p>Orchestration, ambiguous architecture, conflict resolution, high-risk acceptance.</p></div><div class="route"><strong>Sonnet</strong><p>Implementation, synthesis, review, and surgical revision.</p></div><div class="route"><strong>Haiku</strong><p>Narrow recon, extraction, inventory, and deterministic tool work.</p></div><div class="route"><strong>Codex</strong><p>Repository editing, terminal execution, tests, and coding-agent workflows.</p></div>
  </div></div>`}
function agentCard(icon,title,model,detail,mode,a,b){return `<article class="agent-card ${mode}"><span class="agent-icon">${icon}</span><h3>${esc(title)}</h3><p>${esc(detail)}</p><div class="agent-meta"><div><small>Model / role</small><strong>${esc(model)}</strong></div><div><small>Est. cost</small><strong>${esc(a)}</strong></div><div><small>Volume</small><strong>${esc(b)}</strong></div><div><small>Authority</small><strong>${title==='CoS Orchestrator'?'Human-gated':'Task packet'}</strong></div></div></article>`}

/* ── Metrics ──────────────────────────────────────────────────────── */
function statusLabel(s){return s==='on_target'?'On target':s==='needs_attention'?'Needs attention':s==='baseline'?'Baseline':'Unavailable'}
function metricValue(metric){if(!metric.available)return '—';if(metric.unit==='ratio')return `${Math.round(metric.value*100)}%`;if(metric.unit==='seconds')return duration(metric.value);if(metric.unit==='usd')return money(metric.value);return Number(metric.value).toFixed(1)}
function metricTarget(metric){if(!metric.available)return 'No target';if(metric.target==null)return 'Baseline measurement';const value=metric.unit==='ratio'?`${Math.round(metric.target*100)}%`:metric.target;return `Target ${metric.direction==='lower'?'≤':'≥'} ${value}`}
function metricBar(metric){if(!metric.available||metric.target==null)return metric.available?55:0;if(metric.direction==='lower')return metric.value===0?100:Math.min(100,metric.target/metric.value*100);return Math.min(100,metric.value/metric.target*100)}
function metricCard(metric){return `<article class="tracker ${metric.status} clickable" data-metric="${esc(metric.key)}"><header><span>${esc(metric.domain)}</span><span class="tracker-status">${statusLabel(metric.status)}</span></header><h3>${esc(metric.label)}</h3><div class="tracker-value"><strong>${metricValue(metric)}</strong><small>${esc(metricTarget(metric))}</small></div><p>${esc(metric.available?metric.source:metric.reason)}</p><div class="target-bar"><i style="width:${metricBar(metric)}%"></i></div></article>`}
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
function renderMetrics(){const measured=state.metrics.filter(m=>m.available),on=measured.filter(m=>m.status==='on_target'),attention=measured.filter(m=>m.status==='needs_attention'),unavailable=state.metrics.filter(m=>!m.available),outcomes=state.audit.outcomes||{},evidence=state.continuity.evidence||{};$('[data-panel="metrics"]').innerHTML=pageHead('Performance metrics','Delivery, quality, efficiency, and coverage — click any tracker for the math behind it.','Provisional targets · refine after 30 days')+`
  <div class="tracker-summary"><div class="summary-card"><small>Measured trackers</small><strong>${measured.length}</strong><span>Deterministic evidence available</span></div><div class="summary-card"><small>On provisional target</small><strong>${on.length}</strong><span>Baseline targets currently met</span></div><div class="summary-card"><small>Needs attention</small><strong>${attention.length}</strong><span>Measured gaps to address</span></div><div class="summary-card"><small>Not instrumented</small><strong>${unavailable.length}</strong><span>Never rendered as zero</span></div></div>
  <div class="tracker-grid">${state.metrics.map(metricCard).join('')}</div>
  <div class="grid-2"><article class="card"><div class="card-head"><div><h3>Evidence and outcomes</h3><p>Explicit operational proof, not inferred productivity.</p></div></div><div class="usage-numbers"><div><small>Checkpoints</small><strong>${number(evidence.checkpoints)}</strong></div><div><small>Artifacts</small><strong>${number(evidence.artifacts)}</strong></div><div><small>Tests recorded</small><strong>${number(evidence.tests)}</strong></div></div><div class="usage-numbers"><div><small>Outcome records</small><strong>${number(outcomes.records)}</strong></div><div><small>Retries</small><strong>${number(outcomes.retries)}</strong></div><div><small>Recoveries</small><strong>${number(outcomes.recoveries)}</strong></div></div></article><article class="card"><div class="card-head"><div><h3>Checkpoint cadence</h3><p>Immutable checkpoints written by week.</p></div></div>${checkpointChart(state.continuity.checkpoint_weekly||[])}</article></div>
  <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Where to build next</h3><p>Computed from live activity, cost, and outcome coverage.</p></div></div><div class="instrument-grid">${whereToBuild()}</div></div>`}
function checkpointChart(items){if(!items.length)return '<div class="empty-state"><strong>No checkpoints yet</strong></div>';const max=Math.max(...items.map(x=>x.checkpoints),1);return `<div class="mini-chart">${items.slice(-10).map(x=>`<div class="mini-week"><i style="height:${Math.max(3,x.checkpoints/max*100)}px"></i><small>${esc(String(x.week).slice(5))}</small></div>`).join('')}</div><p class="quiet" style="margin-top:8px">${items.length===1?'One week of history — the cadence chart fills in as weeks accumulate.':''}</p>`}

/* ── Usage ────────────────────────────────────────────────────────── */
let usageMode='cost';
function renderUsage(){const providers=state.audit.providers;$('[data-panel="usage"]').innerHTML=pageHead('Usage & telemetry','Claude and Codex activity, tokens, and estimated cost. Click anything to drill in.',freshLine())+`<div class="usage-hero">${providers.map(p=>`<article class="usage-provider clickable" data-provider="${esc(p.provider)}"><header><strong>${esc(p.provider)}</strong><span>${p.cost_is_estimate?'Estimated rates':'List rates'} · ${Math.round((p.token_coverage||0)*100)}% token coverage</span></header><div class="usage-numbers"><div><small>Est. cost</small><strong>${money(p.est_cost)}</strong></div><div><small>Last 7 days</small><strong>${money(p.est_cost_7d)}</strong></div><div><small>Exchanges</small><strong>${number(p.events)}</strong></div><div><small>Sessions</small><strong>${number(p.sessions)}</strong></div><div><small>Total tokens</small><strong>${compact(tokensAll(p))}</strong></div><div><small>Output tokens</small><strong>${compact(p.tokens_out)}</strong></div></div><div class="coverage">Token composition${stackedBar(tokenParts(p))}</div></article>`).join('')}</div>
  <div class="grid-2"><article class="card"><div class="card-head"><div><h3>Weekly activity</h3><p>Click a week for its provider and model breakdown.</p></div><div class="mode-toggle">${['cost','tokens','events'].map(m=>`<button class="${usageMode===m?'active':''}" data-mode="${m}">${m[0].toUpperCase()+m.slice(1)}</button>`).join('')}</div></div>${weeklyChart(state.audit.weekly)}</article><article class="card"><div class="card-head"><div><h3>Telemetry coverage</h3><p>What can be compared safely today.</p></div></div><div class="readiness">${readyRow('✓','Claude tokens & cost','Full usage incl. cache reads/writes from session logs','Comparable','')}${readyRow('✓','Codex tokens & cost','Backfilled from Codex session logs; ~95% coverage','Comparable','')}${readyRow('!','Pre-capture history',`${(provider('claude').events||0)-(provider('claude').tokenized_events||0)} Claude events predate local logs; kept at partial values`,'Partial','warn')}${readyRow('○','Outcome linkage','Model calls are not yet tied to task and run IDs','Missing','off')}</div></article></div>
  <div class="grid-2"><article class="card"><div class="card-head"><div><h3>Model usage</h3><p>Click a model for its weekly trend and token mix.</p></div></div>${modelTable(state.audit.models||[])}</article><article class="card"><div class="card-head"><div><h3>Project activity</h3><p>Click a workspace for provider split and sessions.</p></div></div>${projectBars(state.audit.projects||[])}</article></div>
  <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Recent sessions by cost</h3><p>Highest estimated-cost sessions of the last 14 days.</p></div></div>${sessionTable(state.audit.sessions_recent||[])}</div>`}
function weeklyChart(items){const weeks=[...new Set(items.map(x=>x.week_start))].slice(-10);const field=usageMode==='cost'?'est_cost':usageMode==='tokens'?'tokens':'events';const by=(w,p)=>Number(items.find(x=>x.week_start===w&&x.provider===p)?.[field]||0);const max=Math.max(...weeks.flatMap(w=>[by(w,'claude'),by(w,'codex')]),0.001);const fmt=usageMode==='cost'?money:compact;return `<div class="chart">${weeks.map(w=>`<div class="week clickable" data-week="${esc(w)}" title="Week of ${esc(w)}: Claude ${fmt(by(w,'claude'))} · Codex ${fmt(by(w,'codex'))}"><div class="week-bars"><i style="height:${Math.max(2,by(w,'claude')/max*130)}px"></i><i class="codex" style="height:${Math.max(2,by(w,'codex')/max*130)}px"></i></div><small>${esc(String(w).slice(5))}</small></div>`).join('')}</div><div class="legend-line"><span style="color:var(--green)">● Claude</span> <span style="color:var(--blue)">● Codex</span></div>`}
function modelTable(items){return `<table class="model-table"><thead><tr><th>Provider / model</th><th>Events</th><th>Output</th><th>Cache read</th><th>Total tok</th><th>Est. cost</th></tr></thead><tbody>${items.map(m=>`<tr class="clickable" data-model="${esc(m.model)}" data-model-provider="${esc(m.provider)}"><td><strong>${esc(m.provider)}</strong><br>${esc(m.model)}</td><td>${number(m.events)}</td><td>${compact(m.tokens_out)}</td><td>${compact(m.tokens_cache_read)}</td><td>${compact(m.tokens_total)}</td><td>${money(m.est_cost)}${m.cost_is_estimate?'<small> est</small>':''}</td></tr>`).join('')}</tbody></table>`}
function projectBars(items){const max=Math.max(...items.map(x=>Number(x.est_cost||0)),0.001);return `<div class="project-bars">${items.map(p=>`<div class="project-bar clickable" data-project="${esc(p.project)}"><strong>${esc(p.project)}</strong><div class="bar"><i style="width:${percent(Number(p.est_cost||0),max)}%;background:var(--green)"></i></div><span>${money(p.est_cost)}</span></div>`).join('')}</div>`}
function sessionTable(items){if(!items.length)return '<div class="empty-state"><strong>No sessions in the last 14 days</strong></div>';return `<table class="model-table"><thead><tr><th>Session</th><th>Project</th><th>Exchanges</th><th>Tokens</th><th>Est. cost</th><th>Last active</th></tr></thead><tbody>${items.map(s=>`<tr class="clickable" data-project="${esc(s.project)}"><td><strong>${esc(s.provider)}</strong><br>${esc(s.session_id.slice(0,13))}…</td><td>${esc(s.project)}</td><td>${number(s.events)}</td><td>${compact(s.tokens)}</td><td>${money(s.est_cost)}</td><td>${date(s.last_at)}</td></tr>`).join('')}</tbody></table>`}

/* ── Approvals & System ───────────────────────────────────────────── */
function renderApprovals(){const recs=state.audit.recommendations.filter(r=>r.status==='proposed'),decided=state.audit.recommendations.filter(r=>r.status!=='proposed'),gates=state.operations.approvals||[];$('[data-panel="approvals"]').innerHTML=pageHead('Approvals & human gates','Approving a plan queues it for the runner. Accepting a recommendation turns it into executable work.',`${recs.length} recommendations · ${gates.length} execution gates`)+`<div class="grid-2"><article class="card"><div class="card-head"><div><h3>Execution approvals</h3><p>Approving enqueues the plan's job — the runner daemon picks it up within seconds.</p></div></div>${gates.length?`<div class="approval-list">${gates.map(a=>`<div class="approval-row"><i class="priority-dot high"></i><div><strong>${esc(a.title||a.work_id)}</strong><p>${esc(a.gate_type)} gate · hash ${esc((a.payload_hash||'').slice(0,12))}… · ${date(a.requested_at)}</p></div><div class="action-buttons"><button class="action-button approve" data-approval="${esc(a.approval_id)}" data-decision="true">Approve & run</button><button class="action-button reject" data-approval="${esc(a.approval_id)}" data-decision="false">Reject</button></div></div>`).join('')}</div>`:'<div class="empty-state"><strong>No execution approvals waiting</strong><p>Accept a recommendation to create one.</p></div>'}</article><article class="card"><div class="card-head"><div><h3>Recommendation review queue</h3><p>Create work ships it through the pipeline (branch + PR); Dismiss records why.</p></div></div><div class="approval-list">${recs.map(r=>`<div class="approval-row"><i class="priority-dot ${esc(r.priority)}"></i><div><strong>${esc(r.title)}</strong><p>${esc(r.category)} · ${esc(r.priority)} priority${r.proposed_action?` — ${esc(String(r.proposed_action).slice(0,140))}${String(r.proposed_action).length>140?'…':''}`:''}</p></div><div class="action-buttons"><button class="action-button approve" data-rec="${esc(r.recommendation_id)}" data-rec-action="accept">Create work</button><button class="action-button reject" data-rec="${esc(r.recommendation_id)}" data-rec-action="dismiss">Dismiss</button></div></div>`).join('')||'<div class="empty-state"><strong>Queue clear</strong><p>New recommendations arrive with each weekly audit run.</p></div>'}</div>${decided.length?`<p class="quiet" style="margin-top:10px">${decided.length} previously decided · ${decided.filter(r=>r.status==='accepted').length} accepted · ${decided.filter(r=>['dismissed','rejected'].includes(r.status)).length} dismissed · ${decided.filter(r=>r.status==='resolved').length} resolved</p>`:''}</article></div><div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Gate model</h3><p>Plan, sensitive-action, and release authority are distinct.</p></div></div><div class="gate-grid"><div class="gate"><span>1</span><strong>Plan approval</strong><p>Approving a plan auto-enqueues its job for the local runner.</p></div><div class="gate"><span>2</span><strong>Sensitive action</strong><p>Credentials, production data, external messages, financial, or destructive steps.</p></div><div class="gate"><span>3</span><strong>Release approval</strong><p>Merging the work's PR ships it to production; you get an iMessage on release.</p></div></div></div>`}

function renderSystem(){const connected=state.control_plane.local_runner==='connected',runners=state.operations.runners||[],events=state.operations.events||[];$('[data-panel="system"]').innerHTML=pageHead('System architecture','The website controls authority. The database coordinates. The local computer executes.','Website ↔ Database ↔ Local')+`<div class="system-board"><svg class="system-svg" viewBox="0 0 1100 520" aria-hidden="true"><defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L7 3L0 6Z" fill="#2e6b3f"/></marker><marker id="b" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L7 3L0 6Z" fill="#477c9b"/></marker></defs><path d="M300 155C470 70 650 68 790 115" fill="none" stroke="#2e6b3f" stroke-width="2.5" marker-end="url(#a)"/><path d="M790 178C620 245 475 250 300 205" fill="none" stroke="#b87332" stroke-width="2.5"/><path d="M255 250C320 340 430 370 520 382" fill="none" stroke="#477c9b" stroke-width="2.5" marker-end="url(#b)"/></svg><div class="sys-node db"><small>Durable go-between</small><strong>Supabase Control Plane</strong><span>Typed jobs, approvals, leases, decisions, artifacts, usage, and outcomes.</span></div><div class="sys-node web"><small>Human authority</small><strong>CS Ventures Website</strong><span>Create work, approve plans, monitor progress, review evidence, authorize release.</span></div><div class="sys-node local"><small>Trusted execution</small><strong>Local CoS Runner</strong><span>Claims approved jobs and invokes Claude and Codex through local tools.</span></div><div class="system-note">× No direct website-to-laptop command channel</div></div><div class="grid-even"><article class="card"><div class="card-head"><div><h3>Current readiness</h3><p>Measured from the live control plane.</p></div></div><div class="readiness">${readyRow('✓','Website console','Authenticated dashboard is Supabase-backed','Operational','')}${readyRow('✓','Database control plane','Typed ledger and owner-gated APIs are deployed','Operational','')}${readyRow(connected?'✓':'○','Local runner',connected?'Heartbeat is current':`${runners.length} runner registered; latest heartbeat is stale`,connected?'Connected':'Offline',connected?'':'off')}</div></article><article class="card"><div class="card-head"><div><h3>Recent control-plane events</h3><p>Append-only transitions from the execution ledger.</p></div></div><div class="event-list">${events.length?events.slice(0,8).map(e=>`<div class="event-row"><time>${date(e.created_at)}</time> · ${esc(e.actor)} · <strong>${esc(e.event_type)}</strong>${e.prior_state?` · ${esc(e.prior_state)} → ${esc(e.new_state)}`:''}</div>`).join(''):'<div class="empty-state"><strong>No events yet</strong></div>'}</div></article></div>`}

/* ── Navigation / interactivity ───────────────────────────────────── */
function bindNavigation(){
  $$('[data-tab]').forEach(button=>button.onclick=()=>activate(button.dataset.tab));
  $$('[data-go]').forEach(button=>button.onclick=()=>activate(button.dataset.go));
  $$('[data-approval]').forEach(button=>button.onclick=()=>decideApproval(button.dataset.approval,button.dataset.decision==='true'));
  $$('[data-rec]').forEach(button=>button.onclick=()=>decideRecommendation(button.dataset.rec,button.dataset.recAction));
  $$('[data-provider]').forEach(el=>el.onclick=()=>drillProvider(el.dataset.provider));
  $$('[data-model]').forEach(el=>el.onclick=()=>drillModel(el.dataset.modelProvider,el.dataset.model));
  $$('[data-project]').forEach(el=>el.onclick=()=>drillProject(el.dataset.project));
  $$('[data-week]').forEach(el=>el.onclick=()=>drillWeek(el.dataset.week));
  $$('[data-metric]').forEach(el=>el.onclick=()=>drillMetric(el.dataset.metric));
  $$('[data-mode]').forEach(el=>el.onclick=()=>{usageMode=el.dataset.mode;renderUsage();bindNavigation()});
  $$('[data-drill]').forEach(el=>el.onclick=()=>{const d=el.dataset.drill;if(d==='cost')drillCost();else if(d==='tokens')drillTokens();else if(d==='work-tab')activate('work');else if(d==='approvals-tab')activate('approvals')});
  $('#drill-backdrop').onclick=closeDrill;
}
function activate(tab,updateHash=true){if(!$(`[data-panel="${tab}"]`))return;closeDrill();$$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$$('[data-panel]').forEach(p=>p.classList.toggle('active',p.dataset.panel===tab));if(updateHash)history.replaceState(null,'',`#${tab}`);window.scrollTo({top:0,behavior:'smooth'})}
function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening'}
function render(){
  $('#loading').style.display='none';$('#updated-at').textContent=date(state.generated_at);$('#work-count').textContent=state.overview.active_work;$('#approval-count').textContent=state.overview.pending_review+state.overview.pending_approvals;$('#metric-count').textContent=state.metrics.filter(m=>m.status==='needs_attention').length;
  const h1=$('.welcome h1');if(h1)h1.textContent=`${greeting()}, Carter.`;
  const connected=state.control_plane.local_runner==='connected';$('#runner-pill').classList.toggle('connected',connected);$('#runner-pill').innerHTML=`<i></i> ${connected?'Local runner connected':'Local runner offline'}`;
  renderOverview();renderMetrics();renderWork();renderAgents();renderUsage();renderApprovals();renderSystem();bindNavigation();activate(location.hash.slice(1)||'overview',false);
}
async function load(){const{data,error}=await sb.rpc('api_dashboard_state');if(error)throw error;state=data;render()}
async function decideApproval(id,approved){if(!confirm(`${approved?'Approve this plan? Its job is queued for the runner immediately.':'Reject this execution gate?'}`))return;const{error}=await sb.rpc('api_decide_approval',{p_approval_id:id,p_approved:approved,p_note:'Decided from CS Ventures control dashboard'});if(error){alert(`Action failed: ${error.message}`);return}await load()}
async function decideRecommendation(id,action){const msg=action==='accept'?'Turn this recommendation into a work item? You will still approve its plan before anything runs.':'Dismiss this recommendation?';if(!confirm(msg))return;const{data,error}=await sb.rpc('api_decide_recommendation',{p_recommendation_id:id,p_action:action,p_note:'Decided from CS Ventures control dashboard'});if(error){alert(`Action failed: ${error.message}`);return}if(action==='accept'&&data?.work_id)console.log('created',data.work_id);await load()}
function showApp(session){$('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#who').textContent=session.user.email;load().catch(error=>{$('#loading').className='loading-error';$('#loading').textContent=`Could not load dashboard data: ${error.message}`})}
function showLogin(){$('#app').classList.add('hidden');$('#login').classList.remove('hidden')}
$('#loginForm').addEventListener('submit',async event=>{event.preventDefault();$('#loginErr').textContent='';const{data,error}=await sb.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});if(error){$('#loginErr').textContent='Invalid email or password.';return}showApp(data.session)});
$('#signout').addEventListener('click',async()=>{await sb.auth.signOut();showLogin()});
$('#refresh').addEventListener('click',async()=>{const b=$('#refresh');b.textContent='Refreshing…';try{await load();b.textContent='Data refreshed'}catch(error){b.textContent='Refresh failed'}setTimeout(()=>b.textContent='Refresh data',1200)});
const{data:{session}}=await sb.auth.getSession();if(session)showApp(session);else showLogin();

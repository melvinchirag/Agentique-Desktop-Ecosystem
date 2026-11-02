const fs=require('node:fs'),path=require('node:path');
const dir=__dirname,base='C:/Users/mkarupat/.codex/sessions/2026/10/04';
const sessions=JSON.parse(fs.readFileSync(path.join(dir,'sessions.json'),'utf8'));
const roots=sessions.filter(s=>s.source==='vscode');
const rates={'gpt-6-astra':[250,25,1250],'gpt-6.1-sol':[50,2.5,250],'gpt-6-sol':[50,5,250],
 'gpt-6-luna':[2.5,.25,12.5],'gpt-5.6-luna':[5,.5,30],'gpt-5.6-terra':[50,5,300]};
const load=s=>fs.readFileSync(path.join(base,s.file),'utf8').split(/\r?\n/).filter(Boolean).flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}});
const all=new Map(sessions.map(s=>[s.id,load(s)]));
const current=roots.at(-1), currRows=all.get(current.id);
const contentText=x=>(x.payload?.content??[]).map(c=>c.text??'').join(' ');
const auditStart=currRows.find(x=>x.type==='response_item'&&x.payload?.role==='user'&&/past 2 agents/i.test(contentText(x)))?.timestamp;
const final=currRows.filter(x=>x.type==='response_item'&&x.payload?.role==='assistant'&&x.payload?.phase==='final_answer');
const results=[];
for(const s of sessions){
 const rows=all.get(s.id).filter(x=>!auditStart||x.timestamp<auditStart);
 let model,effort,prev=null,lastFingerprint='',resets=0;const perModel={},increments=[];
 for(const row of rows){
  if(row.type==='turn_context'){model=row.payload.model;effort=row.payload.effort;}
  if(row.type!=='event_msg'||row.payload?.type!=='token_count')continue;
  const info=row.payload.info,total=info?.total_token_usage;if(!total)continue;
  const fingerprint=JSON.stringify(total);if(fingerprint===lastFingerprint)continue;lastFingerprint=fingerprint;
  let delta={};for(const key of ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens']){
   const d=total[key]-(prev?.[key]??0);delta[key]=d<0?total[key]:d;
  }
  if(prev&&total.total_tokens<prev.total_tokens)resets++;
  const bucket=perModel[model]??={input:0,cached:0,output:0,reasoning:0,requests:0,efforts:new Set()};
  bucket.input+=delta.input_tokens;bucket.cached+=delta.cached_input_tokens;bucket.output+=delta.output_tokens;
  bucket.reasoning+=delta.reasoning_output_tokens;bucket.requests++;bucket.efforts.add(effort);
  increments.push({time:row.timestamp,model,effort,...delta,last:info.last_token_usage});prev=total;
 }
 const usage=Object.entries(perModel).map(([model,b])=>({...b,model,efforts:[...b.efforts],
  standardCredits:rates[model]?((b.input-b.cached)*rates[model][0]+b.cached*rates[model][1]+b.output*rates[model][2])/1e6:null}));
 const calls=rows.filter(x=>x.type==='response_item'&&['function_call','custom_tool_call'].includes(x.payload?.type));
 const classified=calls.map(x=>{const p=x.payload,t=p.arguments??p.input??'';
  let commands=[];
  if(p.name==='exec_command'){try{commands=[JSON.parse(t).cmd??''];}catch{}}
  else if(p.name==='exec')commands=[...t.matchAll(/cmd\s*:\s*("(?:[^"\\]|\\.)*")/g)].flatMap(m=>{try{return[JSON.parse(m[1])]}catch{return[]}});
  const cmd=commands.join('\n');return{
  time:x.timestamp,name:p.name,textBytes:t.length,
  fullTest:/(?:^|[;\n])\s*npm(?:\.cmd)?\s+test\b/.test(cmd)&&!/npm(?:\.cmd)?\s+test\b[^;\n]*tests\//.test(cmd),
  focusedTest:/vitest\s+run/.test(cmd)||/npm(?:\.cmd)?\s+test\b[^;\n]*tests\//.test(cmd),typecheck:/(?:npm(?:\.cmd)?\s+run\s+typecheck|tsc\s+--noEmit)/.test(cmd),
  waits:/(?:wait|write_stdin)/.test(p.name??''),reads:/(?:Get-Content|rg\s|git\s+(?:diff|status|log)|read_file)/.test(t),
  spawn:/(?:spawn_agent)/.test(p.name??''),followup:/(?:followup_task)/.test(p.name??'')};});
 const source=s.source?.subagent?.thread_spawn?'worker':s.source?.subagent?.other==='guardian'?'guardian':s.source;
 results.push({id:s.id,parent:s.parent,source,agent:s.source?.subagent?.thread_spawn?.agent_path??s.source?.subagent?.thread_spawn?.agent_nickname,
  start:rows[0]?.timestamp,end:rows.at(-1)?.timestamp,compactions:s.compactions,usage,resets,
  firstUsage:increments[0],lastUsage:increments.at(-1),calls:classified,
  phaseMarkers: rows.filter(x=>x.type==='response_item'&&x.payload?.role==='user'&&/^(Finish it|Bro how much more|Okay get this done|bro wait put all agents|Please continue|How much time|wait how much|Okay now use|Before you start|nice before|> Read compact)/i.test(contentText(x).trim()))
    .map(x=>({time:x.timestamp,text:contentText(x).slice(0,200)})),
  assistantFinals:rows.filter(x=>x.type==='response_item'&&x.payload?.role==='assistant'&&x.payload?.phase==='final_answer').map(x=>({time:x.timestamp,chars:contentText(x).length})),
  limits:rows.filter(x=>JSON.stringify(x.payload??{}).includes('usage limit')).length});
}
fs.writeFileSync(path.join(dir,'details.json'),JSON.stringify({auditStart,roots:roots.map(s=>s.id),results},null,2));
for(const root of roots){const family=results.filter(s=>s.id===root.id||s.parent===root.id);const explicit=family.filter(s=>s.source!=='guardian');
 const sum={input:0,cached:0,output:0,reasoning:0,credits:0,requests:0,calls:0,fullTests:0,focusedTests:0,typechecks:0};
 for(const s of explicit){for(const b of s.usage){for(const k of ['input','cached','output','reasoning','requests'])sum[k]+=b[k];sum.credits+=b.standardCredits??0;}sum.calls+=s.calls.length;sum.fullTests+=s.calls.filter(c=>c.fullTest).length;sum.focusedTests+=s.calls.filter(c=>c.focusedTest).length;sum.typechecks+=s.calls.filter(c=>c.typecheck).length;}
 console.log(JSON.stringify({root:root.id,cutoff:auditStart,nonGuardianSessions:explicit.length,guardians:family.filter(s=>s.source==='guardian').length,sum,markers:family.find(s=>s.id===root.id)?.phaseMarkers}));
 for(const s of explicit)console.log(JSON.stringify({id:s.id,source:s.source,agent:s.agent,usage:s.usage,resets:s.resets,fullTests:s.calls.filter(c=>c.fullTest).length,focused:s.calls.filter(c=>c.focusedTest).length,tsc:s.calls.filter(c=>c.typecheck).length}));
}

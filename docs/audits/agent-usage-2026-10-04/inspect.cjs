const fs=require('node:fs');const base='C:/Users/mkarupat/.codex/sessions/2026/10/04/';
const ss=JSON.parse(fs.readFileSync(__dirname+'/sessions.json','utf8'));
for(const s of ss.filter(s=>s.source==='vscode')){
 const rows=fs.readFileSync(base+s.file,'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));
 console.log('ROOT',s.id);
 console.log('EVENT_TYPES',[...new Set(rows.filter(x=>x.type==='event_msg').map(x=>x.payload.type))]);
 const users=rows.filter(x=>x.type==='response_item'&&x.payload.role==='user');
 for(const r of users){const t=(r.payload.content??[]).map(c=>c.text??'').join(' ');
  if(/past 2 agents|20 mins|all agents in archie|put all agents|Finish it|Bro how much|How much time|Read compact|sponsor|90.minute/i.test(t))
  console.log(JSON.stringify({time:r.timestamp,chars:t.length,safeText:/api.?key|sk-|password|secret|credential/i.test(t)?'[credential-related prompt omitted]':t.slice(0,250)}));
 }
 const finals=rows.filter(x=>x.type==='response_item'&&x.payload.role==='assistant'&&x.payload.phase==='final_answer');
 console.log('FINAL_TIMES',finals.slice(-6).map(x=>({time:x.timestamp,chars:JSON.stringify(x.payload.content).length})));
 console.log('TOOL_SHAPES',rows.filter(x=>x.type==='response_item'&&['function_call','custom_tool_call'].includes(x.payload.type)).slice(-6).map(x=>({time:x.timestamp,keys:Object.keys(x.payload),name:x.payload.name,inputType:typeof x.payload.input,argsType:typeof x.payload.arguments,starts:(x.payload.arguments??x.payload.input??'').slice(0,90)})));
}

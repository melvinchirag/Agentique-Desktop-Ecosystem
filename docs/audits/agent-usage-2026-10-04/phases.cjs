const fs=require('node:fs');const dir=__dirname,base='C:/Users/mkarupat/.codex/sessions/2026/10/04/';
const ss=JSON.parse(fs.readFileSync(dir+'/sessions.json','utf8')),summary=JSON.parse(fs.readFileSync(dir+'/summary.json','utf8'));
const rates={'gpt-6-astra':[250,25,1250],'gpt-6.1-sol':[50,2.5,250],'gpt-6-sol':[50,5,250],'gpt-6-luna':[2.5,.25,12.5]};
const id=summary.at(-1).root;const phases={preflight:{credits:0,requests:0},target20min:{credits:0,requests:0},overrun:{credits:0,requests:0}};
for(const s of ss.filter(s=>s.id===id||s.parent===id&&s.source?.subagent?.thread_spawn)){
 const rows=fs.readFileSync(base+s.file,'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));let model,prev={input_tokens:0,cached_input_tokens:0,output_tokens:0},last='';
 for(const x of rows){if(x.timestamp>='2026-10-04T12:56:14.536Z')break;if(x.type==='turn_context')model=x.payload.model;
 if(x.type!=='event_msg'||x.payload.type!=='token_count')continue;const t=x.payload.info?.total_token_usage;if(!t)continue;const key=JSON.stringify(t);if(key===last)continue;last=key;
 const input=t.input_tokens-prev.input_tokens,cached=t.cached_input_tokens-prev.cached_input_tokens,output=t.output_tokens-prev.output_tokens;prev=t;
 const r=rates[model];if(!r)continue;const phase=x.timestamp<'2026-10-04T12:13:42.000Z'?'preflight':x.timestamp<'2026-10-04T12:33:42.000Z'?'target20min':'overrun';
 phases[phase].credits+=((input-cached)*r[0]+cached*r[1]+output*r[2])/1e6;phases[phase].requests++;
 }
}
fs.writeFileSync(dir+'/phases.json',JSON.stringify(phases,null,2));console.log(phases);

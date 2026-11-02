const fs=require('node:fs');const dir=__dirname,base='C:/Users/mkarupat/.codex/sessions/2026/10/04/';
const ss=JSON.parse(fs.readFileSync(dir+'/sessions.json','utf8'));
const detail=JSON.parse(fs.readFileSync(dir+'/details.json','utf8'));
const summary=[];
for(const s of ss.filter(s=>s.source==='vscode'||s.source==='exec')){
 const rows=fs.readFileSync(base+s.file,'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l)).filter(x=>x.timestamp<detail.auditStart);
 if(s.source==='exec'){summary.push({id:s.id,cwd:s.cwd,start:s.start,end:s.end,total:s.total});continue;}
 console.log('ROOT',s.id);
 const commands=rows.flatMap(x=>{const p=x.payload;if(x.type!=='response_item'||p?.name!=='exec')return[];
  return [...(p.input??'').matchAll(/cmd\s*:\s*("(?:[^"\\]|\\.)*")/g)].flatMap(m=>{try{return[{time:x.timestamp,cmd:JSON.parse(m[1])}]}catch{return[]}});
 });
 console.log('FULL_TEST_COMMANDS',commands.filter(c=>/(?:^|[;\n])\s*npm(?:\.cmd)?\s+test\b/.test(c.cmd)&&!/npm(?:\.cmd)?\s+test\b[^;\n]*tests\//.test(c.cmd))
  .map(c=>({time:c.time,command:c.cmd.match(/npm(?:\.cmd)?\s+test\b[^;\n]*/)?.[0]})));
 const events=rows.filter(x=>x.type==='response_item'&&x.payload?.type==='message'&&x.payload.role==='assistant');
 for(const x of events){const t=(x.payload.content??[]).map(c=>c.text??'').join(' ');
  if(/minute|minutes|deadline|timer|fastest|90.min|20.min/i.test(t)&&t.length<2800)console.log('TIMING_STATEMENT',JSON.stringify({time:x.timestamp,text:t.slice(0,700)}));}
 const spawns=rows.filter(x=>x.type==='response_item'&&/spawn_agent$/.test(x.payload?.name??''));
 console.log('SPAWNS',spawns.map(x=>{let a={};try{a=JSON.parse(x.payload.arguments)}catch{}return{time:x.timestamp,task:a.task_name,fork:a.fork_turns??'all-default',model:a.model??'inherited',effort:a.reasoning_effort??'inherited',promptChars:a.message?.length};}));
}
fs.writeFileSync(dir+'/unlinked-exec.json',JSON.stringify(summary,null,2));
console.log('UNLINKED_EXEC',summary.map(s=>({id:s.id,input:s.total?.input_tokens,cached:s.total?.cached_input_tokens,output:s.total?.output_tokens})));

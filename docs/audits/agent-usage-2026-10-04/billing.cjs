const fs=require('node:fs');const ss=JSON.parse(fs.readFileSync(__dirname+'/sessions.json','utf8'));
for(const s of ss.filter(s=>s.source==='vscode')){
 const rows=fs.readFileSync('C:/Users/mkarupat/.codex/sessions/2026/10/04/'+s.file,'utf8').split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));
 const counts=rows.filter(x=>x.type==='event_msg'&&x.payload.type==='token_count');
 const snapshots=counts.map(x=>({time:x.timestamp,credits:x.payload.rate_limits?.credits,plan:x.payload.rate_limits?.plan_type})).filter(x=>x.credits);
 console.log(JSON.stringify({id:s.id,creditsSnapshotCount:snapshots.length,first:snapshots[0],last:snapshots.at(-1),
   serviceTiers:[...new Set(rows.filter(x=>x.type==='turn_context').map(x=>x.payload.service_tier).filter(Boolean))]}));
}

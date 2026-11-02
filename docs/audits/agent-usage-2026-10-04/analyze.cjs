const fs = require('node:fs');
const path = require('node:path');
const base = 'C:/Users/mkarupat/.codex/sessions/2026/10/04';
const sessions = [];
for (const file of fs.readdirSync(base)) {
  const rows = fs.readFileSync(path.join(base, file), 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const meta = rows.find(x => x.type === 'session_meta')?.payload;
  if (!meta?.cwd?.toLowerCase().includes('ade')) continue;
  const turns = rows.filter(x => x.type === 'turn_context');
  const usage = rows.filter(x => x.type === 'event_msg' && x.payload?.type === 'token_count');
  const calls = rows.filter(x => x.type === 'response_item' && ['function_call','custom_tool_call'].includes(x.payload?.type));
  const total = usage.at(-1)?.payload?.info?.total_token_usage;
  sessions.push({file, id:meta.id, source:meta.source, cwd:meta.cwd,
    start:rows[0]?.timestamp, end:rows.at(-1)?.timestamp, turns:turns.length,
    models:[...new Set(turns.map(x=>x.payload?.model))], efforts:[...new Set(turns.map(x=>x.payload?.effort))],
    total, usageEvents:usage.length, calls:calls.length,
    sampleUsage: !total ? usage.at(-1)?.payload : undefined,
    metaKeys:Object.keys(meta), parent:meta.parent_thread_id,
    compactions:rows.filter(x=>x.type==='compacted').length});
}
fs.writeFileSync(path.join(__dirname,'sessions.json'),JSON.stringify(sessions,null,2));
for (const s of sessions.filter(s => s.source === 'vscode' || s.source?.subagent?.thread_spawn)) {
  console.log(JSON.stringify({id:s.id,parent:s.parent,agent:s.source?.subagent?.thread_spawn?.agent_path ?? s.source?.subagent?.thread_spawn?.agent_nickname,
    start:s.start,end:s.end,model:s.models,effort:s.efforts,input:s.total?.input_tokens,cached:s.total?.cached_input_tokens,
    output:s.total?.output_tokens,reasoning:s.total?.reasoning_output_tokens,calls:s.calls,compactions:s.compactions}));
}

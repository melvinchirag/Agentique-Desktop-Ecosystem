# Sponsor verification — 2026-10-04

Target: root ADE sponsor implementation on branch `chip/logic`, commit `36fa3e77b61ef55e5ab0c852bb17fa342c2390ad`.
Live run began at 2026-10-04T11:05:28.403Z (UTC). Report left uncommitted for parent audit.

## Scope and prerequisites

Read `docs/TESTING.md`, `docs/DECISIONS.md`, sponsor lane acceptance, `scripts/sponsor-smoke.ts`, environment/Backboard/voice/cache/Tiger implementations, and applicable tests.

- Existing Node v22.14.0, npm 10.9.2 and local TypeScript/tsx/Vitest/pg dependencies available. No installation performed.
- Root `.env` and readable root `.tiger-ca.pem` present, ignored and untracked. `git check-ignore -v .env .tiger-ca.pem`: .gitignore lines 2 and 4. No credential/certificate contents emitted.
- Loader found BACKBOARD_API_KEY, BB_ASSISTANT_CHIPMUNK, ELEVENLABS_API_KEY, EL_VOICE_CHIPMUNK, TIGER_DATABASE_URL and TIGER_CA_FILE present. Presence alone did not establish validity.
- Only `readEnvFile(root/.env)` supplied sponsor credentials; process environment did not override them. Tiger CA resolved to the existing root certificate. Verified TLS retained (`rejectUnauthorized: true`).
- Initial/final root branch and commit identical; tracked diff empty. Unrelated untracked `compact.md` left untouched.
- No remote fetch: this was verification of the specified local checkout, with root code/Git metadata treated as read-only. Remote freshness is unverified; no merge/integration action performed.
- Fixture material was synthetic text/audio and unique synthetic event identifiers. No personal-folder tests, MCP/connectors, assistants/voices creation, migrations, commits, pushes or merges. `.worktrees/beaver-i` not accessed.

## Prerequisite commands and results

| Command | Expected behavior | Observed result | Status / next action |
| --- | --- | --- | --- |
| `npm.cmd run typecheck` | No TypeScript errors | Exit 0 | **passed** |
| `npm.cmd exec --no -- vitest run tests/backboard.test.ts tests/voice.test.ts tests/tiger.test.ts` | Relevant sponsor regressions pass | Initial sandbox startup exit 1, `spawn EPERM`; approved retry exit 0, 3 files / 68 tests passed | **passed** after environment retry; original startup blockage retained |
| `npm.cmd test` | Entire root suite passes | Approved run exit 0, 34 files / 286 tests passed | **passed** |
| `$live \| node --import tsx --input-type=module -` | Real sponsor calls with safe output and isolated storage | Approved live run exit 0; individual results below | Exit 0 is wrapper completion, not an overall sponsor pass |

Offline tests mock sponsor boundaries and use temporary fixtures; they are not evidence of live sponsor success.

## Live service results

| Service / acceptance | Expected behavior | Observed evidence | Result |
| --- | --- | --- | --- |
| Backboard tool roundtrip | Existing Chip assistant calls report_user_mood; submitting every tool output yields nonempty completed response | Real Google gemini-2.5-flash, memory off; message HTTP 200, REQUIRES_ACTION, one report_user_mood call; tool-outputs HTTP 200, COMPLETED, nonempty content | **passed** |
| ElevenLabs TTS | Generate fresh Chip MP3 through configured tagged model | Real eleven_v4_turbo HTTP 200; 16,344 bytes, 472 ms, alignment present, no fallback | **passed** |
| ElevenLabs cache | Identical repeat makes zero HTTP calls and returns identical audio | Empty isolated cache initially; repeat made 0 network calls; audio identical; 2 cache files (MP3 + alignment) | **passed** |
| ElevenLabs STT + cue acceptance | Transcribe generated fixture through scribe_v2; expected phrase and audio-event cues | Second real TTS HTTP 200; STT HTTP 200; synthetic phrase “nothing is working” matched; 2 cues returned | **passed** |
| Tiger write/read/cleanup | Verified TLS connection; existing biome_events; write 10 events, read 10 ordered, scoped delete, verify 0 remaining | First SELECT 1 failed at SCRAM authentication before schema check or any INSERT. Sanitized diagnostic: “SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string”. Loader/config booleans: URL password absent; pg parsed password not a string; no password query parameter | **blocked** |
| Archie sponsor ask-file | Inspect root archie-smoke first; fixture-only live document Q&A with configured account | `scripts/archie-smoke.ts` absent. No matching root sponsor ask-file implementation/tests found in inspected src/main/sponsors, src/main/store, tests. Active lane untouched | **blocked** |
| Archie sponsor file-ops | Root test/support code uses synthetic fixture; write/read and scoped cleanup | Same missing root script/support prerequisites; no live Archie operations attempted | **blocked** |

The initial live wrapper categorized Tiger's non-HTTP error as **failed** with raw details suppressed. Read-only diagnosis identified a missing authentication prerequisite, so the final service classification is **blocked**. No Tiger roundtrip assertion was weakened or inferred as passed. Existing Tiger credentials may be stale or incomplete; validity remains unverified. Successful Backboard and ElevenLabs operations establish access to the configured assistant/voice for these calls, not account ownership beyond that access.

## Redaction and execution adaptations

The stock script was inspected but not executed verbatim: `redact()` only removes postgres/postgresql URLs. Backboard and ElevenLabs errors can include raw response bodies, and voice fallback logs include error text. Stock voice cache/Tiger pending defaults point to personal ADE data storage; stock smoke only checks repeat latency and does not verify zero network calls or zero rows after cleanup.

The stdin wrapper below invokes the same production classes, model, tools, synthetic lines and event sequence. It suppresses raw error bodies/logs, emits allowlisted status/evidence, injects explicit temporary cache/pending paths, instruments real fetch calls, checks cache equality/network count and scopes Tiger deletion to the newly generated session. No repository code changed.

No raw smoke output was generated or saved. Raw error objects stayed in memory and were not returned. Additional Tiger diagnostic redacted every nonempty loaded environment value before emitting a short message, additionally scrubbed URLs/quoted fields, and exposed only stage/categories. No ignored raw capture is needed when no raw output is produced. No keys, database URL, certificate, account IDs, voice IDs or conversation IDs appear in this report.

## Cleanup

- SHA-256 comparison in memory confirmed root environment and certificate bytes unchanged; digest values were not printed.
- Temporary voice cache/pending directory was removed under a guarded OS temporary-directory path; removal verified.
- Tiger failed before event bus/sink construction and all INSERT/DELETE operations. No test rows or pending-event files created. Database cleanup is not a tested pass; no rows needed deletion.
- Backboard created a synthetic conversation with memory off on the existing assistant. Conversation remains server-side; thread deletion was not attempted because the inspected client has no supported thread cleanup method. No assistant created/deleted and no IDs exposed.
- TTS/STT consumed real service requests; cached repeat consumed none. Generated local audio removed.
- Live wrapper process ended with exit 0 after remaining process handles were interrupted; all sanitized evidence and temporary cleanup had already completed. This does not alter per-service results.
- Root tracked diff empty before report creation. Only requested report added by this agent; compact.md predates the run.

## Exact next fixes

1. Tiger: when Melvin explicitly resumes deferred environment work, privately correct the ignored root TIGER_DATABASE_URL to include a valid password for the intended service. Do not print or paste it. Existing URL has no password and pg resolves a non-string password. Keep TIGER_CA_FILE pointing to existing root CA and verified TLS enabled. No environment change was made or requested in this run.
2. Re-run Tiger SELECT 1 first, then confirm biome_events exists; if absent, have the authorized owner provision the required schema separately. No migration is justified by the current evidence.
3. Then rerun all 10-event ordered write/read assertions and session-scoped delete plus zero-remaining assertion, using temporary pending storage. Tiger handoff remains blocked until this passes.
4. Archie: parent should audit/integrate the lane's sponsor script/implementations into the intended checkout and identify required account IDs/schema and fixture cleanup contract. Reinspect archie-smoke before running fixture-only ask-file/file-ops checks. No inspection or tests inside the concurrently edited worktree.
5. Code-owner follow-up: improve general redaction for API keys/response errors; add explicit cache/pending paths and cache/network/cleanup assertions to stock smoke. Proposed only; no code edits made.
6. Backboard/ElevenLabs require no fix for the accepted checks in this run. No Chip C1–C3 orchestration or wider sponsor asset/music/memory acceptance claimed.

## Exact live wrapper source

Passed as a PowerShell single-quoted here-string to the existing local tsx loader, without a script file or package installation:

```typescript

import {readEnvFile, assistantIdsFromEnv, voiceIdsFromEnv} from './src/main/sponsors/env.ts';
import {BackboardClient} from './src/main/runtime/backboard.ts';
import {ElevenLabsVoice} from './src/main/voice/elevenlabs.ts';
import {VoiceCache} from './src/main/voice/cache.ts';
import {createTigerPool,tigerPoolConfig,TigerEventSink} from './src/main/store/tiger.ts';
import {TigerQueries} from './src/main/store/tigerQueries.ts';
import {EventBus} from './src/main/bus/eventBus.ts';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const root=process.cwd(); const env=readEnvFile(join(root,'.env'));
const files=['.env','.tiger-ca.pem']; const hashes=files.map(f=>createHash('sha256').update(readFileSync(join(root,f))).digest('hex'));
const evidence={time:new Date().toISOString(),prerequisites:{},results:[],http:[],cleanup:{}};
for(const k of ['BACKBOARD_API_KEY','BB_ASSISTANT_CHIPMUNK','ELEVENLABS_API_KEY','EL_VOICE_CHIPMUNK','TIGER_DATABASE_URL','TIGER_CA_FILE']) evidence.prerequisites[k]=Boolean(env[k]);
const temp=mkdtempSync(join(tmpdir(),'ade-sponsor-verify-'));
const classify=e=>{
 const s=String(e?.message??''); const status=e?.status??Number(s.match(/returned (\d{3})/)?.[1]??0);
 if(status===401||status===403||e?.code==='28P01')return {result:'blocked',reason:'existing credential rejected; validity/account ownership unverified',...(status?{httpStatus:status}:{dbCode:'28P01'})};
 if(status===404)return {result:'blocked',reason:'configured resource or model unavailable; account ownership unverified',httpStatus:status};
 if(status===429)return {result:'blocked',reason:'service quota or rate limit',httpStatus:status};
 if(/fetch failed|unreachable|timed out/i.test(s)||['ENOTFOUND','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH'].includes(e?.code))return {result:'blocked',reason:'network/service unreachable',...(e?.code?{code:e.code}:{})};
 if(/certificate|self.signed/i.test(s))return {result:'blocked',reason:'TLS certificate verification failed'};
 return {result:'failed',reason:'behavior assertion or service error; raw details suppressed',...(status?{httpStatus:status}:{})};
};
const out=(name,result,details)=>{const row={name,result,...details};evidence.results.push(row);console.log(JSON.stringify(row));};
const safeFetch=(service)=>async(url,init)=>{
 const timeout=AbortSignal.timeout(25000);
 const response=await fetch(url,{...init,signal:init?.signal?AbortSignal.any([init.signal,timeout]):timeout});
 const model=typeof init?.body==='string'?JSON.parse(init.body).model_id:undefined;
 evidence.http.push({service,operation:service==='Backboard'?(String(url).includes('tool-outputs')?'tool-outputs':'message'):(String(url).includes('speech-to-text')?'STT':'TTS'),status:response.status,...(model?{model}:{})});
 return response;
};
try {
 if(!env.BACKBOARD_API_KEY||!assistantIdsFromEnv(env).chipmunk)out('Backboard roundtrip','blocked',{reason:'missing key or configured assistant'});
 else try {
 const client=new BackboardClient({apiKey:env.BACKBOARD_API_KEY,defaultModel:{llm_provider:'google',model_name:'gemini-2.5-flash'},fetch:safeFetch('Backboard')});
 const first=await client.send({assistantId:assistantIdsFromEnv(env).chipmunk,content:'Ugh, nothing is working today!',memory:'off',systemPrompt:'You are Chip. Every turn, call report_user_mood first.',tools:[{type:'function',function:{name:'report_user_mood',description:"Report your honest read of the user's emotion. Call this first on every turn.",parameters:{type:'object',properties:{mood:{type:'string',enum:['calm','happy','excited','stressed','angry','sad']},intensity:{type:'number'},reason:{type:'string'}},required:['mood','intensity','reason']}}}]});
 evidence.cleanup.backboardThreadCreated=Boolean(first.thread_id);
 if(first.status!=='REQUIRES_ACTION'||first.tool_calls?.[0]?.function.name!=='report_user_mood')throw new Error('assertion');
 const second=await client.submitToolOutputs(first.thread_id,first.tool_calls.map(c=>({tool_call_id:c.id,output:'{"ok":true}'})));
 if(second.status!=='COMPLETED'||!second.content)throw new Error('assertion');
 out('Backboard roundtrip','passed',{firstStatus:'REQUIRES_ACTION',tool:'report_user_mood',toolCount:first.tool_calls.length,secondStatus:'COMPLETED',nonemptyContent:true,memory:'off'});
 }catch(e){const c=classify(e);out('Backboard roundtrip',c.result,c);}
 let voice, clip;
 if(!env.ELEVENLABS_API_KEY||!voiceIdsFromEnv(env).chipmunk){
 for(const n of ['ElevenLabs TTS','ElevenLabs cache','ElevenLabs STT'])out(n,'blocked',{reason:'missing key or configured voice'});
 }else{
 voice=new ElevenLabsVoice({apiKey:env.ELEVENLABS_API_KEY,voiceIds:voiceIdsFromEnv(env),cache:new VoiceCache(join(temp,'voice-cache')),fetch:safeFetch('ElevenLabs'),log:()=>{}});
 try {
 const start=Date.now();clip=await voice.speak('chipmunk','On it!','excited');
 if(clip.audio.byteLength<=1000)throw new Error('assertion');
 out('ElevenLabs TTS','passed',{bytes:clip.audio.byteLength,ms:Date.now()-start,alignment:Boolean(clip.alignment),fallbackUsed:evidence.http.some(x=>x.model==='eleven_flash_v2_5')});
 }catch(e){const c=classify(e);out('ElevenLabs TTS',c.result,c);}
 if(clip) {
 try{const calls=evidence.http.length;const second=await voice.speak('chipmunk','On it!','excited');const extra=evidence.http.length-calls;
 out('ElevenLabs cache',extra===0&&Buffer.from(second.audio).equals(Buffer.from(clip.audio))?'passed':'failed',{repeatNetworkCalls:extra,audioIdentical:Buffer.from(second.audio).equals(Buffer.from(clip.audio)),cacheFileCount:existsSync(join(temp,'voice-cache'))?readdirSync(join(temp,'voice-cache')).length:0});
 }catch(e){const c=classify(e);out('ElevenLabs cache',c.result,c);}
 try{const sample=await voice.speak('chipmunk','Nothing is working today. Ha ha ha, okay, I give up.','relieved');const heard=await voice.transcribe(sample.audio,'audio/mpeg');const matched=/nothing is working/i.test(heard.text);
 out('ElevenLabs STT',matched?'passed':'failed',{syntheticPhraseMatched:matched,cueCount:heard.cues.length,cueAcceptance:heard.cues.length>0?'passed':'failed',model:'scribe_v2'});
 }catch(e){const c=classify(e);out('ElevenLabs STT',c.result,c);}
 }else{out('ElevenLabs cache','blocked',{reason:'TTS did not produce audio'});out('ElevenLabs STT','blocked',{reason:'TTS did not produce synthetic audio fixture; no personal audio used'});}
 }
 if(!env.TIGER_DATABASE_URL||!env.TIGER_CA_FILE||resolve(root,env.TIGER_CA_FILE)!==join(root,'.tiger-ca.pem'))out('Tiger write/read/cleanup','blocked',{reason:'missing credentials or CA loader does not target existing root certificate'});
 else {
 let pool,sink,off,session,attempted=false;
 try{
 const config=tigerPoolConfig(env,root);evidence.prerequisites.verifiedTLS=config.ssl.rejectUnauthorized===true&&Boolean(config.ssl.ca);
 pool=createTigerPool(env,root);
 await pool.query('SELECT 1');
 const schema=await pool.query("SELECT to_regclass('biome_events') IS NOT NULL AS present");
 if(!schema.rows[0]?.present){out('Tiger write/read/cleanup','blocked',{reason:'biome_events migration prerequisite missing; no migration run'});}
 else{
 const bus=new EventBus();session=bus.sessionId;const taskId=randomUUID();const logs=[];
 sink=new TigerEventSink({db:pool,pendingFile:join(temp,'pending-events.jsonl'),log:()=>logs.push(true)});off=sink.attach(bus);
 attempted=true;for(let i=0;i<10;i++)bus.emit({type:'agent.status',agentId:'chipmunk',taskId,status:'thinking',detail:'smoke '+i});
 off();off=undefined;await sink.dispose();sink=undefined;
 const events=await new TigerQueries(pool,()=>logs.push(true)).taskEvents(taskId);
 const ordered=events.length===10&&events.every((e,i)=>e.type==='agent.status'&&e.detail==='smoke '+i);
 const deleted=await pool.query('DELETE FROM biome_events WHERE session_id = $1',[session]);
 const remaining=await pool.query('SELECT count(*)::int AS count FROM biome_events WHERE session_id = $1',[session]);
 evidence.cleanup.tiger={deletedRows:deleted.rowCount,remainingRows:remaining.rows[0].count};
 out('Tiger write/read/cleanup',ordered&&deleted.rowCount===10&&remaining.rows[0].count===0&&logs.length===0?'passed':'failed',{writtenExpected:10,readRows:events.length,ordered,internalErrorLogs:logs.length,deletedRows:deleted.rowCount,remainingRows:remaining.rows[0].count,pendingFile:existsSync(join(temp,'pending-events.jsonl')),verifiedTLS:true});
 }
 }catch(e){const c=classify(e);out('Tiger write/read/cleanup',c.result,c);}
 finally{
 off?.();if(sink)await sink.dispose();
 if(pool&&attempted&&session)try{await pool.query('DELETE FROM biome_events WHERE session_id = $1',[session]);const r=await pool.query('SELECT count(*)::int AS count FROM biome_events WHERE session_id = $1',[session]);evidence.cleanup.tigerFinalRemaining=r.rows[0].count;}catch{evidence.cleanup.tigerFinalCleanup='unverified';}
 if(pool)await pool.end();
 }
 }
}finally{
 if(dirname(temp)!==resolve(tmpdir())||!temp.startsWith(join(tmpdir(),'ade-sponsor-verify-')))throw new Error('temporary path guard');
 rmSync(temp,{recursive:true,force:true});evidence.cleanup.temporaryStorageRemoved=!existsSync(temp);
 evidence.cleanup.envAndCertificateUnchanged=files.every((f,i)=>hashes[i]===createHash('sha256').update(readFileSync(join(root,f))).digest('hex'));
}
console.log('SANITIZED_EVIDENCE '+JSON.stringify(evidence));

```

## Archie continuation — postponed before live calls

Melvin explicitly postponed sponsor verification. No further sponsor tests/API calls are authorized until resumed.

- Inspected the stable `.worktrees/beaver-logic/scripts/archie-smoke.ts`; branch `beaver/logic`, commit `831d4c742f1909359b44dcaf0c721303ac29d1b7`, working tree clean when inspected. The earlier root-only missing-support finding is superseded: this stable worktree contains the ask-file and file-ops sponsor support.
- Fixture `tests/fixtures/syllabus.pdf` exists in that worktree, 22,023 bytes, PDF header confirmed. Read-only standard-library decoding of its compressed text confirmed late homework loses 12 percent per day, is not accepted after four days, and allows one free late pass per semester. No fixture edit. Optional pypdf extraction was unavailable; no packages installed.
- Command `npm.cmd exec --no -- vitest run tests/backboardDocuments.test.ts tests/tigerFileOps.test.ts` in the stable worktree: **passed**, exit 0, 2 files / 24 mocked sponsor tests. Parent independently reported passing typecheck and 598 tests; those parent results were not rerun or independently verified by this agent.
- Archie document upload/index/grounded-answer live verification: **blocked / postponed by user**, not unavailable due to root branch. No Archie API calls started, no synthetic thread/document created, and no server cleanup needed for this continuation.
- Archie live Tiger file-ops remains **blocked** by the previously confirmed missing database password. No additional Tiger connection or write attempted.
- No verification process remains running from this agent's commands; all continuation commands completed. Earlier Chip voice-cache/pending temporary storage was already removed; earlier synthetic Backboard conversation remains as documented above because supported deletion was not established.
- Root environment/certificate left untouched; no credentials injected into process for a live Archie run, no temporary runner created, no worktree files edited, active beaver-i untouched.
- Resume point: use the stable worktree's ask-file subcheck with root-only credentials in process memory and root CA resolution; retain index and answer assertions. Establish supported thread/document cleanup before claiming removal. Do not retry known-blocked Tiger until deferred credential work is explicitly resumed.
# Sponsor retest — 2026-10-04

Authorized by Melvin. Target: existing `scripts/sponsor-smoke.ts` with supplied local credentials.
Execution started at 2026-10-04 09:27:58 UTC.
Branch: `chip/logic`. Commit: `fbdc48a83c5af377810b58e35b0f8f512790b80e`.

Overall result: **blocked** for complete sponsor acceptance. Backboard and ElevenLabs live checks passed. Tiger was blocked before connection because the supplied connection configuration is missing a password. The unchanged smoke script labels the guarded Tiger check FAIL and exits 1; this is a configuration blocker, not evidence of a failed database operation.

## Prerequisites and local checks

| Check | Expected | Observed | Result |
|---|---|---|---|
| Backboard configuration | Nonempty API key and Chip assistant ID | Both present; clean non-whitespace format; no process override | passed |
| ElevenLabs configuration | Nonempty API key and Chip voice ID | Both present; clean non-whitespace format; no process override | passed |
| Tiger configuration | Parseable PostgreSQL configuration with credentials | Protocol, host, database and username present; **password missing** | blocked |
| Tiger CA | Configured, readable PEM/X509 certificate | Configured path matches copied `.tiger-ca.pem`; certificate parses and is within its validity period | passed |
| Local runner | Installed tsx and dependencies | Local tsx installed and successfully executed after startup corrections | passed |
| Ignored sensitive/local files | Files excluded by git ignore rules | `git check-ignore .env .tiger-ca.pem sponsor-retest.log` confirmed all three ignored | passed |

Format checks do not independently prove credential validity or account ownership. Successful live requests provide evidence that the supplied Backboard assistant and ElevenLabs voice were accessible with their supplied keys. Certificate checks establish local format and validity only; server TLS trust could not be verified without a Tiger connection.

## Expected and observed live evidence

| Test | Expected | Observed | Result |
|---|---|---|---|
| Backboard | First tool is report_user_mood with REQUIRES_ACTION; tool outputs produce COMPLETED with text | Two POST responses HTTP 200; report_user_mood reported stressed, intensity 0.8; required state sequence passed | passed |
| ElevenLabs TTS | More than 1,000 audio bytes for Chip; repeat uses cache | HTTP 200; 16,344 bytes; first synthesis 437 ms; repeat 0 ms; lip-sync timing returned | passed |
| ElevenLabs cache | Repeat should avoid another synthesis request | Only one POST across both identical speak calls; real VoiceCache implementation stored/retrieved through isolated in-memory filesystem | passed within isolation |
| ElevenLabs STT | Synthetic speech transcribes with “nothing is working”; capture audio-event cues | Additional synthesis HTTP 200 and STT HTTP 200; transcript “Nothing is working today. Okay, I give up”; cues [sighs], [laughs] | passed |
| Tiger temporary events | Write 10 synthetic events, read 10 in order, delete only test-session rows | No connection attempted. Password absent in supplied configuration. Process-only guard causes script to stop before pool creation or event buffering | blocked |

Final request counts: Backboard 2; ElevenLabs 3. No HTTP 401/403 responses occurred. Authentication stop guards would prevent additional requests to the affected service after either response. Four isolated voice-cache entries were created in memory; no audio/cache files were written to disk.

## Commands and execution evidence

Read `docs/TESTING.md`, `docs/handoff/chip-sponsors.md`, `scripts/sponsor-smoke.ts`, `src/main/store/tiger.ts`, `src/main/voice/elevenlabs.ts`, and supporting environment/parser, voice-cache and Backboard source. The shorthand handoff/store/voice paths in the request were resolved to these repository locations.

Read-only repository commands:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git check-ignore .env .tiger-ca.pem sponsor-retest.log
```

An inline Node preflight used the same environment parser semantics as the existing script, inspected only presence/format booleans, parsed the database configuration internally, and parsed the certificate using X509Certificate. No credential, identifier, certificate contents or raw connection configuration was printed.

The ordinary prescribed command is `npx.cmd tsx scripts/sponsor-smoke.ts`. This retest used the already installed local runner with an inline safety wrapper to honor the two-file ownership boundary, credential-redaction requirement and authentication stop rule. Exact execution command (contains no supplied credential values):

```powershell
$verificationCode = @'
(async () => {
const fs = await import('node:fs');
const {readEnvFile} = await import('./src/main/sponsors/env.ts');
const env={...readEnvFile('.env'),...process.env};
const log=fs.appendFileSync;
const secrets=Object.entries(env).filter(([k,v])=>v&&/KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|BB_ASSISTANT_|EL_VOICE_/.test(k)).map(([,v])=>v).sort((a,b)=>b.length-a.length);
const scrub=v=>{let s=String(v);for(const x of secrets)s=s.split(x).join('[REDACTED]');return s.replace(/(?:https?|postgres(?:ql)?):\/\/[^\s"'<>]+/gi,'[REDACTED URL]').replace(/\b(?:sk|xi|bb)_[A-Za-z0-9_-]+/g,'[REDACTED KEY]');};
const emit=(...a)=>{const s=a.map(v=>scrub(typeof v==='string'?v:JSON.stringify(v))).join(' ');log('sponsor-retest.log',s+'\n');process.stdout.write(s+'\n');};
console.log=console.warn=console.error=emit;
process.on('uncaughtException',e=>{emit('BLOCKED unhandled:',e.message);process.exit(1);});
process.on('unhandledRejection',e=>{emit('BLOCKED unhandled:',e instanceof Error?e.message:e);process.exit(1);});
emit('Initial sandbox attempt: tsx startup blocked by esbuild spawn EPERM; no sponsor requests made.');
emit('Sponsor retest started:',new Date().toISOString());
emit('Command: local tsx --eval safety wrapper importing unchanged scripts/sponsor-smoke.ts');
emit('Preflight: required keys/Chip IDs present, clean format, no process overrides. CA readable, valid PEM/X509, current validity, matches copied file. Tiger password missing.');
const blocked=new Set(),counts={Backboard:0,ElevenLabs:0};
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 const service=u.hostname.includes('elevenlabs')?'ElevenLabs':u.hostname.includes('backboard')?'Backboard':'other';
 if(blocked.has(service))throw new Error(service+' auth blocked; further requests stopped');
 counts[service]=(counts[service]||0)+1;
 try{
 const res=await realFetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
 emit('HTTP evidence:',service,init?.method||'GET','status',res.status);
 if([401,403].includes(res.status)){blocked.add(service);emit('BLOCKED',service,'auth rejected; affected requests stopped');throw new Error(service+' auth rejected HTTP '+res.status);}
 return res;
 }catch(e){emit('Request outcome:',service,e.message);throw e;}
};
const nativeFs=fs.default,cacheFiles=new Map(),cachePath=p=>String(p).includes('voice-cache');
for(const name of ['existsSync','readFileSync','writeFileSync','mkdirSync']){
 const original=nativeFs[name];
 nativeFs[name]=function(p,...args){
 if(!cachePath(p))return original.call(this,p,...args);
 const key=String(p);
 if(name==='existsSync')return cacheFiles.has(key);
 if(name==='readFileSync'){if(!cacheFiles.has(key))throw new Error('isolated cache miss');const b=cacheFiles.get(key);return args[0]?b.toString():Buffer.from(b);}
 if(name==='writeFileSync'){cacheFiles.set(key,Buffer.from(args[0]));return;}
 return undefined;
 };
}
(await import('node:module')).syncBuiltinESMExports();
process.env.TIGER_DATABASE_URL='';
emit('BLOCKED Tiger: password missing in supplied URL; process-only guard prevents connection and pending-event writes; .env unchanged.');
emit('Real VoiceCache implementation uses isolated in-memory filesystem. No existing cache reused; disk persistence not tested.');
process.on('beforeExit',()=>emit('Final evidence:',{networkRequests:counts,authBlockedServices:[...blocked],isolatedCacheFiles:cacheFiles.size,exitCode:process.exitCode||0}));
await import('./scripts/sponsor-smoke.ts');
})().catch(e=>{console.error('BLOCKED wrapper:',e.message);process.exitCode=1;});
'@
$codeBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($verificationCode))
& node node_modules/tsx/dist/cli.mjs --eval "eval(Buffer.from('$codeBase64','base64').toString())"
```

The wrapper leaves source and .env unchanged. It redacts supplied keys/IDs and network addresses before writing output; uses real sponsor HTTP requests; checks HTTP authentication rejections; substitutes memory-backed filesystem operations only for voice-cache paths; and sets an empty Tiger configuration **only in the child process** to block an unconfigured database lane before any write. The empty child value explains the script’s “TIGER_DATABASE_URL is missing” diagnostic; the supplied local configuration actually exists but has no password.

Startup attempts are preserved as limitations:
1. Initial sandbox launch could not start esbuild: `spawn EPERM`. No sponsor requests ran.
2. An approved elevated launch reached esbuild but PowerShell altered the inline argument: `Unterminated string literal`. No sponsor requests ran.
3. Base64 argument transport corrected shell quoting, and the guarded existing smoke script executed. This encoding transports executable code only, not credentials. It exited 1 because Tiger was deliberately blocked.

## Limitations and exact missing prerequisites

- **Tiger:** parent/account owner must supply the missing password in the ignored local configuration. The agent made no .env change. Once credentials are complete, a reachable service, server certificate trusted by the supplied CA, and an existing compatible `biome_events` schema with SELECT/INSERT/DELETE privileges are required. Reachability, authentication, permissions and schema availability remain unverified; they are not asserted to be missing. No migration or schema change was attempted.
- **Voice cache:** get/set and reuse behavior passed with the real cache implementation and isolated memory storage. Disk persistence, restart reuse, filesystem permissions and production cache directory behavior remain untested.
- **Scope:** this is sponsor smoke evidence, not full CLI/app acceptance, account-wide voice availability, Backboard long-term memory acceptance or a whole-repository regression result. The Backboard test uses memory off and creates synthetic service thread data; no thread cleanup is implemented by the existing script.
- **Working tree:** unrelated existing modifications were present in .gitignore, scripts/chip-cli.ts, Chip prompt, orchestrator and orchestrator tests, plus pre-existing untracked documentation/worktree paths. User authorization for this narrowly scoped retest overrides the general clean-tree/fetch instruction. No fetch, branch switch, git state mutation, source edit, test fix, contract edit, dependency install, commit or push was performed.
- No TLS verification was disabled. Tiger code retains rejectUnauthorized: true. No database write, delete, pending-event file or persistent schema mutation occurred.
- Owned output artifacts: this new report and ignored `sponsor-retest.log`. Raw credentials and network addresses are absent from both.

Next action: parent supplies the Tiger password and reruns the Tiger lane with verified TLS against the pre-existing schema. Full sponsor acceptance remains blocked until temporary write/read/delete behavior has real evidence.


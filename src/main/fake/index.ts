import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENTS } from '../../shared/config';
import type { AgentId } from '../../shared/agents';
import type { AdeSettings } from '../../shared/ipc';
import type { BiomeEvent } from '../../shared/events';
import type { BiomeEventInput, Clock } from '../runtime/types';
import { EventBus } from '../bus/eventBus';
import { createEventPlayer } from './eventPlayer';
import type { CreateFakeCore, CoreAdapter, FakeCoreOptions } from '../shell/contracts';
import type { DemoScript, FakeAuditRow, FakePulse } from './types';
import { boot, emailDigest, parallel, angryRelief, wardenBlock, approval, antPlan, sleepDockWake, nudge, recall } from './scripts/index';
const ids = Object.keys(AGENTS) as AgentId[];
const scripts = [emailDigest, parallel, angryRelief, wardenBlock, approval, antPlan, sleepDockWake, nudge, recall];
const clockDefault: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const defaults = (opts: FakeCoreOptions): AdeSettings => {
 const model={llm_provider:'openai',model_name:'gpt-4o'};
 return {models:Object.fromEntries(ids.map(id=>[id,{...model}])) as AdeSettings['models'],voiceEnabled:true,allowedFolders:[],biome:'forest',demoMode:opts.demoMode??false,installed:Object.fromEntries(ids.map(id=>[id,AGENTS[id].tier==='core'])) as AdeSettings['installed'],timers:opts.demoMode?{sleepAfterSec:30,dockAfterSec:60,moodDecaySec:20}:{sleepAfterSec:180,dockAfterSec:600,moodDecaySec:20},nudges:{enabled:true,quietStart:'23:00',quietEnd:'08:00',maxPerHour:3}};
};
export const createFakeCore: CreateFakeCore = (opts = {}): CoreAdapter => {
 const clock=opts.clock??clockDefault, bus=new EventBus({clock}), players=new Set<ReturnType<typeof createEventPlayer<BiomeEventInput>>>(), approvals=new Map<string,(approved:boolean)=>void>(); let settings=defaults(opts), dnd=false, run=0;
 const emit=(event:BiomeEventInput)=>bus.emit(event);
 const playback=(script:DemoScript, taskId:string, initial=script.steps, done?:()=>void)=>{
  const player=createEventPlayer<BiomeEventInput>({clock}); players.add(player);
  player.load(initial.map(({atMs,event})=>({atMs,event:{...event,taskId,...(('jobId' in event)?{jobId:`${event.jobId}-${run}`} : {}),...(('callId' in event)?{callId:`${event.callId}-${run}`} : {})} as BiomeEventInput})));
  const unsub=player.onDone(()=>{players.delete(player);unsub();done?.();}); player.play(emit); return player;
 };
 const start=()=>{const taskId=`task-${++run}`; const events: {atMs:number;event:BiomeEventInput}[]=[]; ids.forEach((id,i)=>events.push({atMs:i*150,event:{type:'agent.presence',agentId:id,presence:settings.installed[id]?(AGENTS[id].tier==='extra'?'sleeping':'active'):'not_installed',reason:'startup'}})); events.push({atMs:ids.length*150,event:{type:'agent.say',agentId:'chipmunk',text:'Hi! I’m Chip, and your ADE crew is ready to help.',bubble:'Hello!','priority':'chip'}}); playback({...boot,steps:events},taskId); };
 const api: CoreAdapter={subscribe:cb=>bus.subscribe(cb),start,dispose:()=>{for(const p of players)p.stop();players.clear();approvals.clear();},sendMessage:async(text,source)=>{const taskId=`task-${++run}`; emit({type:'user.message',agentId:'chipmunk',text,source,taskId}); const lower=text.toLowerCase(); const script=source==='voice'?emailDigest:scripts.find(s=>s.keywords.some(k=>lower.includes(k))); if(!script){playback({name:'fallback',keywords:[],steps:[{atMs:0,event:{type:'agent.status',agentId:'chipmunk',status:'thinking'}},{atMs:250,event:{type:'agent.say',agentId:'chipmunk',text:'On it!',bubble:'On it','priority':'ack'}},{atMs:600,event:{type:'agent.say',agentId:'chipmunk',text:'In the full app I’d hand that to the right animal.',bubble:'I can help','priority':'chip'}}]},taskId);return;} if(script===approval){let waiting=false; playback(script,taskId,script.steps,undefined); const callId=`trash-${run}`; approvals.set(callId,(approved)=>playback(script,taskId,[...(approved?script.approval!.approved:script.approval!.denied)])); waiting=true; void waiting; return;} if(script===sleepDockWake){const id='beaver'; const timers=settings.timers; playback({ ...script,steps:[{atMs:timers.sleepAfterSec*1000,event:{type:'agent.presence',agentId:id,presence:'sleeping',reason:'idle_timeout'}},{atMs:timers.dockAfterSec*1000,event:{type:'agent.presence',agentId:id,presence:'docked',reason:'dock_timeout'}}]},taskId);return;} playback(script,taskId); },sendVoice:async()=>{await api.sendMessage('(voice message)','voice');},speak:async(agentId)=>{try{const b=await readFile(join(opts.resourcesDir??'resources/fake',`voices/${agentId}.mp3`));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;}catch{return new ArrayBuffer(0);}},resolveApproval:async(callId,approved)=>{approvals.get(callId)?.(approved);approvals.delete(callId);},wakeAgent:async(agentId)=>{emit({type:'agent.presence',agentId,presence:'active',reason:'user'});},setDoNotDisturb:async on=>{dnd=on;void dnd;},demoFireNudge:async()=>api.sendMessage('nudge','text'),getSettings:async()=>structuredClone(settings),setSettings:async patch=>{settings={...settings,...patch,models:{...settings.models,...patch.models},installed:{...settings.installed,...patch.installed},timers:{...settings.timers,...patch.timers},nudges:{...settings.nudges,...patch.nudges}};},connectGoogle:async()=>{settings={...settings,googleEmail:'demo.user@gmail.com'};return {email:'demo.user@gmail.com'};},learnEmailStyle:async()=>({sampled:25}),getTimeline:async(from,to)=>bus.recent().filter(e=>e.ts>=from&&e.ts<=to),getTaskEvents:async(taskId)=>bus.recent().filter(e=>e.taskId===taskId),getMemories:async(agentId)=>memories[agentId].map(x=>({...x})),searchMemories:async(agentId,q)=>memories[agentId].filter(x=>x.memory.toLowerCase().includes(q.toLowerCase())).map(x=>({...x})),updateMemory:async(agentId,id,text)=>{const m=memories[agentId].find(x=>x.id===id);if(m)m.memory=text;},deleteMemory:async(agentId,id)=>{memories[agentId]=memories[agentId].filter(x=>x.id!==id);},getPulse:async()=>pulse(),getWardenAudit:async(limit)=>audit.slice().reverse().slice(0,limit)};
 const audit:FakeAuditRow[]=[{ts:clock.now()-86400000,agentId:'wolf',tool:'gmail_send',verdict:'deny',rule:'W1',reason:'External sending is blocked.'},{ts:clock.now()-400000,agentId:'wolf',tool:'fs_trash',verdict:'ask',rule:'W3',reason:'File changes require approval.'}];
 bus.subscribe((event:BiomeEvent)=>{if(event.type==='wolf.verdict'){const request=bus.recent().find(e=>e.type==='tool.request'&&e.callId===event.callId);audit.push({ts:event.ts,taskId:event.taskId,agentId:'wolf',tool:request?.type==='tool.request'?request.tool:'unknown',verdict:event.verdict,rule:event.rule,reason:event.reason});}});
 const moodWeek:FakePulse['moodWeek']=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day,i)=>({day:day as FakePulse['moodWeek'][number]['day'],mood:(i===4?'happy':'calm'),score:i===4?.82:.65}));
 function pulse():FakePulse {const recent=bus.recent();const jobsPerAgent:FakePulse['jobsPerAgent']={};for(const e of recent)if(e.type==='job.update')jobsPerAgent[e.to]=(jobsPerAgent[e.to]??0)+1;return {moodWeek,jobsPerAgent,wardenBlocks:audit.filter(x=>x.verdict==='deny').length,wardenAsks:audit.filter(x=>x.verdict==='ask').length};}
 return api;
};
const memories:Record<AgentId,{id:string;memory:string}[]> = Object.fromEntries(ids.map(id=>[id,[{id:`${id}-1`,memory:'Prefers concise, practical summaries.'},{id:`${id}-2`,memory:'Likes clear next steps and gentle reminders.'},{id:`${id}-3`,memory:'Morning focus time works especially well.'}]])) as Record<AgentId,{id:string;memory:string}[]>;





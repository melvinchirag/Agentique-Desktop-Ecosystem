import { IPC } from '../../shared/ipc';
import type { RegisterCoreIpc, CoreAdapter } from '../shell/contracts';
function validate(key:string,args:unknown[]):void {
 if(key==='sendMessage' && (typeof args[0]!=='string'||args[0].length>4000)) throw new Error('sendMessage expects text up to 4000 characters');
 if(key==='sendVoice' && (!(args[0] instanceof ArrayBuffer)||args[0].byteLength>10*1024*1024)) throw new Error('sendVoice expects an ArrayBuffer up to 10 MB');
 if(['wakeAgent','speak','getMemories','searchMemories','getTaskEvents','resolveApproval','updateMemory','deleteMemory'].includes(key) && typeof args[0]!=='string') throw new Error(`${key} expects a string id`);
}
export const registerCoreIpc: RegisterCoreIpc = (adapter,{ipc,targets}) => {
 const keys=Object.keys(IPC).filter(key=>key!=='event') as (keyof Omit<CoreAdapter,'subscribe'|'start'|'dispose'>)[];
 for(const key of keys) ipc.handle(IPC[key],async(_event,...args)=>{validate(key,args);return (adapter[key] as (...params:unknown[])=>unknown).apply(adapter,args);});
 const unsubscribe=adapter.subscribe(event=>{for(const target of targets()){try{if(!target.isDestroyed())target.send(IPC.event,event);}catch(error){console.error('[ipc] event target failed',error);}}});
 return ()=>{for(const key of keys)ipc.removeHandler(IPC[key]);unsubscribe();};
};

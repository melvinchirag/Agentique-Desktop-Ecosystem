const fs=require('node:fs');const d=JSON.parse(fs.readFileSync(__dirname+'/details.json','utf8'));
const rates={'gpt-6-astra':[250,25,1250],'gpt-6.1-sol':[50,2.5,250],'gpt-6-sol':[50,5,250],'gpt-6-luna':[2.5,.25,12.5],'gpt-5.6-luna':[5,.5,30],'gpt-5.6-terra':[50,5,300]};
const out=[];
for(const id of d.roots){const root=d.results.find(s=>s.id===id);const family=d.results.filter(s=>(s.id===id||s.parent===id)&&s.source!=='guardian');const models={};
for(const s of family)for(const b of s.usage){const a=models[b.model]??={input:0,cached:0,output:0,reasoning:0,requests:0,credits:0,inputCredits:0,cachedCredits:0,outputCredits:0};
for(const k of ['input','cached','output','reasoning','requests'])a[k]+=b[k];a.credits+=b.standardCredits??0;
const r=rates[b.model];if(r){a.inputCredits+=(b.input-b.cached)*r[0]/1e6;a.cachedCredits+=b.cached*r[1]/1e6;a.outputCredits+=b.output*r[2]/1e6;}}
const sum={input:0,cached:0,output:0,reasoning:0,requests:0,credits:0};for(const b of Object.values(models))for(const k of Object.keys(sum))sum[k]+=b[k];
out.push({root:id,start:root.start,end:root.end,lastFinal:root.assistantFinals.at(-1),models,sum,workers:family.length-1});}
fs.writeFileSync(__dirname+'/summary.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));

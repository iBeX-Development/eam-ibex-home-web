import {readFileSync,existsSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
const app=process.env.PM2_APP||'ibex-web-app';
const config=parseEnv(readFileSync('.env.vps','utf8'));
const environment={...process.env,...config};
let args=['reload',app,'--update-env'],temporary;
if(existsSync('ecosystem.config.cjs')){
  const original=createRequire(import.meta.url)(resolve('ecosystem.config.cjs'));
  const selected=original.apps?.find(p=>p.name===app);if(!selected)throw Error('Application missing from ecosystem configuration');
  temporary=mkdtempSync(join(process.env.V88_TRANSFER_DIR||'/opt/sites/.ibex-v88-transfer','reload-'));
  const path=join(temporary,'ecosystem.json');
  writeFileSync(path,JSON.stringify({apps:[{...selected,cwd:selected.cwd||process.cwd(),env:{...selected.env,...config}}]}),{mode:0o600});
  args=['startOrReload',path,'--only',app,'--update-env'];
}
let result;try{result=spawnSync('pm2',args,{env:environment,stdio:'inherit'});}finally{if(temporary)rmSync(temporary,{recursive:true,force:true});}
if(result.error||result.status!==0)throw Error('PM2 reload failed');
const state=spawnSync('pm2',['jlist'],{env:environment,encoding:'utf8'});
if(state.error||state.status!==0)throw Error('PM2 runtime verification unavailable');
let processes;try{processes=JSON.parse(state.stdout);}catch{throw Error('PM2 returned an invalid state response');}
const actual=processes.find(p=>p.name===app)?.pm2_env;
if(!actual)throw Error('PM2 application missing');
const keys=['DIRECTUS_ADMIN_ROLE_NAMES','DIRECTUS_URL','HOME_AI_ID_HASH_SALT','OPENAI_HOME_API_KEY','OPENAI_MARKETING_API_KEY'].filter(k=>k in config);
const mismatches=keys.filter(k=>(actual[k]??actual.env?.[k])!==config[k]);
if(mismatches.length)throw Error('PM2 application setting mismatch: '+mismatches.join(', '));
console.log('[deploy] runtime settings verified:',keys.length);

import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
const app=process.env.PM2_APP||'ibex-web-app';
const config=parseEnv(readFileSync('.env.vps','utf8'));
const environment={...process.env,...config};
const args=existsSync('ecosystem.config.cjs')?['startOrReload','ecosystem.config.cjs','--only',app,'--update-env']:['reload',app,'--update-env'];
const result=spawnSync('pm2',args,{env:environment,stdio:'inherit'});
if(result.error||result.status!==0)throw Error('PM2 reload failed');
const state=spawnSync('pm2',['jlist'],{env:environment,encoding:'utf8'});
if(state.error||state.status!==0)throw Error('PM2 runtime verification unavailable');
let processes;try{processes=JSON.parse(state.stdout);}catch{throw Error('PM2 returned an invalid state response');}
const actual=processes.find(p=>p.name===app)?.pm2_env;
if(!actual)throw Error('PM2 application missing');
const keys=['DIRECTUS_ADMIN_ROLE_NAMES','DIRECTUS_URL','HOME_AI_ID_HASH_SALT','OPENAI_HOME_API_KEY','OPENAI_MARKETING_API_KEY'].filter(k=>k in config);
if(keys.some(k=>(actual[k]??actual.env?.[k])!==config[k]))throw Error('PM2 application settings do not match migrated configuration');
console.log('[deploy] runtime settings verified:',keys.length);

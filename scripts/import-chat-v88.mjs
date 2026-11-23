import {readFile,writeFile,rename,stat} from 'node:fs/promises';
import {createHash,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import pg from 'pg';
import {S3Client,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {transferValue} from './v88-transfer-values.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const id=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Invalid identifier');return '"'+s+'"';};
const envelope=JSON.parse(await readFile('migration/v88.encrypted.json','utf8'));
const key=privateDecrypt({key:await readFile(process.env.V88_TRANSFER_PRIVATE_KEY||'/opt/sites/.ibex-v88-transfer/private.pem'),oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.key,'base64'));
const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
const raw=Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]);
if(hash(raw)!==envelope.sha256)throw Error('Bundle checksum mismatch');
const marker='/opt/sites/.ibex-v88-transfer/imported-'+envelope.sha256;
try{await stat(marker);console.log('[v88-import] already applied');process.exit(0);}catch(e){if(e.code!=='ENOENT')throw e;}
const bundle=JSON.parse(raw);
if(bundle.schema!==1||bundle.sourceVersion!==88)throw Error('Unsupported source');
const expected=JSON.parse(await readFile('migration/v88-manifest.json','utf8'));
if(expected.sha256!==envelope.sha256||JSON.stringify(Object.keys(bundle.tables).sort())!==JSON.stringify(expected.tables.slice().sort()))throw Error('Manifest mismatch');
for(const object of bundle.objects){const b=Buffer.from(object.base64,'base64');if(b.length!==object.size||hash(b)!==object.sha256)throw Error('Object checksum mismatch');}
if(process.argv.includes('--verify-only')){console.log('[v88-import] bundle integrity verified');process.exit(0);}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,ssl:process.env.PGSSL==='require'?{rejectUnauthorized:process.env.PGSSL_REJECT_UNAUTHORIZED!=='false'}:undefined});
const canonical=x=>JSON.stringify(x,Object.keys(x).sort());
const fingerprint=rows=>hash(rows.map(canonical).sort().join('\n'));
const report={sourceVersion:88,sha256:envelope.sha256,tables:[],objects:[],runtimeKeys:[],completedAt:null};
const client=await pool.connect();
try{
  const schema=(await client.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'")).rows;
  const schemaByTable=new Map();for(const c of schema){if(!schemaByTable.has(c.table_name))schemaByTable.set(c.table_name,new Map());schemaByTable.get(c.table_name).set(c.column_name,c.data_type);}
  const normalized={};
  for(const [table,rows] of Object.entries(bundle.tables)){
    id(table);const columns=schemaByTable.get(table);if(!columns)throw Error('Missing target table '+table);
    normalized[table]=rows.map(row=>Object.fromEntries(Object.entries(row).map(([column,value])=>{
      if(!columns.has(column))throw Error('Missing target column '+table+'.'+column);
      return [column,transferValue(columns.get(column),value)];
    })));
  }
  const s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION||'us-east-1',forcePathStyle:process.env.S3_FORCE_PATH_STYLE!=='false',credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
  for(const object of bundle.objects){
    const m=object.httpMetadata||{};await s3.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:object.key,Body:Buffer.from(object.base64,'base64'),ContentType:m.contentType,ContentDisposition:m.contentDisposition,CacheControl:m.cacheControl,ContentEncoding:m.contentEncoding,ContentLanguage:m.contentLanguage,Metadata:object.customMetadata}));
    const read=await s3.send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:object.key}));const bytes=await read.Body.transformToByteArray();if(hash(bytes)!==object.sha256)throw Error('Uploaded object verification failed');report.objects.push({key:object.key,size:object.size,sha256:object.sha256});
  }
  await client.query('BEGIN');await client.query('SET LOCAL lock_timeout = \'30s\'');
  const tables=Object.keys(normalized);await client.query('LOCK TABLE '+tables.map(id).join(',')+' IN ACCESS EXCLUSIVE MODE');
  for(const table of tables)await client.query('DELETE FROM '+id(table));
  for(const [table,rows] of Object.entries(normalized)){
    for(const row of rows){const columns=Object.keys(row);await client.query('INSERT INTO '+id(table)+' ('+columns.map(id).join(',')+') VALUES ('+columns.map((_,i)=>'$'+(i+1)).join(',')+')',columns.map(c=>row[c]));}
    const actual=(await client.query('SELECT * FROM '+id(table))).rows;
    const projected=actual.map(row=>Object.fromEntries(Object.keys(rows[0]||{}).map(c=>[c,transferValue(schemaByTable.get(table).get(c),row[c])])));
    if(actual.length!==rows.length||fingerprint(projected)!==fingerprint(rows))throw Error('Row reconciliation failed '+table);
    report.tables.push({table,rows:rows.length,sha256:fingerprint(rows)});console.log('[v88-import]',table,rows.length);
  }
  const allowed=['DIRECTUS_ADMIN_ROLE_NAMES','DIRECTUS_URL','HOME_AI_ID_HASH_SALT','OPENAI_HOME_API_KEY','OPENAI_MARKETING_API_KEY'];
  const runtime=bundle.runtimeEnv||{};if(Object.keys(runtime).some(k=>!allowed.includes(k)||typeof runtime[k]!=='string'||/[\r\n\0]/.test(runtime[k])))throw Error('Invalid runtime configuration');
  let envText=await readFile('.env.vps','utf8');
  for(const [k,v]of Object.entries(runtime)){envText=envText.split('\n').filter(line=>!new RegExp('^\\s*(?:export\\s+)?'+k+'\\s*=').test(line)).join('\n');const quote=v.includes('"')?"'":'"';if(v.includes(quote))throw Error('Unsupported quoted runtime value');envText+='\n'+k+'='+quote+v+quote+'\n';report.runtimeKeys.push(k);}
  // Stage configuration before committing the database. The atomic rename does not expose values.
  await writeFile('.env.vps.transfer',envText,{mode:0o600});
  await client.query('COMMIT');await rename('.env.vps.transfer','.env.vps');
  report.completedAt=new Date().toISOString();await writeFile(marker,JSON.stringify(report),{mode:0o600});
  console.log('[v88-import] verified',report.tables.length,'tables,',report.objects.length,'objects,',report.runtimeKeys.length,'runtime settings');
}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();await pool.end();}

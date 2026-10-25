import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
import path from 'node:path';

// Only the selected trusted User MCP is started; credentials never enter prompts or logs.
export async function connectBitbucketMcp({workspace,repository,write=false,reviewers=[],configPath=path.join(homedir(),'.claude.json'),server='bitbucket',spawnProcess=spawn}={}) {
  if(!/^[A-Za-z0-9_-]+$/.test(workspace || '') || !/^[A-Za-z0-9_.-]+$/.test(repository || '') || ['.','..'].includes(repository))
    throw Error('Invalid Bitbucket repository scope');
  const config=JSON.parse(await readFile(configPath,'utf8')).mcpServers?.[server];
  if(!config || config.type!=='stdio' || config.command!=='npx' ||
    JSON.stringify(config.args)!==JSON.stringify(['-y','@aashari/mcp-server-atlassian-bitbucket']))
    throw Error('Configure the installed Bitbucket User MCP (npx @aashari/mcp-server-atlassian-bitbucket) in ~/.claude.json');
  const env={...process.env,...config.env};
  for(const [key,value] of Object.entries(config.env || {})) {
    if(typeof value!=='string')throw Error('Invalid Bitbucket MCP environment configuration');
    env[key]=value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,(_,name)=>{
      if(!process.env[name])throw Error(`Missing Bitbucket MCP environment variable: ${name}`);
      return process.env[name];
    });
  }
  const detached=process.platform!=='win32';
  const child=spawnProcess('npx',['--offline','-y','@aashari/mcp-server-atlassian-bitbucket'],{env,stdio:['pipe','pipe','pipe'],shell:false,detached});
  child.stderr.on('data',()=>{});
  let sequence=0; const pending=new Map();
  const fail=()=>{for(const p of pending.values())p.reject(Error('Bitbucket MCP disconnected; check its local configuration and authentication'));pending.clear();};
  child.on('error',fail);child.on('exit',fail);
  child.stdin.on('error',fail);child.stdout.on('error',fail);
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
    if(line.length>2_000_000){fail();return;}
    let value;try{value=JSON.parse(line);}catch{return;}
    const request=pending.get(value.id);if(!request)return;pending.delete(value.id);
    if(value.error)request.reject(Error('Bitbucket MCP request failed; inspect the selected connection'));
    else request.resolve(value.result);
  });
  const rpc=(method,params)=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Bitbucket MCP timed out; reconcile PR state before retrying a write'));},60000);
    pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  const close=async()=>{
    lines.close();child.stdin.end();
    try {if(detached && child.pid)process.kill(-child.pid,'SIGTERM');else child.kill();}catch{}
    fail();
  };
  try {
    await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'devquest-bitbucket',version:'1'}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const inventory=await rpc('tools/list',{});
    for(const name of write?['bb_get','bb_post']:['bb_get'])
      if(!inventory.tools?.some(t=>t.name===name))throw Error(`Required Bitbucket MCP tool unavailable: ${name}`);
    const root=`/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}`;
    return {close,async request(method,target,{queryParams,body}={}) {
      const prRoot=root+'/pullrequests';
      const allowedRead=target===root || target===prRoot ||
        (target.startsWith(root+'/commit/') && /^[0-9a-f]{12,40}$/.test(target.slice((root+'/commit/').length))) ||
        (target.startsWith(prRoot+'/') && /^\d+$/.test(target.slice(prRoot.length+1))) ||
        reviewers.some(name=>target===`/users/${encodeURIComponent(name)}`);
      if(!((method==='GET'&&allowedRead)||(write&&method==='POST'&&target===prRoot)))
        throw Error('Bitbucket MCP operation denied: only scoped PR reads and explicitly authorized PR creation are permitted');
      const result=await rpc('tools/call',{name:method==='GET'?'bb_get':'bb_post',arguments:{path:target,...(queryParams?{queryParams}:{}),...(body?{body}:{}),outputFormat:'json'}});
      const text=(result.content || []).filter(c=>c.type==='text').map(c=>c.text).join('\n');
      if(result.isError) {
        let safe=text;
        for(const [name,value] of Object.entries(env))if(/token|secret|password|email|key/i.test(name)&&value)safe=safe.replaceAll(value,'[REDACTED]');
        safe=safe.replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]');
        throw Error('Bitbucket MCP rejected the request: '+safe.slice(0,500));
      }
      try{return JSON.parse(text);}catch{throw Error('Bitbucket MCP returned incomplete or non-JSON output; reconcile publication before retrying');}
    }};
  }catch(error){await close();throw error;}
}

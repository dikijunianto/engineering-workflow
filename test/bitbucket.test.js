import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {connectBitbucketMcp} from '../src/bitbucket-mcp.js';
import {BitbucketProvider,bitbucketRepository} from '../src/adapters.js';
function directory(t){const dir=mkdtempSync(path.join(os.tmpdir(),'devquest bitbucket '));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

test('selected User Bitbucket MCP connects without Claude and rejects writes before dispatch in read-only mode',async t=>{
 const dir=directory(t),configPath=path.join(dir,'claude.json');
 writeFileSync(configPath,JSON.stringify({mcpServers:{bitbucket:{type:'stdio',command:'npx',args:['-y','@aashari/mcp-server-atlassian-bitbucket'],env:{ATLASSIAN_API_TOKEN:'synthetic-secret'}}}}));
 const calls=[];
 const spawnProcess=(file,args,options)=>{
  assert.equal(file,'npx');assert.deepEqual(args,['--offline','-y','@aashari/mcp-server-atlassian-bitbucket']);assert.equal(options.shell,false);
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('exit',0);
  child.stdin.on('data',chunk=>{const m=JSON.parse(chunk);if(m.id==null)return;calls.push(m);
   const result=m.method==='tools/list'?{tools:[{name:'bb_get'},{name:'bb_post'}]}:m.method==='tools/call'?{content:[{type:'text',text:JSON.stringify({full_name:'team/repo'})}]}:{};
   child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
  });return child;
 };
 const api=await connectBitbucketMcp({workspace:'team',repository:'repo',configPath,spawnProcess});
 try {
  assert.equal((await api.request('GET','/repositories/team/repo')).full_name,'team/repo');
  await api.request('GET','/repositories/team/repo/commit/'+'a'.repeat(12));
  const count=calls.length;
  await assert.rejects(api.request('GET','/repositories/team/repo/commit/not-a-hash'),/denied/);
  await assert.rejects(api.request('GET','/repositories/other/repo/commit/'+'a'.repeat(12)),/denied/);
  await assert.rejects(api.request('POST','/repositories/team/repo/pullrequests',{body:{}}),/denied/);
  await assert.rejects(api.request('GET','/repositories/unrelated/repo'),/denied/);
  assert.equal(calls.length,count);
 }finally{await api.close();}
 const writable=await connectBitbucketMcp({workspace:'team',repository:'repo',configPath,spawnProcess,write:true});
 try{
  await writable.request('POST','/repositories/team/repo/pullrequests',{body:{title:'synthetic'}});
  for(const method of ['PUT','PATCH','DELETE'])await assert.rejects(writable.request(method,'/repositories/team/repo/pullrequests/1',{body:{}}),/denied/);
  await assert.rejects(writable.request('POST','/repositories/team/repo/issues',{body:{}}),/denied/);
 }finally{await writable.close();}
});

function publisher(t){
 const calls=[];let existing=false,hideAfterCreate=false,duplicate=false,resolvedHead;const head='a'.repeat(40);
 const pr=()=>({id:7,links:{html:{href:'https://bitbucket.org/team/repo/pull-requests/7'}},source:{branch:{name:'epic/test'},commit:{hash:head.slice(0,12)},repository:{full_name:'team/repo'}},destination:{branch:{name:'development'}}});
 const provider=new BitbucketProvider({publicationDirectory:directory(t),runner:async(file,args)=>{
  calls.push({file,args});assert.notEqual(file,'gh');
  if(args[0]==='rev-parse')return {code:0,stdout:head+'\n',stderr:''};
  if(args[0]==='push')return {code:0,stdout:'',stderr:''};
  throw Error('Unexpected Git command');
 },connect:async scope=>({close:async()=>{},request:async(method,target,input)=>{
  calls.push({method,target,input,scope});
  if(method==='POST'){existing=!hideAfterCreate;return pr();}
  if(target.includes('/commit/'))return {hash:resolvedHead ?? head};
  if(target.includes('/pullrequests'))return {values:existing?(duplicate?[pr(),pr()]:[pr()]):[]};
  throw Error('Unexpected MCP read');
 }})});
 const input={remote:'git@bitbucket.org:team/repo.git',repoPath:'/original',path:'/isolated/task',branch:'epic/test',baseBranch:'development',title:'Synthetic',body:'Synthetic approved plan',expectedHead:head,ownership:{branch:'epic/test',path:'/isolated/task'}};
 return {provider,input,calls,setExisting:v=>existing=v,setHidden:v=>hideAfterCreate=v,setDuplicate:v=>duplicate=v,setResolvedHead:v=>resolvedHead=v};
}
test('Bitbucket uses Git push and the exact MCP PR payload, then reconciles without duplicate creation',async t=>{
 const f=publisher(t);assert.deepEqual(bitbucketRepository(f.input.remote),{workspace:'team',repository:'repo'});
 assert.deepEqual(await f.provider.create(f.input),{number:7,url:'https://bitbucket.org/team/repo/pull-requests/7'});
 const post=f.calls.find(c=>c.method==='POST');assert.equal(post.target,'/repositories/team/repo/pullrequests');
 assert.equal(post.input.body.destination.branch.name,'development');assert.equal(post.input.body.close_source_branch,false);
 assert.equal(post.input.body.description,'Synthetic approved plan');
 assert.ok(f.calls.some(c=>c.file==='git'&&c.args[0]==='push'&&c.args.includes(`${f.input.expectedHead}:refs/heads/epic/test`)));
 await f.provider.create(f.input);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('uncertain Bitbucket creation never posts again when read-back cannot confirm it',async t=>{
 const f=publisher(t);f.setHidden(true);
 await assert.rejects(f.provider.create(f.input),/not confirmed/);
 await assert.rejects(f.provider.create(f.input),/not confirmed/);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('Bitbucket denies unowned/protected branches and ambiguous existing PRs',async t=>{
 const f=publisher(t);
 await assert.rejects(f.provider.create({...f.input,branch:'master'}),/protected/);
 await assert.rejects(f.provider.create({...f.input,ownership:undefined}),/ownership/);
 f.setExisting(true);f.setDuplicate(true);
 await assert.rejects(f.provider.create(f.input),/Multiple matching/);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);assert.ok(!f.calls.some(c=>c.args?.[0]==='push'));
});

test('existing abbreviated Bitbucket PR commit resolves exactly without push or duplicate create',async t=>{
 const f=publisher(t);f.setExisting(true);
 await f.provider.create(f.input);
 assert.ok(f.calls.some(c=>c.target?.includes('/commit/')));
 assert.ok(!f.calls.some(c=>c.method==='POST'||c.args?.[0]==='push'));
 f.setResolvedHead('b'.repeat(40));
 await assert.rejects(f.provider.create(f.input),/verified full hash/);
 f.setResolvedHead('a'.repeat(12));
 await assert.rejects(f.provider.create(f.input),/verified full hash/);
 assert.ok(!f.calls.some(c=>c.method==='POST'||c.args?.[0]==='push'));
});

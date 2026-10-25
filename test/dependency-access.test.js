import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,realpathSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {goDependencyReferences} from '../src/dependency-access.js';

test('Go dependency grants use the installed canonical cache with fixed offline command only', t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'go dependencies '));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const cache=path.join(root,'module cache');mkdirSync(cache);
 const link=path.join(root,'cache link');symlinkSync(cache,link);
 assert.deepEqual(goDependencyReferences(root,()=>{throw Error('must not run')}),[]);
 writeFileSync(path.join(root,'go.mod'),'module example.test/test\n');
 const refs=goDependencyReferences(root,(file,args,options)=>{
  assert.equal(file,'go');assert.deepEqual(args,['env','GOMODCACHE']);
  assert.equal(options.env.GOPROXY,'off');assert.equal(options.env.GOTOOLCHAIN,'local');
  return link+'\n';
 });
 assert.deepEqual(refs,[{id:'go-module-cache',name:'Installed Go module dependencies (read-only)',path:realpathSync(cache)}]);
 assert.deepEqual(goDependencyReferences(root,()=>'/'),[]);
 assert.deepEqual(goDependencyReferences(root,()=>{throw Error('no Go')}),[]);
});

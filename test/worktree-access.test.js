import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {worktreeHistoryReferences} from '../src/worktree-access.js';
import {createRepositoryReader} from '../src/repository-reader.js';

test('only the assigned linked worktree HEAD history is readable, never other Git metadata',async t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'task history '));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'}).toString().trim();
 git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 writeFileSync(path.join(root,'README.md'),'synthetic');git('add','.');git('commit','-m','initial');
 const cwd=path.join(root,'task tree');git('worktree','add','-b','task-test',cwd);
 assert.deepEqual(worktreeHistoryReferences(root),[]);
 const refs=worktreeHistoryReferences(cwd);
 assert.equal(refs.length,1);assert.deepEqual(refs[0].allowedFiles,['HEAD']);
 assert.equal(refs[0].path,realpathSync(path.join(root,'.git/worktrees/task-tree/logs')));
 const reader=await createRepositoryReader({readOnly:true,cwd:refs[0].path,repositories:refs});t.after(()=>reader.close());
 async function read(p){return (await (await fetch(reader.url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'ReadRepositoryFile',arguments:{repoId:refs[0].id,path:p}}})})).json()).result;}
 assert.ok(!(await read('HEAD')).isError);
 assert.equal((await read('.')).isError,true);
 assert.equal((await read('../HEAD')).isError,true);
 writeFileSync(path.join(refs[0].path,'unrelated'),'blocked');
 assert.equal((await read('unrelated')).isError,true);
});

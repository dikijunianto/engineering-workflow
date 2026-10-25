import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fixture} from './engine-fixture.js';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

test('analysis fetches clean multi-repository snapshots without changing a dirty feature checkout',async t=>{
  const f=await fixture(t,{realGit:true}),repo=f.repos[0];
  const original=git(repo.path,'rev-parse','HEAD');
  writeFileSync(path.join(repo.path,'README.md'),'Latest remote baseline\n');
  git(repo.path,'add','README.md');git(repo.path,'commit','-m','new baseline');
  const latest=git(repo.path,'rev-parse','HEAD');
  git(repo.path,'checkout','-b','feature-in-progress',original);
  writeFileSync(path.join(repo.path,'unfinished.txt'),'preserve uncommitted work');
  const before=git(repo.path,'status','--porcelain');
  await f.engine.action('ANALYZE_PRD',{questId:f.quest.id});
  const q=f.store.get('quests',f.quest.id),baseline=q.analysisBaselines.find(b=>b.repoId===repo.id);
  assert.equal(baseline.commit,latest);
  assert.equal(readFileSync(path.join(baseline.path,'README.md'),'utf8'),'Latest remote baseline\n');
  assert.equal(git(baseline.path,'status','--porcelain'),'');
  assert.equal(git(repo.path,'rev-parse','HEAD'),original);
  assert.equal(git(repo.path,'branch','--show-current'),'feature-in-progress');
  assert.equal(git(repo.path,'status','--porcelain'),before);
  const run=f.store.all('runs').at(-1);
  assert.equal(run.accessScope.repositories.length,2);
  assert.equal(run.accessScope.repositories.find(r=>r.id===repo.id).path,baseline.path);
  assert.ok(!run.accessScope.repositories.some(r=>r.path===repo.path));
  assert.equal(run.readOnly,true);
  const again=await f.engine.v11.git.analysisSnapshot(q,repo);
  assert.equal(again.path,baseline.path);
  git(repo.path,'update-ref','refs/heads/development',original);
  const integration=await f.engine.v11.work(q,repo);
  assert.equal(integration.baseCommit,latest);
  assert.equal(git(integration.path,'rev-parse','HEAD'),latest);
  assert.equal(git(repo.path,'status','--porcelain'),before);
  git(repo.path,'update-ref','refs/heads/development',latest);
  writeFileSync(path.join(baseline.path,'unexpected.txt'),'changed');
  await assert.rejects(f.engine.v11.git.analysisSnapshot(q,repo),/snapshot changed/);
});

test('fetch failure stops before launching any analysis agent',async t=>{
  const f=await fixture(t,{realGit:true});
  git(f.repos[0].path,'remote','set-url','origin',path.join(f.dir,'missing-remote'));
  await assert.rejects(f.engine.action('ANALYZE_PRD',{questId:f.quest.id}),/fetch failed/);
  assert.equal(f.pending.length,0);
  assert.equal(f.store.get('quests',f.quest.id).analysisBaselines,undefined);
});

test('changing a recorded baseline invalidates prior design approval without altering its artifact',async t=>{
  const f=await fixture(t);await f.plan();
  const trd=f.engine.approved(f.quest.id,'trd'),q=f.store.get('quests',f.quest.id);
  f.store.put('quests',{...q,analysisBaselines:q.analysisBaselines.map((b,i)=>i?b:{...b,commit:'b'.repeat(40)})});
  await assert.rejects(f.engine.action('GENERATE_PLAN',{questId:q.id}),/trd requires human approval/);
  assert.equal(f.store.latest(q.id,'trd').id,trd.id);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';

test('engineering spawns resolve all selected repositories without widening write roots', () => {
  const repos = [1,2,3].map(id => ({id:String(id),name:`repo${id}`,path:`/repos/repo ${id}`,baseBranch:'master'}));
  const work = {id:'work',repoId:'1',path:'/isolated/integrated',prTarget:'development'};
  const engine = {
    get(table,id) {
      if (table === 'repositories') return repos.find(r=>r.id===id);
      if (table === 'tasks') return {repoId:'1'};
      if (table === 'works') return work;
    },
    works:()=>[work],store:{all:()=>repos},
  };
  const quest={id:'q',workflowVersion:2,repositoryIds:['1','2'],analysisBaselines:[{repoId:'2',path:'/snapshots/repo 2',commit:'abc'}]};
  const scope=options=>Engine.prototype.resolveAccessScope.call(engine,quest,options);
  for(const purpose of ['v11-task','v11-conflict','v11-fix']) {
    const options={purpose,role:'developer',workId:'work',readOnly:false,cwd:'/isolated/task',...(purpose==='v11-fix'?{}:{taskId:'task'})};
    const result=scope(options);
    assert.deepEqual(result.repositories.map(r=>r.path),['/isolated/task']);
    assert.deepEqual(result.readOnlyReferences.map(r=>r.path),['/snapshots/repo 2']);
    assert.deepEqual(scope(options),result,'resume rebuilds the same scope');
    assert.ok(!JSON.stringify(result.readOnlyReferences).includes('repo3'));
  }
  const review=scope({role:'reviewer',purpose:'review',workId:'work',readOnly:true,cwd:work.path});
  assert.deepEqual(review.repositories.map(r=>r.path),[work.path,'/snapshots/repo 2']);
  assert.equal(review.readOnly,true);
  for(const role of ['architect','planner','orchestrator']) {
    const result=scope({role,purpose:'analysis',readOnly:true});
    assert.deepEqual(result.repositories.map(r=>r.id),['1','2']);
    assert.equal(result.readOnly,true);
  }
  const jira=scope({role:'jira-specialist',artifactScope:true,readOnly:true,cwd:'/approved/docs'});
  assert.deepEqual(jira.repositories.map(r=>r.path),['/approved/docs']);
  assert.equal(jira.readOnlyReferences,undefined);
});

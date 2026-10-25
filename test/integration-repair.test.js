import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskScheduler} from '../src/scheduler.js';
import {RepositoryOperations} from '../src/repositories.js';

test('post-merge repair edits require the exact clean baseline and unchanged passing validation',async()=>{
 const state={head:'merged-head',fingerprint:'repair-fingerprint',dirty:true};
 const task={id:'T12',key:'T12',commit:'task-commit'};
 const work={path:'/isolated/integration',branch:'epic/test',integration:{taskId:task.id,repairBase:{head:state.head,taskCommit:task.commit,clean:true}}};
 let commits=0;
 const operations={inspect:async()=>state,command:async(_cwd,args)=>({code:args[0]==='merge-base'?0:1,stdout:''}),commit:async()=>{commits++;return 'repair-commit'}};
 const integrate=(w=work,proof)=>RepositoryOperations.prototype.integrate.call(operations,{},w,task,proof);
 await assert.rejects(integrate(),/unrelated changes/);
 const proof={passed:true,head:state.head,fingerprint:state.fingerprint};
 assert.equal(await integrate(work,proof),'repair-commit');assert.equal(commits,1);
 await assert.rejects(integrate(work,{...proof,passed:false}),/unrelated changes/);
 await assert.rejects(integrate(work,{...proof,fingerprint:'changed-after-tests'}),/unrelated changes/);
 await assert.rejects(integrate({...work,integration:{...work.integration,repairBase:{...work.integration.repairBase,head:'stale-head'}}},proof),/unrelated changes/);
 await assert.rejects(integrate({...work,integration:{taskId:'other',repairBase:work.integration.repairBase}},proof),/unrelated changes/);
 assert.equal(commits,1);
});

test('successful integration clears only the current task error after passing validation',async()=>{
 const task={id:'task',key:'T1',repoId:'repo',state:'INTEGRATING',error:'previous validation failure',validationProfile:'go-test'};
 const work={id:'work',repoId:'repo',error:'previous integration failure'};
 const failedRun={state:'FAILED',summary:task.error};
 const records={tasks:task,works:work};let passed=false;
 const scheduler=new TaskScheduler({
  e:{get:(table)=>records[table] || {id:"repo"},tasks:()=>[records.tasks],put:(table,record,patch)=>records[table]={...record,...patch},log:()=>{}},
  validate:async()=>({passed,head:'validated-head',fingerprint:'validated-files',summary:'validation failed'}),
  git:{inspect:async()=>({head:'validated-head'})},
 });
 await assert.rejects(scheduler.finishIntegration({id:'quest'},work,task),/Integration validation failed/);
 assert.equal(records.tasks.error,failedRun.summary);
 passed=true;
 await scheduler.finishIntegration({id:'quest'},work,task);
 assert.equal(records.tasks.state,'COMPLETED');assert.equal(records.tasks.error,null);
 assert.equal(records.works.error,null);assert.equal(records.works.state,'REVIEW_REQUIRED');
 assert.equal(failedRun.state,'FAILED');assert.equal(failedRun.summary,'previous validation failure');
});

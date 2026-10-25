import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './engine-fixture.js';
import {taskRetryLimit} from '../src/scheduler.js';

test('explicit task retry allowance preserves history and starts no agent',async t=>{
 const f=await fixture(t);
 const quest=f.store.put('quests',{...f.quest,workflowVersion:2,execution:{limits:{retries:2}}});
 const task=f.store.put('tasks',{id:'task-retry',questId:quest.id,key:'T6',state:'NEEDS_HUMAN_ATTENTION',retries:2});
 const payload={questId:quest.id,taskId:task.id,expectedRetries:2,expectedLimit:2,confirmed:true};
 await assert.rejects(f.engine.action('ALLOW_TASK_RETRY',{...payload,confirmed:false}),/Confirm/);
 await f.engine.action('ALLOW_TASK_RETRY',payload);
 const saved=f.store.get('tasks',task.id);
 assert.equal(saved.retries,2);assert.equal(saved.manualRetryLimit,3);
 assert.equal(taskRetryLimit(quest,saved),3);assert.equal(saved.state,task.state);
 assert.equal(f.pending.length,0);
 await assert.rejects(f.engine.action('ALLOW_TASK_RETRY',payload),/state changed/);
 f.store.put('tasks',{...saved,integratedCommit:'abc'});
 await assert.rejects(f.engine.action('ALLOW_TASK_RETRY',{...payload,expectedLimit:3}),/unintegrated/);
 f.store.put('tasks',{...saved,state:'RUNNING'});
 await assert.rejects(f.engine.action('ALLOW_TASK_RETRY',{...payload,expectedLimit:3}),/stopped/);
 f.store.put('tasks',{...saved,retries:10,manualRetryLimit:10});
 await assert.rejects(f.engine.action('ALLOW_TASK_RETRY',{...payload,expectedRetries:10,expectedLimit:10}),/maximum/);
});

test('background PR failure is visible on the repository work without removing its approval',async t=>{
 const f=await fixture(t);const quest=f.store.put('quests',{...f.quest,workflowVersion:2});
 const work=f.store.put('works',{id:'failed-pr-work',questId:quest.id,repoId:f.repos[0].id,state:'READY_FOR_PR',humanApprovedCommit:'approved-head'});
 f.engine.v11.createPr=async()=>{throw Error('Bitbucket provider unavailable')};
 await f.engine.action('CREATE_PR',{questId:quest.id,workId:work.id});
 await f.engine.v11.pending.get(`pr:${work.id}`);
 const saved=f.store.get('works',work.id);
 assert.match(saved.error,/Pull request creation failed: Bitbucket provider unavailable/);
 assert.equal(saved.humanApprovedCommit,'approved-head');assert.equal(saved.pr,undefined);
 assert.equal(f.pending.length,0);
});

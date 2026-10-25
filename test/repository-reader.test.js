import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRepositoryReader } from "../src/repository-reader.js";
import { CodexRuntime, ClaudeCodeRuntime } from "../src/adapters.js";

async function scope(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devquest read tool "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repos = [];
  for (const name of ["finance", "funding", "unselected"]) {
    const folder = path.join(root, name);
    await mkdir(folder);
    await writeFile(path.join(folder, "README.md"), `Harmless ${name}`);
    repos.push({ id: name, name, path: folder });
  }
  return {
    root,
    repos,
    readOnly: true,
    cwd: repos[0].path,
    repositories: repos.slice(0, 2),
  };
}
async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).result;
}
test("scoped repository tool reads selected roots only and exposes no shell/write API", async (t) => {
  const s = await scope(t),
    reader = await createRepositoryReader(s);
  t.after(() => reader.close());
  const listed = await rpc(reader.url, "tools/list");
  assert.equal(listed.tools[0].annotations.readOnlyHint, true);
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ["ReadRepositoryFile"],
  );
  for (const repo of s.repositories) {
    const result = await rpc(reader.url, "tools/call", {
      name: "ReadRepositoryFile",
      arguments: { repoId: repo.id, path: "README.md" },
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Harmless/);
  }
  await symlink(
    path.join(s.repos[2].path, "README.md"),
    path.join(s.repos[0].path, "escape.md"),
  );
  for (const args of [
    { repoId: "finance", path: ".." },
    { repoId: "finance", path: "../unselected/README.md" },
    { repoId: "unselected", path: "README.md" },
    { repoId: "finance", path: path.join(s.root, "unselected", "README.md") },
    { repoId: "finance", path: "escape.md" },
  ]) {
    const result = await rpc(reader.url, "tools/call", {
      name: "ReadRepositoryFile",
      arguments: args,
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Access denied/);
  }
  assert.equal(
    (
      await rpc(reader.url, "tools/call", {
        name: "Write",
        arguments: { repoId: "finance", path: "README.md" },
      })
    ).isError,
    true,
  );
  assert.equal(
    (
      await fetch(reader.url.replace(/\/[a-f0-9]+$/, "/wrong"), {
        method: "POST",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(reader.url, {
        method: "POST",
        headers: { Origin: "http://evil.invalid" },
      })
    ).status,
    403,
  );
});
test("Codex scoped adapter invokes actual reader interface, preserves sandbox and denies a skipped repository", async (t) => {
  const s = await scope(t),
    calls = [],
    events = [];
  let skip = false;
  const runtime = new CodexRuntime({
    runner: async (_file, args, options) => {
      calls.push({ args, input: options.input });
      const setting = args.find((arg) => arg.startsWith("mcp_servers="));
      const url = JSON.parse(setting.match(/url=("[^"]+")/)[1]);
      for (const repo of s.repositories.slice(0, skip ? 1 : 2))
        await rpc(url, "tools/call", {
          name: "ReadRepositoryFile",
          arguments: { repoId: repo.id, path: "README.md" },
        });
      return {
        code: 0,
        stderr: "",
        stdout:
          JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: "Read-only TRD" },
          }) + "\n",
      };
    },
  });
  runtime.help = "--ignore-user-config";
  runtime.detectCapabilities = async () => ({
    available: true,
    nestedRestriction: true,
  });
  await runtime.start({
    cwd: s.cwd,
    readOnly: true,
    accessScope: s,
    onEvent: (event) => events.push(event),
  });
  assert.equal(
    events.filter((event) => event.type === "repository-tool").length,
    2,
  );
  const args = calls[0].args;
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(!args.includes("--add-dir"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.match(
    args.find((arg) => arg.startsWith("mcp_servers=")),
    /enabled_tools=\["ReadRepositoryFile"\].*ReadRepositoryFile=\{approval_mode="writes"\}/,
  );
  assert.ok(args.includes("code_mode_host"));
  for (const feature of [
    "shell_tool",
    "unified_exec",
    "code_mode",
    "computer_use",
    "multi_agent",
  ])
    assert.ok(args.includes(feature));
  assert.match(calls[0].input, /EVERY selected repository/);
  skip = true;
  await assert.rejects(
    runtime.start({ cwd: s.cwd, readOnly: true, accessScope: s }),
    /skipped a selected repository/,
  );
});

for (const Runtime of [ClaudeCodeRuntime,CodexRuntime]) test(`${Runtime.name} task references permit selected reads without external write grants`,async t=>{
  const s=await scope(t),events=[];let invocation;
  const runtime=new Runtime({runner:async(_file,args,options)=>{
    invocation={args,options};
    const url=Runtime===ClaudeCodeRuntime
      ? JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.devquest_repository.url
      : JSON.parse(args.find(a=>a.startsWith('mcp_servers=')).match(/url=("[^"]+")/)[1]);
    const good=await rpc(url,'tools/call',{name:'ReadRepositoryFile',arguments:{repoId:'finance',path:'README.md'}});
    assert.match(good.content[0].text,/Harmless finance/);
    for(const arguments_ of [{repoId:'unselected',path:'README.md'},{repoId:'finance',path:'../unselected/README.md'}])
      assert.equal((await rpc(url,'tools/call',{name:'ReadRepositoryFile',arguments:arguments_})).isError,true);
    assert.equal((await rpc(url,'tools/call',{name:'WriteRepositoryFile',arguments:{repoId:'finance',path:'README.md',content:'bad'}})).isError,true);
    return {code:0,stderr:'',stdout:Runtime===ClaudeCodeRuntime ? JSON.stringify({type:'result',result:'Reference inspected'}) : JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Reference inspected'}})};
  }});
  runtime.help='--ignore-user-config --restricted --disallowedTools --permission-mode';
  runtime.detectCapabilities=async()=>({available:true,nestedRestriction:true});
  await runtime.start({cwd:s.repos[1].path,readOnly:false,executionPolicy:{safeFallback:'acceptEdits',nestedSpawning:false},
    accessScope:{cwd:s.repos[1].path,readOnly:false,repositories:[s.repos[1]],readOnlyReferences:[s.repos[0]]},onEvent:e=>events.push(e),prompt:'Implement only in the assigned worktree'});
  assert.ok(!invocation.args.includes('--add-dir'));
  if(Runtime===ClaudeCodeRuntime){
    assert.ok(invocation.args.includes('--restricted'));
    assert.equal(invocation.args[invocation.args.indexOf('--tools')+1],'Read,Glob,Grep,Edit,Write');
    assert.match(invocation.args[invocation.args.indexOf('--allowedTools')+1],/mcp__devquest_repository__ReadRepositoryFile/);
    assert.doesNotMatch(invocation.args[invocation.args.indexOf('--disallowedTools')+1],/mcp__\*/);
  } else assert.equal(invocation.args[invocation.args.indexOf('--sandbox')+1],'workspace-write');
  assert.ok(events.some(e=>e.type==='repository-tool'&&e.call.status==='PASSED'));
});

test('Claude reference recovery matches exact files and directory-scoped search descendants', async t=>{
  const s=await scope(t); let recover=true, outside=false, directory=false, operation='Grep';
  const runtime=new ClaudeCodeRuntime({runner:async(_file,args)=>{
    const url=JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.devquest_repository.url;
    const target=path.join(outside?s.repos[2].path:s.repos[0].path,directory?'':'README.md');
    const stream=[
      {type:'assistant',message:{content:[{type:'tool_use',id:'grep',name:operation,input:{path:target,pattern:'Harmless'}}]}},
      {type:'user',message:{content:[{type:'tool_result',tool_use_id:'grep',is_error:true,content:`${target} is outside task; --restricted confines the file tools to the working directory.`}]}}
    ];
    if(recover){
      const input={repoId:'finance',path:'README.md'};
      const result=await rpc(url,'tools/call',{name:'ReadRepositoryFile',arguments:input});
      stream.push({type:'assistant',message:{content:[{type:'tool_use',id:'ref',name:'mcp__devquest_repository__ReadRepositoryFile',input}]}},
        {type:'user',message:{content:[{type:'tool_result',tool_use_id:'ref',content:result.content,is_error:result.isError}]}});
    }
    stream.push({type:'result',result:'Inspected reference'});
    return {code:0,stderr:'',stdout:stream.map(x=>JSON.stringify(x)).join('\n')};
  }});
  runtime.help='--restricted --disallowedTools --permission-mode';
  runtime.detectCapabilities=async()=>({available:true,nestedRestriction:true});
  const options={cwd:s.repos[1].path,readOnly:false,executionPolicy:{safeFallback:'acceptEdits',nestedSpawning:false},accessScope:{cwd:s.repos[1].path,readOnly:false,repositories:[s.repos[1]],readOnlyReferences:[s.repos[0]]}};
  await runtime.start(options);
  directory=true;
  await runtime.start(options);
  operation='Glob';
  await runtime.start(options);
  operation='Read';
  await assert.rejects(runtime.start(options),/permitted reader/);
  directory=false;operation='Grep';
  recover=false;
  await assert.rejects(runtime.start(options),/permitted reader/);
  outside=true;recover=true;
  await assert.rejects(runtime.start(options),/Runtime repository access denied/);
});

test('reference directory inspection lists only immediate children and keeps traversal blocked',async t=>{
 const s=await scope(t);const reader=await createRepositoryReader(s);t.after(()=>reader.close());
 const listing=await rpc(reader.url,'tools/call',{name:'ReadRepositoryFile',arguments:{repoId:'finance',path:'.'}});
 assert.match(listing.content[0].text,/README.md/);
 const denied=await rpc(reader.url,'tools/call',{name:'ReadRepositoryFile',arguments:{repoId:'finance',path:'..'}});
 assert.equal(denied.isError,true);
});

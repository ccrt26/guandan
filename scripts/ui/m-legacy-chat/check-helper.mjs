/** Finite, offline helper preflight; deliberately never calls listen/start. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createFixtureTransport} from './transport.mjs';
import {buildHelper,root,output} from './build.mjs';
import {createStaticHandler} from './serve.mjs';
assert.equal(process.argv.slice(2).join(' '),'--offline-only');
const fixture=JSON.parse(await fs.readFile(new URL('./fixture.json',import.meta.url),'utf8'));
const manifest=await buildHelper();
assert(!manifest.inputs.some(row=>/server\/index|\/App\.tsx|\/controller\.ts|\.env|vite\.config/.test(row.path)));
const fake=createFixtureTransport(fixture),reference={profileId:fixture.profile.profileId,revision:1,snapshotHash:fixture.profile.snapshotHash};
assert.equal(fake.storage.length,0);assert.deepEqual(await(await fake.fetchImpl('/api/llm-profiles')).json(),[fixture.profile]);
assert.equal((await fake.fetchImpl('/api/import-zcode')).status,400);
assert.deepEqual(await(await fake.fetchImpl('/api/import-zcode',{method:'POST'})).json(),fixture.importDraft);assert.equal(fake.storage.length,0);
fake.setMode('hold');const controller=new AbortController();const held=fake.fetchImpl('/api/chat',{method:'POST',body:JSON.stringify({reference,messages:[{role:'user',content:'fake'}]}),signal:controller.signal});controller.abort();assert.equal(fake.snapshot().aborted,1);assert.equal(fake.snapshot().held,1);fake.releaseLate();assert.equal((await(await held).json()).status,'completed');
const handler=await createStaticHandler();
for(const [method,url,host,expected]of [['GET','/','127.0.0.1:15183',200],['POST','/api/chat','127.0.0.1:15183',404],['GET','/','localhost:15183',404]]){
  const response={status:200,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(n){this.status=n;},end(){}};
  handler({method,url,headers:{host}},response);assert.equal(response.status,expected);assert.match(response.headers['content-security-policy'],/connect-src 'none'/);
}
const entry=await fs.readFile(path.join(root,'scripts/ui/m-legacy-chat/entry.tsx'),'utf8');
assert.match(entry,/Object\.defineProperty\(globalThis,'localStorage'/);assert.match(entry,/Object\.defineProperty\(globalThis,'fetch'/);
const result={status:'passed',kind:'offline-helper-preflight',origin:fixture.origin,staticOutput:output,checks:['static build exact input/output identities','no App/controller/server/env in bundle inputs','memory-only fake profile/import','held abort then explicit late release','static handler exact Host/GET allowlist/CSP'],noListenerStarted:true,noBrowserRun:true,noProductionAPI:true};
console.log(JSON.stringify(result,null,2));

import { afterEach, expect, it, vi } from 'vitest';
import { createChatOperationOwner, requestCompletedChat, requestImportDraft, operationProfileClient } from '../src/ui/chat-operation';
import { loadChatProfileReference, saveChatProfileReference } from '../src/game/storage';
import type { PublicProfile } from '../src/game/storage';
const profile:PublicProfile={profileId:'finite-fake',nickname:'fake',revision:3,snapshotHash:'b'.repeat(64),baseUrl:'https://finite.invalid/v1',protocol:'openai-chat-completions',requestedModel:'fake-model',supportedReasoningOptions:{},requestOptions:{}};
const good={status:'completed',text:'complete',summary:{profileId:profile.profileId,revision:3,snapshotHash:profile.snapshotHash,protocol:profile.protocol,requestedModel:profile.requestedModel,returnedModel:null,requestCount:1}};
afterEach(()=>vi.unstubAllGlobals());
it.each(['failed','empty','partial','mismatch','legacy-sse','truncated-json','non-200','bad-summary','oversized-model'])('rejects %s without protocol retry',async kind=>{
 const value=structuredClone(good) as any;let response:any;
 if(kind==='failed')value.status='failed';
 if(kind==='empty')value.text='';
 if(kind==='partial')delete value.summary;
 if(kind==='mismatch')value.summary.revision=4;
 if(kind==='bad-summary')value.summary.secret='DO_NOT_RENDER';
 if(kind==='oversized-model')value.summary.returnedModel='x'.repeat(201);
 response=kind==='legacy-sse'?new Response('data: {"choices":[{"delta":{"content":"normal"}}]}\n\n'):
  kind==='truncated-json'?new Response('{"status":"completed"'):new Response(JSON.stringify(value),{status:kind==='non-200'?202:200});
 const fetcher=vi.fn(async()=>response);vi.stubGlobal('fetch',fetcher);
 await expect(requestCompletedChat(profile,[{role:'user',content:'fake'}],createChatOperationOwner().begin())).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
});
it('already aborted request never invokes fetch; direct rejection is bounded and no retry',async()=>{
 const owner=createChatOperationOwner(),operation=owner.begin(),fetcher=vi.fn(async()=>{throw Error('SECRET_RAW_FAKE');});vi.stubGlobal('fetch',fetcher);owner.invalidate();
 await expect(requestCompletedChat(profile,[],operation)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 await expect(requestCompletedChat(profile,[],owner.begin())).rejects.not.toThrow('SECRET_RAW_FAKE');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('import preserves whole unverified draft, including missing fields, without fallback',async()=>{
 const draft={apiKey:'FAKE_ONLY',opaque:{source:'not discarded'},effort:'legacy'};vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(draft))));
 expect(await requestImportDraft(createChatOperationOwner().begin())).toEqual(draft);
});
it('public profile cache cannot be written after operation invalidation during JSON',async()=>{
 let resolve!:(value:any)=>void;const hold=new Promise(r=>resolve=r),setItem=vi.fn();vi.stubGlobal('localStorage',{getItem:()=>null,setItem,removeItem:vi.fn()});
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:()=>hold})));
 const owner=createChatOperationOwner(),pending=operationProfileClient(owner.begin()).refresh();await Promise.resolve();owner.invalidate();resolve([profile]);await expect(pending).rejects.toThrow();expect(setItem).not.toHaveBeenCalled();
});
it('saved choice keeps exact revision/hash and never stores a key',()=>{
 const data=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k),setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)});
 saveChatProfileReference(profile);expect(loadChatProfileReference()).toEqual({profileId:profile.profileId,revision:3,snapshotHash:profile.snapshotHash});expect([...data.values()][0]).not.toContain('baseUrl');
 data.set('gd_chat_profile_reference_v1',JSON.stringify({...profile}));expect(loadChatProfileReference()).toBeNull();
});

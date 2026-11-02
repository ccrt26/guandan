/** Runtime data reads only: importing this leaf must not import any mutable catalog JSON. */
import type {Plugin} from 'vite';
import {readFileSync} from 'node:fs';
import {projectPublicIndex} from '../ai/src/policy/public-index';
export interface PolicyDirectoryPaths {indexFile:string;catalogFile:string;releasesFile:string}
const event='ohuo:policy-directory',request='ohuo:policy-directory-request',id='\0virtual:gd-model-index';
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fields(value:unknown,keys:string[]):Record<string,unknown>{
 if(!plain(value)||Object.keys(value).sort().join(',')!==keys.slice().sort().join(','))throw Error('invalid_public_directory_shape');
 return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
function stringFields(value:unknown,keys:string[],nullable:string[]=[]):Record<string,unknown>{
 const data=fields(value,keys);
 if(keys.some(key=>typeof data[key]!=='string'&&!(nullable.includes(key)&&data[key]===null)))throw Error('invalid_public_directory_leaf');
 return data;
}
function publicCatalog(value:unknown){
 const data=fields(value,['schema','formalLocalReleaseRef','models']);if(typeof data.schema!=='string'||typeof data.formalLocalReleaseRef!=='string')throw Error('invalid_public_directory_leaf');if(!Array.isArray(data.models))throw Error('invalid_public_catalog');
 return {...data,models:data.models.map(model=>stringFields(model,['releaseRef','policyId','weightsSHA256','name','version','displayVersion','effectiveDate']))};
}
function publicReleases(value:unknown){
 const data=fields(value,['schemaVersion','releases','legacyProductLayouts']);if(typeof data.schemaVersion!=='string')throw Error('invalid_public_directory_leaf');if(!Array.isArray(data.releases))throw Error('invalid_public_releases');
 const layouts=fields(data.legacyProductLayouts,['easy','standard','hard']);
 if(Object.values(layouts).some(layout=>!Array.isArray(layout)||layout.some(ref=>typeof ref!=='string')))throw Error('invalid_public_layouts');
 return {...data,releases:data.releases.map(release=>stringFields(release,['releaseRef','label','proposalPolicyRef','mode','tier','status','parentRelease'],['parentRelease'])),legacyProductLayouts:layouts};
}
export function policyIndexPlugin(paths:PolicyDirectoryPaths):Plugin {
 const inputs=Object.values(paths),read=()=>({schema:'ohuo-public-policy-directory-v1',index:projectPublicIndex(JSON.parse(readFileSync(paths.indexFile,'utf8'))),
  catalog:publicCatalog(JSON.parse(readFileSync(paths.catalogFile,'utf8'))),releaseCatalog:publicReleases(JSON.parse(readFileSync(paths.releasesFile,'utf8')))});
 const message=()=>{try{return {available:true,snapshot:read()};}catch{return {available:false,error:'directory_unavailable'};}};
 let remove:(()=>void)|undefined;
 return {
  name:'registered-model-index',
  buildStart(){for(const path of inputs)this.addWatchFile(path);},
  resolveId(name){return name==='virtual:gd-model-index'?id:null;},
  load(name){if(name!==id)return null;const snapshot=read();return `export default ${JSON.stringify(snapshot.index)};\nexport const productCatalog=${JSON.stringify(snapshot.catalog)};\nexport const releaseCatalog=${JSON.stringify(snapshot.releaseCatalog)};`;},
  configureServer(server){
   const reply=(_data:unknown,client:{send:(event:string,data:unknown)=>void})=>client.send(event,message());
   server.ws.on(request,reply);remove=()=>server.ws.off(request,reply);
  },
  handleHotUpdate({file,server}){
   if(!inputs.includes(file))return;
   // Cache invalidation does not enqueue React updates. Only this data message is sent.
   const virtual=server.moduleGraph.getModuleById(id);if(virtual)server.moduleGraph.invalidateModule(virtual);
   for(const path of inputs)for(const module of server.moduleGraph.getModulesByFile(path)??[])server.moduleGraph.invalidateModule(module);
   server.hot.send(event,message());return [];
  },
  closeBundle(){remove?.();},
 };
}

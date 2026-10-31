/** Explicit LOCAL manual fixture server. Never run in cloud checks; no real configuration access. */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskOutput } from '../../../scripts/project-paths.mjs';
import { createProfileStore, ProfileError } from '../../../packages/web/server/llm-profiles.mjs';
import { createProfileRoutes } from '../../../packages/web/server/llm-profile-routes.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const fixtureOutput=()=>taskOutput('profiles-ui-manual','B03-ui-manual');
const port=18787,uiPort=15180;

/** Restricts even a mistaken manual submission to the two declared fake credentials/endpoints. */
export function fakeOnlyStore(store,fixtures) {
  return { list:()=>store.list(), resolve:ref=>store.resolve(ref), save(command) {
    const profile=command?.profile;
    const fixture=fixtures.find(f=>f.baseUrl===profile?.baseUrl);
    if(!fixture||profile.protocol!==fixture.protocol||!['fake-glm-model','fake-glm-model-updated','fake-deepseek-model'].includes(profile.requestedModel)||
      (profile.secret!==undefined&&profile.secret!==fixture.secret)) throw new ProfileError('fixture_only');
    return store.save(command);
  } };
}
export function runManualFixture(args) {
  if(args.length===2&&args[0]==='--read-public'&&/^fixture-[a-zA-Z0-9_-]+$/.test(args[1])) {
    const output=fixtureOutput();
    const directory=join(output,args[1]);
    if(!realpathSync(directory).startsWith(realpathSync(output)+sep)) throw Error('fixture_path_required');
    console.log(JSON.stringify(createProfileStore({filePath:join(directory,'.env.llm-profiles.json')}).list(),null,2));
    return;
  }
  if(args.length!==1||args[0]!=='--fake-profiles-only') throw Error('Use --fake-profiles-only (local manual only), or --read-public <printed fixture id>');
  const fixtures=JSON.parse(readFileSync(join(here,'fixtures/profiles.fake.json'),'utf8')).profiles;
  mkdirSync(resolve(here,'../../out'),{recursive:true});
  const output=fixtureOutput();
  mkdirSync(output,{recursive:true});
  const directory=mkdtempSync(join(output,'fixture-'));
  const store=fakeOnlyStore(createProfileStore({filePath:join(directory,'.env.llm-profiles.json')}),fixtures);
  const route=createProfileRoutes({store,port,uiPort});
  const server=createServer(async(req,res)=>{if(!await route(req,res)) {res.writeHead(404);res.end();}});
  let stopped=false;
  const clean=()=>{if(stopped)return;stopped=true;rmSync(directory,{recursive:true,force:true});};
  server.on('error',error=>{clean();console.error(error.code==='EADDRINUSE'?'Fixture port occupied; existing service was not stopped.':'Fixture server unavailable');process.exitCode=1;});
  const stop=()=>server.close(()=>{clean();});
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  server.listen(port,'127.0.0.1',()=>{
    console.log(`Fake-only named-profile handler http://127.0.0.1:${port}; UI http://127.0.0.1:${uiPort}`);
    console.log(`No chat/import/.env. Public Node read: node lab/review6_2/checks/profiles-manual-server.mjs --read-public ${directory.split(sep).pop()}`);
    console.log('Stop only this process with Ctrl-C after recording evidence; its fake directory is then removed.');
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {runManualFixture(process.argv.slice(2));} catch {console.error('Invalid fixture invocation; no real configuration was opened.');process.exitCode=1;}
}

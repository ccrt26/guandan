/** Explicit local fake-profile UI. Importing this module neither creates nor listens on a server. */
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './profiles-manual-vite.config.mjs';

// The sentinel check resolves this exact object; envFile:false must be INLINE, not only in a CLI config file.
export const manualInlineConfig=config;
async function start(args) {
  if(args.length!==1||args[0]!=='--fake-profiles-only') throw Error('explicit_fake_profile_flag_required');
  const server=await createServer(manualInlineConfig);
  const stop=()=>{void server.close();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {await server.listen();} catch(error) {await server.close();throw error;}
  console.log('Fake-profile UI http://127.0.0.1:15180; dotenv loading disabled; no user environment prefixes exposed.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {await start(process.argv.slice(2));}
  catch {console.error('Manual UI not started or unavailable. Use --fake-profiles-only; do not stop an existing service to claim its port.');process.exitCode=1;}
}

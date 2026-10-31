/** Manual INLINE configuration. Use profiles-manual-vite.mjs, never the Vite CLI --config path. */
import { mergeConfig } from 'vite';
import base from '../../../packages/web/vite.config.ts';
export default { ...mergeConfig(base,{
  server:{host:'127.0.0.1',port:15180,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:18787',changeOrigin:true}}},
}), configFile:false, envFile:false, envPrefix:[] };

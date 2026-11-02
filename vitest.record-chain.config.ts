import {defineConfig,mergeConfig} from 'vitest/config';
import base from './vitest.config';
/** This one test supplies the value via vi.mock; never load production Vite config/store. */
export default mergeConfig(base,defineConfig({plugins:[{
 name:'record-chain-virtual-id',
 resolveId(id){return id==='virtual:gd-model-index'?id:null;},
}]}));

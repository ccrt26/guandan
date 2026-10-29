import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {verifyProduct} from '../review6/product';
it('the real product CLI rejects duplicate role laundering before checking browser evidence',()=>{
 const temp=mkdtempSync(join(tmpdir(),'r6-product-cli-')),out=join(temp,'results'),generated=verifyProduct(out);
 const cfg=join(temp,'config.json');writeFileSync(cfg,JSON.stringify({product:{resultDirectory:out,resultManifestHash:generated.resultManifestHash,browserReceipt:join(temp,'missing-browser.json')}}));
 const run=()=>spawnSync(process.execPath,['--import','tsx',resolve('lab/review6/product-cli.ts'),cfg],{encoding:'utf8'});
 expect(run().status).toBe(3);
 const expected=JSON.parse(readFileSync(join(out,'expected-assertions.lock.json'),'utf8')),rows=JSON.parse(readFileSync(join(out,'case-results.json'),'utf8'));
 expected[0].expectedAssertionIds=Array(6).fill(expected[0].expectedAssertionIds[0]);rows[0].card.expectedAssertionIds=expected[0].expectedAssertionIds;rows[0].card.actual.cardCount=999;rows[0].card.afterCounts=[999,999,999,999];
 writeFileSync(join(out,'expected-assertions.lock.json'),JSON.stringify(expected));writeFileSync(join(out,'case-results.json'),JSON.stringify(rows));
 const bad=run();expect(bad.status).toBe(2);expect(bad.stderr).toMatch(/assertion|manifest|input/i);
},120000);

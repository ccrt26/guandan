/** P7 keeps five strong roots and rotates five weak roots, denominator ten. */
export function scheduledTeacherIds(labels:any[],update:number,schedule:any){
 if(!schedule){const families=new Set();return labels.filter(l=>{if(families.has(l.sourceFamilyId))return false;families.add(l.sourceFamilyId);return true;}).slice(0,64).map(l=>l.labelId);}
 if(schedule.kind==='fixed-strong5-family-pool-weak5-v1')return coverageFamilyIds(labels,update,schedule);
 if(schedule.kind==='fixed-strong5-family2-weak5-v1')return resourceFamilyIds(labels,update,schedule);
 if(schedule.kind!=='fixed-strong5-weak5-v1'||schedule.fromUpdate!==400||!Number.isSafeInteger(update)||update<=400)throw Error('reviewed absolute400 teacher schedule required');
 const strong=labels.filter(l=>l.evidenceTier==='strong'&&l.weight===1),weak=labels.filter(l=>l.evidenceTier==='weak'&&l.weight===.25);
 if(strong.length!==5||weak.length<5||strong.length+weak.length!==labels.length||new Set(labels.map(l=>l.sourceFamilyId)).size!==labels.length||new Set(labels.map(l=>l.labelId)).size!==labels.length)throw Error('five strong, at least five weak and unique source roots required');
 const chosen=new Set(strong.map(l=>l.labelId)),start=(5*(update-401))%weak.length;
 for(let i=0;i<5;i++)chosen.add(weak[(start+i)%weak.length].labelId);
 return labels.filter(l=>chosen.has(l.labelId)).map(l=>l.labelId);
}

/** One extra strong family slot; exactly one of its two actual roots per step. */
function resourceFamilyIds(labels:any[],update:number,schedule:any){
 if(schedule.fromUpdate!==1400||!Number.isSafeInteger(update)||update<=1400||schedule.addedLabelIds?.length!==2||new Set(schedule.addedLabelIds).size!==2)throw Error('reviewed absolute1400 two-variant schedule required');
 const extra=labels.filter(l=>l.sourceFamilyId===schedule.familyId),old=labels.filter(l=>l.sourceFamilyId!==schedule.familyId);
 if(extra.length!==2||JSON.stringify(extra.map(l=>l.labelId))!==JSON.stringify(schedule.addedLabelIds)||extra.some(l=>l.evidenceTier!=='strong'||l.weight!==1||l.evidenceKind!=='declared-deal-target-bound-v1')||old.length!==10||old.filter(l=>l.evidenceTier==='strong'&&l.weight===1).length!==5||old.filter(l=>l.evidenceTier==='weak'&&l.weight===.25).length!==5||new Set(old.map(l=>l.sourceFamilyId)).size!==10||new Set(labels.map(l=>l.labelId)).size!==12)throw Error('exact old10 plus one new strong family required');
 const selected=extra[(update-1401)%2].labelId;
 return labels.filter(l=>l.sourceFamilyId!==schedule.familyId||l.labelId===selected).map(l=>l.labelId);
}

/** Cycle families first, then switch each family's conditional direction. */
function coverageFamilyIds(labels:any[],update:number,schedule:any){
 const pool=schedule.familyPool;
 if(schedule.fromUpdate!==1400||!Number.isSafeInteger(update)||update<=1400||!Array.isArray(pool)||pool.length<1||pool.length>5||new Set(pool.map(g=>g.sourceFamilyId)).size!==pool.length||pool.some(g=>!Array.isArray(g.labelIds)||g.labelIds.length!==2))throw Error('fixed complete family pool required');
 const familyIds=new Set(pool.map(g=>g.sourceFamilyId)),extra=labels.filter(l=>familyIds.has(l.sourceFamilyId)),old=labels.filter(l=>!familyIds.has(l.sourceFamilyId));
 if(old.length!==10||old.filter(l=>l.evidenceTier==='strong'&&l.weight===1).length!==5||old.filter(l=>l.evidenceTier==='weak'&&l.weight===.25).length!==5||new Set(old.map(l=>l.sourceFamilyId)).size!==10||new Set(labels.map(l=>l.labelId)).size!==labels.length||extra.length!==2*pool.length||extra.some(l=>l.evidenceTier!=='strong'||l.weight!==1||l.evidenceKind!=='declared-deal-target-bound-v1'))throw Error('exact old10 and complete strong family pool required');
 for(const group of pool)if(JSON.stringify(extra.filter(l=>l.sourceFamilyId===group.sourceFamilyId).map(l=>l.labelId))!==JSON.stringify(group.labelIds))throw Error('family identity/order differs from reviewed pool');
 const slots=schedule.slotsPerUpdate??1;
 if(!Number.isSafeInteger(slots)||(slots!==1&&slots!==pool.length))throw Error('reviewed one or complete-family slots required');
 const selected=new Set<string>();
 for(let j=0;j<slots;j++){const q=(update-1401)*slots+j,group=pool[q%pool.length];selected.add(group.labelIds[Math.floor(q/pool.length)%2]);}
 return labels.filter(l=>!familyIds.has(l.sourceFamilyId)||selected.has(l.labelId)).map(l=>l.labelId);
}

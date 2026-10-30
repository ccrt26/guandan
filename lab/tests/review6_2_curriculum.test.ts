import{it,expect}from'vitest';import{assertTierUpgrade,assertBoundContinuationInputs}from'../review6_2/curriculum';import{json}from'../review6_2/protocol';
const old=()=>json('lab/review6_2/data/p5-teacher-set-001/labels.json'),fresh=()=>json('lab/review6_2/data/p6-teacher-set-001/labels.json');
const keys=()=>json('lab/review6_2/data/p6-book-upgrade-diff.json').changed.map((r:any)=>r.rootKey);
it('allows exactly the two actual certified tier upgrades with identical full inputs',()=>{expect(()=>assertTierUpgrade(old(),fresh(),keys())).not.toThrow();});
it('rejects changed directions/features, unauthorized weights and missing roots',()=>{
 const a=fresh();a[0].plus[0][0]+=.1;expect(()=>assertTierUpgrade(old(),a,keys())).toThrow(/input|changed/);
 const b=fresh();b.find((r:any)=>keys().includes(r.rootKey)).weight=.5;expect(()=>assertTierUpgrade(old(),b,keys())).toThrow(/tier/);
 expect(()=>assertTierUpgrade(old(),fresh().slice(1),keys())).toThrow(/roots/);
 expect(()=>assertTierUpgrade(old(),fresh(),keys().slice(1))).toThrow(/unauthorized/);
});
it('cannot disable a fixed experiment binding by dropping its config declarations',()=>{
 const a=json('lab/review6_2/p6-config.json');delete a.runtimeMigrationRef;delete a.runtimeMigrationSHA256;expect(()=>assertBoundContinuationInputs(a)).toThrow(/bound continuation input/);
 const b=json('lab/review6_2/p6-config.json');delete b.curriculumUpgradeRef;delete b.curriculumUpgradeSHA256;expect(()=>assertBoundContinuationInputs(b)).toThrow(/bound continuation input/);
});

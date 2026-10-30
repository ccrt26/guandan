import{it,expect}from'vitest';import{weakDisposition}from'../review6_2/weak-exploration';
const rows=(n:number,d:number)=>Array.from({length:n},(_,i)=>({worldId:'w'+i,A:{complete:true,initialWorldSHA256:'h'+i,g:2+d,W:1,y:3+d},B:{complete:true,initialWorldSHA256:'h'+i,g:2,W:1,y:3}}));
it('keeps only prelocked directions above the two exploratory mean floors',()=>{
 expect(weakDisposition(rows(32,1),rows(16,1)).accepted).toBe(true);
 expect(weakDisposition(rows(32,1),rows(16,-1)).accepted).toBe(false);
 expect(weakDisposition(rows(32,0),rows(16,0)).accepted).toBe(false);
});
it('rejects incomplete, unpaired, duplicated or non-g+W observations',()=>{
 expect(()=>weakDisposition(rows(31,1),rows(16,1))).toThrow(/fixed/);
 const a=rows(32,1);a[0].B.initialWorldSHA256='other';expect(()=>weakDisposition(a,rows(16,1))).toThrow(/paired/);
 const b=rows(32,1);b[0].A.y=99;expect(()=>weakDisposition(b,rows(16,1))).toThrow(/g\+W/);
 const c=rows(32,1);c[1].worldId=c[0].worldId;expect(()=>weakDisposition(c,rows(16,1))).toThrow(/unique/);
});
it('does not accept fabricated zero-round rewards or truthy completion flags',()=>{
 const zero=rows(32,1);zero[0].A.g=0;zero[0].A.y=1;expect(()=>weakDisposition(zero,rows(16,1))).toThrow(/g\+W/);
 const truthy:any[]=rows(32,1);truthy[0].A.complete=1;expect(()=>weakDisposition(truthy,rows(16,1))).toThrow(/complete/);
});

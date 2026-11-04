/** Private durable representation only. The sampler's engine Set is explicit
 * JSON here; every other sampled field and its identity remain unchanged. */
import {isDeepStrictEqual as equal} from 'node:util';
import {makeLevelCtx} from '../../packages/engine/src/rank';
import type {sampleVisibleWorld} from '../review6/visible-world';
import {canonical} from './task-schema.mjs';

type WorldSample=ReturnType<typeof sampleVisibleWorld>;
export type CachedCommonViewWorldSample=Omit<WorldSample,'state'>&{
 state:Omit<WorldSample['state'],'ctx'>&{ctx:{ranks:number[];levels:[number,number]}};
};
export function serializeCommonViewWorldSample(sample:WorldSample):CachedCommonViewWorldSample{
 const state=sample.state,ctx=makeLevelCtx(state.levelsBefore,state.match.opts.levelMode as any,state.stageTeam);
 if(!equal(state.ctx,ctx))throw Error('common_view_world_context');
 const cached={...structuredClone(sample),state:{...structuredClone(state),ctx:{ranks:[...state.ctx.ranks],levels:[...state.ctx.levels] as [number,number]}}};
 // Reject, rather than silently discard, any other non-JSON engine value.
 canonical(cached);
 return cached;
}
export function restoreCommonViewWorldSample(cached:CachedCommonViewWorldSample):WorldSample{
 canonical(cached);
 const state=cached.state,ctx=makeLevelCtx(state.levelsBefore,state.match.opts.levelMode as any,state.stageTeam);
 if(!equal(state.ctx,{ranks:[...ctx.ranks],levels:ctx.levels}))throw Error('common_view_world_context');
 // No sampling, seeds or hidden-card source is consulted on resume/branching.
 return {...structuredClone(cached),state:{...structuredClone(state),ctx}};
}

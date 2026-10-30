// Manual browser QA only. The button is used in the isolated in-app browser.
// Real engine moves produce valid replay records; no user data is replaced.
import { applyMove, createMatch, DEFAULT_RULES, legalCombos, Recorder, startGame, checkRecordIntegrity } from '@gd/engine';
import { listRecords, loadCurrentMatch, saveCurrentMatch, saveRecord, updateStats, type MatchSave } from '../../../packages/web/src/game/storage';
import pending from '../../../packages/web/src/dev/fixtures/tribute/single-pending.json';

document.querySelector('button')!.addEventListener('click', () => {
  const status = document.querySelector('output')!;
  if (listRecords().length) { status.textContent = '已有记录，未写入测试数据。'; return; }
  for (let seed = 1; seed <= 8; seed++) {
    const match = createMatch(DEFAULT_RULES, seed);
    const state = startGame(match);
    const recorder = new Recorder({ schemaVersion:2, id:`hub-ui-${seed}`, matchId:`hub-ui-${seed}`,
      createdAt:Date.now() - seed * 3600000, ruleOpts:{...match.opts}, levelsBefore:[...state.levelsBefore],
      stageTeam:state.stageTeam, leader:state.leader, humanSeat:0, difficulties:[null,1,1,1],
      initialHands:state.hands.map(h=>[...h]) });
    for (let guard=0; !state.over && guard<500; guard++) {
      const combos=legalCombos(state), player=state.turn, toBeat=state.lastCombo;
      const move=combos.length ? {pass:false as const,combo:combos[0]} : {pass:true as const};
      applyMove(state,move);
      recorder.record(player,move,state.hands,toBeat);
    }
    if (!state.result) throw new Error('QA game did not finish');
    const record=recorder.finish(state.result);
    if (checkRecordIntegrity(record).length) throw new Error('Invalid QA record');
    saveRecord(record); updateStats(record);
  }
  if (!loadCurrentMatch()) saveCurrentMatch(pending as MatchSave);
  status.textContent = '已生成8局有效测试记录及继续比赛入口，可返回主页检查。';
});

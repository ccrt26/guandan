// Offline, finite child-process fixture. Never a public registry capability.
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--case' || !['pass', 'fail'].includes(args[1])) process.exit(2);
fs.appendFileSync('lab/out/probe-executed.txt', `${args[1]}\n`);
console.log(JSON.stringify({ expected: args[1] === 'pass', actual: args[1] === 'pass', caseId: args[1] }));
process.exit(args[1] === 'pass' ? 0 : 1);

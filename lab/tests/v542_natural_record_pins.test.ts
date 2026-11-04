import {afterEach, describe, expect, it, vi} from 'vitest';
const control = vi.hoisted(() => ({reads: [] as string[], corrupt: '', changeDuringRead: ''}));
vi.mock('node:fs', async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {...fs, readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
    const path = String(args[0]); control.reads.push(path);
    const result = fs.readFileSync(...args);
    if (control.changeDuringRead === path) {control.changeDuringRead = ''; fs.appendFileSync(path, 'changed');}
    return control.corrupt === path ? Buffer.from('unexpected disk bytes') : result;
  }};
});
import {mkdtempSync, realpathSync, writeFileSync, symlinkSync, renameSync, utimesSync, statSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as acceptance from '../review6_2/designed-source-acceptance';

const directories: string[] = [];
const fixture = () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'natural-record-pins-')));
  directories.push(directory);
  const file = join(directory, 'record.json'); writeFileSync(file, 'original');
  const make = (acceptance as any).createNaturalRecordPins;
  expect(make).toBeTypeOf('function');
  return {directory, file, pins: make()};
};
afterEach(() => {control.reads = []; control.corrupt = ''; control.changeDuringRead = ''; for (const path of directories.splice(0)) rmSync(path, {recursive: true, force: true});});

describe('acceptance natural record pins', () => {
  it('reads bytes once initially, reuses signals, and retains each final full check', () => {
    const {directory, file, pins} = fixture();
    pins.pinNatural(directory);
    for (let i = 0; i < 3; i++) {pins.pinNatural(directory); pins.assertNaturalSignals();}
    expect(control.reads.filter(p => p === file)).toHaveLength(1);
    pins.assertNaturalUnchanged(); pins.assertNaturalUnchanged();
    expect(control.reads.filter(p => p === file)).toHaveLength(3);
  });

  it('rejects content and same-size atomic replacement even with restored mtime', () => {
    const {directory, file, pins} = fixture(); pins.pinNatural(directory);
    const before = statSync(file), replacement = join(directory, 'replacement');
    writeFileSync(replacement, 'modified'); utimesSync(replacement, before.atime, before.mtime); renameSync(replacement, file);
    expect(() => pins.assertNaturalSignals()).toThrow('natural_record_changed');
  });

  it('rejects changed directory entries and symlink substitution', () => {
    const a = fixture(); a.pins.pinNatural(a.directory); writeFileSync(join(a.directory, 'new.json'), '{}');
    expect(() => a.pins.assertNaturalSignals()).toThrow('natural_record_changed');
    const b = fixture(); b.pins.pinNatural(b.directory); renameSync(b.file, b.file + '.original'); symlinkSync(b.file + '.original', b.file);
    expect(() => b.pins.assertNaturalSignals()).toThrow('natural_record_changed');
  });

  it('rejects symlinks on first pin and file changes during the initial read', () => {
    const a = fixture(); symlinkSync(a.file, join(a.directory, 'link'));
    expect(() => a.pins.pinNatural(a.directory)).toThrow('natural_record_file');
    const b = fixture(); control.changeDuringRead = b.file;
    expect(() => b.pins.pinNatural(b.directory)).toThrow('natural_record_changed');
  });

  it('still checks content at the final boundary even if metadata signals match', () => {
    const {directory, file, pins} = fixture(); pins.pinNatural(directory); control.corrupt = file;
    expect(() => pins.assertNaturalUnchanged()).toThrow('natural_record_changed');
  });
});

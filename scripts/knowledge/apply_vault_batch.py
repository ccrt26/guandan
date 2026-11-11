#!/usr/bin/env python3
"""Apply one frozen, local vault batch. Call while other vault writers are stopped."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


def identity(raw):
    return {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}


def file_bytes(path):
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(mode):
        raise ValueError(f'not a regular file: {path}')
    return path.read_bytes()


def local_path(root, rel):
    path = Path(rel)
    if path.is_absolute() or not path.parts or '..' in path.parts:
        raise ValueError(f'invalid relative path: {rel}')
    full = root / path
    if full.resolve() != full:
        raise ValueError(f'symlink or path drift: {full}')
    return full


def regular_dir(raw):
    path = Path(raw)
    if not path.is_absolute() or path.resolve() != path or not path.is_dir():
        raise ValueError(f'expected canonical directory: {path}')
    return path


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Batch:
    def __init__(self, data, manifest, digest, journal):
        self.base = manifest.parent
        self.run = data['run_id']
        if not isinstance(self.run, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', self.run):
            raise ValueError('invalid run_id')
        self.digest = digest
        self.journal = journal
        if set(data['roots']) != {'vault', 'project'}:
            raise ValueError('expected vault and project roots')
        self.roots = {k: regular_dir(v) for k, v in data['roots'].items()}
        vault, project = self.roots['vault'], self.roots['project']
        if vault.is_relative_to(project) or project.is_relative_to(vault):
            raise ValueError('batch roots overlap')
        if any(p.is_relative_to(root) for p in (manifest, journal, self.base)
               for root in self.roots.values()):
            raise ValueError('batch metadata must stay outside both roots')
        if not journal.is_relative_to(self.base) or journal == manifest:
            raise ValueError('journal must have its own path in the batch directory')
        self.baselines = {
            'vault': data['vault_baseline_files'],
            'project': data['project_baseline_files'],
        }
        self.ops = {}
        self.partners = {}
        self.files = {}
        self.temps = {}
        self.content = {}
        self.backup = {}
        occupied = set()
        groups = {}
        for op in data['ops']:
            oid = op['op_id']
            if not isinstance(oid, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', oid) or oid in self.ops:
                raise ValueError(f'invalid or repeated operation ID: {oid}')
            name = op['root']
            root = self.roots[name]
            dest = local_path(root, op['path'])
            if name == 'vault' and dest.is_relative_to(root / '99-历史存档'):
                raise ValueError(f'historical content is protected: {dest}')
            if not dest.parent.is_dir() or dest in occupied:
                raise ValueError(f'missing parent or repeated destination: {dest}')
            self.files[oid] = dest
            occupied.add(dest)
            before, after = op['before'], op['after']
            if (op['operation'] != ('put' if after is not None else 'remove')
                    or (before is None and after is None)):
                raise ValueError(f'operation and identities disagree: {oid}')
            expected_before = before['sha256'] if before is not None else None
            if self.baselines[name].get(op['path']) != expected_before:
                raise ValueError(f'before identity disagrees with baseline: {oid}')
            self.backup[oid] = self.frozen_bytes(before, 'backup')
            self.content[oid] = self.frozen_bytes(after, 'payload')
            if after is not None:
                temp = local_path(root, op['temp_path'])
                if temp.parent != dest.parent or not temp.name.startswith('.') or temp in occupied:
                    raise ValueError(f'invalid temporary path: {temp}')
                self.temps[oid] = temp
                occupied.add(temp)
            elif op.get('temp_path') is not None:
                raise ValueError(f'delete cannot have a temporary file: {oid}')
            group = op.get('rename_group')
            if group is not None:
                groups.setdefault(group, []).append(oid)
            self.ops[oid] = op

        for group, pair in groups.items():
            if len(pair) != 2:
                raise ValueError(f'expected a complete rename pair: {group}')
            new, old = pair
            if (self.ops[new]['operation'] != 'put' or self.ops[new]['before'] is not None
                    or self.ops[old]['operation'] != 'remove'
                    or self.ops[new]['root'] != self.ops[old]['root']):
                raise ValueError(f'rename needs new put followed by old remove: {group}')
            self.partners[old] = new

        raw_journal = file_bytes(journal)
        self.events = []
        if raw_journal:
            for line in raw_journal.splitlines():
                event = json.loads(line)
                oid = event.get('op_id')
                if (event.get('run_id') != self.run or event.get('manifest_sha') != self.digest
                        or oid not in self.ops or event.get('path') != self.ops[oid]['path']):
                    raise ValueError('journal event belongs to a different batch or path')
                self.events.append(event)

    def frozen_bytes(self, spec, key):
        if spec is None:
            return None
        path = Path(spec[key])
        if path.is_absolute():
            path = path.relative_to(self.base)
        path = local_path(self.base, str(path))
        raw = file_bytes(path)
        if raw is None or identity(raw) != {'sha256': spec['sha256'], 'bytes': spec['bytes']}:
            raise ValueError(f'{key} missing or differs from frozen identity: {path}')
        return raw

    def event(self, oid, name, **extra):
        record = {'event': name, 'run_id': self.run, 'manifest_sha': self.digest,
                  'op_id': oid, 'path': self.ops[oid]['path'], **extra}
        with self.journal.open('a', encoding='utf-8') as out:
            out.write(json.dumps(record, ensure_ascii=False) + '\n')
            out.flush()
            os.fsync(out.fileno())
        self.events.append(record)

    def target_state(self, oid):
        op = self.ops[oid]
        raw = file_bytes(local_path(self.roots[op['root']], op['path']))
        if raw == self.content[oid]:
            return 'after'
        if raw == self.backup[oid]:
            return 'before'
        return 'unknown'

    def temp_state(self, oid):
        path = self.temps.get(oid)
        if path is None:
            return 'absent'
        op = self.ops[oid]
        raw = file_bytes(local_path(self.roots[op['root']], op['temp_path']))
        if raw is None:
            return 'absent'
        events = [e for e in self.events if e['op_id'] == oid and e.get('temp') == op['temp_path']]
        if not any(e['event'] == 'prepared' for e in events):
            return 'unknown_temp'
        st = path.stat()
        created = [e for e in events if e['event'] == 'temp_created']
        if created and (created[-1].get('dev'), created[-1].get('inode')) != (st.st_dev, st.st_ino):
            return 'unknown_temp'
        if raw == self.content[oid]:
            return 'ready'
        if created and self.content[oid].startswith(raw):
            return 'partial_identified'
        return 'unknown_temp'

    def inspect(self, final=False):
        states, temps, problems = {}, {}, []
        for oid in self.ops:
            state, temp = self.target_state(oid), self.temp_state(oid)
            states[oid], temps[oid] = state, temp
            if state == 'unknown':
                problems.append({'op_id': oid, 'state': state})
            if temp == 'unknown_temp' or (state == 'after' and temp == 'partial_identified'):
                problems.append({'op_id': oid, 'state': 'unknown_temp'})
            if final and (state != 'after' or temp != 'absent'):
                problems.append({'op_id': oid, 'state': 'incomplete'})
        for old, new in self.partners.items():
            if states[old] == 'after' and states[new] != 'after':
                problems.append({'op_id': old, 'state': 'rename_target_missing'})
        for name, root in self.roots.items():
            baseline = self.baselines[name]
            edited = {op['path'] for op in self.ops.values() if op['root'] == name}
            declared_temp = {str(p.relative_to(root)) for oid, p in self.temps.items() if self.ops[oid]['root'] == name}
            for rel in sorted(set(baseline) - edited):
                raw = file_bytes(local_path(root, rel))
                if raw is None or identity(raw)['sha256'] != baseline[rel]:
                    problems.append({'root': name, 'path': rel, 'state': 'baseline_changed'})
            for path in root.rglob('*'):
                if path.is_symlink() or not path.is_dir():
                    rel = str(path.relative_to(root))
                    if rel not in baseline and rel not in edited and rel not in declared_temp:
                        problems.append({'root': name, 'path': rel, 'state': 'extra_file'})
        return {'states': states, 'temps': temps, 'problems': problems}

    def write_temp(self, oid, state):
        op, temp = self.ops[oid], self.temps[oid]
        if state == 'ready':
            with temp.open('rb') as ready:
                os.fsync(ready.fileno())
            return
        if state == 'absent':
            self.event(oid, 'prepared', temp=op['temp_path'])
            mode = self.files[oid].stat().st_mode & 0o777 if self.files[oid].exists() else 0o644
            fd = os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, mode)
        else:
            fd = os.open(temp, os.O_WRONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'wb') as out:
            st = os.fstat(out.fileno())
            if state == 'absent':
                sync_dir(temp.parent)
                self.event(oid, 'temp_created', temp=op['temp_path'], dev=st.st_dev, inode=st.st_ino)
            else:
                actual = temp.stat()
                if (self.temp_state(oid) != 'partial_identified'
                        or (actual.st_dev, actual.st_ino) != (st.st_dev, st.st_ino)):
                    raise ValueError(f'temporary identity changed: {oid}')
                out.truncate(0)
            out.write(self.content[oid])
            out.flush()
            os.fsync(out.fileno())

    def apply(self, preflight):
        for oid, op in self.ops.items():
            state, temp = self.target_state(oid), self.temp_state(oid)
            if (state, temp) != (preflight['states'][oid], preflight['temps'][oid]):
                raise ValueError(f'identity changed after preflight: {oid}')
            dest = self.files[oid]
            if state == 'after':
                if temp == 'ready':
                    self.temps[oid].unlink()
                    sync_dir(dest.parent)
                    self.event(oid, 'temp_removed', temp=op['temp_path'])
                continue
            if op['operation'] == 'remove':
                new = self.partners.get(oid)
                if new is not None and self.target_state(new) != 'after':
                    raise ValueError(f'rename target is not verified: {oid}')
                self.event(oid, 'prepared_remove')
                if self.target_state(oid) != 'before':
                    raise ValueError(f'identity changed before removal: {oid}')
                dest.unlink()
                sync_dir(dest.parent)
                self.event(oid, 'removed')
                continue
            self.write_temp(oid, temp)
            if self.target_state(oid) != 'before' or self.temp_state(oid) != 'ready':
                raise ValueError(f'identity changed before replace: {oid}')
            os.replace(self.temps[oid], dest)
            sync_dir(dest.parent)
            if self.target_state(oid) != 'after':
                raise ValueError(f'after identity mismatch: {oid}')
            self.event(oid, 'applied', sha256=op['after']['sha256'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('preflight', 'apply', 'resume'))
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--journal', type=Path)
    args = parser.parse_args()
    manifest = args.manifest.resolve()
    report = args.report.resolve()
    journal = (args.journal or manifest.parent / 'journal.jsonl').resolve()
    result = {'command': args.command, 'manifest_sha256': args.manifest_sha256}
    # Output paths are deliberately constrained even when the manifest cannot be parsed.
    if (not report.is_relative_to(manifest.parent) or report in (manifest, journal)
            or not report.parent.is_dir() or report.exists()):
        print('use a new report path within the batch directory', file=sys.stderr)
        return 2
    allow_report = False
    try:
        with manifest.open('rb') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            raw = stream.read()
            data = json.loads(raw)
            if any(report.is_relative_to(Path(root).resolve()) for root in data['roots'].values()):
                raise ValueError('report must be outside both application roots')
            allow_report = True
            if identity(raw)['sha256'] != args.manifest_sha256:
                raise ValueError('manifest differs from frozen SHA256')
            batch = Batch(data, manifest, args.manifest_sha256, journal)
            result['preflight'] = batch.inspect()
            if not result['preflight']['problems'] and args.command != 'preflight':
                batch.apply(result['preflight'])
                result['final'] = batch.inspect(final=True)
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        result['error'] = str(exc)
    failed = bool(result.get('error') or any(result.get(k, {}).get('problems') for k in ('preflight', 'final')))
    result['result'] = 'blocked' if failed else 'ok'
    if allow_report:
        with report.open('x', encoding='utf-8') as out:
            json.dump(result, out, ensure_ascii=False, indent=2)
            out.write('\n')
    print(json.dumps(result, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())

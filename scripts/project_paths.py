"""Shared local output rules. Importing this file does not create directories."""
import datetime, os
from pathlib import Path
import re
PROJECT_ROOT = Path(__file__).resolve().parents[1]
def checked_output(value, base=None):
    base = (base or PROJECT_ROOT/'lab/out').resolve()
    p = Path(value)
    if not p.is_absolute(): p = PROJECT_ROOT/p
    p = p.resolve()
    if p == base or base not in p.parents:
        raise ValueError('Output must be a task directory under '+str(base))
    return p

def task_output(prefix='task'):
    task = os.environ.get('GD_TASK_ID') or (prefix+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+str(os.getpid()))
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', task): raise ValueError('GD_TASK_ID must be one path segment')
    return checked_output(os.environ.get('GD_TASK_OUTPUT_ROOT') or 'lab/out/'+task)

def delivery_output():
    value = os.environ.get('GD_DELIVERY_OUTPUT_ROOT')
    if not value: raise ValueError('Set GD_DELIVERY_OUTPUT_ROOT=deliverables/research/<new-task> explicitly; sealed deliveries are read-only')
    p = checked_output(value, PROJECT_ROOT/'deliverables/research')
    sealed = PROJECT_ROOT/'deliverables/research/review6-2'
    if p == sealed or sealed in p.parents: raise ValueError('Existing REVIEW6.2 deliveries are sealed; choose a new task outside review6-2')
    return p

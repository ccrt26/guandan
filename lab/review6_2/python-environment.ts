/** Shared facts/worker environment; not a sanitizer for the already-running Node.
 * The host launcher must independently apply its allowlist before Node starts.
 * The explicit Python executable is passed unchanged by callers: a venv's
 * symlink launcher must never be replaced with its realpath/base interpreter.
 */
export function buildPythonEnvironment(source:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
 const result:NodeJS.ProcessEnv={};
 // Locale and executable search only. Venv selection comes from the frozen
 // launcher path, not VIRTUAL_ENV, PYTHONHOME, PYTHONPATH or activation scripts.
 for(const key of ['PATH','LANG','LC_ALL','LC_CTYPE','TZ'])if(source[key]!==undefined)result[key]=source[key];
 return {...result,PYTHONDONTWRITEBYTECODE:'1',OMP_NUM_THREADS:'2'};
}

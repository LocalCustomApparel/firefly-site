'use strict';
const { execFile } = require('child_process');
const { promisify } = require('util');
const { sleep } = require('./errors');
const execFileP = promisify(execFile);

// HTTP via a curl subprocess, NOT node's global fetch. Cloudflare fingerprints node/undici's
// TLS as a bot and challenges it (429) from the datacenter IP, while curl's browser-like
// fingerprint passes — verified 3/3 curl 200 vs node-fetch 429 back-to-back on the droplet.
// Returns { status, ok, text }. Overridable via setHttpImpl for offline tests.
async function curlHttp(url, { method = 'GET', headers = {}, body = null } = {}, _attempt = 1) {
  const args = ['-s', '-S', '--compressed', '--max-time', '25', '-w', '\\n%{http_code}', '-X', method];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (body != null) args.push('--data-binary', body);
  args.push(url);
  let status = 0, text = '';
  try {
    const { stdout } = await execFileP('curl', args, { maxBuffer: 16 * 1024 * 1024 });
    const nl = stdout.lastIndexOf('\n');
    text = nl >= 0 ? stdout.slice(0, nl) : stdout;
    status = Number((nl >= 0 ? stdout.slice(nl + 1) : stdout).trim()) || 0;
  } catch { status = 0; } // curl exec/network failure
  // The store intermittently returns gateway timeouts (502/504) and curl can transiently fail;
  // retry a few times with backoff before giving up on the request.
  if ((status === 0 || status === 502 || status === 504) && _attempt < 4) {
    await sleep(1200 * _attempt);
    return curlHttp(url, { method, headers, body }, _attempt + 1);
  }
  if (status === 0) throw new Error(`curl ${url} failed after ${_attempt} attempts`);
  return { status, ok: status >= 200 && status < 300, text };
}

let _httpImpl = curlHttp;
function setHttpImpl(fn) { _httpImpl = fn; } // test seam

module.exports = {
  curlHttp,
  setHttpImpl,
  // getter so callers that hold onto the exports object (not a destructured copy) always
  // see the current impl after setHttpImpl swaps it in for a test.
  get httpImpl() { return _httpImpl; },
};

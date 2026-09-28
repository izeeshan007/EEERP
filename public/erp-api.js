(function (root) {
 'use strict';
 function createClient({ fetchImpl = root.fetch.bind(root), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, onStatus = () => {}, onUnauthorized = () => {} } = {}) {
  let readiness;
  async function request(url, options = {}) {
   const method = String(options.method || 'GET').toUpperCase();
   const safeRead = ['GET', 'HEAD'].includes(method);
   const { attempts = safeRead ? 3 : 1, timeoutMs = 18000, ...init } = options;
   // Never replay writes: a timed-out sale/payment may already have committed.
   const count = safeRead ? Math.max(1, Math.min(4, attempts)) : 1;
   let lastError;
   for (let attempt = 0; attempt < count; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
     const response = await fetchImpl(url, { ...init, method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
     const json = String(response.headers.get('content-type') || '').includes('json');
     if (response.ok && json) return response;
     const body = json ? await response.clone().json().catch(() => ({})) : {};
     const error = new Error(body.message || body.error || (json ? 'ERP request failed (' + response.status + ').' : 'The ERP service returned a non-API response (' + response.status + ').'));
     if (body.code) error.message += ' Code: ' + body.code + '.';
     if (body.reference) error.message += ' Reference: ' + body.reference + '.';
     error.status = response.status;
     error.retryable = [408, 429, 502, 503, 504].includes(response.status) || (response.ok && !json);
     if (response.status === 401 && url !== '/api/login') onUnauthorized();
     throw error;
    } catch (error) {
     if (error.retryable === false || error.status === 401 || error.status === 403) throw error;
     lastError = error;
     if (!safeRead) {
      error.message += ' This change was not automatically retried. Check the record before submitting again.';
      throw error;
     }
     if (attempt + 1 < count) {
      onStatus('Connection interrupted. Retrying…');
      await sleep(1000 * (attempt + 1));
     }
    } finally { clearTimeout(timer); }
   }
   throw lastError || new Error('Could not reach ERP.');
  }
  function ready() {
   if (readiness) return readiness;
   readiness = (async () => {
    const deadline = now() + 90000;
    do {
     try {
      const response = await request('/api/health', { attempts: 1, timeoutMs: 15000 });
      const state = await response.json();
      if (state.service === 'eeerp' && state.ready === true) return state;
      onStatus('ERP database is reconnecting…');
     } catch { onStatus('Connecting to ERP… Your saved session has not been cleared.'); }
     if (now() >= deadline) break;
     await sleep(2000);
    } while (now() < deadline);
    throw new Error('ERP is unavailable. Retry the connection; do not re-enter unsaved changes.');
   })().finally(() => { readiness = null; });
   return readiness;
  }
  async function checkAuth() {
   const response = await request('/api/check-auth');
   const state = await response.json();
   if (typeof state.authenticated !== 'boolean') throw new Error('Invalid authentication response. Please retry the connection.');
   if (state.authenticated === false) onUnauthorized();
   return state.authenticated;
  }
  return { request, ready, checkAuth };
 }
 if (typeof module !== 'undefined' && module.exports) module.exports = { createClient };
 else root.ERPClient = { createClient };
})(typeof window !== 'undefined' ? window : globalThis);

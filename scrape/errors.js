'use strict';

// Thrown when a store returns a rate-limit / bot-challenge response. Adapters throw this so
// the caller (orchestrator) can back off instead of hammering a closed door.
class RateLimited extends Error {}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const browserHeaders = extra => ({ 'User-Agent': UA, 'Accept-Language': 'en-CA,en;q=0.9', ...extra });
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { RateLimited, browserHeaders, sleep };

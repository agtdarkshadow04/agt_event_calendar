import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_RETRY_AFTER_SECONDS, isMaintenanceActive, retryAfterSeconds, setMaintenanceActive, subscribeMaintenance, timing,
  withMaintenanceRetry,
} from './maintenance';

const maintenance = () => new Response(JSON.stringify({
  error: 'maintenance', message: 'Maintenance in progress. Try again in a moment.', params: { retryAfterSeconds: 10 },
}), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '10' } });
const ok = () => new Response('{"ok":true}', { status: 200 });

describe('503 maintenance (FE-5)', () => {
  it('reads Retry-After, then params, and clamps it', () => {
    assert.equal(retryAfterSeconds('10', undefined), 10);
    assert.equal(retryAfterSeconds(null, { retryAfterSeconds: 3 }), 3);
    assert.equal(retryAfterSeconds('soon', { retryAfterSeconds: 4 }), 4);
    assert.equal(retryAfterSeconds(null, null), DEFAULT_RETRY_AFTER_SECONDS);
    assert.equal(retryAfterSeconds('3600', undefined), 60);
    assert.equal(retryAfterSeconds('0', undefined), 1);
  });

  it('shows the notice, waits for Retry-After and retries once', async () => {
    const waits: number[] = [];
    const sleep = timing.sleep;
    timing.sleep = async (ms) => { waits.push(ms); };
    const seen: boolean[] = [];
    const unsubscribe = subscribeMaintenance((active) => seen.push(active));
    try {
      const responses = [maintenance(), ok()];
      let calls = 0;
      const response = await withMaintenanceRetry(async () => { calls += 1; return responses.shift()!; });
      assert.equal(response.status, 200);
      assert.equal(calls, 2);
      assert.deepEqual(waits, [10_000]);
      assert.deepEqual(seen, [true, false], 'the notice was shown, then cleared');

      // A second 503 is returned to the caller, and the notice stays until a request succeeds.
      const twice = [maintenance(), maintenance()];
      calls = 0;
      assert.equal((await withMaintenanceRetry(async () => { calls += 1; return twice.shift()!; })).status, 503);
      assert.equal(calls, 2, 'retried once only');
      assert.equal(isMaintenanceActive(), true);
      await withMaintenanceRetry(async () => ok());
      assert.equal(isMaintenanceActive(), false);
    } finally {
      timing.sleep = sleep;
      unsubscribe();
      setMaintenanceActive(false);
    }
  });

  it('does not retry other errors, including other 503s', async () => {
    for (const response of [
      new Response('{"error":"setup_password_missing","message":"x"}', { status: 503 }),
      new Response('{"error":"unauthorized","message":"x"}', { status: 401 }),
    ]) {
      let calls = 0;
      assert.equal((await withMaintenanceRetry(async () => { calls += 1; return response; })).status, response.status);
      assert.equal(calls, 1);
    }
    assert.equal(isMaintenanceActive(), false);
  });
});

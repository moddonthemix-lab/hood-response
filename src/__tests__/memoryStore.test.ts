import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../store/memory.js';
import { config } from '../config/env.js';

describe('MemoryStore settings persistence (Wallet Groups + Blue Chip filters)', () => {
  let dir = '';
  const original = config.STORE_SETTINGS_PATH;

  afterEach(async () => {
    config.STORE_SETTINGS_PATH = original;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('round-trips muted tokens and blue-chip toggles through disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'swarm-settings-'));
    config.STORE_SETTINGS_PATH = join(dir, 'settings.json');

    const a = new MemoryStore();
    a.mutedTokens.add('HMM');
    a.mutedTokens.add('TENDIES');
    a.blueChipBuys = false;
    a.blueChipSells = true;
    await a.saveSettings();

    // A fresh store simulates the redeploy: starts from env defaults only,
    // then restores whatever was saved before restart.
    const b = new MemoryStore();
    expect(b.mutedTokens.has('HMM')).toBe(false);
    await b.loadSettings();
    expect([...b.mutedTokens].sort()).toEqual(['HMM', 'TENDIES']);
    expect(b.blueChipBuys).toBe(false);
    expect(b.blueChipSells).toBe(true);
  });

  it('reflects later saves — unmuting and re-saving is picked up on next load', async () => {
    dir = await mkdtemp(join(tmpdir(), 'swarm-settings-'));
    config.STORE_SETTINGS_PATH = join(dir, 'settings.json');

    const a = new MemoryStore();
    a.mutedTokens.add('HMM');
    await a.saveSettings();
    a.mutedTokens.delete('HMM');
    await a.saveSettings();

    const b = new MemoryStore();
    await b.loadSettings();
    expect(b.mutedTokens.has('HMM')).toBe(false);
  });

  it('is a no-op when STORE_SETTINGS_PATH is not set', async () => {
    config.STORE_SETTINGS_PATH = '';
    const store = new MemoryStore();
    await expect(store.saveSettings()).resolves.toBeUndefined();
    await expect(store.loadSettings()).resolves.toBeUndefined();
  });

  it('a missing settings file is treated as "nothing saved yet", not an error', async () => {
    dir = await mkdtemp(join(tmpdir(), 'swarm-settings-'));
    config.STORE_SETTINGS_PATH = join(dir, 'does-not-exist.json');
    const store = new MemoryStore();
    await expect(store.loadSettings()).resolves.toBeUndefined();
  });
});

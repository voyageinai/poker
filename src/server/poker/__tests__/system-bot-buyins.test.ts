import { describe, expect, it } from 'vitest';

import { SYSTEM_BOTS, resolveSystemBotBuyin } from '@/lib/system-bots';

describe('system bot buyins', () => {
  it('keeps shortstack near the table minimum while deeper styles buy in for more', () => {
    const bigBlind = 20;
    const minBuyin = 400;
    const maxBuyin = 2000;

    const shortstack = SYSTEM_BOTS.find(bot => bot.style === 'shortstack');
    const bully = SYSTEM_BOTS.find(bot => bot.style === 'bully');
    const gto = SYSTEM_BOTS.find(bot => bot.style === 'gto');

    expect(shortstack).toBeDefined();
    expect(bully).toBeDefined();
    expect(gto).toBeDefined();

    const shortstackBuyin = resolveSystemBotBuyin(shortstack!, bigBlind, minBuyin, maxBuyin);
    const bullyBuyin = resolveSystemBotBuyin(bully!, bigBlind, minBuyin, maxBuyin);
    const gtoBuyin = resolveSystemBotBuyin(gto!, bigBlind, minBuyin, maxBuyin);

    expect(shortstackBuyin).toBe(minBuyin);
    expect(bullyBuyin).toBeGreaterThan(shortstackBuyin);
    expect(gtoBuyin).toBeGreaterThan(shortstackBuyin);
  });

  it('clamps preferred buyins to table max', () => {
    const bigBlind = 2000;
    const minBuyin = 50_000;
    const maxBuyin = 80_000;
    const bully = SYSTEM_BOTS.find(bot => bot.style === 'bully');

    expect(bully).toBeDefined();
    expect(resolveSystemBotBuyin(bully!, bigBlind, minBuyin, maxBuyin)).toBe(maxBuyin);
  });
});

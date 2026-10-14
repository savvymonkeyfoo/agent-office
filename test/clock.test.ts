// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatHeading, startClock } from '../src/client/clock.ts';

const moment = new Date(2026, 9, 13, 18, 6, 30);

afterEach(() => vi.useRealTimers());

describe('#96 time and date in place of the heading', () => {
  it('#96 AC1 reads "Tue 13 Oct · 18:06" in an en-GB browser', () => {
    expect(formatHeading(moment, 'en-GB')).toBe('Tue 13 Oct · 18:06');
  });

  it('#96 AC2 reads "Tue, Oct 13 · 6:06 PM" in an en-US browser', () => {
    expect(formatHeading(moment, 'en-US')).toBe('Tue, Oct 13 · 6:06 PM');
  });

  it('#96 AC3 updates the heading when the minute changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(moment);
    const heading = document.createElement('h1');
    startClock(heading, 'en-GB');
    expect(heading.textContent).toBe('Tue 13 Oct · 18:06');
    vi.advanceTimersByTime(29_000);
    expect(heading.textContent).toBe('Tue 13 Oct · 18:06');
    vi.advanceTimersByTime(1_000);
    expect(heading.textContent).toBe('Tue 13 Oct · 18:07');
    vi.advanceTimersByTime(60_000);
    expect(heading.textContent).toBe('Tue 13 Oct · 18:08');
  });

  it('#96 AC4 the browser tab title stays "Agent Office"', () => {
    expect(readFileSync('index.html', 'utf8')).toMatch(/<title>Agent Office<\/title>/);
    const heading = document.createElement('h1');
    document.title = 'Agent Office';
    startClock(heading);
    expect(document.title).toBe('Agent Office');
  });
});

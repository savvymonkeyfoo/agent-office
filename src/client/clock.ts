/** The heading's local time and date, e.g. "Tue 13 Oct · 18:06" (en-GB). No locale means the browser's own. */
export function formatHeading(now: Date, locale?: string) {
  const date = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(now);
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(now);
  // Some ICU versions put a narrow no-break space before AM/PM.
  return `${date} · ${time}`.replace(/\s/g, ' ');
}

/** Shows the time in `heading`, refreshed on each minute boundary. */
export function startClock(heading: HTMLElement, locale?: string) {
  const tick = () => {
    const now = new Date();
    heading.textContent = formatHeading(now, locale);
    setTimeout(tick, 60_000 - (now.getTime() % 60_000));
  };
  tick();
}

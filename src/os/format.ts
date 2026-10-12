const longDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Content dates are calendar days (YYYY-MM-DD); format them in UTC so the day never shifts.
export const formatDay = (isoDay: string, style: 'long' | 'short' = 'long') =>
  (style === 'long' ? longDay : shortDay).format(new Date(`${isoDay.slice(0, 10)}T00:00:00Z`));

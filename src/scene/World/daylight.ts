// How dark it is in each city the window looks out on, from that city's own wall clock (Intl, so daylight saving
// is right) and the sun's height there (NOAA's low-precision solar position, good to a fraction of a degree).

export type CityId = 'sf' | 'delhi';

export interface City {
  name: string;
  timeZone: string;
  latitude: number;
  longitude: number;
}

export const CITIES: Record<CityId, City> = {
  sf: { name: 'San Francisco', timeZone: 'America/Los_Angeles', latitude: 37.77, longitude: -122.42 },
  delhi: { name: 'Delhi', timeZone: 'Asia/Kolkata', latitude: 28.61, longitude: 77.21 },
};

// Full day above this sun height, full night below this one; dusk and dawn blend between (civil twilight ends at -6°).
const DAY_ABOVE_DEG = 4;
const NIGHT_BELOW_DEG = -7;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** The wall clock in `timeZone`: hours since local midnight, the local day of the year, and the zone's UTC offset in hours. */
export function localClock(date: Date, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const [year, month, day, hour, minute, second] = [part('year'), part('month'), part('day'), part('hour'), part('minute'), part('second')];
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetHours = Math.round((wallAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000) / 60;
  const dayOfYear = (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000 + 1;
  return { hours: hour + minute / 60 + second / 3600, dayOfYear, offsetHours };
}

/** The sun's height above the horizon in degrees, in `city` at `date`. */
export function sunElevation(city: City, date: Date): number {
  return solarPosition(city, date).elevation;
}

/** The sun's height (degrees) and hour angle (degrees, 0 at local solar noon, negative in the morning). */
export function solarPosition(city: City, date: Date): { elevation: number; hourAngle: number } {
  const { hours, dayOfYear, offsetHours } = localClock(date, city.timeZone);
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);
  const equationOfTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const solarMinutes = hours * 60 + equationOfTime + 4 * city.longitude - 60 * offsetHours;
  const hourAngle = ((solarMinutes / 4 - 180) * Math.PI) / 180;
  const latitude = (city.latitude * Math.PI) / 180;
  const cosZenith = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = 90 - (Math.acos(Math.min(1, Math.max(-1, cosZenith))) * 180) / Math.PI;
  return { elevation, hourAngle: ((((hourAngle * 180) / Math.PI + 540) % 360) + 360) % 360 - 180 };
}

/** 0 in full day, 1 in full night, a smooth blend through dusk and dawn. */
export function nightWeight(city: City, date: Date): number {
  return nightAt(sunElevation(city, date));
}

/** nightWeight for a sun this many degrees above the horizon. */
export function nightAt(elevation: number): number {
  const t = Math.min(1, Math.max(0, (DAY_ABOVE_DEG - elevation) / (DAY_ABOVE_DEG - NIGHT_BELOW_DEG)));
  return t * t * (3 - 2 * t);
}

// A new moon (2000-01-06 18:14 UTC) and the mean synodic month, good to about half a day over decades.
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_DAYS = 29.530588853;

/** The moon's age as a share of its month: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function moonAge(date: Date): number {
  const days = (date.getTime() - NEW_MOON_MS) / 86_400_000;
  return (((days / SYNODIC_DAYS) % 1) + 1) % 1;
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** "3:12 am" on the city's clock. */
export function localTime(city: City, date: Date): string {
  let format = clockFormatters.get(city.timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: city.timeZone, hour: 'numeric', minute: '2-digit' });
    clockFormatters.set(city.timeZone, format);
  }
  return format
    .format(date)
    .replace(/\s?([AP])M$/, (_, half: string) => ` ${half.toLowerCase()}m`);
}

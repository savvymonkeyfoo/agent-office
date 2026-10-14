import { ZONES, ZONE_ALIASES } from './zones.ts';

export interface SunTimes {
  /** Local hours since midnight in the zone, e.g. 7.25 for 07:15. */
  rise: number;
  set: number;
  /** True when the zone wasn't in the table and its place was guessed from its UTC offset. */
  estimated: boolean;
}

const toRad = (degrees: number) => (degrees * Math.PI) / 180;
const toDeg = (radians: number) => (radians * 180) / Math.PI;
const MS_PER_DAY = 864e5;

/** The calendar date and hours since midnight (e.g. 7.25) of `date` in `zone`. */
export function partsIn(zone: string, date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') + get('minute') / 60 + get('second') / 3600 };
}

/** Where `zone` is: its reference city, or for an unknown zone longitude from its UTC offset and latitude 40. */
function locate(zone: string, date: Date) {
  const place = ZONES[ZONE_ALIASES[zone] ?? zone];
  if (place) return { lat: place[0], lon: place[1], estimated: false };
  const local = partsIn(zone, date);
  const offsetHours = (Date.UTC(local.year, local.month - 1, local.day) + local.hour * 36e5 - date.getTime()) / 36e5;
  return { lat: 40, lon: offsetHours * 15, estimated: true };
}

/** Today's sunrise and sunset in the browser's time zone (`zone`), by NOAA's sunrise equation. */
export function sunTimes(zone: string, date = new Date()): SunTimes {
  const { lat, lon, estimated } = locate(zone, date);
  const { year, month, day } = partsIn(zone, date);
  const midnightUtc = Date.UTC(year, month - 1, day);
  const dayOfYear = Math.round((midnightUtc - Date.UTC(year, 0, 0)) / MS_PER_DAY);
  const y = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(y) - 0.032077 * Math.sin(y) - 0.014615 * Math.cos(2 * y) - 0.040849 * Math.sin(2 * y));
  const declination = 0.006918 - 0.399912 * Math.cos(y) + 0.070257 * Math.sin(y) - 0.006758 * Math.cos(2 * y)
    + 0.000907 * Math.sin(2 * y) - 0.002697 * Math.cos(3 * y) + 0.00148 * Math.sin(3 * y);
  const cosHourAngle = Math.cos(toRad(90.833)) / (Math.cos(toRad(lat)) * Math.cos(declination)) - Math.tan(toRad(lat)) * Math.tan(declination);
  // Beyond ±1 the sun never rises (polar night) or never sets (midnight sun); keep a sliver of either so the sky still turns.
  const hourAngle = toDeg(Math.acos(Math.min(0.995, Math.max(-0.995, cosHourAngle))));
  const localHourAt = (utcMinutes: number) => partsIn(zone, new Date(midnightUtc + utcMinutes * 60000)).hour;
  return {
    rise: localHourAt(720 - 4 * (lon + hourAngle) - equationOfTime),
    set: localHourAt(720 - 4 * (lon - hourAngle) - equationOfTime),
    estimated,
  };
}

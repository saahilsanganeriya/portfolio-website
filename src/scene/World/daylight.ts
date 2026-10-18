// The two cities the window looks out on: San Francisco on the left, New Delhi on the right, at one fixed moment
// whatever the hour (owner): San Francisco at 7 PM, the sun setting; New Delhi at 7:30 AM, the sun rising. Nothing here
// reads a clock.

export type CityId = 'sf' | 'delhi';

export interface City {
  name: string;
}

export const CITIES: Record<CityId, City> = {
  sf: { name: 'San Francisco' },
  delhi: { name: 'New Delhi' },
};

/** How dark the window shows `city`: never, since both cities stay lit at dusk and at dawn (the finishing pass's window bloom reads it). */
export function nightWeight(_city: City, _date?: Date): number {
  return 0;
}

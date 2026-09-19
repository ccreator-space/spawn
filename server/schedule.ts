export type Slot = { id: string; weekday: number; platform: string; format: string; label: string };

// JavaScript weekdays: Sunday=0, Monday=1.
export const WEEKLY_SLOTS: Slot[] = [
  { id: "yt-mon-long", weekday: 1, platform: "YouTube", format: "long", label: "Uzun Video #1" },
  { id: "ig-mon-carousel", weekday: 1, platform: "Instagram", format: "carousel", label: "Carousel #1" },
  { id: "li-mon-teaser", weekday: 1, platform: "LinkedIn", format: "teaser", label: "YouTube duyuru videosu #1" },
  { id: "yt-tue-short", weekday: 2, platform: "YouTube", format: "short", label: "Haftalık Short #1" },
  { id: "ig-tue-reel", weekday: 2, platform: "Instagram", format: "reel", label: "Reel #1" },
  { id: "tt-tue", weekday: 2, platform: "TikTok", format: "tiktok", label: "TikTok #1" },
  { id: "li-tue-tip", weekday: 2, platform: "LinkedIn", format: "tip", label: "Yazılım İpucu #1" },
  { id: "x-tue-tip", weekday: 2, platform: "X", format: "tip", label: "Yazılım İpucu #1" },
  { id: "yt-wed-long", weekday: 3, platform: "YouTube", format: "long", label: "Uzun Video #2" },
  { id: "ig-wed-carousel", weekday: 3, platform: "Instagram", format: "carousel", label: "Carousel #2" },
  { id: "li-wed-carousel", weekday: 3, platform: "LinkedIn", format: "carousel", label: "Carousel #1" },
  { id: "yt-thu-js", weekday: 4, platform: "YouTube", format: "short", label: "1 Dakikada JavaScript" },
  { id: "ig-thu-js", weekday: 4, platform: "Instagram", format: "reel", label: "JS Reel" },
  { id: "tt-thu-js", weekday: 4, platform: "TikTok", format: "tiktok", label: "JS TikTok" },
  { id: "li-thu-tip", weekday: 4, platform: "LinkedIn", format: "tip", label: "Yazılım İpucu #2" },
  { id: "x-thu-tip", weekday: 4, platform: "X", format: "tip", label: "Yazılım İpucu #2" },
  { id: "yt-fri-long", weekday: 5, platform: "YouTube", format: "long", label: "Uzun Video #3" },
  { id: "li-fri-teaser", weekday: 5, platform: "LinkedIn", format: "teaser", label: "YouTube duyuru videosu #2" },
  { id: "yt-sat-short", weekday: 6, platform: "YouTube", format: "short", label: "Uzun videodan Short" },
  { id: "ig-sat-reel", weekday: 6, platform: "Instagram", format: "reel", label: "Reel #3" },
  { id: "tt-sat", weekday: 6, platform: "TikTok", format: "tiktok", label: "TikTok #3" },
  { id: "li-sat-carousel", weekday: 6, platform: "LinkedIn", format: "carousel", label: "Carousel #2" },
  { id: "yt-sun-short", weekday: 0, platform: "YouTube", format: "short", label: "Haftalık Short #2" },
  { id: "ig-sun-reel", weekday: 0, platform: "Instagram", format: "reel", label: "Reel #4" },
  { id: "tt-sun", weekday: 0, platform: "TikTok", format: "tiktok", label: "TikTok #4" },
];

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(value: string, count: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function mondayOf(value: string): string {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return addDays(value, -((day + 6) % 7));
}

export function slotsForWeek(monday: string) {
  return WEEKLY_SLOTS.map((slot) => ({ ...slot, date: addDays(monday, (slot.weekday + 6) % 7) }));
}

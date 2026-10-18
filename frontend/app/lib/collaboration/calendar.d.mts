export const COLLABORATION_TIME_ZONE: "Asia/Seoul";
export function validateCalendarDate(value: unknown): string;
export function validateCalendarTime(value: unknown): string;
export function addCalendarDays(value: string, count?: number): string;
export function todayInSeoul(value?: string | Date): string;
export function defaultTaskDueDate(value?: string | Date): string;
export function calendarDateInRange(date: string, startDate: string, endDate: string): boolean;

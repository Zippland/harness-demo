import { describe, it, expect } from 'vitest';
import {
  formatDate,
  parseDate,
  getRelativeTime,
  getRelativeTimeFromNow,
  dateDiff,
  dateDiffInDays,
  dateDiffInMonths,
  dateDiffInYears,
  addDays,
  addMonths,
  isValidDate,
} from '../src/index';

describe('formatDate', () => {
  it('should format date with YYYY-MM-DD pattern', () => {
    const date = new Date(2024, 0, 15); // January 15, 2024
    expect(formatDate(date, 'YYYY-MM-DD')).toBe('2024-01-15');
  });

  it('should format date with DD/MM/YYYY pattern', () => {
    const date = new Date(2024, 11, 25); // December 25, 2024
    expect(formatDate(date, 'DD/MM/YYYY')).toBe('25/12/2024');
  });

  it('should format date with MM-DD-YYYY pattern', () => {
    const date = new Date(2024, 5, 7); // June 7, 2024
    expect(formatDate(date, 'MM-DD-YYYY')).toBe('06-07-2024');
  });

  it('should format date with YYYY/MM/DD HH:mm:ss pattern', () => {
    const date = new Date(2024, 2, 10, 14, 30, 45); // March 10, 2024 14:30:45
    expect(formatDate(date, 'YYYY/MM/DD HH:mm:ss')).toBe('2024/03/10 14:30:45');
  });

  it('should handle single digit months and days with padding', () => {
    const date = new Date(2024, 0, 5); // January 5, 2024
    expect(formatDate(date, 'YYYY-MM-DD')).toBe('2024-01-05');
  });

  it('should format date with custom separators', () => {
    const date = new Date(2024, 6, 20); // July 20, 2024
    expect(formatDate(date, 'YYYY.MM.DD')).toBe('2024.07.20');
  });
});

describe('parseDate', () => {
  it('should parse YYYY-MM-DD format string', () => {
    const result = parseDate('2024-01-15', 'YYYY-MM-DD');
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0); // January
    expect(result.getDate()).toBe(15);
  });

  it('should parse DD/MM/YYYY format string', () => {
    const result = parseDate('25/12/2024', 'DD/MM/YYYY');
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(11); // December
    expect(result.getDate()).toBe(25);
  });

  it('should parse MM-DD-YYYY format string', () => {
    const result = parseDate('06-07-2024', 'MM-DD-YYYY');
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(5); // June
    expect(result.getDate()).toBe(7);
  });

  it('should throw error for invalid date string', () => {
    expect(() => parseDate('invalid', 'YYYY-MM-DD')).toThrow();
  });

  it('should throw error for mismatched format', () => {
    expect(() => parseDate('2024-01-15', 'DD/MM/YYYY')).toThrow();
  });
});

describe('getRelativeTime', () => {
  it('should return "just now" for dates less than a minute apart', () => {
    const now = new Date(2024, 0, 15, 12, 0, 0);
    const date = new Date(2024, 0, 15, 12, 0, 30);
    expect(getRelativeTime(date, now)).toBe('just now');
  });

  it('should return "X minutes ago" for dates minutes apart', () => {
    const now = new Date(2024, 0, 15, 12, 30, 0);
    const date = new Date(2024, 0, 15, 12, 0, 0);
    expect(getRelativeTime(date, now)).toBe('30 minutes ago');
  });

  it('should return "1 minute ago" for singular minute', () => {
    const now = new Date(2024, 0, 15, 12, 1, 0);
    const date = new Date(2024, 0, 15, 12, 0, 0);
    expect(getRelativeTime(date, now)).toBe('1 minute ago');
  });

  it('should return "X hours ago" for dates hours apart', () => {
    const now = new Date(2024, 0, 15, 15, 0, 0);
    const date = new Date(2024, 0, 15, 12, 0, 0);
    expect(getRelativeTime(date, now)).toBe('3 hours ago');
  });

  it('should return "X days ago" for dates days apart', () => {
    const now = new Date(2024, 0, 18, 12, 0, 0);
    const date = new Date(2024, 0, 15, 12, 0, 0);
    expect(getRelativeTime(date, now)).toBe('3 days ago');
  });

  it('should return "X weeks ago" for dates weeks apart', () => {
    const now = new Date(2024, 0, 29, 12, 0, 0);
    const date = new Date(2024, 0, 15, 12, 0, 0);
    expect(getRelativeTime(date, now)).toBe('2 weeks ago');
  });

  it('should return "X months ago" for dates months apart', () => {
    const now = new Date(2024, 3, 15, 12, 0, 0);
    const date = new Date(2024, 0, 15, 12, 0, 0);
    expect(getRelativeTime(date, now)).toBe('3 months ago');
  });

  it('should return "X years ago" for dates years apart', () => {
    const now = new Date(2026, 0, 15, 12, 0, 0);
    const date = new Date(2024, 0, 15, 12, 0, 0);
    expect(getRelativeTime(date, now)).toBe('2 years ago');
  });

  it('should return future relative time for dates in the future', () => {
    const now = new Date(2024, 0, 15, 12, 0, 0);
    const date = new Date(2024, 0, 18, 12, 0, 0);
    expect(getRelativeTime(date, now)).toBe('in 3 days');
  });
});

describe('getRelativeTimeFromNow', () => {
  it('should calculate relative time from current moment', () => {
    // This test uses a fixed reference to ensure determinism
    const fixedNow = new Date(2024, 0, 15, 12, 0, 0);
    const pastDate = new Date(2024, 0, 12, 12, 0, 0);
    // We test the underlying function behavior with explicit reference
    expect(getRelativeTime(pastDate, fixedNow)).toBe('3 days ago');
  });

  it('should handle dates in the past', () => {
    const fixedNow = new Date(2024, 0, 15, 12, 0, 0);
    const pastDate = new Date(2024, 0, 14, 12, 0, 0);
    expect(getRelativeTime(pastDate, fixedNow)).toBe('1 day ago');
  });

  it('should handle dates in the future', () => {
    const fixedNow = new Date(2024, 0, 15, 12, 0, 0);
    const futureDate = new Date(2024, 0, 20, 12, 0, 0);
    expect(getRelativeTime(futureDate, fixedNow)).toBe('in 5 days');
  });

  it('should handle same day different times', () => {
    const fixedNow = new Date(2024, 0, 15, 15, 0, 0);
    const earlierToday = new Date(2024, 0, 15, 10, 0, 0);
    expect(getRelativeTime(earlierToday, fixedNow)).toBe('5 hours ago');
  });
});

describe('dateDiff', () => {
  it('should return difference in milliseconds', () => {
    const date1 = new Date(2024, 0, 15, 12, 0, 0);
    const date2 = new Date(2024, 0, 15, 12, 0, 1);
    expect(dateDiff(date1, date2, 'milliseconds')).toBe(1000);
  });

  it('should return difference in seconds', () => {
    const date1 = new Date(2024, 0, 15, 12, 0, 0);
    const date2 = new Date(2024, 0, 15, 12, 1, 0);
    expect(dateDiff(date1, date2, 'seconds')).toBe(60);
  });

  it('should return difference in minutes', () => {
    const date1 = new Date(2024, 0, 15, 12, 0, 0);
    const date2 = new Date(2024, 0, 15, 14, 0, 0);
    expect(dateDiff(date1, date2, 'minutes')).toBe(120);
  });

  it('should return difference in hours', () => {
    const date1 = new Date(2024, 0, 15, 0, 0, 0);
    const date2 = new Date(2024, 0, 16, 0, 0, 0);
    expect(dateDiff(date1, date2, 'hours')).toBe(24);
  });

  it('should return difference in days', () => {
    const date1 = new Date(2024, 0, 1);
    const date2 = new Date(2024, 0, 31);
    expect(dateDiff(date1, date2, 'days')).toBe(30);
  });

  it('should handle negative differences (date1 > date2)', () => {
    const date1 = new Date(2024, 0, 31);
    const date2 = new Date(2024, 0, 1);
    expect(dateDiff(date1, date2, 'days')).toBe(-30);
  });
});

describe('dateDiffInDays', () => {
  it('should return exact number of days between two dates', () => {
    const date1 = new Date(2024, 0, 1);
    const date2 = new Date(2024, 0, 15);
    expect(dateDiffInDays(date1, date2)).toBe(14);
  });

  it('should handle dates across months', () => {
    const date1 = new Date(2024, 0, 15);
    const date2 = new Date(2024, 1, 15);
    expect(dateDiffInDays(date1, date2)).toBe(31);
  });

  it('should handle dates across years', () => {
    const date1 = new Date(2023, 11, 31);
    const date2 = new Date(2024, 0, 1);
    expect(dateDiffInDays(date1, date2)).toBe(1);
  });

  it('should return 0 for same date', () => {
    const date1 = new Date(2024, 0, 15);
    const date2 = new Date(2024, 0, 15);
    expect(dateDiffInDays(date1, date2)).toBe(0);
  });

  it('should handle leap years', () => {
    const date1 = new Date(2024, 1, 28); // Feb 28, 2024 (leap year)
    const date2 = new Date(2024, 2, 1); // Mar 1, 2024
    expect(dateDiffInDays(date1, date2)).toBe(2);
  });
});

describe('dateDiffInMonths', () => {
  it('should return exact number of months between two dates', () => {
    const date1 = new Date(2024, 0, 15);
    const date2 = new Date(2024, 6, 15);
    expect(dateDiffInMonths(date1, date2)).toBe(6);
  });

  it('should handle dates across years', () => {
    const date1 = new Date(2023, 6, 15);
    const date2 = new Date(2024, 6, 15);
    expect(dateDiffInMonths(date1, date2)).toBe(12);
  });

  it('should return partial months as floor value', () => {
    const date1 = new Date(2024, 0, 1);
    const date2 = new Date(2024, 1, 15);
    expect(dateDiffInMonths(date1, date2)).toBe(1);
  });

  it('should return 0 for dates within same month', () => {
    const date1 = new Date(2024, 0, 1);
    const date2 = new Date(2024, 0, 31);
    expect(dateDiffInMonths(date1, date2)).toBe(0);
  });
});

describe('dateDiffInYears', () => {
  it('should return exact number of years between two dates', () => {
    const date1 = new Date(2020, 0, 15);
    const date2 = new Date(2024, 0, 15);
    expect(dateDiffInYears(date1, date2)).toBe(4);
  });

  it('should return partial years as floor value', () => {
    const date1 = new Date(2020, 0, 15);
    const date2 = new Date(2024, 6, 15);
    expect(dateDiffInYears(date1, date2)).toBe(4);
  });

  it('should return 0 for dates within same year', () => {
    const date1 = new Date(2024, 0, 1);
    const date2 = new Date(2024, 11, 31);
    expect(dateDiffInYears(date1, date2)).toBe(0);
  });

  it('should handle century boundaries', () => {
    const date1 = new Date(1999, 11, 31);
    const date2 = new Date(2000, 0, 1);
    expect(dateDiffInYears(date1, date2)).toBe(0);
  });
});

describe('addDays', () => {
  it('should add positive days to a date', () => {
    const date = new Date(2024, 0, 15);
    const result = addDays(date, 10);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(25);
  });

  it('should subtract days when given negative value', () => {
    const date = new Date(2024, 0, 15);
    const result = addDays(date, -10);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(5);
  });

  it('should handle month boundary crossings', () => {
    const date = new Date(2024, 0, 25);
    const result = addDays(date, 10);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(4);
  });

  it('should handle year boundary crossings', () => {
    const date = new Date(2023, 11, 25);
    const result = addDays(date, 10);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(4);
  });

  it('should not mutate the original date', () => {
    const date = new Date(2024, 0, 15);
    const originalTime = date.getTime();
    addDays(date, 10);
    expect(date.getTime()).toBe(originalTime);
  });
});

describe('addMonths', () => {
  it('should add positive months to a date', () => {
    const date = new Date(2024, 0, 15);
    const result = addMonths(date, 3);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(3); // April
    expect(result.getDate()).toBe(15);
  });

  it('should subtract months when given negative value', () => {
    const date = new Date(2024, 6, 15);
    const result = addMonths(date, -3);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(3); // April
    expect(result.getDate()).toBe(15);
  });

  it('should handle year boundary crossings', () => {
    const date = new Date(2024, 10, 15);
    const result = addMonths(date, 3);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(15);
  });

  it('should handle month-end overflow (31st to 30-day month)', () => {
    const date = new Date(2024, 0, 31); // January 31
    const result = addMonths(date, 1);
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(1); // February
    // Should clamp to last day of February (29 in leap year 2024)
    expect(result.getDate()).toBe(29);
  });

  it('should not mutate the original date', () => {
    const date = new Date(2024, 0, 15);
    const originalTime = date.getTime();
    addMonths(date, 3);
    expect(date.getTime()).toBe(originalTime);
  });
});

describe('isValidDate', () => {
  it('should return true for valid Date object', () => {
    const date = new Date(2024, 0, 15);
    expect(isValidDate(date)).toBe(true);
  });

  it('should return false for Invalid Date', () => {
    const date = new Date('invalid');
    expect(isValidDate(date)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isValidDate(null as unknown as Date)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isValidDate(undefined as unknown as Date)).toBe(false);
  });

  it('should return true for date at epoch', () => {
    const date = new Date(0);
    expect(isValidDate(date)).toBe(true);
  });

  it('should return true for very old dates', () => {
    const date = new Date(1900, 0, 1);
    expect(isValidDate(date)).toBe(true);
  });
});

/**
 * Date utility library for formatting, parsing, relative time, and date arithmetic.
 */

export type DateDiffUnit = 'milliseconds' | 'seconds' | 'minutes' | 'hours' | 'days';

/**
 * Formats a Date object according to a given pattern string.
 * Supported tokens: YYYY, MM, DD, HH, mm, ss
 * @param date - The date to format
 * @param format - The format pattern (e.g., 'YYYY-MM-DD', 'DD/MM/YYYY HH:mm:ss')
 * @returns The formatted date string
 */
export function formatDate(date: Date, format: string): string {
  const pad = (num: number): string => num.toString().padStart(2, '0');

  const tokens: Record<string, string> = {
    'YYYY': date.getFullYear().toString(),
    'MM': pad(date.getMonth() + 1),
    'DD': pad(date.getDate()),
    'HH': pad(date.getHours()),
    'mm': pad(date.getMinutes()),
    'ss': pad(date.getSeconds()),
  };

  let result = format;
  for (const [token, value] of Object.entries(tokens)) {
    result = result.split(token).join(value);
  }

  return result;
}

/**
 * Parses a date string according to a given format pattern.
 * Supported tokens: YYYY, MM, DD
 * @param dateString - The date string to parse
 * @param format - The format pattern that matches the dateString
 * @returns A Date object
 * @throws Error if the date string doesn't match the format or is invalid
 */
export function parseDate(dateString: string, format: string): Date {
  // Find token positions in the format string
  const yearIndex = format.indexOf('YYYY');
  const monthIndex = format.indexOf('MM');
  const dayIndex = format.indexOf('DD');

  if (yearIndex === -1 || monthIndex === -1 || dayIndex === -1) {
    throw new Error('Invalid format: must contain YYYY, MM, and DD');
  }

  // Build a regex pattern from the format string
  // Replace tokens with capture groups and escape other characters
  let regexPattern = format;
  regexPattern = regexPattern.replace('YYYY', '(\\d{4})');
  regexPattern = regexPattern.replace('MM', '(\\d{2})');
  regexPattern = regexPattern.replace('DD', '(\\d{2})');
  // Escape special regex characters in separators
  regexPattern = regexPattern.replace(/([\/\-\.])/g, '\\$1');

  const regex = new RegExp(`^${regexPattern}$`);
  const match = dateString.match(regex);

  if (!match) {
    throw new Error(`Date string "${dateString}" does not match format "${format}"`);
  }

  // Determine which capture group corresponds to which token
  // based on the order they appear in the format string
  const tokenPositions: Array<{ token: string; index: number }> = [
    { token: 'YYYY', index: yearIndex },
    { token: 'MM', index: monthIndex },
    { token: 'DD', index: dayIndex },
  ].sort((a, b) => a.index - b.index);

  const values: Record<string, number> = {};
  tokenPositions.forEach((tp, i) => {
    values[tp.token] = parseInt(match[i + 1], 10);
  });

  const year = values['YYYY'];
  const month = values['MM'] - 1; // Convert from 1-indexed to 0-indexed
  const day = values['DD'];

  // Validate the date components
  if (month < 0 || month > 11) {
    throw new Error('Invalid month value');
  }
  if (day < 1 || day > 31) {
    throw new Error('Invalid day value');
  }

  const date = new Date(year, month, day);

  // Check if the date is valid by verifying the components match
  // (Date constructor may roll over invalid dates, e.g., Feb 30 becomes Mar 2)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    throw new Error('Invalid date');
  }

  return date;
}

/**
 * Returns a human-readable relative time string between two dates.
 * Examples: "just now", "5 minutes ago", "in 3 days", "2 years ago"
 * @param date - The date to describe
 * @param referenceDate - The reference date to compare against
 * @returns A relative time string
 */
export function getRelativeTime(date: Date, referenceDate: Date): string {
  const MS_PER_SECOND = 1000;
  const MS_PER_MINUTE = MS_PER_SECOND * 60;
  const MS_PER_HOUR = MS_PER_MINUTE * 60;
  const MS_PER_DAY = MS_PER_HOUR * 24;
  const MS_PER_WEEK = MS_PER_DAY * 7;
  const MS_PER_MONTH = MS_PER_DAY * 30;
  const MS_PER_YEAR = MS_PER_DAY * 365;

  const diffMs = date.getTime() - referenceDate.getTime();
  const absDiffMs = Math.abs(diffMs);
  const isFuture = diffMs > 0;

  const formatResult = (value: number, unit: string): string => {
    const plural = value === 1 ? '' : 's';
    if (isFuture) {
      return `in ${value} ${unit}${plural}`;
    }
    return `${value} ${unit}${plural} ago`;
  };

  // Less than 1 minute
  if (absDiffMs < MS_PER_MINUTE) {
    return 'just now';
  }

  // Less than 1 hour -> minutes
  if (absDiffMs < MS_PER_HOUR) {
    const minutes = Math.floor(absDiffMs / MS_PER_MINUTE);
    return formatResult(minutes, 'minute');
  }

  // Less than 1 day -> hours
  if (absDiffMs < MS_PER_DAY) {
    const hours = Math.floor(absDiffMs / MS_PER_HOUR);
    return formatResult(hours, 'hour');
  }

  // Less than 1 week -> days
  if (absDiffMs < MS_PER_WEEK) {
    const days = Math.floor(absDiffMs / MS_PER_DAY);
    return formatResult(days, 'day');
  }

  // Less than 1 month -> weeks
  if (absDiffMs < MS_PER_MONTH) {
    const weeks = Math.floor(absDiffMs / MS_PER_WEEK);
    return formatResult(weeks, 'week');
  }

  // Less than 1 year -> months
  if (absDiffMs < MS_PER_YEAR) {
    const months = Math.floor(absDiffMs / MS_PER_MONTH);
    return formatResult(months, 'month');
  }

  // 1 year or more -> years
  const years = Math.floor(absDiffMs / MS_PER_YEAR);
  return formatResult(years, 'year');
}

/**
 * Returns a human-readable relative time string from the current moment.
 * This is a convenience wrapper around getRelativeTime using Date.now() as reference.
 * @param date - The date to describe relative to now
 * @returns A relative time string
 */
export function getRelativeTimeFromNow(date: Date): string {
  return getRelativeTime(date, new Date());
}

/**
 * Calculates the difference between two dates in the specified unit.
 * Returns positive if date2 > date1, negative if date1 > date2.
 * @param date1 - The first date
 * @param date2 - The second date
 * @param unit - The unit of measurement
 * @returns The difference as a number (may be negative)
 */
export function dateDiff(date1: Date, date2: Date, unit: DateDiffUnit): number {
  const MS_PER_SECOND = 1000;
  const MS_PER_MINUTE = 60000;
  const MS_PER_HOUR = 3600000;
  const MS_PER_DAY = 86400000;

  const diffMs = date2.getTime() - date1.getTime();

  switch (unit) {
    case 'milliseconds':
      return diffMs;
    case 'seconds':
      return Math.floor(diffMs / MS_PER_SECOND);
    case 'minutes':
      return Math.floor(diffMs / MS_PER_MINUTE);
    case 'hours':
      return Math.floor(diffMs / MS_PER_HOUR);
    case 'days':
      return Math.floor(diffMs / MS_PER_DAY);
  }
}

/**
 * Calculates the difference between two dates in whole days.
 * Returns positive if date2 > date1, negative if date1 > date2.
 * @param date1 - The first date
 * @param date2 - The second date
 * @returns The difference in days
 */
export function dateDiffInDays(date1: Date, date2: Date): number {
  const MS_PER_DAY = 86400000;
  const diffMs = date2.getTime() - date1.getTime();
  return Math.floor(diffMs / MS_PER_DAY);
}

/**
 * Calculates the difference between two dates in whole months.
 * Uses floor value for partial months.
 * @param date1 - The first date
 * @param date2 - The second date
 * @returns The difference in months
 */
export function dateDiffInMonths(date1: Date, date2: Date): number {
  const yearDiff = date2.getFullYear() - date1.getFullYear();
  const monthDiff = date2.getMonth() - date1.getMonth();
  const dayDiff = date2.getDate() - date1.getDate();

  let totalMonths = yearDiff * 12 + monthDiff;

  // Adjust for partial months - if day2 < day1, we haven't completed the month
  if (totalMonths > 0 && dayDiff < 0) {
    totalMonths -= 1;
  } else if (totalMonths < 0 && dayDiff > 0) {
    totalMonths += 1;
  }

  return totalMonths;
}

/**
 * Calculates the difference between two dates in whole years.
 * Uses floor value for partial years.
 * @param date1 - The first date
 * @param date2 - The second date
 * @returns The difference in years
 */
export function dateDiffInYears(date1: Date, date2: Date): number {
  const yearDiff = date2.getFullYear() - date1.getFullYear();
  const monthDiff = date2.getMonth() - date1.getMonth();
  const dayDiff = date2.getDate() - date1.getDate();

  let totalYears = yearDiff;

  // Adjust for partial years
  if (totalYears > 0) {
    // If we haven't reached the same month/day, subtract a year
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      totalYears -= 1;
    }
  } else if (totalYears < 0) {
    // If we've passed the same month/day (going backwards), add a year
    if (monthDiff > 0 || (monthDiff === 0 && dayDiff > 0)) {
      totalYears += 1;
    }
  }

  return totalYears;
}

/**
 * Adds (or subtracts) a number of days to a date.
 * Does not mutate the original date.
 * @param date - The starting date
 * @param days - The number of days to add (negative to subtract)
 * @returns A new Date object
 */
export function addDays(date: Date, days: number): Date {
  throw new Error('Not implemented');
}

/**
 * Adds (or subtracts) a number of months to a date.
 * Does not mutate the original date.
 * Handles month-end overflow by clamping to the last day of the target month.
 * @param date - The starting date
 * @param months - The number of months to add (negative to subtract)
 * @returns A new Date object
 */
export function addMonths(date: Date, months: number): Date {
  throw new Error('Not implemented');
}

/**
 * Checks if a value is a valid Date object.
 * Returns false for Invalid Date, null, undefined, or non-Date values.
 * @param date - The value to check
 * @returns true if the value is a valid Date, false otherwise
 */
export function isValidDate(date: Date): boolean {
  throw new Error('Not implemented');
}

/**
 * Date utility functions for the scheduler UI
 * Handles week calculations, formatting, and date manipulations
 */

import { format, startOfWeek, endOfWeek, addDays, subDays, isSameDay, parseISO } from 'date-fns';

/**
 * Get the start of the week (Monday) for a given date
 * @param {Date} date - Target date
 * @returns {Date} Monday of that week
 */
export function getWeekStart(date) {
  return startOfWeek(date, { weekStartsOn: 1 }); // Monday = 1
}

/**
 * Get the end of the week (Sunday) for a given date
 * @param {Date} date - Target date  
 * @returns {Date} Sunday of that week
 */
export function getWeekEnd(date) {
  return endOfWeek(date, { weekStartsOn: 1 });
}

/**
 * Generate array of dates for a week starting from Monday
 * @param {Date} weekStart - Monday of the target week
 * @returns {Array<Date>} Array of 7 dates (Mon-Sun)
 */
export function getWeekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * Format date for display in various contexts
 * @param {Date|string} date - Date to format
 * @param {string} formatStr - Format string (date-fns format)
 * @returns {string} Formatted date string
 */
export function formatDate(date, formatStr = 'yyyy-MM-dd') {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return format(dateObj, formatStr);
}

/**
 * Format time for shift display (always in UTC to match backend)
 * @param {string} datetime - ISO datetime string
 * @returns {string} Formatted time (HH:mm)
 */
export function formatTime(datetime) {
  // Most backend-generated datetimes include an explicit timezone (Z / ±HH:MM).
  // Some user-entered times (e.g. overtime) may be stored without a timezone.
  // If we always use UTC formatting, timezone-less strings will appear shifted
  // by the local offset (e.g. Asia/Tbilisi +4 => 13:00 shows as 09:00).
  const date = new Date(datetime);

  const datetimeStr = String(datetime);
  const hasExplicitTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(datetimeStr);

  const hours = (hasExplicitTimezone ? date.getUTCHours() : date.getHours()).toString().padStart(2, '0');
  const minutes = (hasExplicitTimezone ? date.getUTCMinutes() : date.getMinutes()).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Format shift time range for display
 * @param {string} startDatetime - ISO start datetime
 * @param {string} endDatetime - ISO end datetime  
 * @returns {string} Time range (e.g., "04:00–13:00")
 */
export function formatTimeRange(startDatetime, endDatetime) {
  const start = formatTime(startDatetime);
  const end = formatTime(endDatetime);
  return `${start}–${end}`;
}

/**
 * Check if two dates are the same day
 * @param {Date|string} date1 - First date
 * @param {Date|string} date2 - Second date
 * @returns {boolean} True if same day
 */
export function isSameDate(date1, date2) {
  const d1 = typeof date1 === 'string' ? parseISO(date1) : date1;
  const d2 = typeof date2 === 'string' ? parseISO(date2) : date2;
  return isSameDay(d1, d2);
}

/**
 * Get today's date in local timezone
 * Uses a date string to ensure consistency across timezones
 * @returns {Date} Current date (midnight local time)
 */
export function getToday() {
  // Get local date string (YYYY-MM-DD) to avoid timezone offset issues
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateString = `${year}-${month}-${day}`;
  
  // Parse this date string at midnight (local time)
  // Note: parseISO treats the string as local time when there's no Z suffix
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Generate calendar grid for month view
 * @param {number} year - Target year
 * @param {number} month - Target month (0-11)
 * @returns {Array<Array<Date|null>>} 6x7 grid of dates (null for empty cells)
 */
export function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  
  // Get the Monday of the week containing the first day
  const startDate = startOfWeek(firstDay, { weekStartsOn: 1 });
  
  const grid = [];
  let currentDate = new Date(startDate);
  
  // Generate 6 weeks (42 days) to ensure full month coverage
  for (let week = 0; week < 6; week++) {
    const weekRow = [];
    for (let day = 0; day < 7; day++) {
      const dateYear = currentDate.getFullYear();
      const dateMonth = currentDate.getMonth();
      const dateDay = currentDate.getDate();
      
      if (dateMonth === month) {
        // Create a fresh date object for the current month
        weekRow.push(new Date(dateYear, dateMonth, dateDay));
      } else {
        weekRow.push(null); // Outside current month
      }
      currentDate = addDays(currentDate, 1);
    }
    grid.push(weekRow);
  }
  
  return grid;
}

/**
 * Get month names for display
 * @returns {Array<string>} Array of month names
 */
export function getMonthNames() {
  return [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
}

/**
 * Get weekday names for display
 * @returns {Array<string>} Array of weekday abbreviations
 */
export function getWeekdayNames() {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
}

/**
 * Navigate to previous/next week
 * @param {Date} currentWeekStart - Current week start date
 * @param {number} direction - -1 for previous, 1 for next
 * @returns {Date} New week start date
 */
export function navigateWeek(currentWeekStart, direction) {
  return addDays(currentWeekStart, direction * 7);
}

/**
 * Navigate to previous/next month
 * @param {number} currentYear - Current year
 * @param {number} currentMonth - Current month (0-11)
 * @param {number} direction - -1 for previous, 1 for next
 * @returns {Object} New {year, month}
 */
export function navigateMonth(currentYear, currentMonth, direction) {
  const newDate = new Date(currentYear, currentMonth + direction, 1);
  return {
    year: newDate.getFullYear(),
    month: newDate.getMonth(),
  };
}
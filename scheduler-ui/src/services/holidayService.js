/**
 * Holiday Service - Fetches Georgian public holidays from Nager.Date API
 * https://date.nager.at/Api
 */

// Cache holidays to avoid repeated API calls
const holidayCache = new Map();

// Custom holidays that apply every year (MM-DD format)
const CUSTOM_ANNUAL_HOLIDAYS = [
  { monthDay: '05-17', name: 'ოჯახის სიწმინდისა და მშობლების პატივისცემის დღე', englishName: 'Family Purity and Parent Respect Day', type: 'Public' },
];

/**
 * Fetch public holidays for Georgia for a specific year
 * @param {number} year - The year to fetch holidays for
 * @returns {Promise<Array>} Array of holiday objects with date and name
 */
export async function fetchHolidaysForYear(year) {
  const cacheKey = `GE-${year}`;
  
  // Return from cache if available
  if (holidayCache.has(cacheKey)) {
    return holidayCache.get(cacheKey);
  }
  
  try {
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/GE`);
    
    if (!response.ok) {
      console.warn(`Failed to fetch holidays for ${year}:`, response.status);
      return [];
    }
    
    const holidays = await response.json();
    
    // Transform to simpler format
    const transformedHolidays = holidays.map(h => ({
      date: h.date, // YYYY-MM-DD format
      name: h.localName || h.name,
      englishName: h.name,
      type: h.types?.[0] || 'Public'
    }));
    
    // Merge custom annual holidays
    for (const custom of CUSTOM_ANNUAL_HOLIDAYS) {
      const date = `${year}-${custom.monthDay}`;
      if (!transformedHolidays.some(h => h.date === date)) {
        transformedHolidays.push({ date, name: custom.name, englishName: custom.englishName, type: custom.type });
      }
    }

    // Cache the result
    holidayCache.set(cacheKey, transformedHolidays);
    
    console.log(`✅ Loaded ${transformedHolidays.length} holidays for Georgia ${year}`);
    return transformedHolidays;
  } catch (error) {
    console.error(`Error fetching holidays for ${year}:`, error);
    return [];
  }
}

/**
 * Fetch holidays for a date range (automatically determines which years to fetch)
 * @param {Date|string} startDate - Start date
 * @param {Date|string} endDate - End date
 * @returns {Promise<Map<string, object>>} Map of date string -> holiday info
 */
export async function fetchHolidaysForRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Get unique years in the range
  const years = new Set();
  for (let d = new Date(start); d <= end; d.setFullYear(d.getFullYear() + 1)) {
    years.add(d.getFullYear());
  }
  // Also add end year in case the loop didn't catch it
  years.add(end.getFullYear());
  
  // Fetch holidays for all years
  const allHolidays = [];
  for (const year of years) {
    const holidays = await fetchHolidaysForYear(year);
    allHolidays.push(...holidays);
  }
  
  // Create a Map for O(1) lookup by date
  const holidayMap = new Map();
  for (const holiday of allHolidays) {
    holidayMap.set(holiday.date, holiday);
  }
  
  return holidayMap;
}

/**
 * Check if a specific date is a holiday
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {Map<string, object>} holidayMap - Map from fetchHolidaysForRange
 * @returns {object|null} Holiday info or null if not a holiday
 */
export function isHoliday(dateStr, holidayMap) {
  return holidayMap.get(dateStr) || null;
}

/**
 * Get holiday info for a date, returns null if not a holiday
 * @param {string} dateStr - Date in YYYY-MM-DD format  
 * @param {Map<string, object>} holidayMap - Map from fetchHolidaysForRange
 * @returns {object|null} Holiday info object or null
 */
export function getHolidayInfo(dateStr, holidayMap) {
  return holidayMap.get(dateStr) || null;
}

export default {
  fetchHolidaysForYear,
  fetchHolidaysForRange,
  isHoliday,
  getHolidayInfo
};

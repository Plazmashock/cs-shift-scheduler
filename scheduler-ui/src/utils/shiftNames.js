/**
 * Shift name mapping utility
 * Maps internal shift names (morning, day, afternoon, night) to display names (Morning, Day, Afternoon, Night)
 */

export const SHIFT_DISPLAY_NAMES = {
  morning: 'Morning',
  day: 'Day',
  afternoon: 'Afternoon',
  night: 'Night'
};

export const SHIFT_EMOJIS = {
  morning: '🌅',
  day: '☀️',
  afternoon: '🌇',
  night: '🌙'
};

export const SHIFT_TIMES = {
  morning: '04:00 - 13:00',
  day: '10:00 - 19:00',
  afternoon: '15:00 - 00:00',
  night: '19:00 - 04:00'
};

/**
 * Get display name for a shift type
 * @param {string} internalName - Internal shift name (e.g., 'morning')
 * @returns {string} Display name (e.g., 'Morning')
 */
export function getShiftDisplayName(internalName) {
  return SHIFT_DISPLAY_NAMES[internalName] || internalName;
}

/**
 * Get emoji for a shift type
 * @param {string} internalName - Internal shift name
 * @returns {string} Emoji
 */
export function getShiftEmoji(internalName) {
  return SHIFT_EMOJIS[internalName] || '';
}

/**
 * Get time range for a shift type
 * @param {string} internalName - Internal shift name
 * @returns {string} Time range (e.g., '04:00 - 13:00')
 */
export function getShiftTime(internalName) {
  return SHIFT_TIMES[internalName] || '';
}

/**
 * Get full display string for a shift (name + time)
 * @param {string} internalName - Internal shift name
 * @returns {string} Full display string (e.g., 'Morning (04:00 - 13:00)')
 */
export function getShiftFullDisplay(internalName) {
  const emoji = getShiftEmoji(internalName);
  const displayName = getShiftDisplayName(internalName);
  const time = getShiftTime(internalName);
  return `${emoji} ${displayName} (${time})`;
}

/**
 * Shift Type Constants
 * Single source of truth for all shift-related mappings
 * 
 * IMPORTANT: Backend/Database uses: morning, day, afternoon, night
 * UI displays user-friendly names: Morning, Day, Afternoon, Night
 */

// Internal shift type keys (used in backend, database, API)
export const SHIFT_TYPES = {
  MORNING: 'morning',
  DAY: 'day',
  AFTERNOON: 'afternoon',
  NIGHT: 'night'
};

// User-facing display names
export const SHIFT_DISPLAY_NAMES = {
  [SHIFT_TYPES.MORNING]: 'Morning',
  [SHIFT_TYPES.DAY]: 'Day',
  [SHIFT_TYPES.AFTERNOON]: 'Afternoon',
  [SHIFT_TYPES.NIGHT]: 'Night'
};

// Reverse mapping: Display name -> Internal key
export const DISPLAY_TO_INTERNAL = {
  'Morning': SHIFT_TYPES.MORNING,
  'Day': SHIFT_TYPES.DAY,
  'Afternoon': SHIFT_TYPES.AFTERNOON,
  'Night': SHIFT_TYPES.NIGHT
};

// Shift colors for UI
export const SHIFT_COLORS = {
  [SHIFT_TYPES.MORNING]: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    icon: '🌅'
  },
  [SHIFT_TYPES.DAY]: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    icon: '☀️'
  },
  [SHIFT_TYPES.AFTERNOON]: {
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-800',
    icon: '🌆'
  },
  [SHIFT_TYPES.NIGHT]: {
    bg: 'bg-indigo-50',
    border: 'border-indigo-200',
    text: 'text-indigo-800',
    icon: '🌙'
  }
};

// Helper function: Get display name from internal key
export function getShiftDisplayName(shiftType) {
  return SHIFT_DISPLAY_NAMES[shiftType] || shiftType;
}

// Helper function: Get internal key from display name
export function getShiftInternalKey(displayName) {
  return DISPLAY_TO_INTERNAL[displayName] || displayName;
}

// Helper function: Get shift color classes
export function getShiftColors(shiftType) {
  return SHIFT_COLORS[shiftType] || {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-800',
    icon: '⚪'
  };
}

// Array of all shift types (for iteration)
export const ALL_SHIFT_TYPES = [
  SHIFT_TYPES.MORNING,
  SHIFT_TYPES.DAY,
  SHIFT_TYPES.AFTERNOON,
  SHIFT_TYPES.NIGHT
];

// Array of all display names (for UI dropdowns)
export const ALL_DISPLAY_NAMES = [
  SHIFT_DISPLAY_NAMES[SHIFT_TYPES.MORNING],
  SHIFT_DISPLAY_NAMES[SHIFT_TYPES.DAY],
  SHIFT_DISPLAY_NAMES[SHIFT_TYPES.AFTERNOON],
  SHIFT_DISPLAY_NAMES[SHIFT_TYPES.NIGHT]
];

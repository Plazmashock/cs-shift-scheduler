/**
 * usePreferences Hook
 * Manages user preferences with localStorage persistence
 * Remembers: visible employees, view mode, selected week, high traffic days
 */

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEYS = {
  VISIBLE_EMPLOYEES: 'cs-scheduler-visible-employees',
  VIEW_MODE: 'cs-scheduler-view-mode',
  LAST_WEEK: 'cs-scheduler-last-week',
  HIGH_TRAFFIC_DAYS: 'cs-scheduler-high-traffic-days',
  SELECTED_EMPLOYEE_FILTER: 'cs-scheduler-selected-employee-filter',
  DAY_SELECTIONS_BY_WEEK: 'cs-scheduler-day-selections-by-week',
};

/**
 * Save to localStorage with error handling
 */
function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Failed to save preference ${key}:`, err);
  }
}

/**
 * Load from localStorage with error handling
 */
function loadFromStorage(key, defaultValue) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (err) {
    console.warn(`Failed to load preference ${key}:`, err);
    return defaultValue;
  }
}

export default function usePreferences() {
  // View mode: 'by-employee' or 'by-shift'
  const [viewMode, setViewModeState] = useState(() => 
    loadFromStorage(STORAGE_KEYS.VIEW_MODE, 'by-employee')
  );

  // Visible employee IDs
  const [visibleEmployeeIds, setVisibleEmployeeIdsState] = useState(() =>
    loadFromStorage(STORAGE_KEYS.VISIBLE_EMPLOYEES, [])
  );

  // Last selected week
  const [lastWeek, setLastWeekState] = useState(() =>
    loadFromStorage(STORAGE_KEYS.LAST_WEEK, null)
  );

  // High traffic days (array of day indices 0-6)
  const [highTrafficDays, setHighTrafficDaysState] = useState(() =>
    loadFromStorage(STORAGE_KEYS.HIGH_TRAFFIC_DAYS, [2, 3])
  );

  // Selected employee filter (null = all employees, or employee ID)
  const [selectedEmployeeFilter, setSelectedEmployeeFilterState] = useState(() =>
    loadFromStorage(STORAGE_KEYS.SELECTED_EMPLOYEE_FILTER, null)
  );

  // Wrapped setters that persist to localStorage
  const setViewMode = useCallback((mode) => {
    setViewModeState(mode);
    saveToStorage(STORAGE_KEYS.VIEW_MODE, mode);
  }, []);

  const setVisibleEmployeeIds = useCallback((ids) => {
    setVisibleEmployeeIdsState(ids);
    saveToStorage(STORAGE_KEYS.VISIBLE_EMPLOYEES, ids);
  }, []);

  const setLastWeek = useCallback((week) => {
    setLastWeekState(week);
    saveToStorage(STORAGE_KEYS.LAST_WEEK, week);
  }, []);

  const setHighTrafficDays = useCallback((days) => {
    setHighTrafficDaysState(days);
    saveToStorage(STORAGE_KEYS.HIGH_TRAFFIC_DAYS, days);
  }, []);

  const setSelectedEmployeeFilter = useCallback((employeeId) => {
    setSelectedEmployeeFilterState(employeeId);
    saveToStorage(STORAGE_KEYS.SELECTED_EMPLOYEE_FILTER, employeeId);
  }, []);

  // Break day selections per week (persisted by weekStart string)
  const getDaySelectionsForWeek = useCallback((weekStartStr) => {
    const all = loadFromStorage(STORAGE_KEYS.DAY_SELECTIONS_BY_WEEK, {});
    return all?.[weekStartStr] || {};
  }, []);

  const setDaySelectionsForWeek = useCallback((weekStartStr, selectionsObj) => {
    const all = loadFromStorage(STORAGE_KEYS.DAY_SELECTIONS_BY_WEEK, {});
    const updated = { ...all, [weekStartStr]: selectionsObj };
    saveToStorage(STORAGE_KEYS.DAY_SELECTIONS_BY_WEEK, updated);
  }, []);

  return {
    viewMode,
    setViewMode,
    visibleEmployeeIds,
    setVisibleEmployeeIds,
    lastWeek,
    setLastWeek,
    highTrafficDays,
    setHighTrafficDays,
    selectedEmployeeFilter,
    setSelectedEmployeeFilter,
    getDaySelectionsForWeek,
    setDaySelectionsForWeek,
  };
}

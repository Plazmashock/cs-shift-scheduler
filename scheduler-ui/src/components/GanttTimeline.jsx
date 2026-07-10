/**
 * GanttTimeline Component
 * Admin-only horizontal Gantt chart showing shift overlaps by hour
 * X-axis: 04:00 → 04:00 (shift-day boundary)
 * Rows: shift types (Morning, Day, Afternoon, Night, Overtime, Custom)
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { format, addDays, startOfDay, isSameDay, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Shift type configuration matching ShiftCard.jsx
const SHIFT_CONFIG = {
  morning: {
    label: 'Morning',
    icon: '🌅',
    bgColor: 'bg-orange-200 dark:bg-orange-900/40',
    borderColor: 'border-orange-400 dark:border-orange-600',
    textColor: 'text-orange-800 dark:text-orange-200',
    start_hour: 4,
    end_hour: 13,
  },
  day: {
    label: 'Day',
    icon: '☀️',
    bgColor: 'bg-yellow-200 dark:bg-yellow-900/40',
    borderColor: 'border-yellow-400 dark:border-yellow-600',
    textColor: 'text-yellow-800 dark:text-yellow-200',
    start_hour: 10,
    end_hour: 19,
  },
  afternoon: {
    label: 'Afternoon',
    icon: '🌇',
    bgColor: 'bg-purple-200 dark:bg-purple-900/40',
    borderColor: 'border-purple-400 dark:border-purple-600',
    textColor: 'text-purple-800 dark:text-purple-200',
    start_hour: 15,
    end_hour: 24, // midnight = 24 in timeline coords
  },
  night: {
    label: 'Night',
    icon: '🌙',
    bgColor: 'bg-blue-200 dark:bg-blue-900/40',
    borderColor: 'border-blue-400 dark:border-blue-600',
    textColor: 'text-blue-800 dark:text-blue-200',
    start_hour: 19,
    end_hour: 28, // 04:00 next day = 28 in timeline coords (19 + 9)
  },
  overtime: {
    label: 'Overtime',
    icon: '⚡',
    bgColor: 'bg-red-200 dark:bg-red-900/40',
    borderColor: 'border-red-400 dark:border-red-600',
    textColor: 'text-red-800 dark:text-red-200',
  },
  custom: {
    label: 'Custom',
    icon: '💫',
    bgColor: 'bg-gradient-to-r from-pink-200 via-purple-200 to-blue-200 dark:from-pink-900/40 dark:via-purple-900/40 dark:to-blue-900/40',
    borderColor: 'border-pink-400 dark:border-pink-600',
    textColor: 'text-gray-800 dark:text-gray-200',
  },
};

// Leave type icons
const LEAVE_ICONS = {
  sick: '🤒',
  vacation: '🏖️',
  personal: '🏠',
  other: '📋',
};

// Hour cell width in pixels
const HOUR_WIDTH = 60;
// Total hours displayed (04:00 to 03:00 = 24 hours)
const TOTAL_HOURS = 24;
// Timeline total width
const TIMELINE_WIDTH = HOUR_WIDTH * TOTAL_HOURS;
// Row label width
const LABEL_WIDTH = 120;
// Bar height
const BAR_HEIGHT = 28;
// Gap between bars
const BAR_GAP = 4;

/**
 * Convert clock hour to timeline position (04:00-based)
 * 04:00 = position 0, 05:00 = 1, ..., 03:00 = 23, 04:00(next day) = 24
 */
function hourToPosition(hour) {
  return hour < 4 ? hour + 20 : hour - 4;
}

/**
 * Parse datetime and return { hour, minute, date }
 * Uses UTC methods to avoid timezone conversion (times are stored as local-time-in-UTC-format)
 */
function parseDateTime(dateTimeStr) {
  if (!dateTimeStr) return null;
  try {
    const dt = new Date(dateTimeStr);
    return {
      hour: dt.getUTCHours(),
      minute: dt.getUTCMinutes(),
      date: format(new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()), 'yyyy-MM-dd'),
      fullDate: dt,
    };
  } catch {
    return null;
  }
}

/**
 * Format datetime to HH:mm using UTC (to avoid timezone conversion)
 */
function formatTimeUTC(dateTimeStr) {
  if (!dateTimeStr) return '';
  try {
    const dt = new Date(dateTimeStr);
    const hours = dt.getUTCHours().toString().padStart(2, '0');
    const minutes = dt.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch {
    return '';
  }
}

/**
 * Calculate bar position and width for a shift/leave
 * Timeline: position 0 = 04:00 selected day, position 24 = 04:00 next day
 */
function calculateBarPosition(startDateTime, endDateTime, selectedDate) {
  const start = parseDateTime(startDateTime);
  const end = parseDateTime(endDateTime);
  
  if (!start || !end) return null;
  
  const startDateStr = start.date;
  const endDateStr = end.date;
  
  // Convert start hour to timeline position
  let startPos = hourToPosition(start.hour) + start.minute / 60;
  let endPos;
  
  // Detect if shift crosses midnight:
  // 1. Different calendar dates, OR
  // 2. Same calendar date but end hour < start hour (e.g., 19:00 to 04:00 stored same date)
  const crossesMidnight = (endDateStr !== startDateStr) || (end.hour <= 4 && start.hour >= 12);
  
  if (crossesMidnight) {
    // Crosses midnight - map end time to positions 20-24
    // 00:00 = pos 20, 01:00 = pos 21, ..., 04:00 = pos 24
    if (end.hour < 4) {
      endPos = 20 + end.hour + end.minute / 60;
    } else {
      // end.hour >= 4 means it ends at 04:00 or later - clamp to 24
      endPos = 24;
    }
  } else {
    // Same calendar day, doesn't cross midnight
    endPos = hourToPosition(end.hour) + end.minute / 60;
  }
  
  // Clamp to visible range [0, 24]
  startPos = Math.max(0, Math.min(24, startPos));
  endPos = Math.max(0, Math.min(24, endPos));
  
  const width = endPos - startPos;
  if (width <= 0) return null;
  
  return {
    left: startPos * HOUR_WIDTH,
    width: width * HOUR_WIDTH,
  };
}

export default function GanttTimeline({
  assignments = [],
  leaves = [],
  weekStart,
  employees = [],
  isAdmin,
  shiftDefinitions,
  onShiftClick,
}) {
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const scrollContainerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Generate week days
  const weekDays = useMemo(() => {
    const days = [];
    const start = weekStart instanceof Date ? weekStart : new Date(weekStart);
    for (let i = 0; i < 7; i++) {
      days.push(addDays(start, i));
    }
    return days;
  }, [weekStart]);

  const selectedDate = weekDays[selectedDayIndex];
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');

  // Determine "shift-today" (accounting for 04:00 boundary)
  const now = new Date();
  const shiftToday = now.getHours() < 4 
    ? format(addDays(now, -1), 'yyyy-MM-dd')
    : format(now, 'yyyy-MM-dd');

  // Set initial day to today if in current week
  useEffect(() => {
    const todayIndex = weekDays.findIndex(d => format(d, 'yyyy-MM-dd') === shiftToday);
    if (todayIndex >= 0) {
      setSelectedDayIndex(todayIndex);
    }
  }, [weekStart]); // Only on week change

  // Track container width for centering
  useEffect(() => {
    if (scrollContainerRef.current) {
      setContainerWidth(scrollContainerRef.current.clientWidth);
    }
  }, []);

  // Auto-scroll to current time
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    
    const isToday = selectedDateStr === shiftToday;
    
    if (isToday) {
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const currentPos = hourToPosition(currentHour) + currentMinute / 60;
      const scrollTarget = currentPos * HOUR_WIDTH - (containerWidth - LABEL_WIDTH) / 2;
      scrollContainerRef.current.scrollLeft = Math.max(0, scrollTarget);
    } else {
      // Scroll to start (04:00)
      scrollContainerRef.current.scrollLeft = 0;
    }
  }, [selectedDayIndex, containerWidth, selectedDateStr, shiftToday]);

  // Group assignments by shift type for selected day
  const { assignmentsByShift, hasOT, hasCustom, totalBarsByShift } = useMemo(() => {
    const result = {
      morning: [],
      day: [],
      afternoon: [],
      night: [],
      overtime: [],
      custom: [],
    };

    // Build a set of (employee_id, date, shift_type) that have leaves
    // so we can exclude those assignments (leave should replace the regular shift bar)
    const leaveKeys = new Set();
    leaves.forEach(leave => {
      if (leave.date === selectedDateStr && leave.employee_id) {
        // Key by employee+date to exclude ALL shifts for that employee on leave day
        leaveKeys.add(`${leave.employee_id}_${leave.date}`);
      }
    });

    // Only include shifts with date === selectedDateStr
    // Exclude assignments where the employee has a leave on this date
    assignments.forEach(assignment => {
      if (assignment.date !== selectedDateStr) return;
      
      // Skip this assignment if the employee has a leave on this date
      if (leaveKeys.has(`${assignment.employee_id}_${assignment.date}`)) return;
      
      const shiftType = assignment.shift_type || 'custom';
      const key = shiftType in result ? shiftType : 'custom';
      result[key].push(assignment);
    });

    // Calculate total bars per shift type for height
    const totals = {};
    Object.keys(result).forEach(key => {
      totals[key] = result[key].length;
    });

    return {
      assignmentsByShift: result,
      hasOT: result.overtime.length > 0,
      hasCustom: result.custom.length > 0,
      totalBarsByShift: totals,
    };
  }, [assignments, leaves, selectedDateStr]);

  // Group leaves similarly
  const leavesByShift = useMemo(() => {
    const result = {
      morning: [],
      day: [],
      afternoon: [],
      night: [],
      overtime: [],
      custom: [],
    };

    leaves.forEach(leave => {
      if (leave.date !== selectedDateStr) return;
      
      const shiftType = leave.shift_type || 'custom';
      const key = shiftType in result ? shiftType : 'custom';
      result[key].push(leave);
    });

    return result;
  }, [leaves, selectedDateStr]);

  // Shift types to render (always show core 4, conditionally show overtime/custom)
  const shiftTypesToRender = useMemo(() => {
    const core = ['morning', 'day', 'afternoon', 'night'];
    const extra = [];
    if (hasOT || leavesByShift.overtime.length > 0) extra.push('overtime');
    if (hasCustom || leavesByShift.custom.length > 0) extra.push('custom');
    return [...core, ...extra];
  }, [hasOT, hasCustom, leavesByShift]);

  // Hour labels: 04, 05, ..., 02, 03 (24 labels)
  const hourLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < 24; i++) {
      const hour = (4 + i) % 24;
      labels.push(hour.toString().padStart(2, '0'));
    }
    return labels;
  }, []);

  // Calculate hourly coverage - how many people are working in each hour per shift type
  const hourlyCoverage = useMemo(() => {
    // Initialize coverage array: 24 hours (04:00 to 03:00), each with counts per shift type
    const coverage = Array.from({ length: 24 }, () => ({
      morning: 0,
      day: 0,
      afternoon: 0,
      night: 0,
      overtime: 0,
      custom: 0,
      total: 0,
    }));

    // For each assignment, increment the count for each hour it covers
    Object.entries(assignmentsByShift).forEach(([shiftType, assignments]) => {
      assignments.forEach(assignment => {
        const start = parseDateTime(assignment.start_datetime);
        const end = parseDateTime(assignment.end_datetime);
        if (!start || !end) return;

        // Convert to timeline positions
        let startPos = hourToPosition(start.hour);
        let endPos;
        
        const startDateStr = start.date;
        const endDateStr = end.date;
        
        // Detect if shift crosses midnight
        const crossesMidnight = (endDateStr !== startDateStr) || (end.hour <= 4 && start.hour >= 12);
        
        if (crossesMidnight) {
          // Crosses midnight - map end to positions 20-24
          if (end.hour < 4) {
            endPos = 20 + end.hour;
          } else {
            // end.hour >= 4 means it ends at 04:00 or later
            endPos = 24;
          }
        } else {
          endPos = hourToPosition(end.hour);
        }

        // Increment counts for each hour covered (positions 0-23 represent working hours)
        // Position 24 (04:00) is just the endpoint marker, not a working hour
        for (let h = Math.floor(startPos); h < endPos && h < 24; h++) {
          if (h >= 0 && shiftType in coverage[h]) {
            coverage[h][shiftType]++;
            coverage[h].total++;
          }
        }
      });
    });

    return coverage;
  }, [assignmentsByShift]);

  // Current time indicator
  const isToday = selectedDateStr === shiftToday;
  const nowPos = useMemo(() => {
    if (!isToday) return null;
    const hour = now.getHours();
    const minute = now.getMinutes();
    return hourToPosition(hour) + minute / 60;
  }, [isToday, now]);

  if (!isAdmin) return null;

  return (
    <div className="bg-white dark:bg-[#1a1f26] rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-4 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Daily Timeline
          </h3>
          
          {/* Day selector with arrows */}
          <div className="flex items-center gap-2">
            {/* Previous day arrow */}
            <button
              onClick={() => setSelectedDayIndex(Math.max(0, selectedDayIndex - 1))}
              disabled={selectedDayIndex === 0}
              className="p-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft size={16} />
            </button>

            {/* Day buttons */}
            <div className="flex gap-1">
              {weekDays.map((day, index) => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const isSelected = index === selectedDayIndex;
                const isShiftToday = dayStr === shiftToday;
                
                return (
                  <button
                    key={dayStr}
                    onClick={() => setSelectedDayIndex(index)}
                    className={`
                      px-2 py-1 text-xs rounded-md transition-all
                      ${isSelected 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}
                      ${isShiftToday && !isSelected ? 'ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-gray-900' : ''}
                    `}
                  >
                    <span className="font-medium">{format(day, 'EEE')}</span>
                    <span className="ml-1 opacity-75">{format(day, 'd')}</span>
                  </button>
                );
              })}
            </div>

            {/* Next day arrow */}
            <button
              onClick={() => setSelectedDayIndex(Math.min(6, selectedDayIndex + 1))}
              disabled={selectedDayIndex === 6}
              className="p-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight size={16} />
            </button>

            {/* Today button */}
            <button
              onClick={() => {
                const todayIndex = weekDays.findIndex(d => format(d, 'yyyy-MM-dd') === shiftToday);
                if (todayIndex >= 0) setSelectedDayIndex(todayIndex);
              }}
              className="px-2 py-1 text-xs rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-all font-medium"
            >
              Today
            </button>
          </div>
        </div>
      </div>

      {/* Timeline container */}
      <div className="relative">
        {/* Scrollable area - no vertical scroll limit */}
        <div 
          ref={scrollContainerRef}
          className="overflow-x-auto"
        >
          <div className="flex" style={{ minWidth: TIMELINE_WIDTH + LABEL_WIDTH }}>
            {/* Sticky row labels */}
            <div 
              className="sticky left-0 z-20 bg-white dark:bg-[#1a1f26] border-r border-gray-200 dark:border-gray-700"
              style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }}
            >
              {/* Hour header placeholder */}
              <div className="h-8 border-b border-gray-200 dark:border-gray-700" />
              
              {/* Coverage row label */}
              <div className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center px-3">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Coverage</span>
              </div>
              
              {/* Shift type labels */}
              {shiftTypesToRender.map(shiftType => {
                const config = SHIFT_CONFIG[shiftType];
                const barCount = (assignmentsByShift[shiftType]?.length || 0) + (leavesByShift[shiftType]?.length || 0);
                const rowHeight = Math.max(BAR_HEIGHT + BAR_GAP * 2, barCount * (BAR_HEIGHT + BAR_GAP) + BAR_GAP);
                
                return (
                  <div 
                    key={shiftType}
                    className="flex items-center gap-2 px-3 border-b border-gray-100 dark:border-gray-800"
                    style={{ height: rowHeight }}
                  >
                    <span className="text-base">{config.icon}</span>
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {config.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Timeline content */}
            <div className="relative flex-1">
              {/* Hour ruler */}
              <div className="flex h-8 border-b border-gray-200 dark:border-gray-700">
                {hourLabels.map((label, i) => (
                  <div 
                    key={i}
                    className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400 border-l border-gray-100 dark:border-gray-800 flex items-center justify-center"
                    style={{ width: HOUR_WIDTH }}
                  >
                    {label}:00
                  </div>
                ))}
              </div>

              {/* Hourly coverage row */}
              <div className="flex h-12 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
                {hourlyCoverage.map((coverage, i) => {
                  const activeShifts = [];
                  if (coverage.morning > 0) activeShifts.push({ type: 'morning', count: coverage.morning, icon: '🌅', bg: 'bg-orange-100 dark:bg-orange-900/40' });
                  if (coverage.day > 0) activeShifts.push({ type: 'day', count: coverage.day, icon: '☀️', bg: 'bg-yellow-100 dark:bg-yellow-900/40' });
                  if (coverage.afternoon > 0) activeShifts.push({ type: 'afternoon', count: coverage.afternoon, icon: '🌇', bg: 'bg-purple-100 dark:bg-purple-900/40' });
                  if (coverage.night > 0) activeShifts.push({ type: 'night', count: coverage.night, icon: '🌙', bg: 'bg-blue-100 dark:bg-blue-900/40' });
                  if (coverage.overtime > 0) activeShifts.push({ type: 'overtime', count: coverage.overtime, icon: '⚡', bg: 'bg-red-100 dark:bg-red-900/40' });
                  if (coverage.custom > 0) activeShifts.push({ type: 'custom', count: coverage.custom, icon: '💫', bg: 'bg-pink-100 dark:bg-pink-900/40' });
                  
                  return (
                    <div 
                      key={i}
                      className="flex-shrink-0 border-l border-gray-100 dark:border-gray-800 flex flex-col items-center justify-center gap-0.5 py-1"
                      style={{ width: HOUR_WIDTH }}
                      title={activeShifts.map(s => `${s.icon} ${s.count}`).join(' | ') || 'No shifts'}
                    >
                      {activeShifts.length > 0 ? (
                        <>
                          <span className="px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-[9px] font-bold text-gray-700 dark:text-gray-300">{coverage.total}</span>
                          <div className="flex gap-0.5 flex-wrap justify-center">
                            {activeShifts.slice(0, 4).map(s => (
                              <span key={s.type} className={`px-1 py-0.5 rounded-full text-[8px] leading-none ${s.bg}`}>{s.icon}{s.count}</span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600 text-[9px]">-</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Shift rows */}
              {shiftTypesToRender.map(shiftType => {
                const config = SHIFT_CONFIG[shiftType];
                const shiftAssignments = assignmentsByShift[shiftType] || [];
                const shiftLeaves = leavesByShift[shiftType] || [];
                const allItems = [...shiftAssignments, ...shiftLeaves.map(l => ({ ...l, isLeave: true }))];
                const barCount = allItems.length;
                const rowHeight = Math.max(BAR_HEIGHT + BAR_GAP * 2, barCount * (BAR_HEIGHT + BAR_GAP) + BAR_GAP);

                return (
                  <div 
                    key={shiftType}
                    className="relative border-b border-gray-100 dark:border-gray-800"
                    style={{ height: rowHeight, width: TIMELINE_WIDTH }}
                  >
                    {/* Hour grid lines */}
                    <div className="absolute inset-0 flex pointer-events-none">
                      {hourLabels.map((_, i) => (
                        <div 
                          key={i}
                          className="flex-shrink-0 border-l border-gray-50 dark:border-gray-800/50"
                          style={{ width: HOUR_WIDTH }}
                        />
                      ))}
                    </div>

                    {/* Bars */}
                    {allItems.map((item, index) => {
                      const isLeave = item.isLeave;
                      
                      // Calculate bar position
                      let barPos;
                      if (isLeave) {
                        // Leave positioning
                        if (item.timeframe === 'all-day' || !item.custom_start) {
                          // Use default shift times
                          const shiftConfig = SHIFT_CONFIG[item.shift_type];
                          if (shiftConfig) {
                            const startHour = shiftConfig.start_hour;
                            let endHour = shiftConfig.end_hour;
                            // Convert to timeline positions
                            const startPos = hourToPosition(startHour);
                            let endPos = endHour > 24 ? (endHour - 24) + 20 : hourToPosition(endHour % 24);
                            if (endPos < startPos) endPos = 24; // Clamp overnight
                            barPos = {
                              left: startPos * HOUR_WIDTH,
                              width: (endPos - startPos) * HOUR_WIDTH,
                            };
                          }
                        } else {
                          // Custom timeframe leave
                          const leaveStart = item.custom_start || item.shift_start;
                          const leaveEnd = item.custom_end || item.shift_end;
                          if (leaveStart && leaveEnd) {
                            barPos = calculateBarPosition(
                              `${item.date}T${leaveStart}`,
                              `${item.date}T${leaveEnd}`,
                              selectedDateStr
                            );
                          }
                        }
                      } else {
                        // Regular assignment
                        barPos = calculateBarPosition(
                          item.start_datetime,
                          item.end_datetime,
                          selectedDateStr
                        );
                      }

                      if (!barPos) return null;

                      const employeeName = item.employee_name || 
                        employees.find(e => e.id === item.employee_id)?.name || 
                        `Employee ${item.employee_id}`;

                      const showName = barPos.width >= 80;

                      return (
                        <div
                          key={`${item.employee_id}-${item.date}-${index}`}
                          className={`
                            absolute rounded-md border flex items-center px-2 overflow-hidden
                            ${config.bgColor} ${config.borderColor} ${config.textColor}
                            ${isLeave ? 'opacity-80' : ''}
                            transition-all hover:shadow-md cursor-pointer hover:scale-[1.02]
                          `}
                          style={{
                            left: barPos.left,
                            width: barPos.width,
                            height: BAR_HEIGHT,
                            top: BAR_GAP + index * (BAR_HEIGHT + BAR_GAP),
                            // Striped pattern for leaves
                            ...(isLeave && {
                              backgroundImage: `repeating-linear-gradient(
                                45deg,
                                transparent,
                                transparent 4px,
                                rgba(0,0,0,0.1) 4px,
                                rgba(0,0,0,0.1) 8px
                              )`,
                            }),
                          }}
                          title={`${employeeName}${isLeave ? ` (${item.leave_type || 'Leave'})` : ''} • ${
                            formatTimeUTC(item.start_datetime)
                          } - ${
                            formatTimeUTC(item.end_datetime)
                          }`}
                          onClick={() => {
                            if (onShiftClick) {
                              onShiftClick(item);
                            }
                          }}
                        >
                          {isLeave && (
                            <span className="mr-1 text-sm flex-shrink-0">
                              {LEAVE_ICONS[item.leave_type] || LEAVE_ICONS.other}
                            </span>
                          )}
                          {showName && (
                            <span className="text-xs font-medium truncate">
                              {employeeName}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Current time indicator */}
              {isToday && nowPos !== null && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
                  style={{ left: nowPos * HOUR_WIDTH }}
                >
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[10px] px-1 rounded-t">
                    Now
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span>Shifts shown from 04:00 to 03:00 (next day)</span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-3 rounded-sm bg-gray-200 dark:bg-gray-600" style={{
              backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 4px)`
            }} />
            Leave
          </span>
        </div>
      </div>
    </div>
  );
}

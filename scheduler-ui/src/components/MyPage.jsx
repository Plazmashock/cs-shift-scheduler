/**
 * MyPage Component
 * Personal page showing individual employee's schedule, next shift, and statistics
 */

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, User, TrendingUp, Coffee, CalendarPlus, Info } from 'lucide-react';
import { loadGoogleScripts, requestAccessToken, exportMyShiftsToCalendar } from '../services/googleCalendar';
import { 
  formatDate, 
  formatTimeRange,
  isSameDate,
  getWeekStart
} from '../utils/dateHelpers';
import ShiftCard from './ShiftCard';
import * as firebaseDB from '../services/firebaseDatabase';
import { fetchHolidaysForRange } from '../services/holidayService';

/**
 * MyPage Component
 * @param {Object} props - Component props
 * @param {Object} props.currentUser - Current logged-in user data (with email)
 * @param {Object} props.employeeData - Employee data matching the user
 * @param {Array} props.assignments - All shift assignments (will be supplemented with Firebase data)
 * @param {Array} props.leaves - Leave records
 * @param {Function} props.onShiftClick - Handler for shift clicks
 */
export default function MyPage({
  currentUser,
  employeeData,
  assignments = [],
  leaves = [],
  onShiftClick,
  isAdmin = false,
  className = ''
}) {
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [monthAssignments, setMonthAssignments] = useState([]);
  const [monthLeaves, setMonthLeaves] = useState([]);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [holidayMap, setHolidayMap] = useState(new Map());
  const [isExportingToCalendar, setIsExportingToCalendar] = useState(false);

  // Fetch holidays for the selected month
  useEffect(() => {
    const fetchHolidays = async () => {
      try {
        const year = selectedMonth.getFullYear();
        const month = selectedMonth.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const holidays = await fetchHolidaysForRange(firstDay, lastDay);
        setHolidayMap(holidays);
      } catch (error) {
        console.error('Error fetching holidays:', error);
      }
    };

    fetchHolidays();
  }, [selectedMonth]);

  // Load all schedules for the selected month from Firebase
  useEffect(() => {
    const loadMonthSchedules = async () => {
      if (!employeeData) return;

      setLoadingMonth(true);
      try {
        const year = selectedMonth.getFullYear();
        const month = selectedMonth.getMonth();
        
        // Get all weeks that overlap with this month's visible calendar grid
        const firstDay = new Date(year, month, 1);
        
        // Get week starts for the entire month (including partial weeks)
        const weekStarts = [];
        let currentDate = new Date(firstDay);
        
        // Go back to the Monday of the first week
        while (currentDate.getDay() !== 1) {
          currentDate.setDate(currentDate.getDate() - 1);
        }
        
        // Compute the last date actually visible in the 42-day calendar grid
        // (the grid can show up to 7 padding days from the next month)
        const firstDayOfWeek = firstDay.getDay();
        const paddingStart = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
        const gridEndDate = new Date(year, month, 1 - paddingStart + 41); // start of grid + 41 days
        
        // Collect all week starts visible in the calendar grid
        while (currentDate <= gridEndDate) {
          weekStarts.push(formatDate(currentDate));
          currentDate.setDate(currentDate.getDate() + 7);
        }
        
        // Load schedules for all these weeks (excluding hidden weeks)
        const allAssignments = [];
        const allLeaves = [];
        
        for (const weekStart of weekStarts) {
          // Check if this week is hidden — admins bypass this check (they see hidden weeks everywhere)
          const isHidden = isAdmin ? false : await firebaseDB.getWeekSchedulerVisibility(weekStart);
          
          // Only load assignments if week is not hidden
          if (!isHidden) {
            const scheduleData = await firebaseDB.loadScheduleFromFirebase(weekStart);
            if (scheduleData?.assignments) {
              allAssignments.push(...scheduleData.assignments);
            }
            
            // Load leaves for this week
            const weekLeaves = await firebaseDB.loadLeavesFromFirebase(weekStart);
            if (weekLeaves && weekLeaves.length > 0) {
              allLeaves.push(...weekLeaves);
            }
          }
        }
        
        setMonthAssignments(allAssignments);
        setMonthLeaves(allLeaves);

        // Reset selected day when switching months
        setSelectedDate(null);
      } catch (error) {
        console.error('Error loading month schedules:', error);
      } finally {
        setLoadingMonth(false);
      }
    };

    loadMonthSchedules();
  }, [selectedMonth, employeeData, isAdmin]);

  // Handle export to Google Calendar
  const handleExportMonthToCalendar = async () => {
    if (!currentUser || !currentUser.email) {
      alert('Please log in to export your shifts to Google Calendar.');
      return;
    }

    if (!employeeData) {
      alert('Employee data not found. Please make sure your email is added to the team members list.');
      return;
    }

    if (myAssignments.length === 0) {
      alert('No shifts to export for this month.');
      return;
    }

    try {
      setIsExportingToCalendar(true);

      // Get all employees (need to pass to exportMyShiftsToCalendar)
      // For now, we'll create a minimal employee array with just this employee
      const employees = [employeeData];
      
      await loadGoogleScripts();
      await requestAccessToken();
      
      // Export all month's shifts
      const results = await exportMyShiftsToCalendar(myAssignments, currentUser.email, employees, 'Asia/Tbilisi');
      
      const monthName = selectedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const message = `✅ Successfully exported ${results.success} shifts for ${monthName} to your Google Calendar!` +
        (results.failed > 0 ? `\n\n⚠️ Failed: ${results.failed} shifts` : '');
      
      alert(message);
      
    } catch (error) {
      console.error('Calendar export failed:', error);
      
      if (error?.error === 'popup_closed_by_user') {
        alert('Export cancelled. Please try again and allow access to your Google Calendar.');
      } else if (error?.error === 'access_denied') {
        alert('Access denied. Please allow the app to access your Google Calendar.');
      } else {
        alert(`Failed to export to Google Calendar: ${error?.message || JSON.stringify(error)}`);
      }
    } finally {
      setIsExportingToCalendar(false);
    }
  };

  // Filter assignments for this employee from month data
  const myAssignments = useMemo(() => {
    if (!employeeData) return [];
    // Compare employee IDs - handle both string and number types
    const empId = String(employeeData.id);
    return monthAssignments.filter(a => String(a.employee_id) === empId);
  }, [monthAssignments, employeeData]);

  // Filter leaves for this employee from month data
  const myLeaves = useMemo(() => {
    if (!employeeData) return [];
    // Compare employee IDs - handle both string and number types
    const empId = String(employeeData.id);
    return monthLeaves.filter(l => String(l.employee_id) === empId);
  }, [monthLeaves, employeeData]);

  // Get next upcoming shift
  const nextShift = useMemo(() => {
    if (!employeeData) return null;
    
    const now = new Date();
    const upcoming = myAssignments
      .filter(a => new Date(a.start_datetime) > now)
      .sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime));
    
    return upcoming[0] || null;
  }, [myAssignments, employeeData]);

  // Get days in selected month
  const monthDays = useMemo(() => {
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];
    
    // Add padding days from previous month
    const firstDayOfWeek = firstDay.getDay();
    const paddingDays = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Monday = 0
    
    for (let i = paddingDays; i > 0; i--) {
      const date = new Date(year, month, 1 - i);
      days.push({ date, isCurrentMonth: false });
    }
    
    // Add days of current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const date = new Date(year, month, i);
      days.push({ date, isCurrentMonth: true });
    }
    
    // Add padding days from next month to complete the grid
    const remainingDays = 42 - days.length; // 6 rows * 7 days
    for (let i = 1; i <= remainingDays; i++) {
      const date = new Date(year, month + 1, i);
      days.push({ date, isCurrentMonth: false });
    }
    
    return days;
  }, [selectedMonth]);

  // Get assignments for a specific date
  const getAssignmentsForDate = (date) => {
    const dateStr = formatDate(date);
    return myAssignments.filter(a => a.date === dateStr);
  };

  const getAssignmentCommentText = (assignment) => {
    const rawComment =
      assignment?.comment ??
      assignment?.notes ??
      assignment?.note ??
      assignment?.comments ??
      '';
    return typeof rawComment === 'string' ? rawComment.trim() : rawComment ? String(rawComment).trim() : '';
  };

  const hasCommentForAssignments = (assignmentsForDay) => {
    return assignmentsForDay.some((a) => getAssignmentCommentText(a).length > 0);
  };

  // Calculate statistics matching Data tab format for current month
  const statistics = useMemo(() => {
    if (!employeeData) return { 
      totalHours: 0, 
      totalShifts: 0, 
      bonusShifts: 0,
      overtimeHours: 0,
      overtimeShifts: 0,
      holidayHours: 0,
      holidayShifts: 0
    };

    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth();
    const HOURS_PER_SHIFT = 8;  // Paid hours (9h shift - 1h unpaid break)
    const BONUS_ELIGIBLE_SHIFTS = ['morning', 'afternoon', 'night'];

    let totalHours = 0;
    let totalShifts = 0;
    let bonusShifts = 0;
    let overtimeHours = 0;
    let overtimeShifts = 0;
    let holidayHours = 0;
    let holidayShifts = 0;

    // Filter assignments for current month
    myAssignments.forEach(assignment => {
      const assignmentDate = new Date(assignment.date || assignment.start_datetime);
      
      // Check if assignment is in the selected month
      if (assignmentDate.getFullYear() === year && assignmentDate.getMonth() === month) {
        // Calculate hours: use actual duration for overtime, work_hours for custom, 8 hours for regular shifts
        let hours = HOURS_PER_SHIFT;
        if (assignment.shift_type === 'overtime') {
          // Overtime has hours and minutes fields
          const overtimeH = assignment.hours || 0;
          const overtimeM = assignment.minutes || 0;
          hours = parseFloat((overtimeH + (overtimeM / 60)).toFixed(2));
        } else if (assignment.shift_type === 'custom') {
          // Custom shifts have work_hours field
          hours = assignment.work_hours || 0;
        }

        totalHours += hours;
        totalShifts += 1;

        // Count bonus shifts (excluding overtime and custom)
        if (assignment.shift_type === 'overtime') {
          overtimeHours += hours;
          overtimeShifts += 1;
        } else if (assignment.shift_type !== 'custom' && BONUS_ELIGIBLE_SHIFTS.includes(assignment.shift_type)) {
          bonusShifts += 1;
        }
      }
    });

    return {
      totalHours: parseFloat(totalHours.toFixed(2)),
      totalShifts,
      bonusShifts,
      overtimeHours: parseFloat(overtimeHours.toFixed(2)),
      overtimeShifts,
      holidayHours: parseFloat(holidayHours.toFixed(2)),
      holidayShifts: 0
    };
  }, [myAssignments, selectedMonth, employeeData]);

  // Navigate month
  const goToPreviousMonth = () => {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));
  };

  // NOTE: this useMemo must stay ABOVE the early return so hooks are called
  // unconditionally on every render (React rules of hooks).
  const selectedDateAssignments = useMemo(() => {
    if (!selectedDate) return [];
    return getAssignmentsForDate(selectedDate);
  }, [selectedDate, myAssignments]);

  if (!employeeData) {
    return (
      <div className={`bg-white border border-gray-200 rounded-lg p-8 ${className}`}>
        <div className="text-center text-gray-500">
          <User size={48} className="mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Employee Account Not Found</h3>
          <p className="text-sm mb-4">
            Your email <strong>{currentUser?.email}</strong> is not linked to an employee account in the system.
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left text-sm">
            <p className="font-medium text-blue-900 mb-2">How to fix this:</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-800">
              <li>Contact your administrator to add your email to your employee profile</li>
              <li>Or ask them to import/update the employee list via the Data tab</li>
              <li>Make sure your email in the system exactly matches: <code className="bg-white px-1 rounded">{currentUser?.email}</code></li>
            </ol>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Once your email is added, refresh this page to see your schedule.
          </p>
        </div>
      </div>
    );
  }

  const shiftConfig = {
    morning: { 
      label: 'Morning', 
      icon: '🌅', 
      color: 'bg-orange-500',
      gradient: 'from-orange-400 to-orange-600',
      textColor: 'text-orange-900',
      lightBg: 'bg-orange-50'
    },
    day: { 
      label: 'Day', 
      icon: '☀️', 
      color: 'bg-yellow-500',
      gradient: 'from-yellow-400 to-yellow-600',
      textColor: 'text-yellow-900',
      lightBg: 'bg-yellow-50'
    },
    afternoon: { 
      label: 'Afternoon', 
      icon: '🌇', 
      color: 'bg-purple-500',
      gradient: 'from-purple-400 to-purple-600',
      textColor: 'text-purple-900',
      lightBg: 'bg-purple-50'
    },
    night: { 
      label: 'Night', 
      icon: '🌙', 
      color: 'bg-blue-500',
      gradient: 'from-blue-400 to-blue-600',
      textColor: 'text-blue-900',
      lightBg: 'bg-blue-50'
    },
    overtime: {
      label: 'Overtime',
      icon: '⚡',
      color: 'bg-red-500',
      gradient: 'from-red-400 to-red-600',
      textColor: 'text-red-900',
      lightBg: 'bg-red-50'
    },
    custom: {
      label: 'Custom',
      icon: '🛠️',
      color: 'bg-gray-500',
      gradient: 'from-gray-400 to-gray-600',
      textColor: 'text-gray-900',
      lightBg: 'bg-gray-50'
    },
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header with User Info */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg p-6 shadow-lg">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-white text-blue-600 text-xl font-bold rounded-full flex items-center justify-center">
            {employeeData.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <h1 className="text-2xl font-bold">{employeeData.name}</h1>
            <p className="text-blue-100 text-sm">{employeeData.email || currentUser?.email}</p>
          </div>
        </div>
      </div>

      {/* Next Shift Card */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        <div className="bg-white p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <Clock size={20} />
            <span>Next Shift</span>
          </h2>
        </div>
        
        {nextShift ? (
          <div className={`bg-gradient-to-br ${shiftConfig[nextShift.shift_type]?.gradient || 'from-gray-400 to-gray-600'} text-white p-8`}>
            <div className="text-center">
              <div className="text-6xl mb-4 drop-shadow-lg">
                {shiftConfig[nextShift.shift_type]?.icon || '📅'}
              </div>
              <div className="text-4xl font-bold mb-3 drop-shadow-md">
                {shiftConfig[nextShift.shift_type]?.label || nextShift.shift_type}
              </div>
              <div className="text-xl mb-2 text-white/90">
                {formatDate(new Date(nextShift.start_datetime), 'EEEE, MMMM d, yyyy')}
              </div>
              <div className="text-lg text-white/80">
                {formatTimeRange(nextShift.start_datetime, nextShift.end_datetime)}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500 bg-gray-50">
            <Coffee size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-lg">No upcoming shifts scheduled</p>
          </div>
        )}
      </div>

      {/* Dashboard Statistics */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="border-b border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <TrendingUp size={20} />
            <span>Monthly Dashboard</span>
          </h2>
        </div>

        {/* Dashboard Grid */}
        <div className="p-6 grid grid-cols-2 md:grid-cols-5 gap-4">
          {/* Total Hours */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-500/10 dark:to-blue-500/5 rounded-lg p-4 border border-blue-200"
          >
            <div className="text-sm font-medium text-blue-600 mb-2">⌛️ Total Hours</div>
            <div className="text-3xl font-bold text-blue-900">{statistics.totalHours}h</div>
            <div className="text-xs text-blue-600 mt-2">
              {Math.round(statistics.totalHours / 8)} shifts
            </div>
          </motion.div>

          {/* Total Shifts */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-500/10 dark:to-purple-500/5 rounded-lg p-4 border border-purple-200"
          >
            <div className="text-sm font-medium text-purple-600 mb-2">🔄 Total Shifts</div>
            <div className="text-3xl font-bold text-purple-900">{statistics.totalShifts}</div>
            <div className="text-xs text-purple-600 mt-2">assignments</div>
          </motion.div>

          {/* Bonus Shifts */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-500/10 dark:to-green-500/5 rounded-lg p-4 border border-green-200"
          >
            <div className="text-sm font-medium text-green-600 mb-2">🌟 Shifts with Night Bonus</div>
            <div className="text-3xl font-bold text-green-900">{statistics.bonusShifts}</div>
            <div className="text-xs text-green-600 mt-2">
              {((statistics.bonusShifts / Math.max(statistics.totalShifts, 1)) * 100).toFixed(0)}%
            </div>
          </motion.div>

          {/* Overtime Hours */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-500/10 dark:to-red-500/5 rounded-lg p-4 border border-red-200"
          >
            <div className="text-sm font-medium text-red-600 mb-2">⚡ Overtime Hours</div>
            <div className="text-3xl font-bold text-red-900">{statistics.overtimeHours}h</div>
            <div className="text-xs text-red-600 mt-2">
              {statistics.overtimeShifts} shifts
            </div>
          </motion.div>

          {/* Holiday Hours */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-500/10 dark:to-amber-500/5 rounded-lg p-4 border border-amber-200"
          >
            <div className="text-sm font-medium text-amber-600 mb-2">🎉 Holiday Hours</div>
            <div className="text-3xl font-bold text-amber-900">{statistics.holidayHours}h</div>
            <div className="text-xs text-amber-600 mt-2">
              {statistics.holidayShifts} shifts
            </div>
          </motion.div>
        </div>
      </div>

      {/* Monthly Calendar */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <Calendar size={20} />
            <span>Calendar View</span>
          </h2>
          
          {/* Month Navigation and Export Button */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Google Calendar Export Button */}
            {currentUser && employeeData && myAssignments.length > 0 && (
              <button
                onClick={handleExportMonthToCalendar}
                disabled={isExportingToCalendar}
                className="flex items-center gap-2 px-2.5 py-1.5 bg-green-600 text-white text-xs sm:text-sm rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {isExportingToCalendar ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span className="whitespace-nowrap">Exporting...</span>
                  </>
                ) : (
                  <>
                    <CalendarPlus size={16} />
                    <span className="hidden sm:inline whitespace-nowrap">Google Calendar</span>
                    <span className="sm:hidden whitespace-nowrap">Google</span>
                  </>
                )}
              </button>
            )}
            
            {/* Month Navigation */}
            <div className="flex items-center gap-2">
              <button
                onClick={goToPreviousMonth}
                className="px-2.5 py-1 text-xs sm:text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                <span className="hidden sm:inline">← Prev</span>
                <span className="sm:hidden">←</span>
              </button>
              <div className="px-2 sm:px-4 py-1 text-xs sm:text-sm font-medium text-gray-900 sm:whitespace-nowrap">
                {formatDate(selectedMonth, 'MMMM yyyy')}
              </div>
              <button
                onClick={goToNextMonth}
                className="px-2.5 py-1 text-xs sm:text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                <span className="hidden sm:inline">Next →</span>
                <span className="sm:hidden">→</span>
              </button>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loadingMonth ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-500">Loading schedule...</span>
          </div>
        ) : (
          <>
            {/* Mobile Calendar (dots + tap-to-expand) */}
            <div className="md:hidden">
              <div className="grid grid-cols-7 gap-1">
                {/* Weekday Headers */}
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
                  <div key={`${day}-${i}`} className="text-center text-[11px] font-medium text-gray-600 py-1">
                    {day}
                  </div>
                ))}

                {/* Calendar Days */}
                {monthDays.map(({ date, isCurrentMonth }, index) => {
                  const dateAssignments = getAssignmentsForDate(date);
                  const isToday = isSameDate(date, new Date());
                  const isSelected = selectedDate ? isSameDate(date, selectedDate) : false;
                  const dateStr = formatDate(date);
                  const isHoliday = holidayMap.has(dateStr);
                  const hasAnyComment = dateAssignments.length > 0 && hasCommentForAssignments(dateAssignments);

                  const visibleDots = dateAssignments.slice(0, 4);
                  const overflowCount = Math.max(dateAssignments.length - visibleDots.length, 0);

                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setSelectedDate(date)}
                      className={
                        `min-h-[56px] border rounded-md px-1.5 py-1 text-left transition-all ` +
                        `${isHoliday ? 'bg-yellow-50 border-yellow-300' : isCurrentMonth ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100'} ` +
                        `${isToday ? 'ring-2 ring-green-500' : (isSelected ? 'ring-2 ring-blue-400' : '')} ` +
                        `${!isCurrentMonth ? 'opacity-60' : ''}`
                      }
                      aria-label={`Show shifts for ${formatDate(date, 'MMMM d, yyyy')}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div
                          className={
                            `text-xs font-semibold leading-none ` +
                            `${isHoliday ? 'text-yellow-800' : isToday ? 'text-blue-600' : isCurrentMonth ? 'text-gray-900' : 'text-gray-400'}`
                          }
                        >
                          {date.getDate()}
                        </div>
                        {hasAnyComment && (
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-50 text-blue-700"
                            title="This day has shift notes"
                          >
                            <Info size={12} />
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {visibleDots.map((assignment) => {
                          const dotClass = shiftConfig[assignment.shift_type]?.color || 'bg-gray-400';
                          return (
                            <span
                              key={`${assignment.employee_id}-${assignment.date}-${assignment.shift_type}`}
                              className={`h-2 w-2 rounded-full ${dotClass}`}
                            />
                          );
                        })}
                        {overflowCount > 0 && (
                          <span className="text-[10px] font-medium text-gray-600">+{overflowCount}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Selected day details */}
              {selectedDate && (
                <div className="mt-4 border-t border-gray-200 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {formatDate(selectedDate, 'EEEE, MMMM d')}
                      </div>
                      {holidayMap.has(formatDate(selectedDate)) && (
                        <div className="text-xs text-yellow-800">
                          🎉 {holidayMap.get(formatDate(selectedDate))?.name}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(null)}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Close
                    </button>
                  </div>

                  {selectedDateAssignments.length === 0 ? (
                    <div className="mt-3 text-sm text-gray-500">No shifts.</div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {selectedDateAssignments.map((assignment) => {
                        const leaveData = myLeaves.find((leave) =>
                          leave.employee_id === assignment.employee_id &&
                          leave.date === assignment.date &&
                          leave.shift_type === assignment.shift_type
                        );

                        return (
                          <ShiftCard
                            key={`${assignment.employee_id}-${assignment.date}-${assignment.shift_type}`}
                            assignment={assignment}
                            leaveData={leaveData}
                            onClick={onShiftClick}
                            isClickable={true}
                            className=""
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Desktop Calendar (existing full ShiftCard grid) */}
            <div className="hidden md:grid grid-cols-7 gap-2">
              {/* Weekday Headers */}
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
                  {day}
                </div>
              ))}

              {/* Calendar Days */}
              {monthDays.map(({ date, isCurrentMonth }, index) => {
                const dateAssignments = getAssignmentsForDate(date);
                const isToday = isSameDate(date, new Date());
                const dateStr = formatDate(date);
                const isHoliday = holidayMap.has(dateStr);
                const hasAnyComment = dateAssignments.length > 0 && hasCommentForAssignments(dateAssignments);

                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`
                      min-h-[100px] border rounded-lg p-2 transition-all
                      ${isHoliday ? 'bg-yellow-100 border-yellow-400' : isCurrentMonth ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100'}
                      ${isToday ? 'ring-2 ring-blue-500' : ''}
                      ${!isCurrentMonth ? 'opacity-50' : ''}
                    `}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className={`text-sm font-medium ${
                        isHoliday ? 'text-yellow-800' : isToday ? 'text-blue-600' : isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                      }`}>
                        {date.getDate()}
                      </div>
                      {hasAnyComment && (
                        <span
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-blue-700"
                          title="This day has shift notes"
                        >
                          <Info size={14} />
                        </span>
                      )}
                    </div>

                    {/* Shift Cards */}
                    <div className="space-y-1">
                      {dateAssignments.map(assignment => {
                        const leaveData = myLeaves.find(leave =>
                          leave.employee_id === assignment.employee_id &&
                          leave.date === assignment.date &&
                          leave.shift_type === assignment.shift_type
                        );

                        return (
                          <ShiftCard
                            key={`${assignment.employee_id}-${assignment.date}-${assignment.shift_type}`}
                            assignment={assignment}
                            leaveData={leaveData}
                            onClick={onShiftClick}
                            isClickable={true}
                            className="text-xs"
                          />
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

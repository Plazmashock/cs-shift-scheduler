/**
 * Main App Component
 * Coordinates the scheduling interface with backend integration
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw,
  Download,
  FileText,
  Settings,
  AlertCircle,
  CheckCircle as CheckCircleIcon,
  Loader2,
  X,
  LogOut,
  Calendar,
  User,
  Moon,
  Sun
} from 'lucide-react';

// Authentication
import { useAuth } from './contexts/AuthContext';
import Login from './components/Login';

// Components
import MonthCalendar, { CompactMonthSelector } from './components/MonthCalendar';
import EmployeeList, { CompactEmployeeSelector } from './components/EmployeeList';
import WeekGrid from './components/WeekGrid';
import GanttTimeline from './components/GanttTimeline';
import Modal, { ConfirmationModal, GenericModal, LeaveModal, AlertModal } from './components/Modal';
import OvertimeModal from './components/OvertimeModal';
import CustomShiftModal from './components/CustomShiftModal';
import RequestTab from './components/RequestTab';
import DataTab from './components/DataTab';
import SettingsTab from './components/SettingsTab';
import MyPage from './components/MyPage';
import LoadingBar, { ScheduleSkeleton } from './components/LoadingBar';

// Services and utilities
import {
  generateSchedule,
  exportScheduleCSV,
  downloadFile,
  getMockScheduleData,
  notifySlack,
  notifyScheduleReady
} from './services/api';
import * as firebaseDB from './services/firebaseDatabase';
import { loadTeamMembers, loadShiftSettings } from './services/firebaseService';
import { fetchHolidaysForRange } from './services/holidayService';
// import * as emailService from './services/emailService'; // EmailJS disabled - using Slack for notifications
import { getWeekStart, formatDate, getToday } from './utils/dateHelpers';

// Hooks
import usePreferences from './hooks/usePreferences';
import useModal from './hooks/useModal';

// Firebase Realtime Database is the authoritative store for schedules and requests.
const createScheduleKey = (weekStart) => {
  return `cs-scheduler-data-${formatDate(weekStart)}`;
};

/**
 * Migration helper: Convert old shift names to new lowercase names
 * Old names: sunrise, midday -> New names: morning, afternoon
 * This handles legacy data stored in Firebase before the rename
 */
const migrateShiftNames = (scheduleData) => {
  if (!scheduleData || !scheduleData.assignments) return scheduleData;

  const SHIFT_NAME_MAP = {
    'sunrise': 'morning',
    'midday': 'afternoon',
    'day': 'day',
    'night': 'night'
  };

  return {
    ...scheduleData,
    assignments: scheduleData.assignments.map(assignment => ({
      ...assignment,
      shift_type: SHIFT_NAME_MAP[assignment.shift_type] || assignment.shift_type
    }))
  };
};

// Default employees - expanded for better feasibility
const DEFAULT_EMPLOYEES = [
  { id: 1, name: 'Nia Kavtaradze', email: '' },
  { id: 2, name: 'Tamuna Janelidze', email: '' },
  { id: 3, name: 'Nino Beridze', email: '' },
  { id: 4, name: 'Eka Tsiklauri', email: '' },
  { id: 5, name: 'Mari Kutaladze', email: '' },
  { id: 6, name: 'Tako Kvirikashvili', email: '' },
  { id: 7, name: 'Teona Abashidze', email: '' },
  { id: 8, name: 'Luka Japaridze', email: '' },
  { id: 9, name: 'Tamta Gabunia', email: '' },
  { id: 10, name: 'Gvantsa Barbakadze', email: '' },
];

export default function App() {
  // Authentication
  const { user, loading, isAuthenticated, isAdmin: authIsAdmin, signOut, getIdToken } = useAuth();

  // User preferences (persisted to localStorage)
  const preferences = usePreferences();

  // Modal system (replaces window.alert/confirm)
  const { alert: showAlert, confirm: showConfirm, alertState, confirmState } = useModal();

  // Dark mode — persisted to localStorage, respects OS preference on first visit
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('cs-scheduler-dark-mode');
    if (saved !== null) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('cs-scheduler-dark-mode', String(isDarkMode));
  }, [isDarkMode]);

  // Testing mode: Allow kordzadze2002@gmail.com to toggle admin status
  const [isTestingAsEmployee, setIsTestingAsEmployee] = useState(false);
  const canToggleAdminStatus = user?.email === 'kordzadze2002@gmail.com';
  const isAdmin = canToggleAdminStatus && isTestingAsEmployee ? false : authIsAdmin;

  // Tab navigation state
  const [activeTab, setActiveTab] = useState('schedule');

  // State management
  const [weekStart, setWeekStart] = useState(() => {
    // demo: always land on the week the pre-computed solver fixtures cover,
    // ignoring persisted lastWeek and the current date
    if (import.meta.env.VITE_DEMO_MODE === 'true') return new Date(2026, 6, 6);
    // Try to restore last week from preferences, otherwise use current week
    if (preferences.lastWeek) {
      try {
        return new Date(preferences.lastWeek);
      } catch (e) {
        return getWeekStart(getToday());
      }
    }
    return getWeekStart(getToday());
  });
  const [employees, setEmployees] = useState([]);
  const [visibleEmployeeIds, setVisibleEmployeeIds] = useState(preferences.visibleEmployeeIds || []);
  const [viewingEmployeeId, setViewingEmployeeId] = useState(null); // Admin: view another employee's MyPage
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [scheduleData, setScheduleData] = useState(null);
  const [selectedShift, setSelectedShift] = useState(null);
  const [leaves, setLeaves] = useState([]);
  // Reassignment flow state
  const [isSelectingForReassignment, setIsSelectingForReassignment] = useState(false);
  const [reassignmentSource, setReassignmentSource] = useState(null);
  const [reassignmentTarget, setReassignmentTarget] = useState(null);
  const [isReassignConfirmOpen, setIsReassignConfirmOpen] = useState(false);
  const [isSubmittingSwapRequest, setIsSubmittingSwapRequest] = useState(false);
  const [showSelectShiftToast, setShowSelectShiftToast] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [error, setError] = useState(null);
  const [holidayMap, setHolidayMap] = useState(new Map());
  const [shiftDefinitions, setShiftDefinitions] = useState(null);
  const [currentWeekDataForGeneration, setCurrentWeekDataForGeneration] = useState(null);

  // Modal states
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isMorningSelectionOpen, setIsMorningSelectionOpen] = useState(false);
  const [selectedMorningEmployees, setSelectedMorningEmployees] = useState([]);
  const [previousWeekMorningEmployees, setPreviousWeekMorningEmployees] = useState([]);
  const [pastMorningCounts, setPastMorningCounts] = useState({}); // {employeeId: count} for past 3 weeks
  const [employeesNeedingMondayBreak, setEmployeesNeedingMondayBreak] = useState([]); // Employees with 3+ trailing work days
  const [selectedHighTrafficDays, setSelectedHighTrafficDays] = useState(preferences.highTrafficDays || [2, 3]); // Default: Wed (2), Thu (3)
  const [isAddShiftModalOpen, setIsAddShiftModalOpen] = useState(false);
  const [isOvertimeModalFromAddShiftOpen, setIsOvertimeModalFromAddShiftOpen] = useState(false);
  const [isCustomShiftModalOpen, setIsCustomShiftModalOpen] = useState(false);
  const [newShiftData, setNewShiftData] = useState({
    employeeId: '',
    date: '',
    shiftType: ''
  });
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [leaveShiftContext, setLeaveShiftContext] = useState(null);

  // Popover states
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isEmployeeListOpen, setIsEmployeeListOpen] = useState(false);

  // Mobile responsive state
  const [isMobile, setIsMobile] = useState(false);

  // Small toast notification for schedule generation
  const [showGenerateToast, setShowGenerateToast] = useState(false);

  // UI-only state: per-employee day selections (keeps selected days highlighted visually)
  // UI-only state: per-employee day selections (keeps selected days highlighted visually)
  // Initialize from persisted preferences for current week
  const initialDaySelections = preferences.getDaySelectionsForWeek(formatDate(weekStart));
  const [employeeDaySelections, setEmployeeDaySelections] = useState(initialDaySelections || {});
  // Small popup for daily limit reached messages
  const [dayLimitPopup, setDayLimitPopup] = useState({ visible: false, message: '' });
  // Admin schedule generation notes
  const [adminNotes, setAdminNotes] = useState('');

  // Persist break selections whenever week or selections change
  useEffect(() => {
    const weekKey = formatDate(weekStart);
    preferences.setDaySelectionsForWeek(weekKey, employeeDaySelections);
  }, [weekStart, employeeDaySelections, preferences]);

  // Reload persisted selections when switching weeks
  useEffect(() => {
    const weekKey = formatDate(weekStart);
    const persisted = preferences.getDaySelectionsForWeek(weekKey);
    setEmployeeDaySelections(persisted || {});
  }, [weekStart]);

  function DayToggleButton({ employeeId, label, wholeWeek = false, maxBreaksPerDay = 2 }) {
    const key = `${employeeId}-${label}`;
    const selected = employeeDaySelections[employeeId]?.includes(label) || false;

    const toggle = () => {
      setEmployeeDaySelections(prev => {
        const current = prev[employeeId] || [];
        const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        // Helper to count how many employees already have a given day selected
        const countForDay = (day) => Object.values(prev).filter(arr => arr.includes(day)).length;

        // Handle whole-week toggle: only allow if selecting won't push any weekday over limit
        if (wholeWeek) {
          const allSelected = weekdays.every(d => current.includes(d));
          if (allSelected) {
            return { ...prev, [employeeId]: [] };
          }

          // Determine if any weekday would exceed limit when selecting this employee for whole week
          const wouldExceed = weekdays.filter(d => !current.includes(d) && countForDay(d) >= maxBreaksPerDay);
          if (wouldExceed.length > 0) {
            setDayLimitPopup({ visible: true, message: `Break limit reached for: ${wouldExceed.join(', ')}` });
            setTimeout(() => setDayLimitPopup({ visible: false, message: '' }), 3000);
            return prev;
          }

          return { ...prev, [employeeId]: weekdays };
        }

        // Single day toggle: if selecting, ensure limit not exceeded
        if (current.includes(label)) {
          return { ...prev, [employeeId]: current.filter(d => d !== label) };
        }

        // Limit to 1-2 breaks per employee (cannot select more than 2 days)
        if (current.length >= 2) {
          setDayLimitPopup({ visible: true, message: 'Maximum 2 breaks per employee allowed.' });
          setTimeout(() => setDayLimitPopup({ visible: false, message: '' }), 2500);
          return prev;
        }

        const currentCount = countForDay(label);
        if (currentCount >= maxBreaksPerDay) {
          setDayLimitPopup({ visible: true, message: `Break limit reached for ${label} (max ${maxBreaksPerDay} employees).` });
          setTimeout(() => setDayLimitPopup({ visible: false, message: '' }), 2500);
          return prev;
        }

        return { ...prev, [employeeId]: [...current, label] };
      });
    };

    return (
      <button
        type="button"
        onClick={toggle}
        className={`w-full h-8 flex items-center justify-center text-xs rounded-md transition-colors ${wholeWeek ? (selected ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-800 hover:bg-purple-200') : (selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}`}
        aria-pressed={selected}
      >
        {label}
      </button>
    );
  }

  useEffect(() => {
    // Show toast briefly when a schedule is generated successfully
    if (scheduleData?.status && scheduleData.status !== 'infeasible') {
      setShowGenerateToast(true);
      // demo: keep the toast up longer so the demo disclaimer is readable
      const t = setTimeout(() => setShowGenerateToast(false), scheduleData?.demo ? 9000 : 4000);
      return () => clearTimeout(t);
    }
    return undefined;
    // demo: demo_variant changes on every demo generation so the toast re-fires
  }, [scheduleData?.status, scheduleData?.demo_variant]);

  // Check for mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Click outside to close popovers
  useEffect(() => {
    const handleClickOutside = (event) => {
      const target = event.target;

      // Check if click is outside popover and not on a trigger
      const isPopoverTrigger = target.closest('[data-popover-trigger]');
      const isInsidePopover = target.closest('[data-popover]');

      if (!isPopoverTrigger && !isInsidePopover) {
        setIsCalendarOpen(false);
        setIsEmployeeListOpen(false);
      }
    };

    if (isCalendarOpen || isEmployeeListOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isCalendarOpen, isEmployeeListOpen]);

  // Load team members from Firebase on app startup
  useEffect(() => {
    // Initialize EmailJS on app startup
    // emailService.initEmailJS(); // EmailJS disabled - using Slack for notifications

    const loadEmployees = async () => {
      try {
        const savedEmployees = await loadTeamMembers();
        console.log('Raw employees from Firebase:', savedEmployees);
        console.log('Raw employee count:', savedEmployees?.length || 0);

        // Filter out invalid entries (null, undefined, missing id, name, or email)
        const validEmployees = (savedEmployees || []).filter(emp =>
          emp &&
          emp.id &&
          emp.name &&
          typeof emp.id !== 'undefined' &&
          emp.email &&
          emp.email.trim() !== ''
        );

        console.log('Valid employees after filtering:', validEmployees.length);
        console.log('Valid employee IDs:', validEmployees.map(e => e.id));
        console.log('Employees with emails:', validEmployees.map(e => ({ id: e.id, name: e.name, email: e.email })));

        if (validEmployees.length > 0) {
          console.log('✅ Loaded employees from Firebase:', validEmployees.length);
          setEmployees(validEmployees);
          // Update visible employee IDs to include all loaded employees
          setVisibleEmployeeIds(validEmployees.map(emp => emp.id));
        } else {
          console.log('⚠️ No valid employees found in Firebase. Please import employees via CSV with email addresses.');
          setEmployees([]);
          setVisibleEmployeeIds([]);
        }
      } catch (error) {
        console.warn('Could not load employees from Firebase:', error.message);
        setEmployees([]);
        setVisibleEmployeeIds([]);
      }
    };

    loadEmployees();
  }, []);

  // Sync preferences when they change
  useEffect(() => {
    if (visibleEmployeeIds.length > 0) {
      preferences.setVisibleEmployeeIds(visibleEmployeeIds);
    }
  }, [visibleEmployeeIds, preferences]);

  useEffect(() => {
    preferences.setLastWeek(formatDate(weekStart));
  }, [weekStart, preferences]);

  useEffect(() => {
    preferences.setHighTrafficDays(selectedHighTrafficDays);
  }, [selectedHighTrafficDays, preferences]);

  // Keyboard navigation for week changes (Left/Right arrows)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle arrow keys when on schedule tab and no input is focused
      if (activeTab !== 'schedule') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleWeekSelect(new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleWeekSelect(new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, weekStart]);

  // Ensure all employees with emails are always visible
  useEffect(() => {
    if (employees.length > 0) {
      const employeesWithEmails = employees.filter(emp => emp && emp.email && emp.email.trim());
      const allEmployeeIds = employees.map(emp => emp.id);

      // If we have employees with emails but some aren't visible, make them visible
      if (employeesWithEmails.length > 0 && visibleEmployeeIds.length < employees.length) {
        console.log('🔧 Auto-showing all employees with emails:', employeesWithEmails.length);

        // On mobile: restore the selected employee filter if it exists
        if (isMobile && preferences.selectedEmployeeFilter) {
          const filterExists = employees.some(emp => emp.id === preferences.selectedEmployeeFilter);
          if (filterExists) {
            setVisibleEmployeeIds([preferences.selectedEmployeeFilter]);
            setSelectedEmployeeId(preferences.selectedEmployeeFilter);
          } else {
            setVisibleEmployeeIds(allEmployeeIds);
          }
        } else {
          setVisibleEmployeeIds(allEmployeeIds);
        }
      }
    }
  }, [employees, isMobile, preferences.selectedEmployeeFilter]); // Only depend on employees, not visibleEmployeeIds to avoid infinite loop

  // Fetch Georgian holidays when week changes
  useEffect(() => {
    const fetchHolidays = async () => {
      try {
        // Fetch holidays for current month plus buffer
        const startDate = new Date(weekStart);
        const endDate = new Date(weekStart);
        endDate.setDate(endDate.getDate() + 30); // Get a month of holidays

        const holidays = await fetchHolidaysForRange(startDate, endDate);
        setHolidayMap(holidays);
        console.log('✅ Fetched Georgian holidays:', holidays.size, 'entries');
      } catch (err) {
        console.warn('Failed to fetch holidays:', err.message);
        // Keep existing holidays if fetch fails
      }
    };

    fetchHolidays();
  }, [weekStart]);

  // Load admin notes when morning selection modal opens
  useEffect(() => {
    if (isMorningSelectionOpen && isAdmin) {
      const loadNotes = async () => {
        try {
          const notes = await firebaseDB.getAdminNotes();
          setAdminNotes(notes || '');
        } catch (err) {
          console.error('Failed to load admin notes:', err);
        }
      };
      loadNotes();
    }
  }, [isMorningSelectionOpen, isAdmin]);

  // Load shift definitions on component mount and when Settings tab is updated
  useEffect(() => {
    const loadDefinitions = async () => {
      try {
        const settings = await loadShiftSettings();
        if (settings?.shift_definitions) {
          setShiftDefinitions(settings.shift_definitions);
          console.log('✅ Loaded shift definitions:', settings.shift_definitions);
        }
      } catch (err) {
        console.warn('Failed to load shift definitions:', err.message);
      }
    };

    loadDefinitions();
  }, []); // Load once on mount

  // Schedules are loaded from Firebase only.


  // Generate new schedule with manual morning selection
  const generateNewSchedule = async (selectedMorningEmployees = [], currentWeekDataParam = null) => {
    try {
      setScheduleLoading(true);
      setError(null);

      // Use passed currentWeekData parameter (loaded in handleGenerateClick to prevent race condition)
      const currentWeekData = currentWeekDataParam;

      // Always generate a new schedule when requested (do not short-circuit
      // using an existing Firebase schedule). Relying on cached/generated
      // schedules caused subtle bugs; generation should be explicit.

      // Load previous week data for fairness tracking and cross-week constraints
      const previousWeekStart = new Date(weekStart);
      previousWeekStart.setDate(previousWeekStart.getDate() - 7);
      const previousWeekKey = createScheduleKey(previousWeekStart);

      console.log('Loading previous week data for fairness tracking:', formatDate(previousWeekStart));

      // Try Firebase only
      let previousWeekData = null;
      try {
        const previousWeekKeyFirebase = formatDate(previousWeekStart);
        previousWeekData = await firebaseDB.loadScheduleFromFirebase(previousWeekKeyFirebase, user || null);
        if (previousWeekData) {
          // Migrate old shift names
          previousWeekData = migrateShiftNames(previousWeekData);
          console.log('Previous week data loaded from Firebase');
        }
      } catch (err) {
        console.warn('Failed to load previous week from Firebase:', err?.message);
      }


      console.log('Previous week schedule found:', !!previousWeekData);

      // Get visible employees and mark morning assignments + previous week data
      const visibleEmployees = employees
        .filter(emp => emp && emp.id && visibleEmployeeIds.includes(emp.id))
        .map(emp => {
          let pastWeekCounts = {};
          let hadMorningLastWeek = false;
          let hadSundayNight = false;
          let hadSundayDay = false;
          let hadSundayAfternoon = false;
          let trailingConsecutiveWorkDays = 0; // Count of consecutive work days at END of previous week
          let trailingConsecutiveNights = 0; // Count of consecutive night shifts at END of previous week

          // Extract previous week shift counts and Sunday shifts if available
          if (previousWeekData?.assignments) {
            const empAssignments = previousWeekData.assignments.filter(a => a.employee_id === emp.id);
            pastWeekCounts = empAssignments.reduce((counts, assignment) => {
              counts[assignment.shift_type] = (counts[assignment.shift_type] || 0) + 1;
              return counts;
            }, {});
            hadMorningLastWeek = pastWeekCounts.morning > 0;

            // Calculate trailing consecutive work days
            // Sort assignments by date descending (start from Sunday backwards)
            const sortedAssignments = empAssignments
              .map(a => ({ ...a, dateObj: new Date(a.date + 'T00:00:00') }))
              .sort((a, b) => b.dateObj - a.dateObj); // Newest first

            // Group by date
            const dateSet = new Set();
            sortedAssignments.forEach(a => dateSet.add(a.date));
            const uniqueDates = Array.from(dateSet).sort().reverse(); // Latest first

            // Count consecutive days from the end
            if (uniqueDates.length > 0) {
              const lastDate = new Date(uniqueDates[0]);
              trailingConsecutiveWorkDays = 1;

              for (let i = 1; i < uniqueDates.length; i++) {
                const currentDate = new Date(uniqueDates[i]);
                const prevDate = new Date(uniqueDates[i - 1]);
                const daysDiff = Math.round((prevDate - currentDate) / (1000 * 60 * 60 * 24));

                if (daysDiff === 1) {
                  trailingConsecutiveWorkDays++;
                } else {
                  break; // Not consecutive anymore
                }
              }
            }

            // Calculate trailing consecutive night shifts
            const nightAssignments = sortedAssignments
              .filter(a => a.shift_type === 'night')
              .sort((a, b) => b.dateObj - a.dateObj); // Newest first

            const nightDates = Array.from(new Set(nightAssignments.map(a => a.date))).sort().reverse();

            if (nightDates.length > 0) {
              trailingConsecutiveNights = 1;

              for (let i = 1; i < nightDates.length; i++) {
                const currentDate = new Date(nightDates[i]);
                const prevDate = new Date(nightDates[i - 1]);
                const daysDiff = Math.round((prevDate - currentDate) / (1000 * 60 * 60 * 24));

                if (daysDiff === 1) {
                  trailingConsecutiveNights++;
                } else {
                  break; // Not consecutive anymore
                }
              }

              // Debug logging for night shifts
              if (trailingConsecutiveNights >= 2) {
                console.log(`🌙 [${emp.name}] TRAILING CONSECUTIVE NIGHTS: ${trailingConsecutiveNights}`);
                console.log(`   Night dates (newest first): ${nightDates.join(', ')}`);
                console.log(`   ⚠️  Should heavily penalize Mon (weight=10) and Tue (weight=12) nights!`);
              }
            }

            // Check for SUNDAY shifts only (last day of previous week)
            // Sunday shifts affect Monday assignments due to 12-hour gap rule:
            // - Sunday Night (19:00 → Mon 04:00) → blocks Monday Morning (04:00), Day (10:00), Afternoon (15:00)
            // - Sunday Day (10:00 → 19:00) → blocks Monday Morning (04:00)
            // - Sunday Afternoon (15:00 → Mon 00:00) → blocks Monday Morning (04:00), Day (10:00)

            const sundayAssignments = empAssignments.filter(a => {
              const assignmentDate = new Date(a.date + 'T00:00:00');
              const dayOfWeek = assignmentDate.getDay();
              const isSunday = dayOfWeek === 0;

              // Debug log for troubleshooting
              if (a.shift_type === 'night' || isSunday) {
                console.log(`[${emp.name}] Assignment: ${a.date} (day ${dayOfWeek}) shift=${a.shift_type} isSunday=${isSunday}`);
              }

              return isSunday; // Sunday = 0
            });

            hadSundayNight = sundayAssignments.some(a => a.shift_type === 'night');
            hadSundayDay = sundayAssignments.some(a => a.shift_type === 'day');
            hadSundayAfternoon = sundayAssignments.some(a => a.shift_type === 'afternoon');

            // Log detected Sunday shifts
            if (hadSundayNight || hadSundayDay || hadSundayAfternoon) {
              console.log(`[${emp.name}] Sunday shifts detected:`, {
                night: hadSundayNight,
                day: hadSundayDay,
                afternoon: hadSundayAfternoon,
                sundayDates: sundayAssignments.map(a => a.date)
              });
            }
          }

          // Map day selections to actual dates
          const dayOffsForEmployee = employeeDaySelections[emp.id] || [];
          const dayOffDates = [];

          if (dayOffsForEmployee.length > 0) {
            const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            dayOffsForEmployee.forEach(dayName => {
              const dayIndex = dayNames.indexOf(dayName);
              if (dayIndex !== -1) {
                // Calculate the date for this day of the week
                const date = new Date(weekStart);
                date.setDate(date.getDate() + dayIndex);
                dayOffDates.push(formatDate(date));
              }
            });
          }

          // Add all-day leave dates as day_offs so the solver cannot assign the
          // employee on those days (they truly won't work, so they must not count
          // toward shift coverage).
          const allDayLeaveDates = leaves
            .filter(lv => lv.timeframe === 'all-day' && String(lv.employee_id) === String(emp.id))
            .map(lv => lv.date);

          const combinedDayOffs = [...new Set([...dayOffDates, ...allDayLeaveDates])];

          // leave_count tells the scheduler how many fewer shifts this employee
          // works this week (each all-day leave reduces required shifts by 1).
          const leaveCount = allDayLeaveDates.length;

          return {
            ...emp,
            manually_assigned_morning: selectedMorningEmployees.includes(emp.id),
            past_week_counts: Object.keys(pastWeekCounts).length > 0 ? pastWeekCounts : undefined,
            had_morning_last_week: hadMorningLastWeek,
            had_sunday_night: hadSundayNight,
            had_sunday_day: hadSundayDay,
            had_sunday_afternoon: hadSundayAfternoon,
            trailing_consecutive_work_days: trailingConsecutiveWorkDays,
            trailing_consecutive_nights: trailingConsecutiveNights,
            day_offs: combinedDayOffs.length > 0 ? combinedDayOffs : undefined,
            leave_count: leaveCount,
          };
        });

      console.log('DEBUG: All employees:', employees);
      console.log('DEBUG: Visible employee IDs:', visibleEmployeeIds);
      console.log('DEBUG: Selected morning employees:', selectedMorningEmployees);

      // Debug: Log employees with day_offs
      const empWithDayOffs = visibleEmployees.filter(e => e.day_offs && e.day_offs.length > 0);
      if (empWithDayOffs.length > 0) {
        console.log('🚫 EMPLOYEES WITH BREAK DAYS (day_offs):', empWithDayOffs.map(e => ({
          id: e.id,
          name: e.name,
          day_offs: e.day_offs
        })));
      }

      // Debug: Log employees with trailing consecutive patterns
      const empWithTrailingNights = visibleEmployees.filter(e => e.trailing_consecutive_nights >= 2);
      if (empWithTrailingNights.length > 0) {
        console.log('🔥 EMPLOYEES WITH 2+ TRAILING CONSECUTIVE NIGHTS:', empWithTrailingNights.map(e => ({
          name: e.name,
          trailing_consecutive_nights: e.trailing_consecutive_nights,
          trailing_consecutive_work_days: e.trailing_consecutive_work_days
        })));
      }

      const empWithTrailingDays = visibleEmployees.filter(e => e.trailing_consecutive_work_days >= 3);
      if (empWithTrailingDays.length > 0) {
        console.log('📅 EMPLOYEES WITH 3+ TRAILING CONSECUTIVE WORK DAYS:', empWithTrailingDays.map(e => ({
          name: e.name,
          trailing_consecutive_work_days: e.trailing_consecutive_work_days,
          trailing_consecutive_nights: e.trailing_consecutive_nights
        })));
      }

      // Debug previous week cross-week protection
      if (previousWeekData) {
        const empWithPriorMorning = visibleEmployees.filter(emp => emp.had_morning_last_week);
        console.log(`✅ Employees with morning last week: (${empWithPriorMorning.length})`, empWithPriorMorning.map(e => e.name));

        const empWithSundayNight = visibleEmployees.filter(emp => emp.had_sunday_night);
        console.log(`🌙 Employees with SUNDAY NIGHT last week (blocks Mon morning/day/afternoon): (${empWithSundayNight.length})`, empWithSundayNight.map(e => e.name));

        const empWithSundayDay = visibleEmployees.filter(emp => emp.had_sunday_day);
        console.log(`☀️ Employees with SUNDAY DAY last week (blocks Mon morning): (${empWithSundayDay.length})`, empWithSundayDay.map(e => e.name));

        const empWithSundayAfternoon = visibleEmployees.filter(emp => emp.had_sunday_afternoon);
        console.log(`🌅 Employees with SUNDAY AFTERNOON last week (blocks Mon morning/day): (${empWithSundayAfternoon.length})`, empWithSundayAfternoon.map(e => e.name));

        // Show detailed breakdown for employees with Sunday shifts
        if (empWithSundayNight.length > 0 || empWithSundayDay.length > 0 || empWithSundayAfternoon.length > 0) {
          console.log('🔍 Detailed Sunday shift analysis:');
          const empWithAnySunday = visibleEmployees.filter(emp =>
            emp.had_sunday_night || emp.had_sunday_day || emp.had_sunday_afternoon
          );
          empWithAnySunday.forEach(emp => {
            const assignments = previousWeekData.assignments.filter(a => a.employee_id === emp.id);
            const sundayShifts = assignments.filter(a => {
              const date = new Date(a.date + 'T00:00:00');
              return date.getDay() === 0; // Sunday only
            });
            console.log(`  - ${emp.name}:`, sundayShifts.map(a => `${a.date} (Sun) ${a.shift_type}`));
          });
        }
      } else {
        console.log('ℹ️ No previous week data found - first week or no stored schedule');
      }

      console.log('Generating schedule with morning assignments:', {
        visibleEmployees,
        selectedMorningEmployees,
        weekStart: formatDate(weekStart)
      });

      // Load shift settings from Firebase (shift_definitions only)
      // NOTE: shift_combinations no longer used - direct constraint satisfaction
      let shiftDefinitions = null;
      try {
        const shiftSettings = await loadShiftSettings();
        if (shiftSettings?.shift_definitions) {
          shiftDefinitions = shiftSettings.shift_definitions;

          // Migrate old shift definition keys to new names
          if (shiftDefinitions.sunrise) {
            shiftDefinitions.morning = shiftDefinitions.sunrise;
            delete shiftDefinitions.sunrise;
          }
          if (shiftDefinitions.midday) {
            shiftDefinitions.afternoon = shiftDefinitions.midday;
            delete shiftDefinitions.midday;
          }

          console.log('Loaded shift_definitions from Firebase (migrated):', shiftDefinitions);
        }
      } catch (err) {
        console.warn('Could not load shift settings from Firebase, using defaults:', err?.message);
      }

      // Get existing assignments to lock them as pre-assigned shifts
      // This allows the scheduler to preserve manually-added shifts and build around them
      const existingAssignments = currentWeekData?.assignments || [];
      
      // Log all existing assignments to understand what was manually added
      if (existingAssignments.length > 0) {
        console.log('📌 All existing assignments in current week:', existingAssignments.map(a => ({
          employee_id: a.employee_id,
          date: a.date,
          shift_type: a.shift_type
        })));
      } else {
        console.log('📌 No existing assignments in current week');
      }
      
      // Build a set of all day_off dates per employee
      // IMPORTANT: Break days are selected by the user in the modal AFTER manual shifts are added.
      // If there's a conflict, we should NOT exclude the manual shift.
      // Instead, we keep manual shifts and ignore the conflicting break day.
      const dayOffsByEmployee = {};
      visibleEmployees.forEach(emp => {
        if (emp.day_offs && emp.day_offs.length > 0) {
          dayOffsByEmployee[emp.id] = new Set(emp.day_offs);
        }
      });
      
      // Build a set of (employee_id, date) pairs that have an all-day leave,
      // so the scheduler doesn't count them toward coverage (employee won't actually work)
      const fullLeaveKeys = new Set(
        leaves
          .filter(lv => lv.timeframe === 'all-day')
          .map(lv => `${lv.employee_id}__${lv.date}`)
      );

      if (fullLeaveKeys.size > 0) {
        console.log('📋 All-day leaves that may conflict with pre-assigned shifts:',
          Array.from(fullLeaveKeys).map(key => {
            const [empId, date] = key.split('__');
            const emp = visibleEmployees.find(e => String(e.id) === empId);
            return `${emp?.name || empId} on ${date}`;
          })
        );
      }

      const preAssignedShifts = existingAssignments
        .filter(a => {
          // FIXED: Do NOT exclude for break day conflicts!
          // If an admin manually added a shift, that's explicit and should be preserved.
          // The break day selection is secondary; it shouldn't override manual assignments.
          const empDayOffs = dayOffsByEmployee[a.employee_id];
          if (empDayOffs && empDayOffs.has(a.date)) {
            console.log(`⚠️ PRE-ASSIGNED SHIFT on break day: employee ${a.employee_id} on ${a.date} (${a.shift_type}) — KEEPING (manual shift takes precedence)`);
            // Don't return false - keep this shift!
          }
          
          // Do NOT exclude assignments where the employee has a full-day leave!
          // Instead, mark them with has_leave=true so the backend knows
          // not to count them toward coverage (but keep them locked in schedule).
          // This allows: 3 regular day shifts + 1 day shift with leave = 4 total, but coverage only counts 3.
          return true; // Keep ALL pre-assigned shifts (including ones with leave)
        })
        .map(a => {
          // Check if this pre-assigned shift has a full-day leave
          const hasLeave = fullLeaveKeys.has(`${a.employee_id}__${a.date}`);
          if (hasLeave) {
            console.log(`📋 Pre-assigned shift with leave: employee ${a.employee_id} on ${a.date} (${a.shift_type}) — will be locked but NOT counted toward coverage`);
          }
          return {
            employee_id: a.employee_id,
            date: a.date,
            shift_type: a.shift_type,
            ...(hasLeave && { has_leave: true }) // Mark shifts with leave
          };
        });

      console.log(`🔒 Pre-assigned shifts to lock: ${preAssignedShifts.length}`);
      if (preAssignedShifts.length > 0) {
        console.log('🔒 Pre-assigned shifts:', preAssignedShifts.map(s => ({
          employee_id: s.employee_id,
          date: s.date,
          shift_type: s.shift_type,
          has_leave: s.has_leave || false
        })));
      }

      const spec = {
        week_start: formatDate(weekStart),
        employees: visibleEmployees,
        ...(shiftDefinitions && { shift_definitions: shiftDefinitions }),
        // Include pre-assigned shifts to lock manually-added shifts
        // Shifts with has_leave=true are locked but don't count toward coverage
        ...(preAssignedShifts.length > 0 && { pre_assigned_shifts: preAssignedShifts }),
        // Include high-traffic days (admin-selected priority days)
        ...(selectedHighTrafficDays.length > 0 && { high_traffic_days: selectedHighTrafficDays }),
        // shift_combinations removed - no longer needed for pattern-free scheduling
        options: {
          allow_same_day_morning_night_exception: true,
          timezone: 'UTC',
          max_solve_time: 30
        }
      };

      // Log pre-assigned shifts for debugging
      if (preAssignedShifts.length > 0) {
        console.log('🔒 Pre-assigned shifts to lock:', preAssignedShifts.length);
        console.log('🔒 Pre-assigned shifts:', preAssignedShifts);
      }
      console.log('DEBUG: Spec employees count:', spec.employees.length);
      console.log('DEBUG: Spec employees with Sunday constraints:', spec.employees.filter(e => e.had_sunday_night || e.had_sunday_day || e.had_sunday_afternoon).map(e => ({
        name: e.name,
        had_sunday_night: e.had_sunday_night,
        had_sunday_day: e.had_sunday_day,
        had_sunday_afternoon: e.had_sunday_afternoon
      })));
      console.log('DEBUG: Spec employees with day_offs:', spec.employees.filter(e => e.day_offs && e.day_offs.length > 0).map(e => ({
        name: e.name,
        day_offs: e.day_offs
      })));
      console.log('DEBUG: Shift definitions:', spec.shift_definitions);
      console.log('Sending request to backend:', spec);
      const data = await generateSchedule(spec, getIdToken);
      console.log('Received response from backend:', data);

      if (data.status === 'infeasible') {
        // Construct detailed error message from backend response
        let errorDetail = 'Schedule generation failed';

        if (data.error_detail) {
          errorDetail = `${data.error_detail}`;
        }

        if (data.diagnostic) {
          console.log('Diagnostic info:', data.diagnostic);
          const diag = data.diagnostic;

          // Pattern-free diagnostic info
          if (diag.total_slots_available && diag.min_slots_needed) {
            errorDetail += `\n\n📊 Capacity Analysis:`;
            errorDetail += `\n• Employees: ${diag.employees}`;
            errorDetail += `\n• Total slots: ${diag.total_slots_available} (${diag.employees} × 5 shifts)`;
            errorDetail += `\n• Min required: ${diag.min_slots_needed}`;
            errorDetail += `\n• Utilization: ${Math.round(diag.min_slots_needed / diag.total_slots_available * 100)}%`;

            if (diag.shift_definitions) {
              errorDetail += `\n\n📋 Shift Requirements (per week):`;
              Object.entries(diag.shift_definitions).forEach(([type, def]) => {
                const min = def.min_staff * 7;
                const max = def.max_staff * 7;
                errorDetail += `\n• ${type}: ${min}–${max} shifts (${def.min_staff}–${def.max_staff}/day)`;
              });
            }

            errorDetail += `\n\n💡 Suggestions:`;
            if (diag.min_slots_needed > diag.total_slots_available) {
              errorDetail += `\n• Add more employees (need ${Math.ceil((diag.min_slots_needed - diag.total_slots_available) / 5)} more)`;
              errorDetail += `\n• OR reduce min_staff in Settings`;
            } else if (diag.min_slots_needed / diag.total_slots_available > 0.9) {
              errorDetail += `\n• High utilization - try increasing max_staff for flexibility`;
              errorDetail += `\n• OR add 1-2 more employees for breathing room`;
            } else {
              errorDetail += `\n• Try increasing max_staff values in Settings`;
              errorDetail += `\n• Ensure 12-hour rest constraints are satisfied`;
            }
          }
        }

        setError(errorDetail);
        setScheduleData(null);
      } else {
        // Ensure the returned schedule carries the week_start field for clarity
        const scheduleWithWeek = { ...data, week_start: formatDate(weekStart) };
        setScheduleData(scheduleWithWeek);

        // Persist the newly generated schedule to both Firebase and localStorage
        const weekKey = formatDate(weekStart);

        // Save to Firebase with proper error handling
        try {
          const res = await firebaseDB.saveScheduleToFirebase(weekKey, scheduleWithWeek, user);
          if (!res || !res.success) {
            console.warn('Failed to save schedule to Firebase for week', weekKey, res?.error || 'unknown');
            // Notify user but don't block - schedule is still in memory and localStorage
            setTimeout(() => {
              showAlert(
                'Schedule generated successfully but cloud save failed. Your schedule is saved locally.',
                'Warning',
                'warning'
              );
            }, 1000);
          } else {
            console.log('Schedule saved to Firebase for week:', weekKey);
          }
        } catch (err) {
          console.error('Firebase save error:', err);
          setTimeout(() => {
            showAlert(
              'Schedule generated successfully but cloud save failed. Your schedule is saved locally.',
              'Warning',
              'warning'
            );
          }, 1000);
        }

        // Also save to localStorage as backup
        try {
          const localKey = `schedule-${weekKey}`;
          localStorage.setItem(localKey, JSON.stringify(scheduleWithWeek));
          console.log('Schedule saved to localStorage for week:', weekKey);
        } catch (err) {
          console.warn('Failed to save to localStorage:', err?.message || err);
        }

        // Firebase is authoritative for persistence

        // Combination tracking removed - pattern-based scheduling deprecated
      }
    } catch (err) {
      console.error('Failed to generate schedule:', err);
      setError(`Failed to generate schedule: ${err.message}`);
    } finally {
      setScheduleLoading(false);
      setIsMorningSelectionOpen(false); // Close modal after generation
    }
  };

  // Load existing schedule data from storage (no automatic generation)
  const loadScheduleData = useCallback(async () => {
    try {
      setScheduleLoading(true);
      setError(null);

      // Try Firebase first, then localStorage fallback for persistence across sessions
      const weekKey = formatDate(weekStart);
      let loaded = null;

      try {
        loaded = await firebaseDB.loadScheduleFromFirebase(weekKey, user || null);
        // Migrate old shift names (sunrise -> morning, midday -> afternoon)
        if (loaded) {
          loaded = migrateShiftNames(loaded);
        }
      } catch (err) {
        console.warn('Failed to load schedule from Firebase for week', weekKey, ':', err?.message || err);
      }

      // If Firebase fails, try localStorage as fallback
      if (!loaded) {
        try {
          const localKey = `schedule-${weekKey}`;
          const localData = localStorage.getItem(localKey);
          if (localData) {
            loaded = JSON.parse(localData);
            // Migrate old shift names
            loaded = migrateShiftNames(loaded);
            console.log('Loaded schedule from localStorage for week:', weekKey);
          }
        } catch (err) {
          console.warn('Failed to load from localStorage:', err?.message || err);
        }
      } else {
        console.log('Loaded schedule from Firebase for week:', weekKey);
        // Save to localStorage as backup
        try {
          const localKey = `schedule-${weekKey}`;
          localStorage.setItem(localKey, JSON.stringify(loaded));
        } catch (err) {
          console.warn('Failed to save to localStorage:', err?.message || err);
        }
      }

      if (loaded) {
        setScheduleData(loaded);

        // Load leaves for this week
        try {
          const leavesData = await firebaseDB.loadLeavesFromFirebase(weekKey);
          setLeaves(leavesData || []);
          console.log('Loaded leaves from Firebase:', leavesData?.length || 0);
        } catch (err) {
          console.warn('Failed to load leaves from Firebase:', err?.message || err);
          setLeaves([]);
        }
      } else {
        setScheduleData(null);
        setLeaves([]);
      }
    } catch (err) {
      console.error('Failed to load schedule:', err);
      setError(err.message);
    } finally {
      setScheduleLoading(false);
    }
  }, [weekStart, user]);

  // Load schedule data on week change
  useEffect(() => {
    loadScheduleData();
  }, [weekStart, loadScheduleData]);

  // Handle generate schedule click (opens morning selection modal)
  const handleGenerateClick = async () => {
    setSelectedMorningEmployees([]);

    // CRITICAL: Load current week's schedule data first to get existing assignments for pre-assigned shifts
    // This prevents race condition where scheduleData might still be null if user clicks generate before loadScheduleData completes
    const weekKey = formatDate(weekStart);
    let currentWeekData = scheduleData; // Use already-loaded data if available
    if (!currentWeekData) {
      try {
        const loaded = await firebaseDB.loadScheduleFromFirebase(weekKey, user || null);
        if (loaded) {
          currentWeekData = migrateShiftNames(loaded);
          console.log('Loaded current week schedule for generation:', weekKey);
        }
      } catch (err) {
        console.warn('Could not load current week schedule:', err?.message);
      }
    }
    
    // Store in state so modal button can access it when calling generateNewSchedule
    setCurrentWeekDataForGeneration(currentWeekData);

    // Load previous week data to show in modal
    const previousWeekStart = new Date(weekStart);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    const previousWeekKey = formatDate(previousWeekStart);
    let previousWeekData = null;
    try {
      previousWeekData = await firebaseDB.loadScheduleFromFirebase(previousWeekKey, user || null);
      // Migrate old shift names
      if (previousWeekData) {
        previousWeekData = migrateShiftNames(previousWeekData);
      }
    } catch (err) {
      // ignore
    }

    // Load past 3 weeks for morning counts
    const morningCountsMap = {};
    for (let weeksAgo = 1; weeksAgo <= 3; weeksAgo++) {
      const pastWeekStart = new Date(weekStart);
      pastWeekStart.setDate(pastWeekStart.getDate() - 7 * weeksAgo);
      const pastWeekKey = formatDate(pastWeekStart);
      try {
        let pastData = await firebaseDB.loadScheduleFromFirebase(pastWeekKey, user || null);
        if (pastData) pastData = migrateShiftNames(pastData);
        if (pastData?.assignments) {
          pastData.assignments
            .filter(a => a.shift_type === 'morning')
            .forEach(a => {
              morningCountsMap[a.employee_id] = (morningCountsMap[a.employee_id] || 0) + 1;
            });
        }
      } catch (_) { /* ignore */ }
    }
    setPastMorningCounts(morningCountsMap);

    if (previousWeekData?.assignments) {
      // Find employees who had morning shifts last week
      const morningAssignments = previousWeekData.assignments.filter(a => a.shift_type === 'morning');
      const empWithMorning = [...new Set(morningAssignments.map(a => a.employee_name))];
      setPreviousWeekMorningEmployees(empWithMorning);
      console.log('Previous week morning employees:', empWithMorning);

      // Check for employees who worked Fri + Sat + Sun (weekend overload)
      const employeeTrailingDays = [];
      const visibleEmps = employees.filter(emp => visibleEmployeeIds.includes(emp.id));

      // Calculate Friday, Saturday, Sunday dates of previous week
      const prevWeekSunday = new Date(previousWeekStart);
      prevWeekSunday.setDate(prevWeekSunday.getDate() + 6); // Sunday is 6 days after Monday
      const prevWeekSaturday = new Date(previousWeekStart);
      prevWeekSaturday.setDate(prevWeekSaturday.getDate() + 5); // Saturday is 5 days after Monday
      const prevWeekFriday = new Date(previousWeekStart);
      prevWeekFriday.setDate(prevWeekFriday.getDate() + 4); // Friday is 4 days after Monday

      const fridayStr = formatDate(prevWeekFriday);
      const saturdayStr = formatDate(prevWeekSaturday);
      const sundayStr = formatDate(prevWeekSunday);

      for (const emp of visibleEmps) {
        const empAssignments = previousWeekData.assignments.filter(a => a.employee_id === emp.id);
        if (empAssignments.length === 0) continue;

        const workDates = new Set(empAssignments.map(a => a.date));

        // Check if they worked all 3 days: Fri, Sat, Sun
        const workedFriday = workDates.has(fridayStr);
        const workedSaturday = workDates.has(saturdayStr);
        const workedSunday = workDates.has(sundayStr);

        if (workedFriday && workedSaturday && workedSunday) {
          employeeTrailingDays.push({
            name: emp.name,
            days: 3,
            detail: 'Fri + Sat + Sun'
          });
        }
      }

      setEmployeesNeedingMondayBreak(employeeTrailingDays);
      console.log('Employees needing Monday break (worked Fri+Sat+Sun):', employeeTrailingDays);
    } else {
      setPreviousWeekMorningEmployees([]);
      setEmployeesNeedingMondayBreak([]);
      console.log('No previous week data found');
    }
    if (Object.keys(morningCountsMap).length === 0) {
      setPastMorningCounts({});
    }

    setIsMorningSelectionOpen(true);
  };

  // Handle week selection from calendar
  const handleWeekSelect = useCallback((newWeekStart) => {
    setWeekStart(newWeekStart);
  }, []);

  // Handle employee visibility changes
  const handleVisibilityChange = useCallback((newVisibleIds) => {
    setVisibleEmployeeIds(newVisibleIds);
  }, []);

  // Handle employee selection
  const handleEmployeeSelect = useCallback((employeeId) => {
    setSelectedEmployeeId(selectedEmployeeId === employeeId ? null : employeeId);

    // On mobile: filter visible employees when selection changes
    if (isMobile) {
      if (employeeId) {
        // Show only the selected employee
        setVisibleEmployeeIds([employeeId]);
        preferences.setSelectedEmployeeFilter(employeeId);
      } else {
        // Show all employees
        setVisibleEmployeeIds(employees.map(emp => emp.id));
        preferences.setSelectedEmployeeFilter(null);
      }
    }
  }, [selectedEmployeeId, isMobile, employees, preferences]);

  // Popover toggle handlers
  const handleCalendarToggle = useCallback(() => {
    setIsCalendarOpen(prev => !prev);
    setIsEmployeeListOpen(false); // Close the other popover
  }, []);

  const handleEmployeeListToggle = useCallback(() => {
    setIsEmployeeListOpen(prev => !prev);
    setIsCalendarOpen(false); // Close the other popover
  }, []);

  // Handle shift click
  const handleShiftClick = useCallback((shift) => {
    // If we're in reassignment selection mode, capture the clicked shift as the target
    if (isSelectingForReassignment) {
      // If user clicked the same shift, ignore and notify
      if (reassignmentSource &&
        reassignmentSource.employee_id === shift.employee_id &&
        reassignmentSource.date === shift.date &&
        reassignmentSource.shift_type === shift.shift_type) {
        showAlert('Same Shift', 'You selected the same shift. Please choose a different shift to swap with.', 'warning');
        return;
      }

      setReassignmentTarget(shift);
      setIsSelectingForReassignment(false);
      setShowSelectShiftToast(false);
      // Open confirmation modal showing both shifts
      setIsReassignConfirmOpen(true);
      return;
    }

    setSelectedShift(shift);
    setIsShiftModalOpen(true);
  }, [isSelectingForReassignment, reassignmentSource]);

  // Handle shift reassignment (placeholder)
  const handleShiftReassign = useCallback((shift) => {
    // Start interactive reassignment: minimize modal and prompt user to select a target shift
    console.log('Start reassignment for shift:', shift);
    setReassignmentSource(shift);
    setReassignmentTarget(null);
    setIsSelectingForReassignment(true);
    setShowSelectShiftToast(true);
    setIsShiftModalOpen(false);
  }, []);

  // Handle shift deletion with confirmation - Admin only
  const handleShiftDelete = useCallback(async (shift) => {
    if (!isAdmin) {
      showAlert('Permission Denied', 'Only administrators can delete shifts.', 'warning');
      return;
    }

    const confirmed = await showConfirm(
      `Are you sure you want to remove this ${shift.shift_type} shift for ${shift.employee_name} on ${formatDate(new Date(shift.date))}?`,
      'Delete Shift',
      {
        confirmText: 'Delete',
        cancelText: 'Cancel',
        type: 'danger'
      }
    );

    if (confirmed) {
      // User confirmed, proceed with deletion
      deleteShiftFromDB(shift);
    }

    setIsShiftModalOpen(false);
  }, [scheduleData, isAdmin]);

  // Helper function to delete shift from database
  const deleteShiftFromDB = (shift) => {
    if (scheduleData?.assignments) {
      (async () => {
        const weekKey = formatDate(weekStart);
        const shiftDateStr = shift?.date || (shift?.start_datetime ? shift.start_datetime.slice(0, 10) : null);
        const weekKeyFromShiftDate = shiftDateStr
          ? formatDate(getWeekStart(new Date(`${shiftDateStr}T00:00:00`)))
          : weekKey;

        // Remove the shift from assignments
        const updatedAssignments = scheduleData.assignments.filter(assignment =>
          !(assignment.employee_id === shift.employee_id &&
            assignment.date === shift.date &&
            assignment.shift_type === shift.shift_type)
        );

        // Delete any leaves associated with this shift (direct Firebase scan so it
        // works even if local `leaves` state is stale/missing IDs). We attempt both
        // the currently-selected week key and the week key derived from the shift date.
        const leaveDeleteWeekKeys = Array.from(new Set([weekKey, weekKeyFromShiftDate]));
        for (const wk of leaveDeleteWeekKeys) {
          try {
            const leaveDeleteRes = await firebaseDB.deleteLeavesForShift(wk, shift);
            if (!leaveDeleteRes?.success) {
              console.warn('Failed to delete associated leave(s):', { week: wk, error: leaveDeleteRes?.error });
            } else if ((leaveDeleteRes.deleted || 0) > 0) {
              console.log('Deleted associated leave(s):', { week: wk, deleted: leaveDeleteRes.deleted });
            }
          } catch (err) {
            console.error('Error deleting associated leave(s):', { week: wk, err });
          }
        }

        // Update leaves state to remove deleted leaves
        setLeaves(prev => prev.filter(leave =>
          !(leave.employee_id === shift.employee_id &&
            leave.date === shift.date &&
            leave.shift_type === shift.shift_type)
        ));

        // Update schedule data locally (optimistic)
        const updatedScheduleData = {
          ...scheduleData,
          assignments: updatedAssignments,
          total_assignments: updatedAssignments.length
        };
        setScheduleData(updatedScheduleData);

        try {
          const res = await firebaseDB.saveScheduleToFirebase(weekKey, updatedScheduleData, user || null);
          if (!res || !res.success) {
            console.warn('Failed to persist deleted shift to Firebase:', res?.error);
            showAlert('Save Warning', 'Shift removed locally but failed to save to server. It may reappear after refresh.', 'warning');
          } else {
            console.log('Shift deletion persisted to Firebase for week:', weekKey);
          }
        } catch (err) {
          console.error('Error saving deleted shift to Firebase:', err);
          showAlert('Save Error', 'Warning: Shift removed locally but failed to save to server. It may reappear after refresh.', 'error');
        }
      })();
    }
  };

  // Validation functions for adding shifts
  const validateNewShift = useCallback((employeeId, date, shiftType, existingAssignments) => {
    const violations = [];
    const employee = employees.find(emp => emp && emp.id === parseInt(employeeId));
    const employeeName = employee?.name || `Employee ${employeeId}`;

    // Shift definitions for validation
    const SHIFT_TIMES = {
      morning: { start: 4, end: 13 },   // 4:00-13:00
      day: { start: 10, end: 19 },      // 10:00-19:00  
      afternoon: { start: 15, end: 24 },   // 15:00-00:00
      night: { start: 19, end: 28 }     // 19:00-04:00 (next day)
    };

    const MAX_STAFF = {
      morning: 1,
      day: 4,
      afternoon: 4,
      night: 5
    };

    // Check overlapping shifts for same employee on same day
    const employeeShiftsOnDate = existingAssignments.filter(a =>
      a.employee_id === parseInt(employeeId) && a.date === date
    );

    if (employeeShiftsOnDate.length > 0) {
      violations.push(`${employeeName} already has a shift on ${formatDate(new Date(date))}`);
    }

    // Check 12-hour rest period
    const employeeAllShifts = existingAssignments.filter(a => a.employee_id === parseInt(employeeId));
    const newShiftDate = new Date(date);
    const newShiftStart = SHIFT_TIMES[shiftType].start;
    const newShiftEnd = SHIFT_TIMES[shiftType].end > 24 ? SHIFT_TIMES[shiftType].end - 24 : SHIFT_TIMES[shiftType].end;

    for (const shift of employeeAllShifts) {
      // Skip custom and overtime shifts - they don't have standard times
      if (shift.shift_type === 'custom' || shift.shift_type === 'overtime') {
        continue;
      }

      const shiftDate = new Date(shift.date);

      // Parse dates to compare day difference correctly
      const newDay = parseInt(date.split('-')[2]);
      const newMonth = parseInt(date.split('-')[1]);
      const newYear = parseInt(date.split('-')[0]);

      const existingDay = parseInt(shift.date.split('-')[2]);
      const existingMonth = parseInt(shift.date.split('-')[1]);
      const existingYear = parseInt(shift.date.split('-')[0]);

      // Create proper date objects for comparison
      const newDateObj = new Date(newYear, newMonth - 1, newDay);
      const existingDateObj = new Date(existingYear, existingMonth - 1, existingDay);

      const dayDiff = (newDateObj - existingDateObj) / (1000 * 60 * 60 * 24);

      // Only check 12-hour rest for consecutive days
      if (dayDiff === 1) {
        // New shift is the day AFTER existing shift
        const existingStart = SHIFT_TIMES[shift.shift_type].start;
        const existingEnd = SHIFT_TIMES[shift.shift_type].end > 24 ? SHIFT_TIMES[shift.shift_type].end - 24 : SHIFT_TIMES[shift.shift_type].end;

        // Calculate rest hours: from end of existing shift to start of new shift
        // Existing shift ends at existingEnd on day N
        // New shift starts at newShiftStart on day N+1
        // Rest = (24 - existingEnd) + newShiftStart
        const restHours = (24 - existingEnd) + newShiftStart;

        if (restHours < 12) {
          violations.push(`Only ${restHours.toFixed(1)} hours rest between ${shift.shift_type} shift on ${shift.date} and ${shiftType} shift on ${date}`);
        }
      } else if (dayDiff === -1) {
        // New shift is the day BEFORE existing shift
        const existingStart = SHIFT_TIMES[shift.shift_type].start;
        const existingEnd = SHIFT_TIMES[shift.shift_type].end > 24 ? SHIFT_TIMES[shift.shift_type].end - 24 : SHIFT_TIMES[shift.shift_type].end;

        // Calculate rest hours: from end of new shift to start of existing shift (next day)
        // New shift ends at newShiftEnd on day N
        // Existing shift starts at existingStart on day N+1
        // Rest = (24 - newShiftEnd) + existingStart
        const restHours = (24 - newShiftEnd) + existingStart;

        if (restHours < 12) {
          violations.push(`Only ${restHours.toFixed(1)} hours rest between ${shiftType} shift on ${date} and ${shift.shift_type} shift on ${shift.date}`);
        }
      }
    }

    // Check maximum staff limits
    const shiftsOnDate = existingAssignments.filter(a => a.date === date && a.shift_type === shiftType);
    if (shiftsOnDate.length >= MAX_STAFF[shiftType]) {
      violations.push(`Maximum staff limit (${MAX_STAFF[shiftType]}) reached for ${shiftType} shift on ${formatDate(new Date(date))}`);
    }

    return violations;
  }, [employees]);

  // Handle adding new shift - Admin only
  const handleAddShift = useCallback(async (shiftTypeOverride = null) => {
    if (!isAdmin) {
      showAlert('Permission Denied', 'Only administrators can add shifts.', 'warning', () => {
        setIsAddShiftModalOpen(false);
      });
      return;
    }

    // Use override if provided (for immediate add), otherwise use state
    const shiftType = shiftTypeOverride || newShiftData.shiftType;
    const { employeeId, date } = newShiftData;

    if (!employeeId || !date || !shiftType) {
      showAlert('Incomplete Form', 'Please fill in all fields', 'warning');
      return;
    }

    const employee = employees.find(emp => emp && emp.id === parseInt(employeeId));

    if (!employee) {
      showAlert('Invalid Employee', 'Employee not found. Please select a valid employee.', 'warning');
      return;
    }

    const existingAssignments = scheduleData?.assignments || [];

    // Validate the new shift
    const violations = validateNewShift(employeeId, date, shiftType, existingAssignments);

    // Show violations as notifications but allow user to proceed
    if (violations.length > 0) {
      const confirmed = await showConfirm(
        `Warning: The following rule violations were detected:\n\n${violations.join('\n')}\n\nDo you want to add the shift anyway?`,
        'Rule Violations Detected',
        {
          confirmText: 'Add Anyway',
          cancelText: 'Cancel',
          type: 'warning'
        }
      );

      if (confirmed) {
        // User confirmed, proceed with adding shift
        addShiftToDB(employeeId, date, shiftType);
      }
      return;
    }

    // No violations, proceed with adding shift
    addShiftToDB(employeeId, date, shiftType);
  }, [newShiftData, scheduleData, employees, validateNewShift, isAdmin]);

  // Helper function to add shift to database
  const addShiftToDB = (employeeId, date, shiftType) => {
    const employee = employees.find(emp => emp && emp.id === parseInt(employeeId));
    const existingAssignments = scheduleData?.assignments || [];

    // Create new shift assignment
    const startTime = getShiftStartTime(shiftType);
    const endTime = getShiftEndTime(shiftType);
    const endDate = getShiftEndDate(date, shiftType);

    console.log('Creating shift assignment:', {
      shiftType,
      date,
      startTime,
      endTime,
      endDate
    });

    // Create proper UTC datetime strings to match backend format
    const startDatetime = new Date(`${date}T${startTime}:00.000Z`).toISOString();
    const endDatetime = new Date(`${endDate}T${endTime}:00.000Z`).toISOString();

    console.log('Generated datetimes:', {
      start_datetime: startDatetime,
      end_datetime: endDatetime
    });

    const newAssignment = {
      employee_id: parseInt(employeeId),
      employee_name: employee.name,
      date: date,
      shift_type: shiftType,
      start_datetime: startDatetime,
      end_datetime: endDatetime
    };

    // Add to schedule data and persist to Firebase
    (async () => {
      const updatedAssignments = [...existingAssignments, newAssignment];
      const updatedScheduleData = {
        ...scheduleData,
        assignments: updatedAssignments,
        total_assignments: updatedAssignments.length,
        status: scheduleData?.status || 'manual'
      };

      // Optimistic update
      setScheduleData(updatedScheduleData);

      try {
        const weekKey = formatDate(weekStart);
        const res = await firebaseDB.saveScheduleToFirebase(weekKey, updatedScheduleData, user || null);
        if (!res || !res.success) {
          console.warn('Failed to persist added shift to Firebase:', res?.error);
          showAlert('Save Warning', 'Shift added locally but failed to save to server. It may be lost on refresh.', 'warning');
        } else {
          console.log('Shift addition persisted to Firebase for week:', weekKey);
        }
      } catch (err) {
        console.error('Error saving added shift to Firebase:', err);
        showAlert('Save Error', 'Warning: Shift added locally but failed to save to server. It may be lost on refresh.', 'error');
      } finally {
        // Reset form and close modal
        setNewShiftData({ employeeId: '', date: '', shiftType: '' });
        setIsAddShiftModalOpen(false);
        console.log('Shift added:', newAssignment);
      }
    })();
  };

  // Handle adding overtime shift - Admin only
  const handleAddOvertime = useCallback((overtimeData) => {
    if (!isAdmin) {
      showAlert('Permission Denied', 'Only administrators can add overtime shifts.', 'warning');
      return;
    }

    const {
      employee_id,
      employee_name,
      startDate,
      startTime,
      endDate,
      endTime,
      durationHours
    } = overtimeData;

    if (!employee_id || !startDate || !startTime || !endDate || !endTime || durationHours === undefined) {
      showAlert('Incomplete Form', 'Please fill in all fields', 'warning');
      return;
    }

    const existingAssignments = scheduleData?.assignments || [];

    // Check both start and end dates for conflicts
    const employeeShiftsOnDates = existingAssignments.filter(a =>
      a.employee_id === parseInt(employee_id) &&
      (a.date === startDate || a.date === endDate)
    );

    if (employeeShiftsOnDates.length > 0) {
      const dateStr = startDate === endDate ? formatDate(new Date(startDate)) : `${formatDate(new Date(startDate))} - ${formatDate(new Date(endDate))}`;
      showConfirm(
        'Shift Already Exists',
        `${employee_name} already has a shift on ${dateStr}.\n\nDo you want to add the overtime shift anyway?`,
        () => {
          // User confirmed, proceed with adding overtime
          addOvertimeToDB(employee_id, employee_name, startDate, startTime, endDate, endTime, durationHours);
        },
        'Add Anyway',
        'Cancel',
        'warning'
      );
      return;
    }

    // No conflicts, proceed with adding overtime
    addOvertimeToDB(employee_id, employee_name, startDate, startTime, endDate, endTime, durationHours);
  }, [scheduleData, isAdmin, showAlert, showConfirm]);

  // Format duration hours to "Xh Ym" format
  const formatDurationDisplay = (durationHours) => {
    const hours = Math.floor(durationHours);
    const minutes = Math.round((durationHours - hours) * 60);
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  };

  // Helper function to add overtime to database
  const addOvertimeToDB = (employee_id, employee_name, startDate, startTime, endDate, endTime, durationHours) => {
    const existingAssignments = scheduleData?.assignments || [];

    // Create new overtime assignment with duration_hours (matching approved overtime shifts)
    const newOvertime = {
      employee_id: parseInt(employee_id),
      employee_name: employee_name,
      start_date: startDate,
      start_time: startTime,
      end_date: endDate,
      end_time: endTime,
      date: startDate, // For compatibility
      shift_type: 'overtime',
      duration_hours: durationHours,
      start_datetime: `${startDate}T${startTime}:00`,
      end_datetime: `${endDate}T${endTime}:00`
    };

    // Add to schedule data and persist to Firebase
    (async () => {
      const updatedAssignments = [...existingAssignments, newOvertime];
      const updatedScheduleData = {
        ...scheduleData,
        assignments: updatedAssignments,
        total_assignments: updatedAssignments.length,
        status: scheduleData?.status || 'manual'
      };

      // Optimistic update
      setScheduleData(updatedScheduleData);

      try {
        const weekKey = formatDate(weekStart);
        const res = await firebaseDB.saveScheduleToFirebase(weekKey, updatedScheduleData, user || null);
        if (!res || !res.success) {
          console.warn('Failed to persist overtime shift to Firebase:', res?.error);
          showAlert('Save Warning', 'Overtime shift added locally but failed to save to server. It may be lost on refresh.', 'warning');
        } else {
          console.log('Overtime shift persisted to Firebase for week:', weekKey);
          const durationDisplay = formatDurationDisplay(durationHours);
          showAlert('Overtime Added', `Overtime shift (${durationDisplay}) added successfully for ${employee_name}!`, 'success');
        }
      } catch (err) {
        console.error('Error saving overtime shift to Firebase:', err);
        showAlert('Save Error', 'Warning: Overtime shift added locally but failed to save to server. It may be lost on refresh.', 'error');
      } finally {
        console.log('Overtime shift added:', newOvertime);
      }
    })();
  };

  // Handle adding custom shift - Admin only
  const handleAddCustomShift = useCallback((customShiftData) => {
    if (!isAdmin) {
      showAlert('Permission Denied', 'Only administrators can add custom shifts.', 'warning');
      return;
    }

    const existingAssignments = scheduleData?.assignments || [];

    // Create new custom shift assignment with start_datetime and end_datetime
    const newCustomShift = {
      employee_id: customShiftData.employee_id,
      employee_name: customShiftData.employee_name,
      date: customShiftData.date,
      shift_type: 'custom',
      start_datetime: customShiftData.start_datetime,
      end_datetime: customShiftData.end_datetime,
      work_hours: customShiftData.work_hours
    };

    // Add to schedule data and persist to Firebase
    (async () => {
      const updatedAssignments = [...existingAssignments, newCustomShift];
      const updatedScheduleData = {
        ...scheduleData,
        assignments: updatedAssignments,
        total_assignments: updatedAssignments.length,
        status: scheduleData?.status || 'manual'
      };

      // Optimistic update
      setScheduleData(updatedScheduleData);

      try {
        const weekKey = formatDate(weekStart);
        const res = await firebaseDB.saveScheduleToFirebase(weekKey, updatedScheduleData, user || null);
        if (!res || !res.success) {
          console.warn('Failed to persist custom shift to Firebase:', res?.error);
          showAlert('Save Warning', 'Custom shift added locally but failed to save to server. It may be lost on refresh.', 'warning');
        } else {
          console.log('Custom shift persisted to Firebase for week:', weekKey);
          showAlert('Custom Shift Added', `Custom shift (${customShiftData.work_hours}h) added successfully for ${customShiftData.employee_name}!`, 'success');
        }
      } catch (err) {
        console.error('Error saving custom shift to Firebase:', err);
        showAlert('Save Error', 'Warning: Custom shift added locally but failed to save to server. It may be lost on refresh.', 'error');
      } finally {
        console.log('Custom shift added:', newCustomShift);
      }
    })();
  }, [scheduleData, isAdmin, weekStart, user]);

  // Handle add leave to shift
  const handleAddLeave = useCallback((shift) => {
    setLeaveShiftContext(shift);
    setIsLeaveModalOpen(true);
  }, []);

  // Handle submit leave
  const handleSubmitLeave = useCallback(async (leaveData) => {
    if (!leaveShiftContext) return;

    try {
      const shiftDateStr = leaveShiftContext?.date || (leaveShiftContext?.start_datetime ? leaveShiftContext.start_datetime.slice(0, 10) : null);
      const weekKey = shiftDateStr
        ? formatDate(getWeekStart(new Date(`${shiftDateStr}T00:00:00`)))
        : formatDate(weekStart);

      // Build complete leave record
      const leaveRecord = {
        employee_id: leaveShiftContext.employee_id,
        employee_name: leaveShiftContext.employee_name,
        date: leaveShiftContext.date,
        shift_type: leaveShiftContext.shift_type,
        leave_type: leaveData.leaveType,
        timeframe: leaveData.timeframe,
        custom_start: leaveData.customStart,
        custom_end: leaveData.customEnd,
        shift_start: leaveShiftContext.start_datetime,
        shift_end: leaveShiftContext.end_datetime
      };

      // Save to Firebase
      const result = await firebaseDB.saveLeaveToFirebase(weekKey, leaveRecord, user || null);

      if (result.success) {
        console.log('Leave saved successfully:', result.leaveId);

        // Add to local state
        setLeaves(prev => [...prev, { ...leaveRecord, id: result.leaveId }]);

        showAlert('Leave Added', `Leave added successfully for ${leaveShiftContext.employee_name}!`, 'success');
      } else {
        console.error('Failed to save leave:', result.error);
        showAlert('Save Failed', 'Failed to save leave. Please try again.', 'error');
      }
    } catch (err) {
      console.error('Error saving leave:', err);
      showAlert('Error', 'Error saving leave. Please try again.', 'error');
    } finally {
      // Close modal
      setIsLeaveModalOpen(false);
      setLeaveShiftContext(null);
    }
  }, [leaveShiftContext, weekStart, user]);

  // Handle delete leave
  const handleDeleteLeave = useCallback(async (shift, leave) => {
    if (!leave || !leave.id) {
      showAlert('Not Found', 'Leave record not found', 'warning');
      return;
    }

    try {
      const shiftDateStr = shift?.date || (shift?.start_datetime ? shift.start_datetime.slice(0, 10) : null);
      const weekKey = shiftDateStr
        ? formatDate(getWeekStart(new Date(`${shiftDateStr}T00:00:00`)))
        : formatDate(weekStart);
      const result = await firebaseDB.deleteLeaveFromFirebase(weekKey, leave.id);

      if (result.success) {
        // Remove from local state
        setLeaves(prev => prev.filter(l => l.id !== leave.id));
        showAlert('Leave Removed', 'Leave removed successfully', 'success');
        setIsShiftModalOpen(false);
      } else {
        showAlert('Delete Failed', 'Failed to remove leave. Please try again.', 'error');
      }
    } catch (err) {
      console.error('Error deleting leave:', err);
      showAlert('Error', 'Error removing leave. Please try again.', 'error');
    }
  }, [weekStart]);

  // Handle save shift notes
  const handleSaveNotes = useCallback(async (shift, notes) => {
    if (!shift) return;

    try {
      const weekKey = formatDate(weekStart);

      // Update the shift with notes in local state
      setScheduleData(prev => {
        if (!prev || !prev.assignments) return prev;

        const updatedAssignments = prev.assignments.map(a => {
          if (a.employee_id === shift.employee_id &&
            a.date === shift.date &&
            a.shift_type === shift.shift_type) {
            return { ...a, notes: notes || '' };
          }
          return a;
        });

        return { ...prev, assignments: updatedAssignments };
      });

      // Also update selectedShift for modal
      if (selectedShift) {
        setSelectedShift(prev => prev ? { ...prev, notes: notes || '' } : null);
      }

      // Save to Firebase
      const result = await firebaseDB.saveScheduleToFirebase(
        weekKey,
        {
          ...scheduleData,
          assignments: scheduleData.assignments.map(a =>
            a.employee_id === shift.employee_id &&
              a.date === shift.date &&
              a.shift_type === shift.shift_type
              ? { ...a, notes: notes || '' }
              : a
          )
        },
        null
      );

      if (!result || !result.success) {
        throw new Error(result?.error || 'Failed to save notes');
      }
    } catch (err) {
      console.error('Error saving notes:', err);
      throw err;
    }
  }, [weekStart, selectedShift, scheduleData]);

  // Handle shift swap via drag-and-drop
  const handleShiftSwap = useCallback(async (draggedShift, targetShift, targetEmployeeId, targetDate) => {
    if (!scheduleData || !scheduleData.assignments) return;

    // Create a deep copy of assignments to avoid mutating state directly
    const newAssignments = scheduleData.assignments.map(a => ({ ...a }));

    // Find indices
    const draggedIndex = newAssignments.findIndex(a =>
      a.employee_id === draggedShift.employee_id &&
      a.date === draggedShift.date &&
      a.shift_type === draggedShift.shift_type
    );

    if (draggedIndex === -1) {
      console.warn('Dragged shift not found in assignments');
      return;
    }

    if (targetShift) {
      // Swap: two shifts exchange positions
      const targetIndex = newAssignments.findIndex(a =>
        a.employee_id === targetShift.employee_id &&
        a.date === targetShift.date &&
        a.shift_type === targetShift.shift_type
      );

      if (targetIndex === -1) {
        console.warn('Target shift not found in assignments');
        return;
      }

      // Swap employee IDs and names
      const tempEmployeeId = newAssignments[draggedIndex].employee_id;
      const tempEmployeeName = newAssignments[draggedIndex].employee_name;

      newAssignments[draggedIndex].employee_id = newAssignments[targetIndex].employee_id;
      newAssignments[draggedIndex].employee_name = newAssignments[targetIndex].employee_name;

      newAssignments[targetIndex].employee_id = tempEmployeeId;
      newAssignments[targetIndex].employee_name = tempEmployeeName;

      console.log('Swapped shifts:', {
        shift1: `${tempEmployeeName} ${draggedShift.date} ${draggedShift.shift_type}`,
        shift2: `${targetShift.employee_name} ${targetShift.date} ${targetShift.shift_type}`
      });
    } else {
      // Move: reassign shift to new employee/date
      newAssignments[draggedIndex] = {
        ...newAssignments[draggedIndex],
        employee_id: targetEmployeeId,
        employee_name: employees.find(e => e.id === targetEmployeeId)?.name || 'Unknown',
        date: targetDate
      };

      console.log('Moved shift:', {
        from: `${draggedShift.employee_name} ${draggedShift.date}`,
        to: `${newAssignments[draggedIndex].employee_name} ${targetDate}`
      });
    }

    const updatedScheduleData = {
      ...scheduleData,
      assignments: newAssignments
    };

    // Update local state
    setScheduleData(updatedScheduleData);

    // Save to Firebase
    try {
      const weekKey = formatDate(weekStart);
      const res = await firebaseDB.saveScheduleToFirebase(weekKey, updatedScheduleData, user || null);
      if (res.success) {
        console.log('Shift swap saved to Firebase');
      } else {
        console.error('Failed to save shift swap to Firebase:', res.error);
        alert('Failed to save changes to server. Please refresh and try again.');
      }
    } catch (err) {
      console.error('Error saving shift swap:', err);
      alert('Error saving changes. Please check your connection.');
    }
  }, [scheduleData, employees, weekStart, user]);

  // Handle clearing current week's schedule
  const handleClearWeek = useCallback(() => {
    const confirmClear = window.confirm(
      `Are you sure you want to clear all shifts for the week of ${formatDate(weekStart)}? This action cannot be undone.`
    );

    if (confirmClear) {
      (async () => {
        try {
          const weekKey = formatDate(weekStart);
          // Delete from Firebase first (best-effort)
          const res = await firebaseDB.deleteScheduleFromFirebase(weekKey, user || null);
          if (!res || !res.success) {
            console.warn('Failed to delete schedule from Firebase:', res?.error);
          } else {
            console.log('Deleted schedule from Firebase for:', weekKey);
          }
        } catch (err) {
          console.warn('Error deleting schedule from Firebase:', err?.message || err);
        } finally {
          // Remove local app state (Firebase is authoritative)
          // Remove local app state and any localStorage backup
          try {
            const localKey = `schedule-${formatDate(weekStart)}`;
            localStorage.removeItem(localKey);
            console.log('Removed localStorage backup for:', localKey);
          } catch (err) {
            console.warn('Failed to remove localStorage backup:', err?.message || err);
          }

          setScheduleData(null);
          setError(null);
          console.log('Week schedule cleared for:', formatDate(weekStart));
        }
      })();
    }
  }, [weekStart]);

  // Handle remove shifts that don't have leaves
  const handleRemoveShiftsOnly = useCallback(() => {
    const confirmRemove = window.confirm(
      `Remove all shifts WITHOUT leaves for the week of ${formatDate(weekStart)}? Shifts with attached leaves will be preserved.`
    );

    if (confirmRemove) {
      (async () => {
        try {
          const weekKey = formatDate(weekStart);
          
          // Load current schedule and leaves
          const [scheduleData, leavesData] = await Promise.all([
            firebaseDB.loadScheduleFromFirebase(weekKey),
            firebaseDB.loadLeavesFromFirebase(weekKey)
          ]);

          if (!scheduleData || !scheduleData.assignments) {
            console.warn('No schedule data found for week:', weekKey);
            showAlert('No Data', 'No schedule found for this week', 'warning');
            return;
          }

          // Create a set of shifts that have leaves (match by employee_id, date, shift_type)
          const shiftsWithLeaves = new Set();
          if (leavesData && leavesData.length > 0) {
            leavesData.forEach(leave => {
              if (leave.employee_id && leave.date && leave.shift_type) {
                shiftsWithLeaves.add(`${leave.employee_id}|${leave.date}|${leave.shift_type}`);
              }
            });
          }

          // Filter assignments to keep only those with leaves
          const originalCount = scheduleData.assignments.length;
          scheduleData.assignments = scheduleData.assignments.filter(assignment => {
            const key = `${assignment.employee_id}|${assignment.date}|${assignment.shift_type}`;
            return shiftsWithLeaves.has(key);
          });
          const finalCount = scheduleData.assignments.length;
          const removedCount = originalCount - finalCount;

          // Update total_assignments count
          scheduleData.total_assignments = scheduleData.assignments.length;

          // Save updated schedule back to Firebase
          await firebaseDB.saveScheduleToFirebase(weekKey, scheduleData, user || null);

          // Refresh local schedule data
          setScheduleData(scheduleData);
          setError(null);
          
          showAlert(
            'Shifts Removed',
            `Removed ${removedCount} shift(s) without leaves. ${finalCount} shift(s) with leaves were preserved.`,
            'success'
          );
          
          console.log(`✅ Removed shifts without leaves. Removed: ${removedCount}, Kept: ${finalCount}`);
        } catch (err) {
          console.error('Error removing shifts only:', err);
          showAlert('Error', `Failed to remove shifts: ${err?.message || err}`, 'error');
        }
      })();
    }
  }, [weekStart, user]);

  // Handle random morning employee selection
  const handleRandomMorningSelection = useCallback(() => {
    const visibleEmployees = employees.filter(emp => emp && emp.id && visibleEmployeeIds.includes(emp.id));

    if (visibleEmployees.length < 7) {
      alert(`Not enough visible employees (${visibleEmployees.length}). Need at least 7 employees to select randomly.`);
      return;
    }

    // Shuffle array and take first 7
    const shuffled = [...visibleEmployees].sort(() => Math.random() - 0.5);
    const randomSelection = shuffled.slice(0, 7).map(emp => emp.id);

    setSelectedMorningEmployees(randomSelection);
    console.log('Random morning selection:', randomSelection.map(id =>
      employees.find(emp => emp && emp.id === id)?.name
    ));
  }, [employees, visibleEmployeeIds]);

  // Handle selecting employees who didn't have morning last week
  const handleSelectNonPreviousMorning = useCallback(() => {
    const visibleEmployees = employees.filter(emp => emp && emp.id && visibleEmployeeIds.includes(emp.id));

    // Filter out employees who had morning shifts last week
    const nonPreviousEmployees = visibleEmployees.filter(emp =>
      !previousWeekMorningEmployees.includes(emp.name)
    );

    if (nonPreviousEmployees.length === 0) {
      alert('No employees available who didn\'t have morning shifts last week.');
      return;
    }

    // Shuffle first for random tie-breaking, then sort by past 3-week morning count (ascending)
    const shuffled = [...nonPreviousEmployees].sort(() => Math.random() - 0.5);
    const sorted = shuffled.sort((a, b) =>
      (pastMorningCounts[a.id] || 0) - (pastMorningCounts[b.id] || 0)
    );

    // Select up to 7 employees with lowest morning shift counts
    const selected = sorted.slice(0, 7).map(emp => emp.id);
    setSelectedMorningEmployees(selected);

    console.log('Selected employees without previous morning (sorted by past 3-week morning count):',
      sorted.slice(0, 7).map(e => `${e.name} (${pastMorningCounts[e.id] || 0}x)`));

    if (nonPreviousEmployees.length < 7) {
      alert(`Only ${nonPreviousEmployees.length} employees available who didn't have morning last week. Selected all of them.`);
    }
  }, [employees, visibleEmployeeIds, previousWeekMorningEmployees, pastMorningCounts]);

  // Helper functions for shift times
  const getShiftStartTime = (shiftType) => {
    const times = { morning: '04:00', day: '10:00', afternoon: '15:00', night: '19:00' };
    return times[shiftType];
  };

  const getShiftEndTime = (shiftType) => {
    const times = { morning: '13:00', day: '19:00', afternoon: '00:00', night: '04:00' };
    return times[shiftType];
  };

  const getShiftEndDate = (startDate, shiftType) => {
    if (shiftType === 'afternoon' || shiftType === 'night') {
      // These shifts end the next day
      const date = new Date(startDate + 'T00:00:00');
      date.setDate(date.getDate() + 1);
      return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
    }
    return startDate;
  };

  // Export handlers
  const handleExportCSV = useCallback(async () => {
    if (!scheduleData?.assignments) {
      alert('No schedule data to export');
      return;
    }

    try {
      const blob = await exportScheduleCSV(scheduleData);
      const filename = `schedule-${formatDate(weekStart)}.csv`;
      downloadFile(blob, filename);
    } catch (err) {
      console.error('Export failed:', err);
      alert(`Export failed: ${err.message}`);
    }
  }, [scheduleData, weekStart]);

  // Show loading screen while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 md:py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            {/* Logo and Title */}
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <Calendar className="w-5 h-5 md:w-6 md:h-6 text-blue-600 flex-shrink-0" />
                  <h1 className="text-lg md:text-2xl font-bold text-gray-900">CS Scheduler</h1>
                </div>
                <p className="text-xs md:text-sm text-gray-600 hidden sm:block">
                  24/7 Customer Support Shift Scheduler
                </p>
              </div>

              {/* Mobile: User info */}
              <div className="md:hidden flex items-center space-x-1">
                {/* Admin/Employee Toggle - Only for kordzadze2002@gmail.com */}
                {canToggleAdminStatus && (
                  <button
                    onClick={() => setIsTestingAsEmployee(!isTestingAsEmployee)}
                    className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${isTestingAsEmployee
                      ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                      }`}
                    title="Toggle between Admin and Employee view for testing"
                  >
                    {isTestingAsEmployee ? '👤' : '⚙️'}
                  </button>
                )}
                <button
                  onClick={() => setIsDarkMode(prev => !prev)}
                  className="p-1.5 text-gray-500 hover:text-gray-700 transition-colors"
                  title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                  aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                </button>
                <button
                  onClick={signOut}
                  className="flex items-center space-x-1 text-gray-500 hover:text-red-600 transition-colors p-1.5"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>

            {/* Desktop: Header Actions */}
            <div className="hidden md:flex items-center space-x-2">
              {/* User info button */}
              <button
                onClick={() => setActiveTab('mypage')}
                className="flex items-center space-x-2 px-3 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
                title="Go to My Page"
              >
                <User size={16} />
                <span>{user?.email?.split('@')[0]}</span>
                {isAdmin && (
                  <span className="text-green-600 font-bold">★</span>
                )}
              </button>

              {/* Admin/Employee Toggle - Desktop version - Only for kordzadze2002@gmail.com */}
              {canToggleAdminStatus && (
                <button
                  onClick={() => setIsTestingAsEmployee(!isTestingAsEmployee)}
                  className={`text-sm px-3 py-2 font-medium rounded-md transition-colors border-2 ${isTestingAsEmployee
                    ? 'bg-orange-100 text-orange-700 hover:bg-orange-200 border-orange-400'
                    : 'bg-green-100 text-green-700 hover:bg-green-200 border-green-400'
                    }`}
                  title="Toggle between Admin and Employee view for testing"
                >
                  {isTestingAsEmployee ? '👤 Employee' : '⚙️ Admin'}
                </button>
              )}

              {/* Dark mode toggle */}
              <button
                onClick={() => setIsDarkMode(prev => !prev)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
              </button>

              {/* Logout button */}
              <button
                onClick={signOut}
                className="flex items-center space-x-1 px-3 py-2 text-sm font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="Sign out"
              >
                <LogOut size={16} />
                <span>Logout</span>
              </button>
            </div>

            {/* Mobile: Action Buttons Row */}
            <div className="md:hidden flex items-center justify-between gap-2 pt-3 border-t border-gray-100">
              <div className="flex items-center space-x-2 flex-1">

              </div>

              {/* User email badge */}
              <button
                onClick={() => setActiveTab('mypage')}
                className="flex items-center space-x-1 px-2 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded hover:bg-blue-100 hover:text-blue-700 transition-colors cursor-pointer whitespace-nowrap"
                title="Go to My Page"
              >
                <User size={14} />
                <span>{user?.email?.split('@')[0]}</span>
                {isAdmin && <span className="text-green-600 font-bold">★</span>}
              </button>

              {/* Admin/Employee Toggle - Only for kordzadze2002@gmail.com */}
              {canToggleAdminStatus && (
                <button
                  onClick={() => setIsTestingAsEmployee(!isTestingAsEmployee)}
                  className={`text-xs px-2 py-1.5 rounded font-medium transition-colors ${isTestingAsEmployee
                    ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                    : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                  title="Toggle between Admin and Employee view for testing"
                >
                  {isTestingAsEmployee ? '👤' : '⚙️'}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex items-center justify-between space-x-4 md:space-x-8">
            {/* Left side tabs */}
            <div className="flex space-x-4 md:space-x-8 overflow-x-auto">
              <button
                onClick={() => setActiveTab('schedule')}
                className={`py-3 md:py-4 px-1 border-b-2 font-medium text-xs md:text-sm transition-colors whitespace-nowrap ${activeTab === 'schedule'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                📅 Schedule
              </button>
              <button
                onClick={() => setActiveTab('request')}
                className={`py-3 md:py-4 px-1 border-b-2 font-medium text-xs md:text-sm transition-colors whitespace-nowrap ${activeTab === 'request'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                🔄 Request
              </button>
              <button
                onClick={() => setActiveTab('data')}
                className={`py-3 md:py-4 px-1 border-b-2 font-medium text-xs md:text-sm transition-colors whitespace-nowrap ${activeTab === 'data'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                📊 Data
              </button>
              {isAdmin && (
              <button
                onClick={() => setActiveTab('settings')}
                className={`py-3 md:py-4 px-1 border-b-2 font-medium text-xs md:text-sm transition-colors whitespace-nowrap ${activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                ⚙️ Settings
              </button>
              )}
            </div>

            {/* Right side - My Page button */}
            <button
              onClick={() => setActiveTab('mypage')}
              className={`py-3 md:py-4 px-1 border-b-2 font-medium text-xs md:text-sm transition-colors whitespace-nowrap ml-auto ${activeTab === 'mypage'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              👤 My Page
            </button>
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-2 md:px-4 py-4 md:py-6">
        {/* Error Alert */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 md:mb-6 bg-red-50 border border-red-200 rounded-lg p-3 md:p-4"
          >
            <div className="flex items-start space-x-3">
              <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
              <div>
                <h3 className="font-medium text-red-800 text-sm md:text-base">Schedule Generation Failed</h3>
                <p className="text-xs md:text-sm text-red-700 mt-1">{error}</p>
                <button
                  onClick={handleGenerateClick}
                  className="text-xs md:text-sm text-red-600 hover:text-red-800 underline mt-2"
                >
                  Try Again
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Small toast notification for generation (top-right) */}
        <AnimatePresence>
          {showGenerateToast && scheduleData?.status && scheduleData.status !== 'infeasible' && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className={`fixed top-4 left-4 z-50 w-80 rounded-md shadow-lg p-3 flex items-start space-x-3 ${scheduleData.status === 'optimal'
                ? 'bg-green-50 border border-green-200'
                : scheduleData.status === 'greedy_fallback'
                  ? 'bg-yellow-50 border border-yellow-200'
                  : 'bg-blue-50 border border-blue-200'
                }`}
            >
              <CheckCircleIcon className={`flex-shrink-0 mt-0.5 ${scheduleData.status === 'optimal'
                ? 'text-green-500'
                : scheduleData.status === 'greedy_fallback'
                  ? 'text-yellow-500'
                  : 'text-blue-500'
                }`} size={18} />

              <div className="flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <div className={`font-medium text-sm ${scheduleData.status === 'optimal' ? 'text-green-800' : scheduleData.status === 'greedy_fallback' ? 'text-yellow-800' : 'text-blue-800'
                      }`}>Schedule Generated</div>
                    <div className="text-xs text-gray-700 mt-1">
                      {scheduleData.assignments?.length || 0} shifts • {scheduleData.solve_time ? `${scheduleData.solve_time}s` : '—'}
                      {scheduleData.status === 'greedy_fallback' && ' • fallback'}
                    </div>
                    {/* demo: honest label — result is real solver output, served statically */}
                    {scheduleData.demo && (
                      <div className="text-xs text-amber-700 mt-1 font-medium">
                        Demo: pre-computed result from the real OR-Tools solver — the live backend is not deployed in this demo.
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setShowGenerateToast(false)}
                    aria-label="Dismiss"
                    className="ml-3 text-gray-500 hover:text-gray-700"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Select shift toast shown when user is selecting a target for reassignment */}
        <AnimatePresence>
          {showSelectShiftToast && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="fixed top-4 right-4 z-50 w-56 rounded-md shadow-lg p-3 flex items-start space-x-3 bg-blue-50 border border-blue-200"
            >
              <div className="flex-1 text-sm text-blue-800">Please select the shift you want to swap with</div>
              <button onClick={() => { setIsSelectingForReassignment(false); setShowSelectShiftToast(false); setReassignmentSource(null); }} className="text-blue-600">Cancel</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tab Content */}
        {activeTab === 'schedule' && (
          /* Schedule Tab - Layout */
          <>
            {isMobile ? (
              /* Mobile Layout - Stacked */
              <div className="space-y-6">
                <CompactMonthSelector
                  selectedWeekStart={weekStart}
                  onWeekSelect={handleWeekSelect}
                />

                <CompactEmployeeSelector
                  employees={employees}
                  selectedEmployeeId={selectedEmployeeId}
                  onEmployeeSelect={handleEmployeeSelect}
                />

                <WeekGrid
                  weekStart={weekStart}
                  employees={employees}
                  visibleEmployeeIds={visibleEmployeeIds}
                  assignments={scheduleData?.assignments || []}
                  leaves={leaves}
                  selectedEmployeeId={selectedEmployeeId}
                  onShiftClick={handleShiftClick}
                  onAddShift={isAdmin ? (employee, date, shiftType) => {
                    // If employee, date and/or shiftType are provided (calendar cell click), pre-fill them.
                    // If called without args (toolbar blue button), open modal with empty fields.
                    setNewShiftData({
                      employeeId: employee?.id ? String(employee.id) : '',
                      date: date ? formatDate(date) : '',
                      shiftType: shiftType || ''
                    });
                    setIsAddShiftModalOpen(true);
                  } : null}
                  onAddOvertime={isAdmin ? handleAddOvertime : null}
                  onShiftSwap={handleShiftSwap}
                  onShiftDelete={loadScheduleData}
                  isAdmin={isAdmin}
                  user={user}
                  loading={scheduleLoading}
                  className="overflow-x-auto"
                  holidayMap={holidayMap}
                  viewMode={preferences.viewMode}
                  onViewModeChange={preferences.setViewMode}
                  shiftDefinitions={shiftDefinitions}
                  getIdToken={getIdToken}
                  showAlert={showAlert}
                  showConfirm={showConfirm}
                />
              </div>
            ) : (
              /* Desktop Layout - Full Width with Popovers */
              <div className="w-full">
                {isAdmin && (
                  <GanttTimeline
                    assignments={scheduleData?.assignments || []}
                    leaves={leaves}
                    weekStart={weekStart}
                    employees={employees}
                    isAdmin={isAdmin}
                    shiftDefinitions={shiftDefinitions}
                    onShiftClick={handleShiftClick}
                  />
                )}
                <WeekGrid
                  weekStart={weekStart}
                  employees={employees}
                  visibleEmployeeIds={visibleEmployeeIds}
                  assignments={scheduleData?.assignments || []}
                  leaves={leaves}
                  selectedEmployeeId={selectedEmployeeId}
                  onShiftClick={handleShiftClick}
                  onAddShift={isAdmin ? (employee, date, shiftType) => {
                    setNewShiftData({
                      employeeId: employee?.id ? String(employee.id) : '',
                      date: date ? formatDate(date) : '',
                      shiftType: shiftType || ''
                    });
                    setIsAddShiftModalOpen(true);
                  } : null}
                  onAddOvertime={isAdmin ? handleAddOvertime : null}
                  onGenerateSchedule={isAdmin ? handleGenerateClick : null}
                  onClearWeek={isAdmin ? handleClearWeek : null}
                  onRemoveShiftsOnly={isAdmin ? handleRemoveShiftsOnly : null}
                  onShiftSwap={handleShiftSwap}
                  onShiftDelete={loadScheduleData}
                  isAdmin={isAdmin}
                  user={user}
                  loading={scheduleLoading}
                  // Popover props
                  isCalendarOpen={isCalendarOpen}
                  isEmployeeListOpen={isEmployeeListOpen}
                  onCalendarToggle={handleCalendarToggle}
                  onEmployeeListToggle={handleEmployeeListToggle}
                  onWeekSelect={handleWeekSelect}
                  onVisibilityChange={handleVisibilityChange}
                  onEmployeesChange={setEmployees}
                  onEmployeeSelect={handleEmployeeSelect}
                  scheduleData={scheduleData}
                  holidayMap={holidayMap}
                  viewMode={preferences.viewMode}
                  onViewModeChange={preferences.setViewMode}
                  shiftDefinitions={shiftDefinitions}
                  getIdToken={getIdToken}
                  showAlert={showAlert}
                  showConfirm={showConfirm}
                />
              </div>
            )}
          </>
        )}

        {/* Request Tab */}
        {activeTab === 'request' && (
          <RequestTab
            employees={employees}
            assignments={scheduleData?.assignments || []}
            weekStart={weekStart}
            onSwapRequest={loadScheduleData}
            isTestingAsEmployee={isTestingAsEmployee}
            showAlert={showAlert}
            showConfirm={showConfirm}
          />
        )}

        {/* Data Tab */}
        {activeTab === 'data' && (
          <DataTab
            employees={employees}
            assignments={scheduleData?.assignments || []}
            weekStart={weekStart}
            holidayMap={holidayMap}
          />
        )}

        {/* Settings Tab */}
        {isAdmin && activeTab === 'settings' && (
          <SettingsTab
            isAdmin={isAdmin}
            employees={employees}
          />
        )}

        {/* My Page Tab */}
        {activeTab === 'mypage' && (() => {
          // Enhanced employee matching logic with better fallbacks
          let matchedEmployee = null;

          if (user?.email && employees.length > 0) {
            const userEmail = user.email.toLowerCase().trim();
            const username = userEmail.split('@')[0];

            // Try 1: Exact email match (case-insensitive)
            matchedEmployee = employees.find(emp =>
              emp?.email && emp.email.toLowerCase().trim() === userEmail
            );

            // Try 2: Email starts with match (handles variations)
            if (!matchedEmployee) {
              matchedEmployee = employees.find(emp =>
                emp?.email && emp.email.toLowerCase().trim().startsWith(userEmail.split('@')[0])
              );
            }

            // Try 3: Name contains username (e.g., luka.japaridze matches "Luka Japaridze")
            if (!matchedEmployee) {
              const usernameParts = username.split(/[._-]/);
              matchedEmployee = employees.find(emp => {
                if (!emp?.name) return false;
                const empNameLower = emp.name.toLowerCase();
                return usernameParts.every(part => empNameLower.includes(part));
              });
            }

            // Try 4: Fuzzy match on first.last name pattern
            if (!matchedEmployee) {
              matchedEmployee = employees.find(emp => {
                if (!emp?.name) return false;
                const nameParts = emp.name.toLowerCase().split(/\s+/);
                return nameParts.some(part => username.includes(part));
              });
            }

            console.log('Employee matching for', userEmail, ':', {
              found: !!matchedEmployee,
              employeeName: matchedEmployee?.name,
              employeeId: matchedEmployee?.id,
              employeeEmail: matchedEmployee?.email,
              totalEmployees: employees.length,
              availableEmployees: employees.map(e => ({ id: e.id, name: e.name, email: e.email }))
            });
          }

          // Admin: resolve the employee to display (selected via dropdown, or own page)
          const displayEmployee = isAdmin && viewingEmployeeId
            ? employees.find(emp => String(emp.id) === String(viewingEmployeeId)) || matchedEmployee
            : matchedEmployee;

          // Sort employees alphabetically for the dropdown
          const sortedEmployees = [...employees].sort((a, b) =>
            (a.name || '').localeCompare(b.name || '')
          );

          return (
            <div>
              {isAdmin && employees.length > 0 && (
                <div className="flex items-center gap-3 px-4 md:px-6 pt-4 pb-2">
                  <label className="text-sm font-medium text-gray-600 whitespace-nowrap">Viewing:</label>
                  <select
                    value={viewingEmployeeId || ''}
                    onChange={e => setViewingEmployeeId(e.target.value || null)}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[180px]"
                  >
                    <option value="">My Page{matchedEmployee ? ` (${matchedEmployee.name})` : ''}</option>
                    {sortedEmployees
                      .filter(emp => !matchedEmployee || String(emp.id) !== String(matchedEmployee.id))
                      .map(emp => (
                        <option key={emp.id} value={String(emp.id)}>{emp.name}</option>
                      ))
                    }
                  </select>
                </div>
              )}
              <MyPage
                currentUser={user}
                employeeData={displayEmployee}
                assignments={scheduleData?.assignments || []}
                leaves={leaves}
                onShiftClick={handleShiftClick}
                isAdmin={isAdmin}
              />
            </div>
          );
        })()}
      </main>

      {/* Modals */}

      <Modal
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        shift={selectedShift}
        onReassign={handleShiftReassign}
        onDelete={handleShiftDelete}
        onAddLeave={isAdmin ? handleAddLeave : null}
        onDeleteLeave={isAdmin ? handleDeleteLeave : null}
        onSaveNotes={isAdmin ? handleSaveNotes : null}
        shiftNotes={selectedShift?.notes || ''}
        leaves={leaves}
        holidayInfo={selectedShift ? holidayMap.get(selectedShift.date || (selectedShift.start_datetime ? selectedShift.start_datetime.slice(0, 10) : '')) : null}
      />

      {/* Reassignment Confirmation Modal */}
      <GenericModal
        isOpen={isReassignConfirmOpen}
        onClose={() => { setIsReassignConfirmOpen(false); setReassignmentSource(null); setReassignmentTarget(null); }}
        title="Confirm Shift Reassignment"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-blue-800">Original Shift</h4>
              {reassignmentSource ? (
                <div className="text-sm text-blue-700 mt-2">
                  <div>{reassignmentSource.employee_name}</div>
                  <div className="text-xs text-gray-600">{formatDate(new Date(reassignmentSource.date))} • {reassignmentSource.shift_type}</div>
                </div>
              ) : (
                <div className="text-sm text-gray-500 mt-2">—</div>
              )}
            </div>

            <div className="p-3 bg-green-50 rounded-lg">
              <h4 className="font-medium text-green-800">Selected Shift</h4>
              {reassignmentTarget ? (
                <div className="text-sm text-green-700 mt-2">
                  <div>{reassignmentTarget.employee_name}</div>
                  <div className="text-xs text-gray-600">{formatDate(new Date(reassignmentTarget.date))} • {reassignmentTarget.shift_type}</div>
                </div>
              ) : (
                <div className="text-sm text-gray-500 mt-2">No shift selected</div>
              )}
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t">
            <button
              onClick={() => { setIsReassignConfirmOpen(false); setReassignmentSource(null); setReassignmentTarget(null); }}
              className="px-4 py-2 bg-white border rounded"
            >Cancel</button>

            <button
              onClick={async () => {
                if (!reassignmentSource || !reassignmentTarget) {
                  alert('Please select a target shift first');
                  return;
                }

                // Prevent duplicate submissions
                if (isSubmittingSwapRequest) {
                  return;
                }

                setIsSubmittingSwapRequest(true);

                const requestData = {
                  requester: reassignmentSource.employee_name,
                  requesterId: reassignmentSource.employee_id,
                  requesterEmail: user?.email || null,
                  targetEmployee: reassignmentTarget.employee_name,
                  targetEmployeeId: reassignmentTarget.employee_id,
                  originalShift: reassignmentSource,
                  targetShift: reassignmentTarget,
                  status: 'pending'
                };

                try {
                  const res = await firebaseDB.createShiftSwapRequest(requestData, user || null);
                  if (res?.success) {
                    // Send email to target employee about the request
                    try {
                      const formatShiftForEmail = (shift) => {
                        if (!shift) return { date: '', time: '', type: '' };
                        const date = new Date(shift.date);
                        const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                        const SHIFT_TIMES = {
                          morning: { start: '04:00', end: '13:00' },
                          day: { start: '10:00', end: '19:00' },
                          afternoon: { start: '15:00', end: '00:00' },
                          night: { start: '19:00', end: '04:00' }
                        };
                        const times = SHIFT_TIMES[shift.shift_type];
                        const timeStr = times ? `${times.start} - ${times.end}` : '00:00 - 00:00';
                        return { date: dateStr, time: timeStr, type: shift.shift_type };
                      };

                      const EMPLOYEE_EMAILS = {
                        'Nia Kavtaradze': 'nia.kavtaradze@example.com',
                        'Tamuna Janelidze': 'tamuna.janelidze@example.com',
                        'Nino Beridze': 'nino.beridze@example.com',
                        'Eka Tsiklauri': 'eka.tsiklauri@example.com',
                        'Mari Kutaladze': 'mari.kutaladze@example.com',
                        'Tako Kvirikashvili': 'tako.kvirikashvili@example.com',
                        'Teona Abashidze': 'teona.abashidze@example.com',
                        'Luka Japaridze': 'luka.japaridze@example.com',
                        'Tamta Gabunia': 'tamta.gabunia@example.com',
                        'Gvantsa Barbakadze': 'gvantsa.barbakadze@example.com',
                        'Lela Alavidze': 'lela.alavidze@example.com',
                        'Dato Lomidze': 'dato.lomidze@example.com',
                        'Irakli Kapanadze': 'irakli.kapanadze@example.com',
                        'Natia Chikhladze': 'natia.chikhladze@example.com'
                      };

                      const getEmployeeEmail = (employeeName) => {
                        const employeeRecord = employees?.find(e => e.name === employeeName);
                        if (employeeRecord && employeeRecord.email) return employeeRecord.email;
                        return EMPLOYEE_EMAILS[employeeName] || null;
                      };

                      const originalShift = formatShiftForEmail(reassignmentSource);
                      const targetShift = formatShiftForEmail(reassignmentTarget);
                      const targetEmail = getEmployeeEmail(reassignmentTarget.employee_name);

                      if (targetEmail) {
                        await notifySlack({
                          request_id: res.id,
                          target_email: targetEmail,
                          requester_name: reassignmentSource.employee_name,
                          original_shift: {
                            date: originalShift.date,
                            type: originalShift.type,
                            time: originalShift.time
                          },
                          target_shift: {
                            date: targetShift.date,
                            type: targetShift.type,
                            time: targetShift.time
                          }
                        }, getIdToken);
                      }
                    } catch (slackErr) {
                      console.error('Failed to send Slack notification:', slackErr);
                      // Don't fail the entire request if Slack notification fails
                    }

                    alert('Swap request created successfully!');
                    setIsReassignConfirmOpen(false);
                    setReassignmentSource(null);
                    setReassignmentTarget(null);
                  } else {
                    alert('Failed to create swap request: ' + (res?.error || 'unknown'));
                  }
                } catch (err) {
                  console.error('Failed to create swap request:', err);
                  alert('Failed to create swap request. Please try again.');
                } finally {
                  setIsSubmittingSwapRequest(false);
                }
              }}
              disabled={isSubmittingSwapRequest}
              className={`px-4 py-2 rounded text-white ${isSubmittingSwapRequest ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}

            >{isSubmittingSwapRequest ? 'Submitting...' : 'Confirm Swap Request'}</button>
          </div>
        </div>
      </GenericModal>

      <ConfirmationModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={() => { }}
        title="Confirm Action"
        message="Are you sure you want to proceed?"
        type="warning"
      />

      {/* Add Shift Modal */}
      <GenericModal
        isOpen={isAddShiftModalOpen}
        onClose={() => setIsAddShiftModalOpen(false)}
        title="Add New Shift"
      >
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            Add a shift for an employee. You'll be warned about any rule violations.
          </p>

          {/* Employee Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Employee
            </label>
            <select
              value={newShiftData.employeeId}
              onChange={(e) => setNewShiftData({ ...newShiftData, employeeId: e.target.value })}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select an employee...</option>
              {employees.map(employee => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Date
            </label>
            <input
              type="date"
              value={newShiftData.date}
              onChange={(e) => setNewShiftData({ ...newShiftData, date: e.target.value })}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Shift Type Selection - Clickable Cubes (2x3 Grid) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Shift Type
            </label>
            <div className="grid grid-cols-2 gap-3 shift-type-grid">
              {[
                { type: 'morning', icon: '🌅', label: 'Morning', time: '4:00 AM - 1:00 PM', bg: 'bg-amber-50', border: 'border-amber-300', selected: 'bg-amber-100 border-amber-500' },
                { type: 'day', icon: '☀️', label: 'Day', time: '10:00 AM - 7:00 PM', bg: 'bg-blue-50', border: 'border-blue-300', selected: 'bg-blue-100 border-blue-500' },
                { type: 'afternoon', icon: '🌆', label: 'Afternoon', time: '3:00 PM - 12:00 AM', bg: 'bg-orange-50', border: 'border-orange-300', selected: 'bg-orange-100 border-orange-500' },
                { type: 'night', icon: '🌙', label: 'Night', time: '7:00 PM - 4:00 AM', bg: 'bg-indigo-50', border: 'border-indigo-300', selected: 'bg-indigo-100 border-indigo-500' },
                { type: 'overtime', icon: '⚡', label: 'Overtime', time: 'Custom hours', bg: 'bg-purple-50', border: 'border-purple-300', selected: 'bg-purple-100 border-purple-500', isSpecial: true },
                { type: 'custom', icon: '💫', label: 'Custom', time: 'Custom setup', bg: 'bg-gray-50', border: 'border-gray-300', selected: 'bg-gray-100 border-gray-500', isSpecial: true }
              ].map(shift => (
                <button
                  key={shift.type}
                  onClick={() => {
                    if (shift.type === 'overtime') {
                      // Open overtime modal instead
                      setIsOvertimeModalFromAddShiftOpen(true);
                      setIsAddShiftModalOpen(false);
                    } else if (shift.type === 'custom') {
                      // Open custom shift modal
                      setIsCustomShiftModalOpen(true);
                      setIsAddShiftModalOpen(false);
                    } else {
                      setNewShiftData({ ...newShiftData, shiftType: shift.type });
                      // Auto-add shift if employee and date are selected
                      if (newShiftData.employeeId && newShiftData.date) {
                        handleAddShift(shift.type);
                      }
                    }
                  }}
                  className={`p-4 border-2 rounded-lg transition-all hover:shadow-md ${newShiftData.shiftType === shift.type
                    ? `${shift.selected} shadow-sm shift-selected`
                    : `${shift.bg} ${shift.border} hover:border-opacity-70`
                    }`}
                >
                  <div className="flex flex-col items-center space-y-2">
                    <span className="text-3xl">{shift.icon}</span>
                    <span className="font-semibold text-gray-800">{shift.label}</span>
                    <span className="text-xs text-gray-600">{shift.time}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </GenericModal>

      {/* Morning Shift Selection Modal */}
      <GenericModal
        isOpen={isMorningSelectionOpen}
        onClose={() => {
          setIsMorningSelectionOpen(false);
          setSelectedMorningEmployees([]);
        }}
        title="Select Morning Shift Employees"
        maxWidthClass="max-w-3xl"
        disableContentScroll={false}
      >
        <div className="relative">
          {/* Day limit popup - positioned so it doesn't affect layout */}
          {dayLimitPopup.visible && (
            <div className="absolute right-4 top-4 z-50 pointer-events-auto">
              <div className="px-3 py-2 bg-red-600 text-white text-sm rounded shadow-lg">
                {dayLimitPopup.message}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {/* Admin Notes Section */}
            {adminNotes && (
              <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <h4 className="font-semibold text-purple-900 mb-2">📝 Notes for This Week</h4>
                <p className="text-sm text-purple-800 whitespace-pre-wrap">{adminNotes}</p>
              </div>
            )}

            {/* Previous Week Morning Employees */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-medium text-blue-800 mb-2">Employees with morning shift in last week</h4>
              <div className="text-sm text-blue-700">
                {previousWeekMorningEmployees.length > 0 ? (
                  <ul className="list-disc list-inside space-y-1">
                    {previousWeekMorningEmployees.map(name => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="italic">No previous week data available</p>
                )}
              </div>
            </div>

            {/* Employees Needing Monday Break - worked Fri+Sat+Sun */}
            {employeesNeedingMondayBreak.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg">
                <h4 className="font-medium text-amber-800 mb-2">⚠️ Consider Monday break for these employees</h4>
                <p className="text-xs text-amber-600 mb-2">Worked Friday, Saturday, and Sunday last week</p>
                <div className="text-sm text-amber-700">
                  <ul className="list-disc list-inside space-y-1">
                    {employeesNeedingMondayBreak.map(emp => (
                      <li key={emp.name}>{emp.name} <span className="text-amber-500">({emp.detail})</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* High-Traffic Days Selector */}
            <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-lg p-4 mb-6">
              <div className="mb-3">
                <p className="text-gray-700 font-medium">🚀 High-Traffic Days</p>
                <p className="text-sm text-gray-600">Select 2 weekdays to prioritize for maximum staffing:</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      if (selectedHighTrafficDays.includes(index)) {
                        // Remove if already selected
                        setSelectedHighTrafficDays(selectedHighTrafficDays.filter(d => d !== index));
                      } else if (selectedHighTrafficDays.length < 2) {
                        // Add if not at limit
                        setSelectedHighTrafficDays([...selectedHighTrafficDays, index]);
                      }
                    }}
                    className={`px-4 py-2 rounded-md font-medium transition-all ${selectedHighTrafficDays.includes(index)
                      ? 'bg-orange-600 text-white shadow-md'
                      : 'bg-white border border-gray-300 text-gray-700 hover:border-orange-300'
                      } ${selectedHighTrafficDays.length >= 2 && !selectedHighTrafficDays.includes(index) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={selectedHighTrafficDays.length >= 2 && !selectedHighTrafficDays.includes(index)}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Selected: {selectedHighTrafficDays.length}/2 days • {selectedHighTrafficDays.map(d => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', ') || 'None'}
              </p>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-gray-600 text-sm">
                Choose exactly 7 employees who should work morning shifts (4:00 AM - 1:00 PM) this week:
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={handleSelectNonPreviousMorning}
                  className="px-3 py-1 text-xs bg-green-100 text-green-700 hover:bg-green-200 rounded-md transition-colors"
                  title="Select employees who didn't have morning shift last week"
                >
                  🔄 Select Non-Previous
                </button>
                <button
                  onClick={handleRandomMorningSelection}
                  className="px-3 py-1 text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-md transition-colors"
                  title="Randomly select 7 employees"
                >
                  🎲 Random
                </button>
              </div>
            </div>

            {/* Employee grid */}
            <div className="grid grid-cols-2 gap-3">
              {employees
                .filter(emp => visibleEmployeeIds.includes(emp.id))
                .map(employee => {
                  // Calculate max breaks allowed per day: total_employees - min_staff_per_shift
                  // Assuming min_staff is 1 for morning, we calculate conservatively
                  const totalEmployees = employees.filter(e => visibleEmployeeIds.includes(e.id)).length;
                  const minStaffPerDay = 1; // Conservative estimate
                  const maxBreaksPerDay = Math.max(1, totalEmployees - minStaffPerDay);

                  return (
                    <div key={employee.id} className="p-4 border rounded-lg bg-white">
                      <div className="flex items-center justify-between mb-3">
                        <label className="flex items-center space-x-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedMorningEmployees.includes(employee.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                if (selectedMorningEmployees.length < 7) {
                                  setSelectedMorningEmployees([...selectedMorningEmployees, employee.id]);
                                }
                              } else {
                                setSelectedMorningEmployees(
                                  selectedMorningEmployees.filter(id => id !== employee.id)
                                );
                              }
                            }}
                            disabled={!selectedMorningEmployees.includes(employee.id) && selectedMorningEmployees.length >= 7}
                            className="rounded"
                          />
                          <div>
                            <span className="text-sm font-medium">{employee.name}</span>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {pastMorningCounts[employee.id]
                                ? `🌅 Morning ${pastMorningCounts[employee.id]}x in past 3 weeks`
                                : '🌅 No morning shifts in past 3 weeks'}
                            </div>
                          </div>
                        </label>
                        <div className="text-xs text-gray-500">ID: {employee.id}</div>
                      </div>

                      <div className="space-y-3">
                        {/* Employee Notes - shown above Select Break */}
                        {employee.notes && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <div className="flex items-start space-x-2">
                              <span className="text-blue-600 text-sm">📝</span>
                              <div className="flex-1">
                                <p className="text-xs font-medium text-blue-800 mb-1">Note:</p>
                                <p className="text-sm text-blue-900">{employee.notes}</p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div>
                          <div role="heading" aria-level="5" className="text-sm font-medium text-gray-800">
                            Select Break
                          </div>
                        </div>

                        <div>
                          <div className="grid grid-cols-4 gap-2">
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                              <DayToggleButton key={day} employeeId={employee.id} label={day} maxBreaksPerDay={maxBreaksPerDay} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="flex justify-between items-center pt-4 border-t">
              <span className="text-sm text-gray-500">Selected: {selectedMorningEmployees.length}/7</span>
              <div className="flex space-x-2">
                <button
                  onClick={() => {
                    setIsMorningSelectionOpen(false);
                    setSelectedMorningEmployees([]);
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>

                <button
                  onClick={() => generateNewSchedule(selectedMorningEmployees, currentWeekDataForGeneration)}
                  disabled={selectedMorningEmployees.length !== 7 || loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scheduleLoading ? 'Generating...' : 'Generate Schedule'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </GenericModal>

      {/* Leave Modal */}
      <LeaveModal
        isOpen={isLeaveModalOpen}
        onClose={() => {
          setIsLeaveModalOpen(false);
          setLeaveShiftContext(null);
        }}
        shift={leaveShiftContext}
        onSubmit={handleSubmitLeave}
      />

      {/* Loading Bar - Shows during schedule generation */}
      <LoadingBar
        isVisible={scheduleLoading}
        message="Generating schedule..."
      />

      {/* Overtime Modal - From Add New Shift Modal */}
      <OvertimeModal
        isOpen={isOvertimeModalFromAddShiftOpen}
        onClose={() => {
          setIsOvertimeModalFromAddShiftOpen(false);
          setIsAddShiftModalOpen(true);
        }}
        onAddOvertime={(overtimeData) => {
          setIsOvertimeModalFromAddShiftOpen(false);
          setIsAddShiftModalOpen(false);
          if (handleAddOvertime) handleAddOvertime(overtimeData);
        }}
        employees={employees}
        weekStart={formatDate(weekStart)}
      />

      {/* Custom Shift Modal - From Add New Shift Modal */}
      <CustomShiftModal
        isOpen={isCustomShiftModalOpen}
        onClose={() => {
          setIsCustomShiftModalOpen(false);
          setIsAddShiftModalOpen(true);
        }}
        onAddCustomShift={(customShiftData) => {
          setIsCustomShiftModalOpen(false);
          setIsAddShiftModalOpen(false);
          handleAddCustomShift(customShiftData);
        }}
        employees={employees}
        weekStart={formatDate(weekStart)}
        prefilledEmployee={newShiftData.employeeId}
        prefilledDate={newShiftData.date}
      />

      {/* Alert Modal - Replaces window.alert() */}
      <AlertModal
        isOpen={alertState.isOpen}
        onClose={alertState.onClose}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
      />

      {/* Confirm Modal - Replaces window.confirm() */}
      <ConfirmationModal
        isOpen={confirmState.isOpen}
        onClose={confirmState.onCancel}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        type={confirmState.type}
      />
    </div>
  );
}
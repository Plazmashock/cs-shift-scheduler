/**
 * Week Grid Component
 * Main weekly calendar view showing employees and their shift assignments
 */

import { Fragment, useMemo, useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, Users, AlertCircle, Grid3x3, RotateCcw, ChevronLeft, ChevronRight, CalendarPlus, Download, Upload } from 'lucide-react';
import { loadGoogleScripts, requestAccessToken, exportMyShiftsToCalendar } from '../services/googleCalendar';
import * as firebaseDB from '../services/firebaseDatabase';
import { exportScheduleToCSV, importScheduleFromCSV } from '../utils/scheduleExportImport';
import { 
  getWeekDates, 
  formatDate, 
  getWeekdayNames, 
  isSameDate,
  formatTimeRange
} from '../utils/dateHelpers';
import ShiftCard, { EmptyShiftSlot, ShiftIndicator } from './ShiftCard';
import MonthCalendar from './MonthCalendar';
import EmployeeList from './EmployeeList';
import OvertimeModal from './OvertimeModal';
import { notifyScheduleReady } from '../services/api';
import { pushWeekDoc } from '../services/webhookService';

/**
 * WeekGrid Component
 * @param {Object} props - Component props
 * @param {Date} props.weekStart - Start date of the week (Monday)
 * @param {Array} props.employees - Array of employee objects
 * @param {Array} props.visibleEmployeeIds - IDs of employees to show
 * @param {Array} props.assignments - Shift assignments array
 * @param {Array} props.leaves - Leave records array
 * @param {Map} props.holidayMap - Map of date strings to holiday info
 * @param {number} props.selectedEmployeeId - ID of highlighted employee
 * @param {Function} props.onShiftClick - Handler for shift card clicks
 * @param {Function} props.onAddShift - Handler for adding new shifts
 * @param {Function} props.onAddOvertime - Handler for adding overtime shifts (admin only)
 * @param {Function} props.onShiftSwap - Handler for swapping shifts via drag-and-drop
 * @param {boolean} props.isAdmin - Whether current user is admin
 * @param {boolean} props.loading - Loading state
 * @param {string} props.className - Additional CSS classes
 * @param {boolean} props.isCalendarOpen - Calendar popover state
 * @param {boolean} props.isEmployeeListOpen - Employee list popover state
 * @param {Function} props.onCalendarToggle - Calendar popover toggle
 * @param {Function} props.onEmployeeListToggle - Employee list popover toggle
 * @param {Function} props.onWeekSelect - Week selection handler
 * @param {Function} props.onVisibilityChange - Employee visibility change handler
 * @param {Function} props.onEmployeesChange - Employees data change handler
 * @param {Function} props.onEmployeeSelect - Employee selection handler
 * @param {Object} props.scheduleData - Schedule data for employee list
 * @param {string} props.viewMode - View mode: 'by-employee' or 'by-shift' (controlled by parent)
 * @param {Function} props.onViewModeChange - View mode change handler
 */
export default function WeekGrid({
  weekStart,
  employees = [],
  visibleEmployeeIds = [],
  assignments = [],
  leaves = [],
  holidayMap = new Map(),
  selectedEmployeeId,
  onShiftClick,
  onAddShift,
  onAddOvertime,
  onGenerateSchedule,
  onClearWeek,
  onRemoveShiftsOnly,
  onShiftSwap,
  isAdmin = false,
  loading = false,
  className = '',
  user = null,
  // Popover props
  isCalendarOpen = false,
  isEmployeeListOpen = false,
  onCalendarToggle,
  onEmployeeListToggle,
  onWeekSelect,
  onVisibilityChange,
  onEmployeesChange,
  onEmployeeSelect,
  scheduleData,
  // View mode props (controlled by parent for persistence)
  viewMode = 'by-employee',
  onViewModeChange,
  onShiftDelete, // Callback when a shift is deleted (to refresh parent data)
  shiftDefinitions = null, // Shift definitions from Settings tab
  getIdToken = null, // Firebase auth token getter
  // Modal functions from App
  showAlert,
  showConfirm,
}) {
  const weekDates = getWeekDates(weekStart);
  const weekdayNames = getWeekdayNames();
  
  // File input ref for CSV import
  const fileInputRef = useRef(null);
  
  // CSV menu state
  const [isCSVMenuOpen, setIsCSVMenuOpen] = useState(false);
  
  // Overtime modal state
  const [isOvertimeModalOpen, setIsOvertimeModalOpen] = useState(false);
  
  // Google Calendar export state
  const [isExportingToCalendar, setIsExportingToCalendar] = useState(false);
  
  // CSV import state
  const [isImportingCSV, setIsImportingCSV] = useState(false);
  
  // Schedule menu state
  const [isScheduleMenuOpen, setIsScheduleMenuOpen] = useState(false);
  const scheduleMenuRef = useRef(null);
  
  // Scheduler visibility state
  const [isSchedulerHidden, setIsSchedulerHidden] = useState(false);

  // Bulk delete mode state
  const [isBulkDeleteMode, setIsBulkDeleteMode] = useState(false);
  const [deletedShifts, setDeletedShifts] = useState([]); // Track deleted shifts for undo

  // Drag-and-drop state
  const [draggedShift, setDraggedShift] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // {employeeId, date}
  
  // Mobile day navigation state
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [hoveredRowId, setHoveredRowId] = useState(null); // tracks hovered row for bg highlight
  
  // Shift type definitions
  const SHIFT_TYPES = [
    { key: 'morning', label: 'Morning', icon: '🌅' },
    { key: 'day', label: 'Day', icon: '☀️' },
    { key: 'afternoon', label: 'Afternoon', icon: '🌇' },
    { key: 'night', label: 'Night', icon: '🌙' },
    { key: 'overtime', label: 'Overtime', icon: '⚡' },
    { key: 'custom', label: 'Custom', icon: '💫' }
  ];
  
  // Maximum staff per shift type (from Settings tab or fallback defaults)
  const MAX_STAFF = useMemo(() => {
    if (shiftDefinitions) {
      return {
        morning: shiftDefinitions.morning?.max_staff || 1,
        day: shiftDefinitions.day?.max_staff || 4,
        afternoon: shiftDefinitions.afternoon?.max_staff || 4,
        night: shiftDefinitions.night?.max_staff || 5
      };
    }
    // Fallback defaults if shift definitions not loaded yet
    return {
      morning: 1,
      day: 4,
      afternoon: 4,
      night: 5
    };
  }, [shiftDefinitions]);
  
  // Calculate free shifts for a given date and shift type
  // Filter visible employees
  const visibleEmployees = employees.filter(emp => 
    emp && emp.id && visibleEmployeeIds.includes(emp.id)
  );

  // Group assignments by employee and date (for employee view)
  const assignmentsByEmployeeAndDate = useMemo(() => {
    const grouped = {};
    
    assignments.forEach(assignment => {
      const empId = assignment.employee_id;
      // Use date with fallback to start_datetime
      const date = assignment.date || (assignment.start_datetime ? assignment.start_datetime.slice(0, 10) : '');
      
      if (!grouped[empId]) grouped[empId] = {};
      if (!grouped[empId][date]) grouped[empId][date] = [];
      
      grouped[empId][date].push(assignment);
    });
    
    return grouped;
  }, [assignments]);

  // Group assignments by shift type and date (for shift view)
  const assignmentsByShiftAndDate = useMemo(() => {
    const grouped = {};
    
    assignments.forEach(assignment => {
      const shiftType = assignment.shift_type;
      // Use date with fallback to start_datetime
      const date = assignment.date || (assignment.start_datetime ? assignment.start_datetime.slice(0, 10) : '');
      
      if (!grouped[shiftType]) grouped[shiftType] = {};
      if (!grouped[shiftType][date]) grouped[shiftType][date] = [];
      
      grouped[shiftType][date].push(assignment);
    });
    
    return grouped;
  }, [assignments]);

  // Get assignments for a specific employee and date (employee view)
  const getAssignmentsForCell = (employeeId, date) => {
    const dateStr = formatDate(date);
    return assignmentsByEmployeeAndDate[employeeId]?.[dateStr] || [];
  };

  // Get assignments for a specific shift type and date (shift view)
  const getAssignmentsForShiftCell = (shiftType, date) => {
    const dateStr = formatDate(date);
    return assignmentsByShiftAndDate[shiftType]?.[dateStr] || [];
  };

  // Find leave for an assignment — prefers shift_id match (precise) over tuple fallback (legacy)
  // ✅ NEW: Handles imported leaves that don't have shift_type by matching just (employee_id, date)
  const findLeaveForAssignment = (assignment, assignmentDateStr) => {
    return leaves.find(leave => {
      // Priority 1: Match by shift_id (most precise)
      if (assignment.shift_id && leave.shift_id && leave.shift_id === assignment.shift_id) {
        return true;
      }

      // Priority 2: Match by shift_type (legacy exact match)
      if (!assignment.shift_id && !leave.shift_id &&
          leave.employee_id === assignment.employee_id &&
          leave.date === assignmentDateStr &&
          leave.shift_type === assignment.shift_type) {
        return true;
      }

      // Priority 3: Match by (employee_id, date) only — for imported leaves without shift_type
      // This allows imported leaves from external HR systems to display on any shift the employee has that day
      if (!assignment.shift_id && !leave.shift_id &&
          !leave.shift_type &&  // Leave has no shift_type (external import)
          leave.employee_id === assignment.employee_id &&
          leave.date === assignmentDateStr) {
        return true;
      }

      return false;
    });
  };

  // Detect if an employee has multiple different leaves on the same date (data issue)
  const hasMultipleLeavesOnSameDay = (employeeId, dateStr) => {
    const employeeLeaves = leaves.filter(leave => 
      leave.employee_id === employeeId && leave.date === dateStr
    );
    return employeeLeaves.length > 1;
  };

  // Get all employees with multiple leaves on the same day (for warning banner)
  const getEmployeesWithMultipleLeaves = () => {
    const conflicts = [];
    
    // Group ALL leaves by employee and date (not filtered by week)
    const groupedLeaves = {};
    leaves.forEach(leave => {
      const key = `${leave.employee_id}|${leave.date}`;
      if (!groupedLeaves[key]) {
        groupedLeaves[key] = [];
      }
      groupedLeaves[key].push(leave);
    });
    
    // Find entries with multiple leaves
    Object.entries(groupedLeaves).forEach(([key, leaveList]) => {
      if (leaveList.length > 1) {
        const [employeeId, date] = key.split('|');
        const employee = employees.find(e => e.id === employeeId);
        
        // Skip if employee not found (Unknown)
        if (!employee) return;
        
        conflicts.push({
          employeeId,
          employeeName: employee.name,
          date,
          leaves: leaveList
        });
      }
    });
    
    // Sort by date, then by employee name
    return conflicts.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.employeeName.localeCompare(b.employeeName);
    });
  };

  const multipleLeavesConflicts = getEmployeesWithMultipleLeaves();

  // Handle export to Google Calendar
  const handleExportToGoogleCalendar = async () => {
    if (!user || !user.email) {
      await showAlert('Please log in to export your shifts to Google Calendar.', 'Info', 'info');
      return;
    }

    if (assignments.length === 0) {
      await showAlert('No shifts to export. Please generate a schedule first.', 'Info', 'info');
      return;
    }

    try {
      setIsExportingToCalendar(true);
      
      console.log('Step 1: Loading Google API scripts...');
      await loadGoogleScripts();
      console.log('Step 2: Google API scripts loaded');
      
      console.log('Step 3: Requesting access token...');
      await requestAccessToken();
      console.log('Step 4: Access token received');
      
      console.log('Step 5: Exporting your shifts...', {
        userEmail: user.email,
        assignments: assignments.length
      });
      
      // Export only current user's shifts for this week
      const results = await exportMyShiftsToCalendar(assignments, user.email, employees, 'Asia/Tbilisi');
      console.log('Step 6: Export complete', results);
      
      // Show success message
      const message = `✅ Successfully exported ${results.success} of ${results.success + results.failed} shifts to your Google Calendar!` +
        (results.failed > 0 ? `\n\n⚠️ Failed: ${results.failed} shifts` : '');
      
      await showAlert(message, 'Success', 'success');
      
    } catch (error) {
      console.error('Calendar export failed:', error);
      console.error('Error details:', {
        message: error?.message,
        stack: error?.stack,
        error: error?.error,
        type: typeof error
      });
      
      if (error?.error === 'popup_closed_by_user') {
        await showAlert('Export cancelled. Please try again and allow access to your Google Calendar.', 'Info', 'info');
      } else if (error?.error === 'access_denied') {
        await showAlert('Access denied. Please allow the app to access your Google Calendar.', 'Warning', 'warning');
      } else {
        await showAlert(`Failed to export to Google Calendar: ${error?.message || JSON.stringify(error)}`, 'Error', 'error');
      }
    } finally {
      setIsExportingToCalendar(false);
    }
  };

  // Drag-and-drop handlers
  const handleDragStart = (assignment) => {
    if (!isAdmin) return;
    setDraggedShift(assignment);
  };

  const handleDragEnd = () => {
    if (!isAdmin) return;
    setDraggedShift(null);
    setDropTarget(null);
  };

  const handleDragOver = (e, employeeId, date) => {
    if (!isAdmin) return;
    // Only allow drop in by-employee view
    if (viewMode !== 'by-employee') return;
    
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const dateStr = formatDate(date);
    setDropTarget({ employeeId, date: dateStr });
  };

  const handleDragLeave = () => {
    if (!isAdmin) return;
    setDropTarget(null);
  };

  const handleDrop = (e, targetEmployeeId, targetDate) => {
    if (!isAdmin) return;
    e.preventDefault();
    
    // Only allow drop in by-employee view
    if (viewMode !== 'by-employee' || !draggedShift || !onShiftSwap) return;
    
    const targetDateStr = formatDate(targetDate);
    
    // Don't do anything if dropping on the same cell
    if (draggedShift.employee_id === targetEmployeeId && draggedShift.date === targetDateStr) {
      setDraggedShift(null);
      setDropTarget(null);
      return;
    }
    
    // Find the target shift (if any) in the same cell
    const targetShift = assignments.find(a => 
      a.employee_id === targetEmployeeId && 
      a.date === targetDateStr &&
      a.shift_type === draggedShift.shift_type // Same shift type
    );
    
    // Call the swap handler
    onShiftSwap(draggedShift, targetShift, targetEmployeeId, targetDateStr);
    
    setDraggedShift(null);
    setDropTarget(null);
  };

  // Handle CSV export
  const handleExportCSV = () => {
    exportScheduleToCSV(assignments, weekStart, leaves);
  };

  // Handle CSV import
  const handleImportCSV = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImportingCSV(true);
    try {
      const importedAssignments = await importScheduleFromCSV(file);
      
      // Extract leaves from the import result
      const importedLeaves = importedAssignments._leaves || [];
      
      console.log('🔍 CSV IMPORT DEBUG - Imported assignments:', importedAssignments);
      console.log('🔍 CSV IMPORT DEBUG - Imported leaves:', importedLeaves);
      console.log('🔍 CSV IMPORT DEBUG - Current weekStart:', weekStart);
      console.log('🔍 CSV IMPORT DEBUG - Current assignments count:', assignments.length);
      
      // Ask user to confirm import
      const message = `Import ${importedAssignments.length} shifts from "${file.name}"?\n\nThis will add/replace shifts in the current schedule.`;
      if (await showConfirm(message, 'Import Shifts')) {
        // Create merged schedule data (same format as the main app uses)
        const mergedAssignments = [...assignments];
        let addedCount = 0;
        
        importedAssignments.forEach(imported => {
          // Check if this assignment already exists
          const existingIndex = mergedAssignments.findIndex(a => 
            a.date === imported.date && 
            a.shift_type === imported.shift_type && 
            a.employee_id === imported.employee_id
          );

          if (existingIndex >= 0) {
            // Replace existing, preserving notes if not in import
            const existing = mergedAssignments[existingIndex];
            mergedAssignments[existingIndex] = {
              ...imported,
              notes: imported.notes || existing.notes || ''
            };
            console.log(`🔍 Replacing assignment for ${imported.employee_name} on ${imported.date}`);
          } else {
            // Add new
            mergedAssignments.push(imported);
            addedCount++;
            console.log(`🔍 Adding new assignment for ${imported.employee_name} on ${imported.date}`);
          }
        });

        console.log('🔍 CSV IMPORT DEBUG - Merged assignments count:', mergedAssignments.length);
        console.log('🔍 CSV IMPORT DEBUG - Final merged data:', mergedAssignments);

        // Save merged assignments AND leaves to Firebase
        try {
          const weekKey = formatDate(weekStart);
          console.log('🔍 CSV IMPORT DEBUG - Saving with weekKey:', weekKey);
          
          // Merge existing leaves with imported leaves
          const mergedLeaves = [...leaves];
          importedLeaves.forEach(importedLeave => {
            // Check if this leave already exists
            const existingLeaveIndex = mergedLeaves.findIndex(l =>
              l.employee_id === importedLeave.employee_id &&
              l.date === importedLeave.date
            );

            if (existingLeaveIndex >= 0) {
              // Replace existing leave
              mergedLeaves[existingLeaveIndex] = importedLeave;
              console.log(`🔍 Updating leave for employee ${importedLeave.employee_id} on ${importedLeave.date}`);
            } else {
              // Add new leave
              mergedLeaves.push(importedLeave);
              console.log(`🔍 Adding new leave for employee ${importedLeave.employee_id} on ${importedLeave.date}`);
            }
          });
          
          // Build schedule data object (same format as saveScheduleToFirebase expects)
          const scheduleData = {
            week: weekKey,
            assignments: mergedAssignments,
            leaves: mergedLeaves,
            updated: new Date().toISOString()
          };
          
          const res = await firebaseDB.saveScheduleToFirebase(weekKey, scheduleData, null);
          
          if (!res || !res.success) {
            throw new Error(res?.error || 'Unknown save error');
          }
          
          console.log('🔍 CSV IMPORT DEBUG - Save completed, reloading in 1 second...');
          
          const leaveMessage = importedLeaves.length > 0 ? `\nImported ${importedLeaves.length} leave records.` : '';
          await showAlert(`Successfully imported ${importedAssignments.length} shifts!${leaveMessage}\n\nAdded: ${addedCount} new shifts\nUpdated: ${importedAssignments.length - addedCount} existing shifts\n\nReloading...`, 'Success', 'success');
          
          // Wait 1 second to ensure Firebase write completes, then reload
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        } catch (saveError) {
          await showAlert(`Failed to save imported shifts: ${saveError.message}`, 'Error', 'error');
          console.error('Save error:', saveError);
        }
      }
    } catch (error) {
      await showAlert(`Import failed: ${error.message}`, 'Error', 'error');
      console.error('CSV import error:', error);
    } finally {
      setIsImportingCSV(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Close CSV menu when clicking outside
  const csvMenuRef = useRef(null);
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (csvMenuRef.current && !csvMenuRef.current.contains(event.target)) {
        setIsCSVMenuOpen(false);
      }
    };

    if (isCSVMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isCSVMenuOpen]);

  // Close Schedule menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (scheduleMenuRef.current && !scheduleMenuRef.current.contains(event.target)) {
        setIsScheduleMenuOpen(false);
      }
    };

    if (isScheduleMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isScheduleMenuOpen]);

  // Load scheduler visibility state from Firebase for THIS WEEK
  useEffect(() => {
    const loadSchedulerVisibility = async () => {
      try {
        const weekStartStr = formatDate(weekStart);
        const isHidden = await firebaseDB.getWeekSchedulerVisibility(weekStartStr);
        setIsSchedulerHidden(isHidden);
      } catch (err) {
        console.error('Failed to load scheduler visibility:', err);
      }
    };
    loadSchedulerVisibility();
  }, [weekStart]);
  
  // Save scheduler visibility state to Firebase for THIS WEEK
  const toggleSchedulerVisibility = async () => {
    try {
      const weekStartStr = formatDate(weekStart);
      const newState = !isSchedulerHidden;
      await firebaseDB.setWeekSchedulerVisibility(weekStartStr, newState);
      setIsSchedulerHidden(newState);
    } catch (err) {
      console.error('Failed to toggle scheduler visibility:', err);
      await showAlert('Failed to change scheduler visibility', 'Error', 'error');
    }
  };

  // Bulk delete handlers
  const handleDeleteShift = async (assignment) => {
    try {
      const weekStartStr = formatDate(weekStart);
      console.log('🗑️ Deleting shift:', { 
        weekStart: weekStartStr, 
        employeeId: assignment.employee_id, 
        shiftType: assignment.shift_type,
        date: assignment.date,
        assignmentData: assignment 
      });
      
      // Remove from Firebase - pass full assignment data for precise matching
      const result = await firebaseDB.deleteShift(
        weekStartStr, 
        assignment.employee_id, 
        null, // shiftId not used
        assignment // pass full assignment for matching
      );
      console.log('Delete result:', result);
      
      if (result.success) {
        console.log('✅ Shift deleted successfully');
        // Track for undo
        setDeletedShifts([...deletedShifts, { ...assignment, weekStart: weekStartStr }]);
        // Notify parent to reload schedule data
        if (onShiftDelete) {
          onShiftDelete();
        }
      } else {
        console.error('❌ Delete failed:', result.error);
        await showAlert(`Failed to delete shift: ${result.error}`, 'Error', 'error');
      }
    } catch (err) {
      console.error('❌ Exception during delete:', err);
      await showAlert('Failed to delete shift: ' + err.message, 'Error', 'error');
    }
  };

  const handleUndoDelete = async () => {
    if (deletedShifts.length === 0) return;
    
    try {
      const lastDeleted = deletedShifts[deletedShifts.length - 1];
      const { weekStart: weekStartStr, ...shiftData } = lastDeleted;
      // Restore to Firebase
      await firebaseDB.saveShiftToWeek(weekStartStr, lastDeleted.employee_id, shiftData);
      // Remove from deleted list
      setDeletedShifts(deletedShifts.slice(0, -1));
    } catch (err) {
      console.error('Failed to undo delete:', err);
      await showAlert('Failed to undo delete', 'Error', 'error');
    }
  };

  const handleCancelBulkDelete = () => {
    setIsBulkDeleteMode(false);
    // Note: deletions are permanent; undo is available during the session
  };

  // Calculate daily summaries
  const dailySummaries = useMemo(() => {
    return weekDates.map(date => {
      const dateStr = formatDate(date);
      const dayAssignments = assignments.filter(a => a.date === dateStr);
      
      // Create a set of employee IDs that have all-day leaves on this date
      const allDayLeaveEmployees = new Set();
      (leaves || []).forEach(leave => {
        if (leave.date === dateStr && leave.timeframe === 'all-day') {
          allDayLeaveEmployees.add(leave.employee_id);
        }
      });
      
      const summary = {
        morning: 0,
        day: 0, 
        afternoon: 0,
        night: 0
      };
      
      dayAssignments.forEach(assignment => {
        // Skip counting this shift if the employee has an all-day leave on this date
        if (!allDayLeaveEmployees.has(assignment.employee_id) && summary.hasOwnProperty(assignment.shift_type)) {
          summary[assignment.shift_type]++;
        }
      });
      
      return { date, summary };
    });
  }, [weekDates, assignments, leaves]);

  if (loading) {
    return (
      <div className={`bg-white border border-gray-200 rounded-lg p-8 ${className}`}>
        <div className="flex items-center justify-center space-x-3 text-gray-500">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <span>Generating schedule...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white border border-gray-200 rounded-lg overflow-hidden ${className}`}>
      {/* Bulk Delete Mode Banner */}
      {isBulkDeleteMode && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="bg-red-50 border-b-2 border-red-300 px-4 py-3 flex items-center justify-between"
        >
          <div className="flex items-center space-x-2 text-red-700">
            <AlertCircle size={18} />
            <span className="font-semibold">Bulk Delete Mode: Click any shift to delete it immediately</span>
          </div>
          <div className="flex items-center space-x-2">
            {deletedShifts.length > 0 && (
              <button
                onClick={handleUndoDelete}
                className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium flex items-center space-x-1"
              >
                <RotateCcw size={14} />
                <span>Undo ({deletedShifts.length})</span>
              </button>
            )}
            <button
              onClick={handleCancelBulkDelete}
              className="px-3 py-1.5 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      {/* Header with week navigation and summary */}
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          {/* Week Navigation - Hidden on Mobile (using CompactMonthSelector instead) */}
          <div className="hidden md:flex items-center space-x-2 relative">
            {/* Previous Week Arrow */}
            <button
              onClick={() => {
                const prevWeek = new Date(weekStart);
                prevWeek.setDate(prevWeek.getDate() - 7);
                onWeekSelect && onWeekSelect(prevWeek);
              }}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors flex-shrink-0"
              aria-label="Previous week"
              title="Previous week"
            >
              <ChevronLeft size={20} />
            </button>

            {/* Week Selector */}
            <div className="flex items-center space-x-2 flex-1 min-w-0">
              <Calendar size={18} className="text-gray-600 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <button
                  onClick={onCalendarToggle}
                  data-popover-trigger="calendar"
                  className="text-left cursor-pointer hover:text-blue-600 transition-colors w-full"
                >
                  <div className="flex items-center space-x-2">
                    <h2 className="font-semibold text-gray-900 hover:text-blue-600 text-sm md:text-base truncate">
                      Week of {formatDate(weekStart, 'MMMM d, yyyy')}
                    </h2>
                    {isSchedulerHidden && (
                      <span className="inline-block px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded">
                        🚫 HIDDEN
                      </span>
                    )}
                  </div>
                  <p className="text-xs md:text-sm text-gray-600">
                    {formatDate(weekStart, 'MMM d')} - {formatDate(weekDates[6], 'MMM d, yyyy')}
                  </p>
                </button>
              </div>
            </div>

            {/* Next Week Arrow */}
            <button
              onClick={() => {
                const nextWeek = new Date(weekStart);
                nextWeek.setDate(nextWeek.getDate() + 7);
                onWeekSelect && onWeekSelect(nextWeek);
              }}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors flex-shrink-0"
              aria-label="Next week"
              title="Next week"
            >
              <ChevronRight size={20} />
            </button>

            {/* Calendar Popover */}
            {isCalendarOpen && onWeekSelect && (
              <div 
                data-popover="calendar"
                className="absolute top-full left-0 mt-2 z-50 shadow-xl rounded-lg border border-gray-200 bg-white"
                style={{ minWidth: '320px' }}
              >
                <MonthCalendar
                  selectedWeekStart={weekStart}
                  onWeekSelect={onWeekSelect}
                />
              </div>
            )}
          </div>
          
          {/* Stats and Actions - Full width on mobile */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between md:justify-start md:space-x-4 gap-2 md:gap-0 text-sm text-gray-600">
            {/* Stats Section */}
            <div className="flex items-center justify-around md:justify-start md:space-x-4">
              <div className="relative">
                <button
                  onClick={onEmployeeListToggle}
                  data-popover-trigger="employees"
                  className="flex items-center space-x-1 cursor-pointer hover:text-blue-600 transition-colors"
                >
                  <Users size={16} />
                  <span className="hover:text-blue-600">{visibleEmployees.length} employees</span>
                </button>

                {/* Employee List Popover */}
                {isEmployeeListOpen && onVisibilityChange && onEmployeesChange && onEmployeeSelect && (
                  <div 
                    data-popover="employees"
                    className="absolute top-full right-0 mt-2 z-50 shadow-xl rounded-lg border border-gray-200 bg-white overflow-y-auto"
                    style={{ minWidth: '320px', maxHeight: '500px' }}
                  >
                    <EmployeeList
                      employees={employees}
                      visibleEmployeeIds={visibleEmployeeIds}
                      onVisibilityChange={onVisibilityChange}
                      onEmployeesChange={onEmployeesChange}
                      selectedEmployeeId={selectedEmployeeId}
                      onEmployeeSelect={onEmployeeSelect}
                      scheduleData={scheduleData}
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-1">
                <Clock size={16} className="flex-shrink-0" />
                <span className="whitespace-nowrap">{assignments.length} shifts</span>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex items-center justify-center md:justify-start space-x-2 flex-wrap gap-2">
              {/* Schedule Menu Dropdown */}
              {onAddShift && (
                <div className="relative" ref={scheduleMenuRef}>
                  <button
                    onClick={() => setIsScheduleMenuOpen(!isScheduleMenuOpen)}
                    className="flex items-center space-x-1 md:space-x-2 px-2 md:px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap"
                    title="Schedule Options"
                  >
                    <span className="text-xs">📅</span>
                    <span className="text-xs font-medium hidden md:inline">Schedule</span>
                  </button>

                  {/* Dropdown Menu */}
                  {isScheduleMenuOpen && (
                    <div className="absolute left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50">
                      {/* Generate Shift Option */}
                      {isAdmin && onGenerateSchedule && (
                        <button
                          onClick={() => {
                            onGenerateSchedule();
                            setIsScheduleMenuOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100 flex items-center space-x-2 transition-colors"
                        >
                          <span className="text-xs">🔄</span>
                          <span>Generate Shift</span>
                        </button>
                      )}

                      {/* Clear Week Option */}
                      {isAdmin && onClearWeek && (
                        <button
                          onClick={() => {
                            onClearWeek();
                            setIsScheduleMenuOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 border-b border-gray-100 flex items-center space-x-2 transition-colors"
                        >
                          <span className="text-xs">❌</span>
                          <span>Clear Week</span>
                        </button>
                      )}

                      {/* Remove Shifts Only Option */}
                      {isAdmin && onRemoveShiftsOnly && (
                        <button
                          onClick={() => {
                            onRemoveShiftsOnly();
                            setIsScheduleMenuOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-orange-600 hover:bg-orange-50 border-b border-gray-100 flex items-center space-x-2 transition-colors"
                        >
                          <span className="text-xs">🗑️</span>
                          <span>Remove Shifts Only</span>
                        </button>
                      )}

                      {/* Add Shift Option */}
                      <button
                        onClick={() => {
                          onAddShift();
                          setIsScheduleMenuOpen(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100 flex items-center space-x-2 transition-colors"
                      >
                        <span className="text-xs">➕</span>
                        <span>Add Shift</span>
                      </button>

                      {/* Add Overtime Option */}
                      {isAdmin && onAddOvertime && (
                        <button
                          onClick={() => {
                            setIsOvertimeModalOpen(true);
                            setIsScheduleMenuOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 flex items-center space-x-2 transition-colors"
                        >
                          <span className="text-xs">⚡</span>
                          <span>Add Overtime</span>
                        </button>
                      )}

                      {/* Divider for admin-only options */}
                      {isAdmin && <div className="border-t border-gray-100"></div>}

                      {/* Bulk Remove Button (Admin Only) */}
                      {isAdmin && (
                        <button
                          onClick={() => {
                            setIsBulkDeleteMode(true);
                            setIsScheduleMenuOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm flex items-center space-x-2 transition-colors text-red-600 hover:bg-red-50"
                        >
                          <span className="text-xs">🗑️</span>
                          <span>Bulk Remove</span>
                        </button>
                      )}

                      {/* Hide/Unhide Scheduler Option (Admin Only) */}
                      {isAdmin && (
                        <button
                          onClick={async () => {
                            setIsScheduleMenuOpen(false);
                            if (isSchedulerHidden) {
                              // Showing the scheduler — ask about notification
                              const weekLabel = formatDate(weekStart);
                              const sendNotif = await showConfirm(
                                'Send schedule-ready notification to all employees via Slack?',
                                'Notify Employees?'
                              );
                              await toggleSchedulerVisibility();

                              // Push week data to KPI dashboard whenever schedule is shown
                              try {
                                const weekStartStr = formatDate(weekStart);
                                await pushWeekDoc(weekStartStr, assignments, leaves);
                              } catch (kpiErr) {
                                console.warn('KPI push failed (non-critical):', kpiErr?.message);
                              }

                              if (sendNotif && getIdToken) {
                                try {
                                  // Format week label nicely e.g. "April 21 – April 27"
                                  const start = new Date(weekStart);
                                  const end = new Date(weekStart);
                                  end.setDate(end.getDate() + 6);
                                  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
                                  const label = `${fmt(start)} – ${fmt(end)}`;
                                  const result = await notifyScheduleReady(label, getIdToken);
                                  await showAlert(`✅ Notifications sent to ${result.sent} employee(s).`, 'Done', 'success');
                                } catch (err) {
                                  await showAlert(`Failed to send notifications: ${err.message}`, 'Error', 'error');
                                }
                              }
                            } else {
                              await toggleSchedulerVisibility();
                            }
                          }}
                          className={`w-full text-left px-4 py-2 text-sm flex items-center space-x-2 transition-colors ${
                            isSchedulerHidden 
                              ? 'text-green-600 hover:bg-green-50' 
                              : 'text-orange-600 hover:bg-orange-50'
                          }`}
                        >
                          <span className="text-xs">{isSchedulerHidden ? '👁️' : '🚫'}</span>
                          <span>{isSchedulerHidden ? 'Show Scheduler' : 'Hide Scheduler'}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Export to Google Calendar Button (All Users) */}
              {user && assignments.length > 0 && (
                <button
                  onClick={handleExportToGoogleCalendar}
                  disabled={isExportingToCalendar}
                  className="flex items-center space-x-1 md:space-x-2 px-2 md:px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Export all shifts to Google Calendar"
                >
                  {isExportingToCalendar ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                      <span className="text-xs font-medium hidden md:inline">Exporting...</span>
                    </>
                  ) : (
                    <>
                      <CalendarPlus size={14} />
                      <span className="text-xs font-medium hidden md:inline">Google Calendar</span>
                    </>
                  )}
                </button>
              )}

              {/* CSV Menu Dropdown (Admin Only) */}
              {isAdmin && (
                <div className="relative" ref={csvMenuRef}>
                  <button
                    onClick={() => setIsCSVMenuOpen(!isCSVMenuOpen)}
                    className="flex items-center space-x-1 md:space-x-2 px-2 md:px-3 py-1.5 bg-gray-700 text-white rounded-md hover:bg-gray-800 transition-colors whitespace-nowrap"
                    title="CSV Export/Import options"
                  >
                    <Download size={14} />
                    <span className="text-xs font-medium">CSV</span>
                  </button>

                  {/* Dropdown Menu */}
                  {isCSVMenuOpen && (
                    <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-50">
                      {/* Export Option */}
                      {assignments.length > 0 && (
                        <button
                          onClick={() => {
                            handleExportCSV();
                            setIsCSVMenuOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100 flex items-center space-x-2 transition-colors"
                        >
                          <Download size={14} />
                          <span>Export Week</span>
                        </button>
                      )}

                      {/* Import Option */}
                      <button
                        onClick={() => {
                          fileInputRef.current?.click();
                          setIsCSVMenuOpen(false);
                        }}
                        disabled={isImportingCSV}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2 transition-colors disabled:opacity-50"
                      >
                        <Upload size={14} />
                        <span>{isImportingCSV ? 'Importing...' : 'Import Week'}</span>
                      </button>
                    </div>
                  )}

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleImportCSV}
                    style={{ display: 'none' }}
                    aria-label="Import CSV file"
                  />
                </div>
              )}
              
              {/* Layout Toggle Button */}
              <button
                onClick={() => onViewModeChange && onViewModeChange(viewMode === 'by-employee' ? 'by-shift' : 'by-employee')}
                className="flex items-center space-x-1 md:space-x-2 px-2 md:px-3 py-1.5 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors whitespace-nowrap"
                title={viewMode === 'by-employee' ? 'Switch to Shift Type View' : 'Switch to Employee View'}
              >
                <RotateCcw size={14} />
                <span className="text-xs font-medium hidden md:inline">
                  {viewMode === 'by-employee' ? 'By Shift' : 'By Employee'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Multiple Leaves Warning Banner */}
      {multipleLeavesConflicts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="bg-red-50 border-t border-b border-red-200 dark:bg-red-900/20 dark:border-red-800"
        >
          <div className="px-4 py-3">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 mt-0.5">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2">
                  ⚠️ Multiple Leave Entries Detected
                </h3>
                <p className="text-xs text-red-700 dark:text-red-400 mb-3">
                  The following employees have multiple different leave entries on the same day. This may indicate a data issue:
                </p>
                <div className="space-y-2">
                  {multipleLeavesConflicts.map((conflict, index) => (
                    <div 
                      key={`${conflict.employeeId}-${conflict.date}`}
                      className="bg-white dark:bg-gray-800 rounded-md p-3 border border-red-200 dark:border-red-700"
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:space-x-4 space-y-1 md:space-y-0">
                        {/* Employee and Date */}
                        <div className="flex items-center space-x-2 min-w-[200px]">
                          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                            {conflict.employeeName}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">•</span>
                          <span className="text-sm text-gray-700 dark:text-gray-300">
                            {formatDate(new Date(conflict.date + 'T00:00:00'), 'MMM d, yyyy')}
                          </span>
                        </div>
                        
                        {/* Leave Details */}
                        <div className="flex-1 flex flex-wrap gap-2">
                          {conflict.leaves.map((leave, leaveIndex) => {
                            const timeframeLabel = {
                              'all-day': 'Full Day',
                              'first-half': 'First Half',
                              'second-half': 'Second Half',
                              'other': `Custom (${leave.custom_start || ''}-${leave.custom_end || ''})`
                            }[leave.timeframe] || leave.timeframe;
                            
                            const shiftTypeLabel = leave.shift_type 
                              ? ` (${leave.shift_type})` 
                              : '';
                            
                            return (
                              <span
                                key={`${leave.employee_id}-${leave.date}-${leaveIndex}`}
                                className="inline-flex items-center px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-xs font-medium rounded border border-red-300 dark:border-red-700"
                              >
                                {timeframeLabel}{shiftTypeLabel}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Mobile Day Navigation - Only on Mobile */}
      <div className="md:hidden bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedDayIndex(Math.max(0, selectedDayIndex - 1))}
            disabled={selectedDayIndex === 0}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous day"
          >
            <ChevronLeft size={20} />
          </button>
          
          <div className="text-center">
            <div className="font-semibold text-gray-900 text-base">
              {weekdayNames[selectedDayIndex]}
            </div>
            <div className="text-sm text-gray-600">
              {formatDate(weekDates[selectedDayIndex], 'MMM d, yyyy')}
            </div>
            {holidayMap.has(formatDate(weekDates[selectedDayIndex])) && (
              <div className="mt-1 text-xs text-amber-700 font-medium">
                🎉 {holidayMap.get(formatDate(weekDates[selectedDayIndex])).name}
              </div>
            )}
          </div>
          
          <button
            onClick={() => setSelectedDayIndex(Math.min(6, selectedDayIndex + 1))}
            disabled={selectedDayIndex === 6}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next day"
          >
            <ChevronRight size={20} />
          </button>
        </div>
        
        {/* Day dots indicator */}
        <div className="flex justify-center space-x-2 mt-3">
          {weekDates.map((_, index) => (
            <button
              key={index}
              onClick={() => setSelectedDayIndex(index)}
              className={`w-2 h-2 rounded-full transition-all ${
                index === selectedDayIndex 
                  ? 'bg-blue-600 w-6' 
                  : 'bg-gray-300 hover:bg-gray-400'
              }`}
              aria-label={`Go to ${weekdayNames[index]}`}
            />
          ))}
        </div>
      </div>

      {/* Desktop Grid - Hidden on Mobile */}
      {/* Single shared-grid container: header + all data rows use the same column tracks */}
      <div className="hidden md:block overflow-x-auto">
        <div
          className="grid min-w-max"
          style={{ gridTemplateColumns: '150px repeat(7, minmax(120px, 1fr))' }}
        >
          {/* ── Header row: Fragment = zero DOM nodes, cells go straight into the shared grid ── */}
          <Fragment>
            {/* Label column header */}
            <div className="px-4 py-4 border-r border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
              <span className="text-sm font-medium text-gray-700">
                {viewMode === 'by-employee' ? 'Employee' : 'Shift Type'}
              </span>
            </div>
          {/* Day headers */}
          {weekDates.map((date, index) => {
            const isToday = isSameDate(date, new Date());
            const dateStr = formatDate(date);
            const isHoliday = holidayMap.has(dateStr);
            const holidayInfo = holidayMap.get(dateStr);
            
            return (
              <div 
                key={date.toISOString()}
                className={`px-3 py-4 text-center border-r border-b border-gray-200 ${
                  isHoliday ? 'bg-amber-100' : isToday ? 'bg-blue-50' : 'bg-gray-50'
                }`}
              >
                <div className={`font-medium text-xs md:text-sm ${
                  isHoliday ? 'text-amber-800' : isToday ? 'text-blue-700' : 'text-gray-900'
                }`}>
                  {weekdayNames[index]}
                </div>
                <div className={`text-xs ${
                  isHoliday ? 'text-amber-700' : isToday ? 'text-blue-600' : 'text-gray-500'
                }`}>
                  {formatDate(date, 'MMM d')}
                </div>
                
                {/* Holiday indicator */}
                {isHoliday && holidayInfo && (
                  <div className="mt-1 text-xs text-amber-700 font-medium truncate" title={holidayInfo.name}>
                    🎉 {holidayInfo.name.length > 12 ? holidayInfo.name.substring(0, 12) + '...' : holidayInfo.name}
                  </div>
                )}
                
                {/* Daily summary indicators */}
                <div className="mt-2 grid grid-cols-2 gap-1 max-w-fit mx-auto">
                  {Object.entries(dailySummaries[index].summary).map(([shiftType, count]) => (
                    count > 0 && (
                      <ShiftIndicator 
                        key={shiftType}
                        shiftType={shiftType}
                        count={count}
                        className="text-xs"
                      />
                    )
                  ))}
                </div>
              </div>
            );
          })}
          </Fragment>{/* end header */}

          {/* ── Data rows: keyed Fragments = zero DOM, cells are true grid children ── */}
          {isSchedulerHidden && !isAdmin ? (
            /* Hidden week message — span all 8 columns */
            <div className="col-span-full flex items-center justify-center h-96 bg-white border border-gray-200">
              <div className="text-center space-y-3">
                <p className="text-lg text-gray-600">The shift is being finalized.</p>
                <p className="text-lg text-gray-600">Please wait for an update</p>
              </div>
            </div>
          ) : viewMode === 'by-employee' ? (
          /* Employee View Mode */
          visibleEmployees.length === 0 ? (
            /* Empty State — span all 8 columns */
            <div className="col-span-full p-8 text-center text-gray-500">
              <Users size={32} className="mx-auto mb-3 text-gray-300" />
              <h3 className="font-medium text-gray-900 mb-1 text-sm md:text-base">No employees visible</h3>
              <p className="text-xs md:text-sm">Select employees from the list to view their schedules</p>
            </div>
          ) : (
            /* Employee Rows */
            visibleEmployees.map((employee) => {
              const isSelected = selectedEmployeeId === employee.id;
              
              return (
                <Fragment key={employee.id}>
                  {/* Employee Name Cell */}
                  <div
                    className={`
                      px-4 py-1 border-r border-b border-gray-200 flex items-center overflow-hidden
                      transition-colors duration-150
                      ${isSelected ? 'bg-blue-100' : hoveredRowId === employee.id ? 'bg-gray-50' : 'bg-white'}
                    `}
                    onMouseEnter={() => setHoveredRowId(employee.id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      {/* Avatar */}
                      <div className="w-8 h-8 bg-blue-500 text-white text-xs font-semibold rounded-full flex items-center justify-center flex-shrink-0">
                        {employee.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      
                      {/* Name */}
                      <div className="min-w-0 flex-1">
                        <div className={`
                          text-xs md:text-sm font-medium truncate
                          ${isSelected ? 'text-blue-900' : 'text-gray-900'}
                        `}>
                          {employee.name.split(' ')[0]}
                        </div>
                        <div className="text-xs text-gray-500 truncate hidden md:block">
                          {employee.name.split(' ').slice(1).join(' ')}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Shift Cells */}
                  {weekDates.map((date) => {
                    const dateStr = formatDate(date);
                    const cellAssignments = getAssignmentsForCell(employee.id, date);
                    const isHoliday = holidayMap.has(dateStr);
                    const isDropTarget = dropTarget?.employeeId === employee.id && dropTarget?.date === dateStr;
                    
                    return (
                      <div 
                        key={`${employee.id}-${dateStr}`}
                        className={`
                          px-2 py-1 border-r border-b border-gray-200 min-h-[100px] overflow-hidden
                          transition-colors duration-150
                          ${isSelected ? 'bg-blue-50' : hoveredRowId === employee.id ? 'bg-gray-50' : ''}
                          ${isHoliday ? 'bg-amber-50/70' : ''}
                          ${isDropTarget ? 'bg-blue-100 ring-2 ring-blue-400 ring-inset' : ''}
                        `}
                        onMouseEnter={() => setHoveredRowId(employee.id)}
                        onMouseLeave={() => setHoveredRowId(null)}
                        onDragOver={isAdmin ? (e) => handleDragOver(e, employee.id, date) : undefined}
                        onDragLeave={isAdmin ? handleDragLeave : undefined}
                        onDrop={isAdmin ? (e) => handleDrop(e, employee.id, date) : undefined}
                      >
                        {cellAssignments.length > 0 ? (
                          /* Render shift cards */
                          <div className="space-y-1">
                            {cellAssignments.map((assignment) => {
                              // Get date string with fallback
                              const assignmentDateStr = assignment.date || (assignment.start_datetime ? assignment.start_datetime.slice(0, 10) : '');
                              
                              // Find leave for this assignment
                              const leaveData = findLeaveForAssignment(assignment, assignmentDateStr);
                              
                              // Check if employee has multiple leaves on same day
                              const hasMultipleLeaves = hasMultipleLeavesOnSameDay(assignment.employee_id, assignmentDateStr);
                              
                              return (
                                <ShiftCard
                                  key={`${assignment.employee_id}-${assignmentDateStr}-${assignment.shift_type}`}
                                  assignment={assignment}
                                  leaveData={leaveData}
                                  hasMultipleLeavesOnSameDay={hasMultipleLeaves}
                                  onClick={onShiftClick}
                                  isClickable={true}
                                  isDraggable={isAdmin && viewMode === 'by-employee' && !isBulkDeleteMode}
                                  onDragStart={handleDragStart}
                                  onDragEnd={handleDragEnd}
                                  isBulkDeleteMode={isBulkDeleteMode}
                                  onDelete={handleDeleteShift}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          /* Empty slot */
                          <EmptyShiftSlot
                            onAdd={onAddShift ? () => onAddShift(employee, date) : undefined}
                            employeeName={employee.name}
                            date={dateStr}
                          />
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              );
            })
          )
        ) : (
          /* Shift Type View Mode */
          SHIFT_TYPES.map((shiftType) => (
            <Fragment key={shiftType.key}>
              {/* Shift Type Name Cell */}
              <div className="px-4 py-3 border-r border-b border-gray-200 flex items-center bg-white dark:bg-[#14181d] overflow-hidden">
                  <div className="flex items-center space-x-2 min-w-0">
                    {/* Shift Icon */}
                    <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-600 text-white text-sm font-semibold rounded-full flex items-center justify-center flex-shrink-0">
                      {shiftType.icon}
                    </div>
                    
                    {/* Shift Name */}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs md:text-sm font-medium text-gray-900 truncate">
                        {shiftType.label}
                      </div>
                      <div className="text-xs text-gray-500 hidden md:block">
                        Shift Type
                      </div>
                    </div>
                  </div>
                </div>

                {/* Employee Cells for each day */}
                {weekDates.map((date) => {
                  const dateStr = formatDate(date);
                  const shiftAssignments = getAssignmentsForShiftCell(shiftType.key, date);
                  const isHoliday = holidayMap.has(dateStr);
                  
                  return (
                    <div 
                      key={`${shiftType.key}-${dateStr}`}
                      className={`px-2 py-3 border-r border-b border-gray-200 min-h-[100px] overflow-hidden ${isHoliday ? 'bg-amber-50/70' : 'bg-white dark:bg-[#14181d]'}`}
                    >
                      <div className="space-y-2">
                        {/* Existing employee assignments */}
                        {shiftAssignments.length > 0 && shiftAssignments.map((assignment) => {
                          // Get date string with fallback
                          const assignmentDateStr = assignment.date || (assignment.start_datetime ? assignment.start_datetime.slice(0, 10) : '');
                          
                          // Find leave for this assignment
                          const leaveData = findLeaveForAssignment(assignment, assignmentDateStr);
                          
                          // Check if employee has multiple leaves on same day
                          const hasMultipleLeaves = hasMultipleLeavesOnSameDay(assignment.employee_id, assignmentDateStr);

                          return (
                            <EmployeeCard
                              key={`${assignment.employee_id}-${assignmentDateStr}-${assignment.shift_type}`}
                              assignment={assignment}
                              leaveData={leaveData}
                              hasMultipleLeavesOnSameDay={hasMultipleLeaves}
                              onClick={onShiftClick}
                              isClickable={true}
                              isBulkDeleteMode={isBulkDeleteMode}
                              onDelete={handleDeleteShift}
                            />
                          );
                        })}
                        
                        {/* Empty state */}
                        {shiftAssignments.length === 0 && (
                          <EmptyShiftSlot
                            onAdd={onAddShift ? () => onAddShift(/* employee */ null, date, shiftType.key) : undefined}
                            employeeName={''}
                            date={dateStr}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
            </Fragment>
          ))
        )
        }
        </div>
      </div>

      {/* Mobile Card View - Only on Mobile */}
      <div className="md:hidden">
        {viewMode === 'by-employee' ? (
          /* Mobile Employee View */
          visibleEmployees.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Users size={32} className="mx-auto mb-3 text-gray-300" />
              <h3 className="font-medium text-gray-900 mb-1">No employees visible</h3>
              <p className="text-sm">Select employees from the list to view their schedules</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {visibleEmployees.map((employee) => {
                const isSelected = selectedEmployeeId === employee.id;
                const dateStr = formatDate(weekDates[selectedDayIndex]);
                const cellAssignments = getAssignmentsForCell(employee.id, weekDates[selectedDayIndex]);
                const isHoliday = holidayMap.has(dateStr);
                
                return (
                  <motion.div
                    key={employee.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-4 ${
                      isSelected ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'
                    } ${isHoliday ? 'bg-amber-50/30' : ''}`}
                  >
                    {/* Employee Header */}
                    <div className="flex items-center space-x-3 mb-3">
                      <div className="w-10 h-10 bg-blue-500 text-white text-sm font-semibold rounded-full flex items-center justify-center flex-shrink-0">
                        {employee.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {employee.name}
                        </div>
                      </div>
                    </div>
                    
                    {/* Shifts for this day */}
                    {cellAssignments.length > 0 ? (
                      <div className="space-y-2">
                        {cellAssignments.map((assignment) => {
                          const assignmentDateStr = assignment.date || (assignment.start_datetime ? assignment.start_datetime.slice(0, 10) : '');
                          const leaveData = findLeaveForAssignment(assignment, assignmentDateStr);
                          const hasMultipleLeaves = hasMultipleLeavesOnSameDay(assignment.employee_id, assignmentDateStr);
                          
                          return (
                            <ShiftCard
                              key={`${assignment.employee_id}-${assignmentDateStr}-${assignment.shift_type}`}
                              assignment={assignment}
                              leaveData={leaveData}
                              hasMultipleLeavesOnSameDay={hasMultipleLeaves}
                              onClick={onShiftClick}
                              isClickable={true}
                              isDraggable={false}
                              isBulkDeleteMode={isBulkDeleteMode}
                              onDelete={handleDeleteShift}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 text-center py-4">
                        No shifts scheduled
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )
        ) : (
          /* Mobile Shift Type View */
          <div className="divide-y divide-gray-200">
            {SHIFT_TYPES.map((shiftType) => {
              const dateStr = formatDate(weekDates[selectedDayIndex]);
              const shiftAssignments = getAssignmentsForShiftCell(shiftType.key, weekDates[selectedDayIndex]);
              const isHoliday = holidayMap.has(dateStr);
              
              return (
                <motion.div
                  key={shiftType.key}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`p-4 ${isHoliday ? 'bg-amber-50/30' : 'bg-white dark:bg-[#14181d]'}`}
                >
                  {/* Shift Type Header */}
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 text-white text-lg rounded-full flex items-center justify-center flex-shrink-0">
                      {shiftType.icon}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">
                        {shiftType.label}
                      </div>
                      <div className="text-sm text-gray-500">
                        {shiftAssignments.length} {shiftAssignments.length === 1 ? 'employee' : 'employees'}
                      </div>
                    </div>
                  </div>
                  
                  {/* Employees for this shift */}
                  {shiftAssignments.length > 0 ? (
                    <div className="space-y-2">
                      {shiftAssignments.map((assignment) => {
                        const assignmentDateStr = assignment.date || (assignment.start_datetime ? assignment.start_datetime.slice(0, 10) : '');
                        const leaveData = findLeaveForAssignment(assignment, assignmentDateStr);
                        const hasMultipleLeaves = hasMultipleLeavesOnSameDay(assignment.employee_id, assignmentDateStr);
                        
                        return (
                          <EmployeeCard
                            key={`${assignment.employee_id}-${assignmentDateStr}-${assignment.shift_type}`}
                            assignment={assignment}
                            leaveData={leaveData}
                            hasMultipleLeavesOnSameDay={hasMultipleLeaves}
                            onClick={onShiftClick}
                            isClickable={true}
                            isBulkDeleteMode={isBulkDeleteMode}
                            onDelete={handleDeleteShift}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 text-center py-4">
                      No employees assigned
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Legend - Desktop Only */}
      <OvertimeModal
        isOpen={isOvertimeModalOpen}
        onClose={() => setIsOvertimeModalOpen(false)}
        onAddOvertime={(overtimeData) => {
          setIsOvertimeModalOpen(false);
          if (onAddOvertime) onAddOvertime(overtimeData);
        }}
        employees={employees}
        weekStart={formatDate(new Date(weekStart))}
      />
      
    </div>
  );
}

/**
 * Employee Card Component
 * Shows employee information in shift type view
 */
function EmployeeCard({ 
  assignment,
  leaveData,
  hasMultipleLeavesOnSameDay = false,
  onClick, 
  isClickable = true, 
  className = '',
  isBulkDeleteMode = false,
  onDelete
}) {
  // Shift type color configurations with distinct colors (matching ShiftCard)
  const SHIFT_CONFIG = {
    morning: {
      colorClasses: 'bg-orange-100 border-l-orange-500 text-orange-800',
      darkColorClasses: 'dark:bg-[#20252b] dark:border-l-orange-400 dark:text-orange-300',
      hoverClasses: 'hover:bg-orange-200 hover:shadow-orange-500/30',
      darkHoverClasses: 'dark:hover:bg-[#252b33]',
    },
    day: {
      colorClasses: 'bg-yellow-100 border-l-yellow-500 text-yellow-800',
      darkColorClasses: 'dark:bg-[#20252b] dark:border-l-yellow-400 dark:text-yellow-300',
      hoverClasses: 'hover:bg-yellow-200 hover:shadow-yellow-500/30',
      darkHoverClasses: 'dark:hover:bg-[#252b33]',
    },
    afternoon: {
      colorClasses: 'bg-purple-100 border-l-purple-500 text-purple-800',
      darkColorClasses: 'dark:bg-[#20252b] dark:border-l-purple-400 dark:text-purple-300',
      hoverClasses: 'hover:bg-purple-200 hover:shadow-purple-500/30',
      darkHoverClasses: 'dark:hover:bg-[#252b33]',
    },
    night: {
      colorClasses: 'bg-blue-100 border-l-blue-500 text-blue-800',
      darkColorClasses: 'dark:bg-[#20252b] dark:border-l-blue-400 dark:text-blue-300',
      hoverClasses: 'hover:bg-blue-200 hover:shadow-blue-500/30',
      darkHoverClasses: 'dark:hover:bg-[#252b33]',
    },
    overtime: {
      colorClasses: 'bg-red-100 border-l-red-500 text-red-800',
      darkColorClasses: 'dark:bg-[#20252b] dark:border-l-red-400 dark:text-red-300',
      hoverClasses: 'hover:bg-red-200 hover:shadow-red-500/30',
      darkHoverClasses: 'dark:hover:bg-[#252b33]',
    },
    custom: {
      colorClasses: 'bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100 border-l-pink-500 text-gray-800',
      darkColorClasses: 'dark:bg-[#20252b] dark:from-[#20252b] dark:via-[#20252b] dark:to-[#20252b] dark:border-l-pink-400 dark:text-gray-200',
      hoverClasses: 'hover:from-pink-200 hover:via-purple-200 hover:to-blue-200 hover:shadow-pink-500/30 hover:shadow-lg',
      darkHoverClasses: 'dark:hover:bg-[#252b33] dark:hover:from-[#252b33] dark:hover:via-[#252b33] dark:hover:to-[#252b33]',
    },
  };

  const timeRange = assignment.shift_type === 'overtime' || assignment.shift_type !== 'custom'
    ? formatTimeRange(assignment.start_datetime, assignment.end_datetime)
    : '';
  const displayValue = assignment.shift_type === 'custom'
    ? `${assignment.start_time}-${assignment.finish_time}`
    : timeRange;
  const config = SHIFT_CONFIG[assignment.shift_type] || SHIFT_CONFIG.day; // fallback to day colors
  
  // Format name as "FirstName L." (e.g., "Nia K." from "Nia Kavtaradze")
  const formatNameWithInitial = (fullName) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  };
  const displayName = formatNameWithInitial(assignment.employee_name);

  const handleClick = () => {
    if (isBulkDeleteMode && onDelete) {
      onDelete(assignment);
      return;
    }
    if (isClickable && onClick) {
      onClick(assignment);
    }
  };

  const handleKeyDown = (event) => {
    if (isBulkDeleteMode && onDelete && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onDelete(assignment);
      return;
    }
    if (isClickable && onClick && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onClick(assignment);
    }
  };

  // Calculate leave overlay position and width (horizontal)
  const getLeaveOverlayStyle = () => {
    if (!leaveData) return null;

    const { timeframe, custom_start, custom_end, shift_start, shift_end } = leaveData;

    if (timeframe === 'all-day') {
      return { left: 0, width: '100%' };
    } else if (timeframe === 'first-half') {
      return { left: 0, width: '50%' };
    } else if (timeframe === 'second-half') {
      return { left: '50%', width: '50%' };
    } else if (timeframe === 'other') {
      // Handle custom timeframe
      if (custom_start && custom_end && shift_start && shift_end) {
        try {
          const shiftStartTime = new Date(shift_start);
          const shiftEndTime = new Date(shift_end);
          const leaveStartTime = new Date(`${leaveData.date}T${custom_start}`);
          let leaveEndTime = new Date(`${leaveData.date}T${custom_end}`);

          // Handle shifts that cross midnight
          // If shift ends on next day but leave end time is before leave start, adjust by adding a day
          if (shiftEndTime > shiftStartTime + 24 * 60 * 60 * 1000) {
            // Shift crosses midnight
            if (leaveEndTime < leaveStartTime) {
              // Leave crosses midnight, add a day to end time
              leaveEndTime = new Date(leaveEndTime.getTime() + 24 * 60 * 60 * 1000);
            }
          }

          const shiftDuration = shiftEndTime - shiftStartTime;
          const leaveStart = leaveStartTime - shiftStartTime;
          const leaveDuration = leaveEndTime - leaveStartTime;

          const leftPercent = (leaveStart / shiftDuration) * 100;
          const widthPercent = (leaveDuration / shiftDuration) * 100;

          return { 
            left: `${Math.max(0, leftPercent)}%`, 
            width: `${Math.min(100 - leftPercent, widthPercent)}%`
          };
        } catch (err) {
          console.warn('Error calculating custom leave overlay:', err);
          return null;
        }
      }
    }

    return null;
  };

  const leaveOverlayStyle = getLeaveOverlayStyle();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isClickable ? { y: -2, scale: 1.02 } : {}}
      whileTap={isClickable ? { scale: 0.98 } : {}}
      className={`
        relative border-l-4 rounded-r-md p-4 transition-all duration-200 overflow-hidden
        ${leaveData ? 'border-l-red-600' : ''}
        ${config.colorClasses}
        ${config.darkColorClasses || ''}
        ${isBulkDeleteMode ? 'cursor-pointer ring-2 ring-red-400 ring-offset-1 hover:bg-red-200 hover:opacity-90' : ''}
        ${isClickable && !isBulkDeleteMode ? `cursor-pointer ${config.hoverClasses} ${config.darkHoverClasses || ''} focus:outline-none focus:ring-2 focus:ring-offset-1` : ''}
        ${className}
      `}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={isClickable ? 0 : -1}
      role={isClickable ? 'button' : 'presentation'}
      aria-label={
        isBulkDeleteMode
          ? `${assignment.employee_name}, ${displayValue}. Click to delete.`
          : isClickable 
            ? `${assignment.employee_name}, ${displayValue}. Click for details.`
            : `${assignment.employee_name}, ${displayValue}`
      }
    >
      {/* Leave Overlay - Grey Diagonal Stripes */}
      {leaveOverlayStyle && (
        <div 
          className="absolute top-0 bottom-0 pointer-events-none z-10"
          style={{
            ...leaveOverlayStyle,
            background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(128, 128, 128, 0.25) 10px, rgba(128, 128, 128, 0.25) 20px)'
          }}
        />
      )}

      {/* Content wrapper with z-index to appear above overlay */}
      <div className="relative z-20">
      {/* Employee name */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center space-x-1">
          <span className="text-sm" role="img" aria-hidden="true">
            👤
          </span>
          <span className="font-medium text-sm">{displayName}</span>
        </div>
        
        {/* Multiple leaves warning indicator */}
        {hasMultipleLeavesOnSameDay && (
          <span 
            className="text-red-600 dark:text-red-400" 
            title="⚠️ Warning: Multiple leave entries detected for this employee on this date. This may indicate a data issue."
            aria-label="Multiple leaves warning"
            role="img"
          >
            ⚠️
          </span>
        )}
      </div>

      {/* Time range or overtime duration */}
      <div className="text-xs font-mono text-gray-600 dark:text-gray-400">
        {displayValue}
      </div>
      </div>

      {/* Hover effect overlay */}
      {isClickable && (
        <div className="absolute inset-0 rounded-r-md bg-white/0 hover:bg-white/10 transition-colors duration-200 pointer-events-none" />
      )}
    </motion.div>
  );
}

/**
 * Shift legend component
 * Shows available shift types and their time ranges
 */
function ShiftLegend({ className = '' }) {
  const shiftTypes = [
    { type: 'morning', label: 'Morning', time: '4am–1pm', icon: '🌅' },
    { type: 'day', label: 'Day', time: '10am–7pm', icon: '☀️' },
    { type: 'afternoon', label: 'Afternoon', time: '3pm–12am', icon: '🌇' },
    { type: 'night', label: 'Night', time: '7pm–4am', icon: '🌙' },
    { type: 'overtime', label: 'Overtime', time: 'Custom', icon: '⚡' },
  ];

  return (
    <div className={`bg-gray-50 px-4 py-3 ${className}`}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 flex items-center space-x-2">
          <AlertCircle size={16} />
          <span>Shift Types</span>
        </h4>
        
        <div className="flex items-center space-x-4">
          {shiftTypes.map((shift) => (
            <div key={shift.type} className="flex items-center space-x-1">
              <ShiftIndicator shiftType={shift.type} count="" />
              <span className="text-xs text-gray-600">
                {shift.label} ({shift.time})
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
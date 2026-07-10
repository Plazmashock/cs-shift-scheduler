/**
 * Data Tab Component  
 * Counts working hours per employee and provides export functionality
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import * as firebaseDB from '../services/firebaseDatabase';
import { Download, FileText, Calendar, Clock, BarChart3, Filter, User, Code, ChevronsUpDown, ChevronUp, ChevronDown, Sheet } from 'lucide-react';
import { formatDate, getWeekStart, getWeekDates } from '../utils/dateHelpers';
import { useAuth } from '../contexts/AuthContext';
import { exportToSheets } from '../services/api';
import { pushAllWeeksToFirestore } from '../services/webhookService';

// Helper function to round hours to 2 decimal places
const roundHours = (hours) => {
  return Math.round(hours * 100) / 100;
};

// Calculate hours between two datetime strings
const calculateShiftHours = (startDateTime, endDateTime) => {
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  return (end - start) / (1000 * 60 * 60); // Convert milliseconds to hours
};

export default function DataTab({ 
  employees = [], 
  assignments = [], 
  weekStart,
  holidayMap = new Map()
}) {
  const { user, isAdmin: contextIsAdmin } = useAuth();
  const [exportingSheetsLoading, setExportingSheetsLoading] = useState(false);
  const [exportSheetsStatus, setExportSheetsStatus] = useState(null); // null | 'success' | 'error'
  const [exportSheetsMessage, setExportSheetsMessage] = useState('');
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef(null);

  const [pushingKpi, setPushingKpi] = useState(false);
  const [kpiPushStatus, setKpiPushStatus] = useState(null); // null | 'success' | 'error'

  // Close export dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target)) {
        setExportDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleExportToSheets = async () => {
    if (!user) return;
    setExportingSheetsLoading(true);
    setExportSheetsStatus(null);
    try {
      const getIdToken = () => user.getIdToken();
      const result = await exportToSheets({}, getIdToken);
      setExportSheetsStatus('success');
      setExportSheetsMessage(
        `Updated ${result.rows_updated} row(s) in Google Sheets ` +
        `(cols ${result.worked_hours_column} & ${result.total_shifts_column})`
      );
    } catch (err) {
      setExportSheetsStatus('error');
      setExportSheetsMessage(err.message || 'Export failed');
    } finally {
      setExportingSheetsLoading(false);
      setTimeout(() => setExportSheetsStatus(null), 6000);
    }
  };

  const handlePushToKpi = async () => {
    setPushingKpi(true);
    setKpiPushStatus(null);
    try {
      const result = await pushAllWeeksToFirestore();
      setKpiPushStatus(result.success ? 'success' : 'error');
    } catch (err) {
      setKpiPushStatus('error');
    } finally {
      setPushingKpi(false);
      setTimeout(() => setKpiPushStatus(null), 5000);
    }
  };

  // Date range state (start and end dates)
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    now.setDate(1); // First day of current month
    return formatDate(now);
  });
  
  const [endDate, setEndDate] = useState(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return formatDate(lastDay);
  });
  
  const [selectedEmployee, setSelectedEmployee] = useState('all');

  // Use assignments passed from parent App (which loads from Firebase successfully)
  // Filter them by selected month
  const [showRaw, setShowRaw] = useState(false);
  const [isLoadingMonth, setIsLoadingMonth] = useState(true);

  // Filter assignments by selected month (use assignments from parent App)
  // We'll merge assignments passed from parent with any schedules stored in Firebase
  // for the whole selected month. This ensures that generating multiple weeks
  // in the same month is reflected in the DataTab without requiring manual
  // navigation.
  const [externalAssignments, setExternalAssignments] = useState([]);
  const [externalLeaves, setExternalLeaves] = useState([]);

  useEffect(() => {
    let mounted = true;

    const loadDateRangeSchedules = async () => {
      setIsLoadingMonth(true);
      try {
        const start = new Date(startDate);
        const end = new Date(endDate);

        // Collect all unique week starts (Monday) that appear in the date range
        const weekStarts = new Set();
        const currentDate = new Date(start);
        
        while (currentDate <= end) {
          const weekStartDate = formatDate(getWeekStart(currentDate));
          weekStarts.add(weekStartDate);
          currentDate.setDate(currentDate.getDate() + 1);
        }

        const loadedAssignments = [];
        const loadedLeaves = [];
        console.log('📅 Loading weeks for date range:', { startDate, endDate, weeksToLoad: Array.from(weekStarts).sort() });
        for (const ws of Array.from(weekStarts)) {
          try {
            const sched = await firebaseDB.loadScheduleFromFirebase(ws, null);
            if (sched?.assignments && Array.isArray(sched.assignments)) {
              loadedAssignments.push(...sched.assignments);
            }
          } catch (e) {
            console.warn('DataTab: failed to load week', ws, e?.message || e);
          }
          
          // Load leaves from Firebase for this week
          try {
            const leaves = await firebaseDB.loadLeavesFromFirebase(ws);
            if (leaves && Array.isArray(leaves)) {
              loadedLeaves.push(...leaves);
            }
          } catch (e) {
            console.warn('DataTab: failed to load leaves for week', ws, e?.message || e);
          }
        }

        if (mounted) {
          setExternalAssignments(loadedAssignments);
          setExternalLeaves(loadedLeaves);
          console.log('DataTab: loaded external data for date range', { startDate, endDate, 
            assignments: loadedAssignments.length,
            leaves: loadedLeaves.length
          });
        }
      } catch (err) {
        console.warn('DataTab: failed to load date range schedules:', err?.message || err);
      } finally {
        if (mounted) {
          setIsLoadingMonth(false);
        }
      }
    };

    loadDateRangeSchedules();
    return () => { mounted = false; };
  }, [startDate, endDate]);

  const monthlyAssignments = useMemo(() => {
    // Use ONLY external assignments loaded from Firebase based on selected date range
    const seen = new Set();
    const combined = [];

    const pushUnique = (a) => {
      const key = `${a.date || (a.start_datetime ? a.start_datetime.slice(0,10) : '')}::${a.shift_type}::${a.employee_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(a);
      } else {
        console.log('🔄 Duplicate assignment detected and skipped:', { 
          date: a.date || a.start_datetime?.slice(0,10), 
          employee_id: a.employee_id, 
          shift_type: a.shift_type 
        });
      }
    };

    // Use ONLY externalAssignments (date range from Firebase)
    (externalAssignments || []).forEach(pushUnique);

    if (combined.length === 0) {
      console.log('DataTab: no combined assignments found for date range', { startDate, endDate });
      return [];
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    const filtered = combined.filter(a => {
      const dateStr = a.date || (a.start_datetime ? a.start_datetime.slice(0,10) : null);
      if (!dateStr) return false;
      const ad = new Date(dateStr);
      return ad >= start && ad <= end;
    });

    // Normalize assignment fields (ensure employee_id is a number)
    const normalized = filtered.map(a => ({
      ...a,
      employee_id: typeof a.employee_id === 'string' ? parseInt(a.employee_id, 10) : a.employee_id
    }));

    console.log('DataTab: filtered combined assignments for date range', { 
      startDate, 
      endDate,
      externalAssignments: (externalAssignments || []).length,
      afterDedup: combined.length,
      filteredCount: normalized.length,
      sample: normalized.slice(0, 3),
      employeeIds: [...new Set(normalized.map(a => a.employee_id))]
    });

    return normalized;
  }, [externalAssignments, startDate, endDate]);

  // Use leaves from prop (App.jsx) first, fall back to external Firebase load
  const monthlyLeaves = useMemo(() => {
    const seen = new Set();
    const combined = [];

    const pushUnique = (leave) => {
      // Use a more robust key that includes all identifying information
      const key = leave.id 
        ? `id::${leave.id}`
        : `${leave.date}::${leave.employee_id}::${leave.shift_type}::${leave.leave_type}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(leave);
      } else {
        console.log('🔄 Duplicate leave detected and skipped:', { date: leave.date, employee_id: leave.employee_id, key });
      }
    };

    // Use ONLY externalLeaves from Firebase (date range based)
    (externalLeaves || []).forEach(pushUnique);

    // Filter by selected date range (use string comparison to avoid timezone issues)
    const start = startDate;
    const end = endDate;
    
    const filtered = combined
      .filter(leave => {
        if (!leave.date) return false;
        // Use string comparison to avoid timezone interpretation issues with Date objects
        return leave.date >= start && leave.date <= end;
      })
      .map(leave => ({
        ...leave,
        // Normalize employee_id to number so strict-equality matches against
        // assignments (which are also normalized to numbers above).
        employee_id: typeof leave.employee_id === 'string'
          ? parseInt(leave.employee_id, 10)
          : leave.employee_id,
      }));

    // Detailed logging for debugging
    const tamarLeaves = filtered.filter(l => String(l.employee_id) === '15');
    console.log('DataTab: monthly leaves (Firebase date range based)', { 
      startDate,
      endDate,
      externalLeaves: (externalLeaves || []).length,
      uniqueAfterDedup: combined.length,
      filteredForRange: filtered.length,
      tamarLeavesInRange: tamarLeaves.length,
      tamarLeaveDetails: tamarLeaves.map(l => ({ date: l.date, type: l.leave_type, timeframe: l.timeframe }))
    });

    return filtered;
  }, [externalLeaves, startDate, endDate]);

  // Calculate working hours for each employee (8 hours per shift, or actual duration for overtime)
  const employeeHours = useMemo(() => {
    const hoursData = {};
    const HOURS_PER_SHIFT = 8;
    const BONUS_ELIGIBLE_SHIFTS = ['morning', 'afternoon', 'night']; // All except day
    
    // Initialize all current employees with 0 hours
    employees.forEach(emp => {
      hoursData[emp.id] = {
        id: emp.id,
        name: emp.name,
        totalHours: 0,
        totalShifts: 0,
        bonusShifts: 0,
        overtimeHours: 0,
        overtimeShifts: 0,
        holidayHours: 0,
        holidayShifts: 0,
        leaveHours: 0,
        paidLeaveHours: 0,
        unpaidLeaveHours: 0,
        leaveCount: 0,
        shifts: [],
        leaves: [],
        isRemoved: false,
        shiftsByType: {
          morning: { count: 0, hours: 0 },
          day: { count: 0, hours: 0 },
          afternoon: { count: 0, hours: 0 },
          night: { count: 0, hours: 0 },
          overtime: { count: 0, hours: 0 }
        }
      };
    });

    // Find removed employees (those in assignments but not in current employee list)
    const currentEmployeeIds = new Set(employees.map(e => e.id));
    monthlyAssignments.forEach(assignment => {
      const empId = assignment.employee_id;
      if (!currentEmployeeIds.has(empId) && !hoursData[empId]) {
        // This is a removed employee - initialize their data
        hoursData[empId] = {
          id: empId,
          name: assignment.employee_name || `Employee ${empId}`,
          totalHours: 0,
          totalShifts: 0,
          bonusShifts: 0,
          overtimeHours: 0,
          overtimeShifts: 0,
          holidayHours: 0,
          holidayShifts: 0,
          leaveHours: 0,
          paidLeaveHours: 0,
          unpaidLeaveHours: 0,
          leaveCount: 0,
          shifts: [],
          leaves: [],
          isRemoved: true,
          shiftsByType: {
            morning: { count: 0, hours: 0 },
            day: { count: 0, hours: 0 },
            afternoon: { count: 0, hours: 0 },
            night: { count: 0, hours: 0 },
            overtime: { count: 0, hours: 0 }
          }
        };
      }
    });

    // Calculate hours from monthly assignments
    console.log('DataTab: calculating hours for employees', {
      employeeCount: employees.length,
      employeeIds: employees.map(e => e.id),
      assignmentCount: monthlyAssignments.length,
      assignmentEmployeeIds: [...new Set(monthlyAssignments.map(a => a.employee_id))]
    });
    
    // Define shift hours at the beginning so it's available for calculations
    const SHIFT_HOURS = {
      morning: 8,
      day: 8,
      afternoon: 8,
      night: 8
    };
    
    monthlyAssignments.forEach(assignment => {
      const empId = assignment.employee_id;
      if (hoursData[empId]) {
        // Calculate hours: use actual duration for overtime, 8 hours for regular shifts
        let hours = HOURS_PER_SHIFT;
        if (assignment.shift_type === 'overtime') {
          // Overtime uses duration_hours field (total hours without break)
          hours = parseFloat(assignment.duration_hours || 0);
        }

        const isBonus = BONUS_ELIGIBLE_SHIFTS.includes(assignment.shift_type) && assignment.shift_type !== 'overtime';
        
        // Check if this shift is on a holiday AND if there's no leave on this day
        const dateStr = assignment.date || (assignment.start_datetime ? assignment.start_datetime.slice(0,10) : '');
        const hasLeaveOnThisDay = monthlyLeaves.some(leave => leave.employee_id === empId && leave.date === dateStr);
        const hasAllDayLeaveOnThisDay = monthlyLeaves.some(leave => leave.employee_id === empId && leave.date === dateStr && leave.timeframe === 'all-day');
        const isHoliday = holidayMap.has(dateStr) && !hasAllDayLeaveOnThisDay;

        // Calculate work hours after deducting partial leave
        let workHours = hours;
        const partialLeaveOnThisDay = monthlyLeaves.find(leave => 
          leave.employee_id === empId && 
          leave.date === dateStr && 
          leave.timeframe !== 'all-day'
        );
        
        if (hasAllDayLeaveOnThisDay) {
          workHours = 0;
        } else if (partialLeaveOnThisDay) {
          // Deduct partial leave hours from work hours
          let leaveHoursToDeduct = 0;
          const shiftHours = SHIFT_HOURS[assignment.shift_type] || 8;
          
          if (partialLeaveOnThisDay.timeframe === 'first-half' || partialLeaveOnThisDay.timeframe === 'second-half') {
            leaveHoursToDeduct = shiftHours / 2;
          } else if (partialLeaveOnThisDay.timeframe === 'other' && partialLeaveOnThisDay.custom_start && partialLeaveOnThisDay.custom_end) {
            try {
              const leaveStart = new Date(`${partialLeaveOnThisDay.date}T${partialLeaveOnThisDay.custom_start}`);
              const leaveEnd = new Date(`${partialLeaveOnThisDay.date}T${partialLeaveOnThisDay.custom_end}`);
              leaveHoursToDeduct = (leaveEnd - leaveStart) / (1000 * 60 * 60);
            } catch (err) {
              leaveHoursToDeduct = 0;
            }
          }
          workHours = Math.max(0, hours - leaveHoursToDeduct);
        }

        // Don't count shifts that have all-day leaves
        if (!hasAllDayLeaveOnThisDay) {
          hoursData[empId].totalHours = roundHours(hoursData[empId].totalHours + workHours);
          hoursData[empId].totalShifts += 1;
          
          if (assignment.shift_type === 'overtime') {
            hoursData[empId].overtimeHours = roundHours(hoursData[empId].overtimeHours + workHours);
            hoursData[empId].overtimeShifts += 1;
          } else if (isBonus) {
            hoursData[empId].bonusShifts += 1;
          }
          
          if (isHoliday) {
            hoursData[empId].holidayHours = roundHours(hoursData[empId].holidayHours + workHours);
            hoursData[empId].holidayShifts += 1;
          }
        }
        
        hoursData[empId].shifts.push({
          date: assignment.date || (assignment.start_datetime ? assignment.start_datetime.slice(0,10) : ''),
          type: assignment.shift_type,
          hours: workHours,
          isBonus: isBonus,
          isHoliday: isHoliday,
          startTime: assignment.start_datetime,
          endTime: assignment.end_datetime
        });

        // Count by shift type (also exclude all-day leaves)
        if (!hasAllDayLeaveOnThisDay && hoursData[empId].shiftsByType[assignment.shift_type]) {
          hoursData[empId].shiftsByType[assignment.shift_type].count += 1;
          hoursData[empId].shiftsByType[assignment.shift_type].hours = roundHours(hoursData[empId].shiftsByType[assignment.shift_type].hours + workHours);
        }
      }
    });

    // Calculate leave hours from monthlyLeaves
    console.log('🍃 Processing monthlyLeaves:', monthlyLeaves.length, 'total leaves');
    console.log('🍃 Sopo leaves in monthlyLeaves:', monthlyLeaves.filter(l => String(l.employee_id) === '15').map(l => ({ date: l.date, id: l.id, employee_id: l.employee_id, type: typeof l.employee_id })));
    monthlyLeaves.forEach(leave => {
      if (leave.employee_id === '15' || leave.employee_id === 15) {
        console.log('👤 Found leave for Sopo (ID 15):', { date: leave.date, leave_type: leave.leave_type, timeframe: leave.timeframe, employee_id: leave.employee_id, id_type: typeof leave.employee_id });
      }
      // Count all leaves regardless of whether there's a matching shift assignment
      // (employees can take paid leave on days they're not scheduled to work)
      const empId = leave.employee_id;
      if (!hoursData[empId]) {
        // Leave for an employee not in current list - could be removed
        hoursData[empId] = {
          name: leave.employee_name || `Employee ${empId}`,
          totalHours: 0,
          totalShifts: 0,
          bonusShifts: 0,
          overtimeHours: 0,
          overtimeShifts: 0,
          holidayHours: 0,
          holidayShifts: 0,
          leaveHours: 0,
          paidLeaveHours: 0,
          unpaidLeaveHours: 0,
          leaveCount: 0,
          shifts: [],
          leaves: [],
          isRemoved: true,
          shiftsByType: {
            morning: { count: 0, hours: 0 },
            day: { count: 0, hours: 0 },
            afternoon: { count: 0, hours: 0 },
            night: { count: 0, hours: 0 },
            overtime: { count: 0, hours: 0 }
          }
        };
      }

      const shiftPaidHours = SHIFT_HOURS[leave.shift_type] || 8;
      let leaveHours = 0;

      if (leave.timeframe === 'all-day') {
        leaveHours = shiftPaidHours;
      } else if (leave.timeframe === 'first-half' || leave.timeframe === 'second-half') {
        leaveHours = shiftPaidHours / 2;
      } else if (leave.timeframe === 'other' && leave.custom_start && leave.custom_end) {
        try {
          // Parse custom times like "11:00" to get hours difference
          const startParts = leave.custom_start.split(':');
          const endParts = leave.custom_end.split(':');
          const startMins = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
          const endMins = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
          leaveHours = (endMins - startMins) / 60;
          
          if (empId === '15' || empId === 15) {
            console.log('🔢 Sopo custom leave time calculation:', { 
              date: leave.date,
              custom_start: leave.custom_start,
              custom_end: leave.custom_end,
              startMins,
              endMins,
              calculatedHours: leaveHours 
            });
          }
        } catch (err) {
          console.warn('Error calculating custom leave hours:', err);
          leaveHours = 0;
        }
      }

      // Prevent negative leave hours and ensure it's a valid number
      leaveHours = Math.max(0, roundHours(leaveHours));

      // Separate paid vs unpaid leaves (only "unpaid" leave_type is unpaid, others are paid)
      const isPaidLeave = leave.leave_type !== 'unpaid';
      hoursData[empId].leaveHours = roundHours(hoursData[empId].leaveHours + leaveHours);
      if (isPaidLeave) {
        hoursData[empId].paidLeaveHours = roundHours(hoursData[empId].paidLeaveHours + leaveHours);
      } else {
        hoursData[empId].unpaidLeaveHours = roundHours(hoursData[empId].unpaidLeaveHours + leaveHours);
      }
      hoursData[empId].leaveCount += 1;
      
      // Debug: Log Sopo's leave counting
      if (empId === '15' || empId === 15) {
        console.log('✅ Sopo leave counted:', { date: leave.date, leaveHours, isPaidLeave, currentPaidTotal: hoursData[empId].paidLeaveHours });
      }

      if (false) { // debug: leave hours (disabled)
      }

      hoursData[empId].leaves.push({
        date: leave.date,
        type: leave.leave_type,
        timeframe: leave.timeframe,
        hours: leaveHours
      });
    });

    // Final summary check
    const summary = {
      totalEmployees: Object.keys(hoursData).length,
      totalShifts: Object.values(hoursData).reduce((sum, emp) => sum + emp.totalShifts, 0),
      totalAssignmentsProcessed: monthlyAssignments.length,
      totalLeavesProcessed: monthlyLeaves.length,
      avgShiftsPerEmployee: (Object.values(hoursData).reduce((sum, emp) => sum + emp.totalShifts, 0) / Object.keys(hoursData).length).toFixed(2),
      tamarFinalData: hoursData['15'] ? { 
        paidLeaveHours: hoursData['15'].paidLeaveHours,
        unpaidLeaveHours: hoursData['15'].unpaidLeaveHours,
        leaveCount: hoursData['15'].leaveCount
      } : 'NOT FOUND'
    };
    console.log('📊 DataTab SUMMARY:', summary);

    return hoursData;
  }, [employees, monthlyAssignments, monthlyLeaves, holidayMap]);

  // Filter data based on selected employee
  const filteredData = useMemo(() => {
    if (selectedEmployee === 'all') {
      return Object.values(employeeHours);
    }
    const empData = employeeHours[selectedEmployee];
    return empData ? [empData] : [];
  }, [employeeHours, selectedEmployee]);

  // Sort state
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedData = useMemo(() => {
    if (!sortField) return filteredData;
    return [...filteredData].sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        case 'name':            aVal = a.name;                       bVal = b.name;                       break;
        case 'totalHours':      aVal = a.totalHours;                 bVal = b.totalHours;                 break;
        case 'totalShifts':     aVal = a.totalShifts;                bVal = b.totalShifts;                break;
        case 'bonusShifts':     aVal = a.bonusShifts;                bVal = b.bonusShifts;                break;
        case 'overtimeHours':   aVal = a.overtimeHours;              bVal = b.overtimeHours;              break;
        case 'holidayHours':    aVal = a.holidayHours;               bVal = b.holidayHours;               break;
        case 'paidLeaveHours':  aVal = a.paidLeaveHours || 0;        bVal = b.paidLeaveHours || 0;        break;
        case 'unpaidLeaveHours':aVal = a.unpaidLeaveHours || 0;      bVal = b.unpaidLeaveHours || 0;      break;
        case 'morning':         aVal = a.shiftsByType.morning.count;   bVal = b.shiftsByType.morning.count;   break;
        case 'day':             aVal = a.shiftsByType.day.count;       bVal = b.shiftsByType.day.count;       break;
        case 'afternoon':       aVal = a.shiftsByType.afternoon.count; bVal = b.shiftsByType.afternoon.count; break;
        case 'night':           aVal = a.shiftsByType.night.count;     bVal = b.shiftsByType.night.count;     break;
        default: return 0;
      }
      if (typeof aVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [filteredData, sortField, sortDirection]);

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const data = Object.values(employeeHours);
    const totalHours = data.reduce((sum, emp) => sum + emp.totalHours, 0);
    const totalShifts = data.reduce((sum, emp) => sum + emp.totalShifts, 0);
    const totalBonusShifts = data.reduce((sum, emp) => sum + emp.bonusShifts, 0);
    const totalOvertimeHours = data.reduce((sum, emp) => sum + emp.overtimeHours, 0);
    const totalOvertimeShifts = data.reduce((sum, emp) => sum + emp.overtimeShifts, 0);
    const totalHolidayHours = data.reduce((sum, emp) => sum + emp.holidayHours, 0);
    const totalHolidayShifts = data.reduce((sum, emp) => sum + emp.holidayShifts, 0);
    const totalLeaveHours = data.reduce((sum, emp) => sum + emp.leaveHours, 0);
    const totalLeaveCount = data.reduce((sum, emp) => sum + emp.leaveCount, 0);
    const avgHoursPerEmployee = data.length > 0 ? totalHours / data.length : 0;
    const maxHours = Math.max(...data.map(emp => emp.totalHours), 0);
    const minHours = Math.min(...data.map(emp => emp.totalHours), 0);

    return {
      totalHours: totalHours.toFixed(2),
      totalShifts,
      totalBonusShifts,
      totalOvertimeHours: totalOvertimeHours.toFixed(2),
      totalOvertimeShifts,
      totalHolidayHours: totalHolidayHours.toFixed(2),
      totalHolidayShifts,
      totalLeaveHours: totalLeaveHours.toFixed(2),
      totalLeaveCount,
      avgHoursPerEmployee: avgHoursPerEmployee.toFixed(2),
      maxHours: maxHours.toFixed(2),
      minHours: minHours.toFixed(2),
      totalEmployees: data.filter(emp => emp.totalHours > 0).length
    };
  }, [employeeHours]);

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'Employee ID',
      'Employee',
      'Total Hours', 
      'Total Shifts',
      'Bonus Shifts',
      'Overtime Hours',
      'Holiday Hours',
      'Paid Leave Hours',
      'Unpaid Leave Hours',
      'Morning Shifts',
      'Day Shifts',
      'Afternoon Shifts', 
      'Night Shifts'
    ];

    const csvData = filteredData.map(emp => [
      emp.id,
      emp.name,
      emp.totalHours,
      emp.totalShifts,
      emp.bonusShifts,
      emp.overtimeHours,
      emp.holidayHours,
      emp.paidLeaveHours || 0,
      emp.unpaidLeaveHours || 0,
      emp.shiftsByType.morning.count,
      emp.shiftsByType.day.count,
      emp.shiftsByType.afternoon.count,
      emp.shiftsByType.night.count
    ]);

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employee-hours-${formatDate(weekStart)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export detailed shifts CSV
  const handleExportDetailedCSV = () => {
    const headers = [
      'Employee ID',
      'Employee Name',
      'Date',
      'Shift Type', 
      'Start DateTime',
      'End DateTime',
      'Hours',
      'Is Holiday',
      'Is Overtime',
      'Is Bonus Shift',
      'Leave Type',
      'Leave Hours'
    ];

    const BONUS_ELIGIBLE_SHIFTS = ['morning', 'afternoon', 'night'];

    const csvData = [];
    filteredData.forEach(emp => {
      emp.shifts.forEach(shift => {
        // Check if there's a leave on this shift date
        const leaveOnThisShift = emp.leaves?.find(leave => leave.date === shift.date) || null;
        
        // Determine if this is overtime
        const isOvertime = shift.type === 'overtime';
        
        // Determine if this is a bonus shift (morning, afternoon, night - but NOT overtime or day)
        const isBonusShift = BONUS_ELIGIBLE_SHIFTS.includes(shift.type) && !isOvertime;
        
        csvData.push([
          emp.id,
          emp.name,
          shift.date,
          shift.type,
          // ponytail: stored datetimes are Tbilisi wall-clock with a bogus UTC offset —
          // slice off the offset so toLocaleString doesn't shift them +4h
          shift.startTime ? new Date(shift.startTime.slice(0, 19)).toLocaleString() : '',
          shift.endTime ? new Date(shift.endTime.slice(0, 19)).toLocaleString() : '',
          shift.hours.toFixed(2),
          shift.isHoliday ? 'Yes' : 'No',
          isOvertime ? 'Yes' : 'No',
          isBonusShift ? 'Yes' : 'No',
          leaveOnThisShift ? leaveOnThisShift.type : '',
          leaveOnThisShift ? leaveOnThisShift.hours.toFixed(2) : '0'
        ]);
      });
    });

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `detailed-shifts-${formatDate(weekStart)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Toolbar Card */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-5 py-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">

          {/* Title block */}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 size={18} className="text-blue-500 flex-shrink-0" />
              Employee Hours Report
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">Track hours and shifts for any date range · 8 hrs / shift</p>
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-2">

            {/* From date */}
            <div className="flex items-center gap-1.5 h-10 bg-gray-50 border border-gray-200 rounded-lg px-3 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100 transition-all">
              <Calendar size={13} className="text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-400 whitespace-nowrap select-none">From</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-sm text-gray-700 outline-none border-none w-[7.5rem]"
              />
            </div>

            {/* To date */}
            <div className="flex items-center gap-1.5 h-10 bg-gray-50 border border-gray-200 rounded-lg px-3 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100 transition-all">
              <Calendar size={13} className="text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-400 whitespace-nowrap select-none">To</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-sm text-gray-700 outline-none border-none w-[7.5rem]"
              />
            </div>

            {/* Employee filter */}
            <div className="flex items-center gap-1.5 h-10 bg-gray-50 border border-gray-200 rounded-lg px-3 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100 transition-all">
              <User size={13} className="text-gray-400 flex-shrink-0" />
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                className="bg-transparent text-sm text-gray-700 outline-none border-none appearance-none cursor-pointer pr-1"
              >
                <option value="all">All Employees</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="text-gray-400 flex-shrink-0 pointer-events-none" />
            </div>

            {/* Divider */}
            <div className="hidden sm:block h-6 w-px bg-gray-200" />

            {/* Export dropdown */}
            <div className="relative" ref={exportDropdownRef}>
              <button
                onClick={() => setExportDropdownOpen(v => !v)}
                disabled={filteredData.length === 0}
                className="flex items-center gap-1.5 h-10 px-4 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Download size={14} />
                <span>Export</span>
                <ChevronDown size={13} className={`text-gray-400 transition-transform duration-150 ${exportDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {exportDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1.5 overflow-hidden">
                  <button
                    onClick={() => { handleExportCSV(); setExportDropdownOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <FileText size={14} className="text-gray-400" />
                    Export Summary CSV
                  </button>
                  <button
                    onClick={() => { handleExportDetailedCSV(); setExportDropdownOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Download size={14} className="text-gray-400" />
                    Export Detailed CSV
                  </button>
                  {contextIsAdmin && (
                    <>
                      <div className="my-1 mx-3 border-t border-gray-100" />
                      <button
                        onClick={() => { handleExportToSheets(); setExportDropdownOpen(false); }}
                        disabled={exportingSheetsLoading}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                      >
                        <Sheet size={14} className="text-emerald-500" />
                        {exportingSheetsLoading ? 'Pushing…' : 'Push to Google Sheets'}
                      </button>
                      <button
                        onClick={() => { handlePushToKpi(); setExportDropdownOpen(false); }}
                        disabled={pushingKpi || filteredData.length === 0}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                      >
                        <span className="text-indigo-500 text-base leading-none">⚡️</span>
                        {pushingKpi ? 'Pushing…' : 'Push to KPI Dashboard'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Sheets status inline */}
            {exportSheetsStatus && (
              <span className={`text-xs font-medium ${
                exportSheetsStatus === 'success' ? 'text-emerald-600' : 'text-red-500'
              }`}>
                {exportSheetsStatus === 'success' ? '✓' : '✗'} {exportSheetsMessage}
              </span>
            )}

            {/* KPI push status inline */}
            {kpiPushStatus && (
              <span className={`text-xs font-medium ${
                kpiPushStatus === 'success' ? 'text-indigo-600' : 'text-red-500'
              }`}>
                {kpiPushStatus === 'success' ? '✓ Sent to KPI Dashboard' : '✗ KPI push failed'}
              </span>
            )}

          </div>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-9 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-600 flex items-center space-x-1">
            <span>Total Hours</span>
            <Clock size={14} className="text-gray-400" />
          </p>
          <p className="text-xl font-bold text-blue-600">{summaryStats.totalHours}</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-600 flex items-center space-x-1">
            <span>Total Shifts</span>
            <Calendar size={14} className="text-gray-400" />
          </p>
          <p className="text-xl font-bold text-green-600">{summaryStats.totalShifts}</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-600 flex items-center space-x-1">
            <span>Bonus Shifts</span>
            <span className="text-sm">⭐</span>
          </p>
          <p className="text-xl font-bold text-yellow-600">{summaryStats.totalBonusShifts}</p>
        </div>

        <div className="bg-white rounded-lg border border-red-200 p-4 bg-gradient-to-r from-red-50/50 dark:from-transparent">
          <p className="text-xs font-medium text-gray-600 flex items-center space-x-1">
            <span>Overtime Hours</span>
            <span className="text-sm">⚡</span>
          </p>
          <p className="text-xl font-bold text-red-600">{summaryStats.totalOvertimeHours}</p>
          <p className="text-xs text-red-500">{summaryStats.totalOvertimeShifts} shifts</p>
        </div>

        <div className="bg-white rounded-lg border border-amber-200 p-4 bg-gradient-to-r from-amber-50/50 dark:from-transparent">
          <p className="text-xs font-medium text-gray-600 flex items-center space-x-1">
            <span>Holiday Hours</span>
            <span className="text-sm">🎉</span>
          </p>
          <p className="text-xl font-bold text-amber-600">{summaryStats.totalHolidayHours}</p>
          <p className="text-xs text-amber-500">{summaryStats.totalHolidayShifts} shifts</p>
        </div>

        <div className="bg-white rounded-lg border border-teal-200 p-4 bg-gradient-to-r from-teal-50/50 dark:from-transparent">
          <p className="text-xs font-medium text-gray-600 flex items-center space-x-1">
            <span>Leave Hours</span>
            <span className="text-sm">🏖️</span>
          </p>
          <p className="text-xl font-bold text-teal-600">{summaryStats.totalLeaveHours}</p>
          <p className="text-xs text-teal-500">{summaryStats.totalLeaveCount} leaves</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-600 flex items-center space-x-1">
            <span>Avg Hours</span>
            <BarChart3 size={14} className="text-gray-400" />
          </p>
          <p className="text-xl font-bold text-purple-600">{summaryStats.avgHoursPerEmployee}</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-600 flex items-center space-x-1">
            <span>Max Hours</span>
            <BarChart3 size={14} className="text-gray-400" />
          </p>
          <p className="text-xl font-bold text-orange-600">{summaryStats.maxHours}</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-600 flex items-center space-x-1">
            <span>Active Employees</span>
            <User size={14} className="text-gray-400" />
          </p>
          <p className="text-xl font-bold text-indigo-600">{summaryStats.totalEmployees}</p>
        </div>
      </div>

      {/* Debug/Raw Data Display */}
      {showRaw && (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Debug Info</h3>
          <p className="text-sm text-gray-600 mb-2">Total assignments from app: {assignments.length}</p>
          <p className="text-sm text-gray-600 mb-2">Monthly assignments for {selectedMonth}: {monthlyAssignments.length}</p>
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-700">Raw assignments data</summary>
            <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-60">
              {JSON.stringify(monthlyAssignments.slice(0, 10), null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Employee Hours Table */}
      {isLoadingMonth ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-3 text-gray-600">Loading month data...</span>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Employee Hours Breakdown</h3>
          </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {[{field:'name',label:'Employee',colorClass:'text-gray-500'},
                  {field:'totalHours',label:'Total Hours',colorClass:'text-gray-500'},
                  {field:'totalShifts',label:'Total Shifts',colorClass:'text-gray-500'},
                  {field:'bonusShifts',label:'Bonus Shifts',colorClass:'text-gray-500'},
                  {field:'overtimeHours',label:'Overtime ⚡',colorClass:'text-red-600'},
                  {field:'holidayHours',label:'Holiday Hours 🎉',colorClass:'text-amber-600'},
                  {field:'paidLeaveHours',label:'Paid Leave 💚',colorClass:'text-green-600'},
                  {field:'unpaidLeaveHours',label:'Unpaid Leave 🚫',colorClass:'text-orange-600'},
                  {field:'morning',label:'Morning ⭐',colorClass:'text-gray-500'},
                  {field:'day',label:'Day',colorClass:'text-gray-500'},
                  {field:'afternoon',label:'Afternoon ⭐',colorClass:'text-gray-500'},
                  {field:'night',label:'Night ⭐',colorClass:'text-gray-500'},
                ].map(({field, label, colorClass}) => (
                  <th
                    key={field}
                    onClick={() => handleSort(field)}
                    className={`px-6 py-3 text-left text-xs font-medium ${colorClass} uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100 transition-colors`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortField === field
                        ? (sortDirection === 'asc'
                            ? <ChevronUp size={12} className="shrink-0" />
                            : <ChevronDown size={12} className="shrink-0" />)
                        : <ChevronsUpDown size={12} className="shrink-0 opacity-30" />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200 dark-table-rows">
              {sortedData.map((emp, index) => (
                <motion.tr 
                  key={emp.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`hover:bg-gray-50 ${emp.isRemoved ? 'bg-red-50' : ''}`}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`w-8 h-8 ${emp.isRemoved ? 'bg-red-500' : 'bg-blue-500'} text-white rounded-full flex items-center justify-center text-sm font-semibold`}>
                        {emp.name.charAt(0)}
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900">
                          {emp.name}
                          {emp.isRemoved && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                              Removed
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-gray-900">{roundHours(emp.totalHours)}h</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{emp.totalShifts}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-yellow-600">{emp.bonusShifts}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-red-600">
                      {roundHours(emp.overtimeHours)}h
                      {emp.overtimeShifts > 0 && (
                        <span className="ml-1 text-xs text-red-400">({emp.overtimeShifts})</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-amber-600">
                      {roundHours(emp.holidayHours)}h
                      {emp.holidayShifts > 0 && (
                        <span className="ml-1 text-xs text-amber-400">({emp.holidayShifts})</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-green-600">
                      {roundHours(emp.paidLeaveHours || 0)}h
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-orange-600">
                      {roundHours(emp.unpaidLeaveHours || 0)}h
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {emp.shiftsByType.morning.count}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {emp.shiftsByType.day.count}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {emp.shiftsByType.afternoon.count}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {emp.shiftsByType.night.count}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredData.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <BarChart3 size={48} className="mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium mb-2">No Data Available</h3>
            <p>Generate a schedule to see employee hours data.</p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
/**
 * Request Tab Component
 * Allows employees to request shift swaps with each other
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Clock, User, ArrowRightLeft, Check, X, AlertCircle, UserCheck, Calendar, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { formatTimeRange, formatDate } from '../utils/dateHelpers';
import * as firebaseDB from '../services/firebaseDatabase';
import { useAuth } from '../contexts/AuthContext';
import CustomDatePicker from './CustomDatePicker';
import * as emailService from '../services/emailService';

// Employee email mapping
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

export default function RequestTab({ 
  employees = [], 
  assignments = [], 
  weekStart,
  onSwapRequest,
  isTestingAsEmployee = false,
  showAlert,
  showConfirm
}) {
  const { user, isAdmin: contextIsAdmin } = useAuth();
  const [activeRequestTab, setActiveRequestTab] = useState('create');
  const [loading, setLoading] = useState(false);
  
  // Selection state for "Your Shift"
  const [yourShiftSelection, setYourShiftSelection] = useState({
    week: '',
    shiftType: '',
    shift: null,
    selectedDate: ''
  });
  
  // Selection state for "Swap With"
  const [swapWithSelection, setSwapWithSelection] = useState({
    week: '',
    shiftType: '',
    shift: null,
    selectedDate: ''
  });

  const [swapRequests, setSwapRequests] = useState([]);
  const [freeShiftRequests, setFreeShiftRequests] = useState([]);
  const [overtimeRequests, setOvertimeRequests] = useState([]);
  // History sort / filter state
  const [historySortField, setHistorySortField] = useState('date'); // 'date'|'employeeName'|'status'|'requestType'
  const [historySortDir, setHistorySortDir] = useState('desc');     // 'asc'|'desc'
  const [historyFilterStatus, setHistoryFilterStatus] = useState('');
  const [historyFilterType, setHistoryFilterType] = useState('');
  const [historyFilterEmployee, setHistoryFilterEmployee] = useState('');
  const [historyFilterDateFrom, setHistoryFilterDateFrom] = useState('');
  const [historyFilterDateTo, setHistoryFilterDateTo] = useState('');
  
  // Overtime request state
  const [overtimeRequest, setOvertimeRequest] = useState({
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: ''
  });

  // Load shift swap requests from Firebase on mount
  useEffect(() => {
    loadSwapRequests();
    loadFreeShiftRequests();
    loadOvertimeRequests();
  }, []);

  const loadSwapRequests = async () => {
    setLoading(true);
    try {
      const requests = await firebaseDB.getShiftSwapRequests(user);
      setSwapRequests(requests || []);
      console.log('Loaded shift swap requests from Firebase:', requests?.length || 0);
    } catch (err) {
      console.error('Failed to load shift swap requests:', err);
    } finally {
      setLoading(false);
    }
  };
  
  const loadFreeShiftRequests = async () => {
    try {
      const requests = await firebaseDB.getFreeShiftClaimRequests(user);
      setFreeShiftRequests(requests || []);
      console.log('Loaded free shift claim requests from Firebase:', requests?.length || 0);
    } catch (err) {
      console.error('Failed to load free shift claim requests:', err);
    }
  };
  
  const loadOvertimeRequests = async () => {
    try {
      const requests = await firebaseDB.getOvertimeRequests(user);
      setOvertimeRequests(requests || []);
      console.log('Loaded overtime requests from Firebase:', requests?.length || 0);
    } catch (err) {
      console.error('Failed to load overtime requests:', err);
    }
  };

  // Available weeks loaded from Firebase
  const [availableWeeks, setAvailableWeeks] = useState([]);

  useEffect(() => {
    let mounted = true;
    const loadWeeks = async () => {
      setLoading(true);
      try {
        const weeks = [];
        const currentWeek = new Date(weekStart);
        // local helper to compute week label (avoids depending on formatWeekRange defined later)
        const computeWeekRangeLabel = (startDate) => {
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 6);
          const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
          const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
          const startDay = startDate.getDate();
          const endDay = endDate.getDate();
          const year = startDate.getFullYear();
          if (startMonth === endMonth) {
            return `${startMonth} ${startDay}-${endDay}, ${year}`;
          } else {
            return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
          }
        };
        for (let i = 0; i < 8; i++) {
          const weekDate = new Date(currentWeek);
          weekDate.setDate(weekDate.getDate() + (i * 7));
          const weekKey = formatDate(weekDate);
          try {
            const weekData = await firebaseDB.loadScheduleFromFirebase(weekKey, user || null);
            if (weekData && weekData.assignments && weekData.assignments.length > 0) {
              weeks.push({ startDate: weekDate, label: computeWeekRangeLabel(weekDate), assignments: weekData.assignments });
            }
          } catch (e) {
            // ignore missing weeks
          }
        }
        if (mounted) setAvailableWeeks(weeks);
      } catch (err) {
        console.error('Failed to load available weeks from Firebase:', err);
      } finally {
        setLoading(false);
      }
    };
    loadWeeks();
    return () => { mounted = false; };
  }, [weekStart, user]);
  
  // Helper function to format week range
  const formatWeekRange = (startDate) => {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    
    const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
    const startDay = startDate.getDate();
    const endDay = endDate.getDate();
    const year = startDate.getFullYear();
    
    if (startMonth === endMonth) {
      return `${startMonth} ${startDay}-${endDay}, ${year}`;
    } else {
      return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
    }
  };
  
  // Get the current user's employee ID based on their email
  const getCurrentUserEmployeeId = () => {
    if (!user?.email) return null;
    const currentEmployee = employees.find(e => 
      e.email?.toLowerCase() === user.email.toLowerCase()
    );
    return currentEmployee?.id || null;
  };

  // Get filtered assignments based on current selection
  const getFilteredAssignments = (selection, availableWeeks, onlyOwnShifts = false) => {
    if (!selection.week) return [];
    // Allow matching by week label or by ISO startDate string (YYYY-MM-DD)
    const selectedWeek = availableWeeks.find(w => {
      try {
        const iso = w.startDate.toISOString().slice(0,10);
        return w.label === selection.week || iso === selection.week;
      } catch (e) {
        return w.label === selection.week;
      }
    });
    if (!selectedWeek) return [];
    
    let filtered = selectedWeek.assignments;
    
    // Filter to only current user's shifts if onlyOwnShifts is true
    if (onlyOwnShifts) {
      const currentUserEmpId = getCurrentUserEmployeeId();
      if (!currentUserEmpId) {
        console.warn('Cannot filter own shifts: current user not found in employee list');
        return [];
      }
      filtered = filtered.filter(a => a.employee_id === currentUserEmpId);
    }
    
    if (selection.shiftType) {
      filtered = filtered.filter(a => a.shift_type === selection.shiftType);
    }

    // If a specific date was selected (date picker), filter assignments to that date only
    if (selection.selectedDate) {
      filtered = filtered.filter(a => {
        try {
          const aDate = new Date(a.date).toISOString().slice(0,10);
          return aDate === selection.selectedDate;
        } catch (e) {
          return false;
        }
      });
    }
    
    return filtered;
  };

  // Get shift type emoji
  const getShiftEmoji = (shiftType) => {
    const emojis = {
      'morning': '🌅',
      'day': '☀️',
      'afternoon': '🌇',
      'night': '🌙'
    };
    return emojis[shiftType] || '⏰';
  };

  // Get display name for shift type
  const getShiftDisplayName = (shiftType) => {
    const displayNames = {
      'morning': 'Morning',
      'day': 'Day',
      'afternoon': 'Afternoon',
      'night': 'Night'
    };
    return displayNames[shiftType] || shiftType;
  };
  
  // Get unique shift types from selected week in proper order
  const getAvailableShiftTypes = (selection, availableWeeks) => {
    const weekAssignments = getFilteredAssignments({ week: selection.week }, availableWeeks);
    const availableTypes = [...new Set(weekAssignments.map(a => a.shift_type))];
    
    // Define the correct order
    const shiftOrder = ['morning', 'day', 'afternoon', 'night'];
    
    // Return shift types in the correct order, only including those that are available
    return shiftOrder.filter(shiftType => availableTypes.includes(shiftType));
  };
  

  // Helper to check if current user can approve as employee (only the target employee)
  const canUserApproveAsEmployee = (request) => {
    // If admin is testing as employee, allow them to approve on behalf of anyone
    if (isAdmin() && isTestingAsEmployee) return true;

    // 1. Try to find email in the loaded employees list (from CSV/Firebase)
    const employeeRecord = employees.find(e => e.name === request.targetEmployee);
    let targetEmployeeEmail = employeeRecord ? employeeRecord.email : null;

    // 2. Fallback to hardcoded list if not found in loaded employees
    if (!targetEmployeeEmail) {
      targetEmployeeEmail = EMPLOYEE_EMAILS[request.targetEmployee];
    }

    return user?.email === targetEmployeeEmail;
  };

  // Helper to check if user is admin (only the two specific admin emails)
  const isAdmin = () => !!contextIsAdmin;

  // Helper to format shift info for emails
  const formatShiftForEmail = (shift) => {
    if (!shift) return { date: '', time: '', type: '' };
    const date = new Date(shift.date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const startTime = shift.start_datetime?.substring(11, 16) || '';
    const endTime = shift.end_datetime?.substring(11, 16) || '';
    const type = shift.shift_type?.charAt(0).toUpperCase() + shift.shift_type?.slice(1) || '';
    return { date, time: `${startTime} - ${endTime}`, type };
  };

  // Helper to get employee email
  const getEmployeeEmail = (employeeName) => {
    const employeeRecord = employees.find(e => e.name === employeeName);
    if (employeeRecord && employeeRecord.email) return employeeRecord.email;
    return EMPLOYEE_EMAILS[employeeName] || null;
  };

  // Helper to send employee request email
  const sendRequestEmail = async (request) => {
    try {
      const targetEmail = getEmployeeEmail(request.targetEmployee);
      
      if (!targetEmail) {
        console.warn(`Could not find email for ${request.targetEmployee}`);
        return;
      }

      const originalShift = formatShiftForEmail(request.originalShift);
      const targetShift = formatShiftForEmail(request.targetShift);

      await emailService.sendSwapRequestEmail({
        email: targetEmail,
        isRequest: true,
        requesterName: request.requester,
        targetEmployeeName: request.targetEmployee,
        originalDate: originalShift.date,
        originalShiftType: originalShift.type,
        originalTime: originalShift.time,
        targetDate: targetShift.date,
        targetShiftType: targetShift.type,
        targetTime: targetShift.time
      });
      console.log('Request email sent to', targetEmail);
    } catch (err) {
      console.error('Failed to send request email:', err);
    }
  };

  // Helper to send employee approval notification
  const sendApprovalEmail = async (request) => {
    try {
      const requesterEmail = getEmployeeEmail(request.requester);
      
      if (!requesterEmail) {
        console.warn(`Could not find email for ${request.requester}`);
        return;
      }

      const originalShift = formatShiftForEmail(request.originalShift);
      const targetShift = formatShiftForEmail(request.targetShift);

      await emailService.sendSwapRequestEmail({
        email: requesterEmail,
        isApproved: true,
        requesterName: request.requester,
        targetEmployeeName: request.targetEmployee,
        originalDate: originalShift.date,
        originalShiftType: originalShift.type,
        originalTime: originalShift.time,
        targetDate: targetShift.date,
        targetShiftType: targetShift.type,
        targetTime: targetShift.time
      });
      console.log('Approval email sent to', requesterEmail);
    } catch (err) {
      console.error('Failed to send approval email:', err);
    }
  };

  // Helper to send admin review notification
  const sendAdminReviewEmail = async (request, adminEmails) => {
    try {
      const originalShift = formatShiftForEmail(request.originalShift);
      const targetShift = formatShiftForEmail(request.targetShift);

      for (const adminEmail of adminEmails) {
        await emailService.sendSwapReadyForReviewEmail({
          email: adminEmail,
          isReadyForReview: true,
          requesterName: request.requester,
          targetEmployeeName: request.targetEmployee,
          originalDate: originalShift.date,
          originalShiftType: originalShift.type,
          originalTime: originalShift.time,
          targetDate: targetShift.date,
          targetShiftType: targetShift.type,
          targetTime: targetShift.time
        });
      }
      console.log('Admin review email sent');
    } catch (err) {
      console.error('Failed to send admin review email:', err);
    }
  };

  // Helper to send finalization notification
  const sendFinalizationEmails = async (request, status) => {
    try {
      const requesterEmail = getEmployeeEmail(request.requester);
      const targetEmail = getEmployeeEmail(request.targetEmployee);
      const originalShift = formatShiftForEmail(request.originalShift);
      const targetShift = formatShiftForEmail(request.targetShift);

      if (status === 'approved') {
        // Send finalized emails to both employees
        const emailData = {
          isFinalized: true,
          originalDate: originalShift.date,
          originalShiftType: originalShift.type,
          originalTime: originalShift.time,
          targetDate: targetShift.date,
          targetShiftType: targetShift.type,
          targetTime: targetShift.time
        };

        if (requesterEmail) {
          await emailService.sendSwapReadyForReviewEmail({
            ...emailData,
            email: requesterEmail,
            employeeName: request.requester,
            newDate: targetShift.date,
            newShiftType: targetShift.type,
            newTime: targetShift.time
          });
        }

        if (targetEmail) {
          await emailService.sendSwapReadyForReviewEmail({
            ...emailData,
            email: targetEmail,
            employeeName: request.targetEmployee,
            newDate: originalShift.date,
            newShiftType: originalShift.type,
            newTime: originalShift.time
          });
        }
        console.log('Finalization emails sent');
      } else if (status === 'rejected') {
        // Rejection emails removed - no notification sent on rejection
      }
    } catch (err) {
      console.error('Failed to send finalization email:', err);
    }
  };

  const handleEmployeeApprove = async (requestId) => {
    try {
      const request = swapRequests.find(req => req.id === requestId);
      if (!request) return;

      setLoading(true);

      // Apply the shift swap immediately upon employee approval
      const swapResult = await firebaseDB.applyShiftSwap(request, user);
      if (!swapResult.success) {
        await showAlert(`Failed to apply shift swap: ${swapResult.error}`, 'Error', 'error');
        setLoading(false);
        return;
      }

      // Update the request status to approved
      await firebaseDB.updateShiftSwapRequestStatus(requestId, 'approved', user);
      setSwapRequests(prev =>
        prev.map(req =>
          req.id === requestId
            ? { ...req, status: 'approved' }
            : req
        )
      );

      // Clear localStorage cache for affected weeks
      try {
        const getWeekStart = (dateStr) => {
          const date = new Date(dateStr);
          const day = date.getDay();
          const diff = (day + 6) % 7;
          const monday = new Date(date);
          monday.setDate(date.getDate() - diff);
          return monday.toISOString().slice(0, 10);
        };
        const originalWeekKey = `schedule-${getWeekStart(request.originalShift.date)}`;
        const targetWeekKey = `schedule-${getWeekStart(request.targetShift.date)}`;
        localStorage.removeItem(originalWeekKey);
        if (originalWeekKey !== targetWeekKey) {
          localStorage.removeItem(targetWeekKey);
        }
      } catch (err) {
        console.warn('Failed to clear localStorage cache:', err);
      }

      // Send finalization emails to both employees
      await sendFinalizationEmails(request, 'approved');

      // Trigger schedule reload
      if (onSwapRequest) {
        await onSwapRequest();
      }

      setLoading(false);
      await showAlert('Shift swap approved and applied successfully!', 'Success', 'success');
    } catch (err) {
      console.error('Failed to approve request as employee:', err);
      setLoading(false);
      await showAlert('Failed to approve request. Please try again.', 'Error', 'error');
    }
  };

  const handleApproveRequest = async (requestId) => {
    try {
      const request = swapRequests.find(req => req.id === requestId);
      if (!request) return;

      setLoading(true);

      // First apply the shift swap to the schedule data
      const swapResult = await firebaseDB.applyShiftSwap(request, user);
      if (!swapResult.success) {
        await showAlert(`Failed to apply shift swap: ${swapResult.error}`, 'Error', 'error');
        setLoading(false);
        return;
      }

      // Then update the request status
      await firebaseDB.updateShiftSwapRequestStatus(requestId, 'approved', user);
      setSwapRequests(prev => 
        prev.map(req => 
          req.id === requestId 
            ? { ...req, status: 'approved' }
            : req
        )
      );
      
      // Clear localStorage cache for affected weeks to force fresh reload from Firebase
      try {
        const getWeekStart = (dateStr) => {
          const date = new Date(dateStr);
          const day = date.getDay();
          const diff = (day + 6) % 7;
          const monday = new Date(date);
          monday.setDate(date.getDate() - diff);
          return monday.toISOString().slice(0, 10);
        };
        
        const originalWeekKey = `schedule-${getWeekStart(request.originalShift.date)}`;
        const targetWeekKey = `schedule-${getWeekStart(request.targetShift.date)}`;
        
        localStorage.removeItem(originalWeekKey);
        if (originalWeekKey !== targetWeekKey) {
          localStorage.removeItem(targetWeekKey);
        }
        console.log('Cleared localStorage cache for affected weeks');
      } catch (err) {
        console.warn('Failed to clear localStorage cache:', err);
      }
      
      // Send finalization emails to both employees
      await sendFinalizationEmails(request, 'approved');
      
      // Trigger a reload of the schedule in the parent app
      if (onSwapRequest) {
        await onSwapRequest(); // Wait for schedule to reload
      }
      
      setLoading(false);
      await showAlert('Shift swap approved and applied successfully!', 'Success', 'success');
      console.log('Approved and applied shift swap request:', requestId);
    } catch (err) {
      console.error('Failed to approve request:', err);
      setLoading(false);
      await showAlert('Failed to approve request. Please try again.', 'Error', 'error');
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      const request = swapRequests.find(req => req.id === requestId);
      if (!request) return;
      
      await firebaseDB.updateShiftSwapRequestStatus(requestId, 'rejected', user);
      setSwapRequests(prev => 
        prev.map(req => 
          req.id === requestId 
            ? { ...req, status: 'rejected' }
            : req
        )
      );
      
      // Send rejection emails to both employees
      await sendFinalizationEmails(request, 'rejected');
      
      console.log('Rejected shift swap request:', requestId);
    } catch (err) {
      console.error('Failed to reject request:', err);
      await showAlert('Failed to reject request. Please try again.', 'Error', 'error');
    }
  };
  
  // Handle free shift claim request approval
  const handleApproveFreeShiftRequest = async (requestId) => {
    const confirmed = await showConfirm('Are you sure you want to approve this free shift claim request?', 'Confirm Approval');
    if (!confirmed) {
      return;
    }
    
    try {
      const result = await firebaseDB.updateFreeShiftClaimRequestStatus(requestId, 'approved', user);
      if (result.success) {
        setFreeShiftRequests(prev => 
          prev.map(req => req.id === requestId ? { ...req, status: 'approved' } : req)
        );
        await showAlert('Free shift claim request approved!', 'Success', 'success');
        await loadFreeShiftRequests();
        // Reload schedule data to show new shift
        if (onSwapRequest) {
          await onSwapRequest();
        }
      } else {
        await showAlert('Failed to approve request.', 'Error', 'error');
      }
    } catch (err) {
      console.error('Failed to approve free shift request:', err);
      await showAlert('Failed to approve request.', 'Error', 'error');
    }
  };
  
  const handleRejectFreeShiftRequest = async (requestId) => {
    const confirmed = await showConfirm('Are you sure you want to reject this free shift claim request?', 'Confirm Rejection');
    if (!confirmed) {
      return;
    }
    
    try {
      const result = await firebaseDB.updateFreeShiftClaimRequestStatus(requestId, 'rejected', user);
      if (result.success) {
        setFreeShiftRequests(prev => 
          prev.map(req => req.id === requestId ? { ...req, status: 'rejected' } : req)
        );
        await showAlert('Free shift claim request rejected.', 'Rejected', 'warning');
        await loadFreeShiftRequests();
        // Reload schedule data to update free shifts display
        if (onSwapRequest) {
          await onSwapRequest();
        }
      } else {
        await showAlert('Failed to reject request.', 'Error', 'error');
      }
    } catch (err) {
      console.error('Failed to reject free shift request:', err);
      await showAlert('Failed to reject request.', 'Error', 'error');
    }
  };
  
  // Overtime request handlers
  const handleSubmitOvertimeRequest = async () => {
    const { startDate, startTime, endDate, endTime } = overtimeRequest;
    
    // Validate inputs
    if (!startDate || !startTime || !endDate || !endTime) {
      await showAlert('Please fill in all fields', 'Validation Error', 'warning');
      return;
    }
    
    // Calculate duration in hours
    const startDateTime = new Date(`${startDate}T${startTime}:00`);
    const endDateTime = new Date(`${endDate}T${endTime}:00`);
    const durationMs = endDateTime - startDateTime;
    const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(2);
    
    if (durationHours <= 0) {
      await showAlert('End time must be after start time', 'Validation Error', 'warning');
      return;
    }
    
    // Get current user's employee info
    const currentUserEmpId = getCurrentUserEmployeeId();
    const currentEmployee = employees.find(e => e.id === currentUserEmpId);
    
    if (!currentEmployee) {
      await showAlert('Could not find your employee information', 'Error', 'error');
      return;
    }
    
    setLoading(true);
    try {
      const requestData = {
        employeeId: currentUserEmpId,
        employeeName: currentEmployee.name,
        startDate,
        startTime,
        endDate,
        endTime,
        durationHours,
        status: 'pending'
      };
      
      const result = await firebaseDB.createOvertimeRequest(requestData, user);
      
      if (result.success) {
        await loadOvertimeRequests();
        setOvertimeRequest({ startDate: '', startTime: '', endDate: '', endTime: '' });
        await showAlert('Overtime request submitted successfully!', 'Success', 'success');
      } else {
        await showAlert('Failed to submit overtime request. Please try again.', 'Error', 'error');
      }
    } catch (err) {
      console.error('Failed to create overtime request:', err);
      await showAlert('Failed to submit overtime request. Please try again.', 'Error', 'error');
    } finally {
      setLoading(false);
    }
  };
  
  const handleApproveOvertimeRequest = async (requestId) => {
    const confirmed = await showConfirm('Are you sure you want to approve this overtime request?', 'Confirm Approval');
    if (!confirmed) {
      return;
    }
    
    try {
      const result = await firebaseDB.updateOvertimeRequestStatus(requestId, 'approved', user);
      if (result.success) {
        setOvertimeRequests(prev => 
          prev.map(req => req.id === requestId ? { ...req, status: 'approved' } : req)
        );
        await showAlert('Overtime request approved!', 'Success', 'success');
        await loadOvertimeRequests();
        // Reload schedule data to show new overtime shift
        if (onSwapRequest) {
          await onSwapRequest();
        }
      } else {
        await showAlert('Failed to approve request.', 'Error', 'error');
      }
    } catch (err) {
      console.error('Failed to approve overtime request:', err);
      await showAlert('Failed to approve request.', 'Error', 'error');
    }
  };
  
  const handleRejectOvertimeRequest = async (requestId) => {
    const confirmed = await showConfirm('Are you sure you want to reject this overtime request?', 'Confirm Rejection');
    if (!confirmed) {
      return;
    }
    
    try {
      const result = await firebaseDB.updateOvertimeRequestStatus(requestId, 'rejected', user);
      if (result.success) {
        setOvertimeRequests(prev => 
          prev.map(req => req.id === requestId ? { ...req, status: 'rejected' } : req)
        );
        await showAlert('Overtime request rejected.', 'Rejected', 'warning');
        await loadOvertimeRequests();
      } else {
        await showAlert('Failed to reject request.', 'Error', 'error');
      }
    } catch (err) {
      console.error('Failed to reject overtime request:', err);
      await showAlert('Failed to reject request.', 'Error', 'error');
    }
  };

  // Hierarchical Shift Selector Component
  const HierarchicalShiftSelector = ({ selection, onSelectionChange, title, onlyOwnShifts = false }) => {
    const handleWeekChange = (week, selectedDate = '') => {
      onSelectionChange({
        week,
        shiftType: '',
        shift: null,
        selectedDate: selectedDate || ''
      });
    };

    const handleShiftTypeChange = (shiftType) => {
      onSelectionChange({
        ...selection,
        shiftType,
        shift: null
      });
    };

    const handleShiftChange = (shift) => {
      onSelectionChange({
        ...selection,
        shift
      });
    };

    const availableShiftTypes = getAvailableShiftTypes(selection, availableWeeks);
    const availableShifts = getFilteredAssignments(selection, availableWeeks, onlyOwnShifts);

    // Calculate date range for the picker (from first available week to 8 weeks out)
    let minDate = '';
    let maxDate = '';
    if (availableWeeks.length > 0) {
      const firstWeek = availableWeeks[0].startDate;
      const lastWeek = availableWeeks[availableWeeks.length - 1].startDate;
      minDate = new Date(firstWeek.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 1 week before first
      maxDate = new Date(lastWeek.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 2 weeks after last
    }

    return (
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">
          {title}
        </label>
        
        {/* Week Selection (now a date picker) */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            1. Pick a Day (select any day in the week you want)
          </label>
          <CustomDatePicker
            value={selection.selectedDate || ''}
            min={minDate}
            max={maxDate}
            onChange={(e) => {
              const dateStr = e.target.value;
              if (!dateStr) return handleWeekChange('', '');
              const d = new Date(dateStr + 'T00:00:00');
              // compute Monday of the week (weekStartsOn: 1)
              const day = d.getDay(); // 0=Sun,1=Mon...
              const diff = (day + 6) % 7; // days since Monday
              const monday = new Date(d);
              monday.setDate(d.getDate() - diff);
              const label = formatWeekRange(monday);
              // Pass both week label and exact selected date (YYYY-MM-DD) so filtering by day works
              handleWeekChange(label, dateStr);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {/* Show computed week label when a date is selected */}
          {selection.week && (
            <div className="mt-2 text-sm text-gray-600">Week: {selection.week}</div>
          )}
        </div>

        {/* Shift Type Selection */}
        {selection.week && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              2. Select Shift Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {availableShiftTypes.length > 0 ? (
                availableShiftTypes.map((shiftType) => (
                  <button
                    key={shiftType}
                    onClick={() => handleShiftTypeChange(shiftType)}
                    className={`p-3 rounded-lg border-2 transition-all font-medium text-sm ${
                      selection.shiftType === shiftType
                        ? 'border-blue-500 bg-blue-50 text-blue-900 shadow-md'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-lg mb-1">{getShiftEmoji(shiftType)}</div>
                    <div>{getShiftDisplayName(shiftType)}</div>
                  </button>
                ))
              ) : (
                <p className="text-gray-500 text-sm col-span-2 text-center py-3">
                  No shift types available
                </p>
              )}
            </div>
          </div>
        )}

        {/* Specific Shift Selection */}
        {selection.week && selection.shiftType && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              3. Select Specific Shift
            </label>
            <div 
              className="space-y-2 max-h-96 overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50"
              onWheel={(e) => e.stopPropagation()}
            >
              {availableShifts.map((shift, index) => (
                <button
                  key={`${shift.date}-${shift.shift_type}-${shift.employee_id}`}
                  onClick={() => handleShiftChange(shift)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                    selection.shift && 
                    selection.shift.date === shift.date && 
                    selection.shift.shift_type === shift.shift_type && 
                    selection.shift.employee_id === shift.employee_id
                      ? 'border-blue-500 bg-blue-50 shadow-md' 
                      : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">
                        {getShiftEmoji(shift.shift_type)} {getShiftDisplayName(shift.shift_type)}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        {formatDate(new Date(shift.date))}
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ml-2 ${
                      selection.shift && 
                      selection.shift.date === shift.date && 
                      selection.shift.shift_type === shift.shift_type && 
                      selection.shift.employee_id === shift.employee_id
                        ? 'border-blue-600 bg-blue-600' 
                        : 'border-gray-400 bg-white'
                    }`}>
                      {selection.shift && 
                       selection.shift.date === shift.date && 
                       selection.shift.shift_type === shift.shift_type && 
                       selection.shift.employee_id === shift.employee_id && (
                        <div className="w-2 h-2 rounded-full bg-white"></div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-gray-600 flex items-center">
                      <span className="font-medium">Time:</span>
                      <span className="ml-2">
                        {shift.shift_type === 'custom'
                          ? `${shift.start_time}-${shift.finish_time}`
                          : formatTimeRange(shift.start_datetime, shift.end_datetime)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 flex items-center">
                      <span className="font-medium">Employee:</span>
                      <span className="ml-2">{shift.employee_name}</span>
                    </div>
                  </div>
                </button>
              ))}
              {availableShifts.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-gray-500 text-sm">
                    No shifts available for selected criteria
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
        <button
          onClick={() => setActiveRequestTab('create')}
          className={`flex-1 px-4 py-2 rounded-md transition-colors ${
            activeRequestTab === 'create'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Create Request
        </button>
        <button
          onClick={() => setActiveRequestTab('pending')}
          className={`flex-1 px-4 py-2 rounded-md transition-colors ${
            activeRequestTab === 'pending'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Pending Requests ({swapRequests.filter(r => r.status === 'pending').length})
        </button>
        <button
          onClick={() => setActiveRequestTab('history')}
          className={`flex-1 px-4 py-2 rounded-md transition-colors ${
            activeRequestTab === 'history'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Request History
        </button>
      </div>

      {/* Create Request Tab */}
      {activeRequestTab === 'create' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-lg border border-gray-200 p-6"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
            <ArrowRightLeft size={20} />
            <span>Request Shift Swap</span>
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Select Your Shift */}
            <div>
              <HierarchicalShiftSelector
                selection={yourShiftSelection}
                onSelectionChange={setYourShiftSelection}
                title="Select Your Shift to Swap"
                onlyOwnShifts={true}
              />
            </div>

            {/* Request Swap With */}
            <div>
              <HierarchicalShiftSelector
                selection={swapWithSelection}
                onSelectionChange={setSwapWithSelection}
                title="Request Swap With"
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="mt-6 flex justify-center">
            <button
              onClick={async () => {
                if (yourShiftSelection.shift && swapWithSelection.shift) {
                  // Validate that "Your Shift" belongs to the current user
                  const currentUserEmpId = getCurrentUserEmployeeId();
                  if (yourShiftSelection.shift.employee_id !== currentUserEmpId) {
                    await showAlert('You can only request a swap for your own shifts. Please select one of your assigned shifts.', 'Validation Error', 'warning');
                    return;
                  }

                  setLoading(true);
                  try {
                    // Create swap request
                    const requestData = {
                      requester: yourShiftSelection.shift.employee_name,
                      requesterId: yourShiftSelection.shift.employee_id,
                      requesterEmail: user?.email || null,
                      targetEmployee: swapWithSelection.shift.employee_name,
                      targetEmployeeId: swapWithSelection.shift.employee_id,
                      originalShift: yourShiftSelection.shift,
                      targetShift: swapWithSelection.shift,
                      status: 'pending'
                    };
                    
                    const result = await firebaseDB.createShiftSwapRequest(requestData, user);
                    
                    if (result.success) {
                      // Reload requests from Firebase
                      await loadSwapRequests();
                      
                      // Send request email to target employee
                      const createdRequest = result.request || { ...requestData, id: result.id };
                      await sendRequestEmail(createdRequest);
                      
                      // Reset selections
                      setYourShiftSelection({ week: '', shiftType: '', shift: null });
                      setSwapWithSelection({ week: '', shiftType: '', shift: null });
                      
                      // Switch to pending tab
                      setActiveRequestTab('pending');
                      
                      await showAlert('Shift swap request submitted successfully!', 'Success', 'success');
                    } else {
                      await showAlert('Failed to submit request. Please try again.', 'Error', 'error');
                    }
                  } catch (err) {
                    console.error('Failed to create swap request:', err);
                    await showAlert('Failed to submit request. Please try again.', 'Error', 'error');
                  } finally {
                    setLoading(false);
                  }
                } else {
                  await showAlert('Please select both shifts to swap', 'Validation Error', 'warning');
                }
              }}
              disabled={!yourShiftSelection.shift || !swapWithSelection.shift || loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Submitting...' : 'Submit Swap Request'}
            </button>
          </div>
        </motion.div>
      )}
      
      {/* Request Overtime Box */}
      {activeRequestTab === 'create' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-lg border border-gray-200 p-6 mt-6"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
            <Clock size={20} />
            <span>Request Overtime</span>
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Start Date & Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Date & Time
              </label>
              <div className="space-y-3">
                <input
                  type="date"
                  value={overtimeRequest.startDate}
                  onChange={(e) => setOvertimeRequest(prev => ({ ...prev, startDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  type="time"
                  value={overtimeRequest.startTime}
                  onChange={(e) => setOvertimeRequest(prev => ({ ...prev, startTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* End Date & Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Date & Time
              </label>
              <div className="space-y-3">
                <input
                  type="date"
                  value={overtimeRequest.endDate}
                  onChange={(e) => setOvertimeRequest(prev => ({ ...prev, endDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  type="time"
                  value={overtimeRequest.endTime}
                  onChange={(e) => setOvertimeRequest(prev => ({ ...prev, endTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Duration Display */}
          {overtimeRequest.startDate && overtimeRequest.startTime && overtimeRequest.endDate && overtimeRequest.endTime && (() => {
            const startDateTime = new Date(`${overtimeRequest.startDate}T${overtimeRequest.startTime}:00`);
            const endDateTime = new Date(`${overtimeRequest.endDate}T${overtimeRequest.endTime}:00`);
            const durationMs = endDateTime - startDateTime;
            const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(2);
            return durationHours > 0 && (
              <div className="mt-4 p-3 bg-blue-50 rounded-md border border-blue-200">
                <p className="text-sm text-blue-800">
                  <strong>Duration:</strong> {durationHours} hours
                </p>
              </div>
            );
          })()}

          {/* Submit Button */}
          <div className="mt-6 flex justify-center">
            <button
              onClick={handleSubmitOvertimeRequest}
              disabled={!overtimeRequest.startDate || !overtimeRequest.startTime || !overtimeRequest.endDate || !overtimeRequest.endTime || loading}
              className="px-6 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Submitting...' : 'Submit Overtime Request'}
            </button>
          </div>
        </motion.div>
      )}

      {/* Pending Requests Tab */}
      {activeRequestTab === 'pending' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {swapRequests.filter(req => req.status === 'pending').length === 0 &&
           freeShiftRequests.filter(req => req.status === 'pending').length === 0 &&
           overtimeRequests.filter(req => req.status === 'pending').length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <Clock className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Pending Requests</h3>
              <p className="text-gray-500">Create a swap request, claim a free shift, or request overtime to get started.</p>
            </div>
          ) : (
            <div className="space-y-6">

              {/* ── Group 1: Free Shift Claims (admin approval) ── */}
              {freeShiftRequests.filter(req => req.status === 'pending').length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-100 border border-green-200 text-green-800 rounded-lg mb-3">
                    <Check size={15} className="flex-shrink-0" />
                    <span className="font-semibold text-sm">Ready to Approve</span>
                    <span className="ml-auto text-xs font-medium bg-green-200 px-2 py-0.5 rounded-full">
                      {freeShiftRequests.filter(req => req.status === 'pending').length}
                    </span>
                  </div>
                  <div className="space-y-4">

                    {/* Free Shift Claim Requests */}
                    {freeShiftRequests
                      .filter(req => req.status === 'pending')
                      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                      .map((request) => (
                        <motion.div
                          key={request.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border-2 border-green-200 p-6"
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-2">
                                <div className="bg-green-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                                  FREE SHIFT CLAIM
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <User size={16} className="text-green-600" />
                                <span className="font-semibold text-green-900">{request.requesterName}</span>
                                <span className="text-gray-600">requested</span>
                                <span className="font-semibold text-green-900">{request.shiftType} shift</span>
                              </div>
                              <div className="mt-3 space-y-1 bg-white/50 p-3 rounded-md">
                                <div className="text-sm text-gray-700 flex items-center space-x-2">
                                  <Calendar size={14} className="text-gray-500" />
                                  <span className="font-medium">
                                    {formatDate(new Date(request.date), 'EEEE, MMMM d, yyyy')}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600">
                                  <strong>Employee:</strong> {request.requesterEmail || request.createdBy}
                                </div>
                                {request.createdAt && (
                                  <div className="text-xs text-gray-500">
                                    <strong>Requested:</strong> {formatDate(new Date(request.createdAt), 'MMM d, yyyy h:mm a')}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          {contextIsAdmin && (
                            <div className="flex items-center space-x-2 pt-4 border-t border-green-200">
                              <button
                                onClick={() => handleApproveFreeShiftRequest(request.id)}
                                className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
                              >
                                <Check size={16} />
                                <span>Approve</span>
                              </button>
                              <button
                                onClick={() => handleRejectFreeShiftRequest(request.id)}
                                className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors font-medium"
                              >
                                <X size={16} />
                                <span>Reject</span>
                              </button>
                            </div>
                          )}
                          {!contextIsAdmin && (
                            <div className="mt-4 text-xs text-gray-600 bg-white/50 p-2 rounded-md">
                              ⏳ Waiting for admin approval
                            </div>
                          )}
                        </motion.div>
                      ))}

                  </div>
                </div>
              )}

              {/* ── Group 2: Pending Swap Requests ── */}
              {swapRequests.filter(req => req.status === 'pending').length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-3 py-2 bg-yellow-100 border border-yellow-200 text-yellow-800 rounded-lg mb-3">
                    <ArrowRightLeft size={15} className="flex-shrink-0" />
                    <span className="font-semibold text-sm">Pending Swap Requests</span>
                    <span className="ml-auto text-xs font-medium bg-yellow-200 px-2 py-0.5 rounded-full">
                      {swapRequests.filter(req => req.status === 'pending').length}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {swapRequests
                      .filter(req => req.status === 'pending')
                      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
                      .map((request) => (
                        <motion.div
                          key={request.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="bg-white rounded-lg border border-gray-200 p-6"
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2">
                                <User size={16} className="text-gray-400" />
                                <span className="font-medium">{request.requester}</span>
                                <span className="text-gray-400">wants to swap with</span>
                                <span className="font-medium">{request.targetEmployee}</span>
                              </div>
                              <div className="mt-2 space-y-1">
                                <div className="text-xs text-gray-500">
                                  Requested by: <span className="font-medium">{request.createdBy || request.requesterEmail || ''}</span>
                                </div>
                                {request.createdAt && (
                                  <div className="text-xs text-gray-400">
                                    {formatDate(new Date(request.createdAt), 'MMM d, yyyy h:mm a')}
                                  </div>
                                )}
                              </div>
                              <div className="mt-3 flex items-center space-x-1 text-xs text-gray-500">
                                <Clock size={12} />
                                <span>Awaiting <span className="font-medium text-gray-700">{request.targetEmployee}</span>'s approval</span>
                              </div>
                            </div>
                            <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full whitespace-nowrap">
                              Pending
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div className="p-3 bg-blue-50 rounded-lg">
                              <h4 className="font-medium text-blue-900 mb-1">Giving Up</h4>
                              <p className="text-sm text-blue-700">
                                {formatDate(new Date(request.originalShift.date))} • {getShiftEmoji(request.originalShift.shift_type)} {getShiftDisplayName(request.originalShift.shift_type)}
                              </p>
                              <p className="text-xs text-blue-600">
                                {formatTimeRange(request.originalShift.start_datetime, request.originalShift.end_datetime)}
                              </p>
                            </div>
                            <div className="p-3 bg-green-50 rounded-lg">
                              <h4 className="font-medium text-green-900 mb-1">Wants</h4>
                              <p className="text-sm text-green-700">
                                {formatDate(new Date(request.targetShift.date))} • {getShiftEmoji(request.targetShift.shift_type)} {getShiftDisplayName(request.targetShift.shift_type)}
                              </p>
                              <p className="text-xs text-green-600">
                                {formatTimeRange(request.targetShift.start_datetime, request.targetShift.end_datetime)}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {/* Person B (target employee) can approve & apply directly */}
                            {canUserApproveAsEmployee(request) && (
                              <button
                                onClick={() => handleEmployeeApprove(request.id)}
                                disabled={loading}
                                className={`flex items-center space-x-1 px-3 py-2 rounded-md transition-colors ${
                                  loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
                                } text-white`}
                              >
                                <Check size={16} />
                                <span>{loading ? 'Applying...' : 'Approve'}</span>
                              </button>
                            )}
                            {/* Admin can also approve & apply */}
                            {isAdmin() && !isTestingAsEmployee && !canUserApproveAsEmployee(request) && (
                              <button
                                onClick={() => handleApproveRequest(request.id)}
                                disabled={loading}
                                className={`flex items-center space-x-1 px-3 py-2 rounded-md transition-colors ${
                                  loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
                                } text-white`}
                              >
                                <Check size={16} />
                                <span>{loading ? 'Applying...' : 'Approve & Apply'}</span>
                              </button>
                            )}
                            {/* Person B or admin can reject */}
                            {(canUserApproveAsEmployee(request) || (isAdmin() && !isTestingAsEmployee)) && (
                              <button
                                onClick={() => handleRejectRequest(request.id)}
                                className="flex items-center space-x-1 px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                              >
                                <X size={16} />
                                <span>Reject</span>
                              </button>
                            )}
                          </div>
                        </motion.div>
                      ))}
                  </div>
                </div>
              )}

              {/* ── Group 3: Overtime ── */}
              {overtimeRequests.filter(req => req.status === 'pending').length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-100 border border-amber-200 text-amber-800 rounded-lg mb-3">
                    <Clock size={15} className="flex-shrink-0" />
                    <span className="font-semibold text-sm">Overtime</span>
                    <span className="ml-auto text-xs font-medium bg-amber-200 px-2 py-0.5 rounded-full">
                      {overtimeRequests.filter(req => req.status === 'pending').length}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {overtimeRequests
                      .filter(req => req.status === 'pending')
                      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                      .map((request) => (
                        <motion.div
                          key={request.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="bg-gradient-to-r from-yellow-50 to-amber-50 rounded-lg border-2 border-yellow-200 p-6"
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-2">
                                <div className="bg-yellow-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                                  OVERTIME REQUEST
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <User size={16} className="text-yellow-600" />
                                <span className="font-semibold text-yellow-900">{request.employeeName}</span>
                                <span className="text-gray-600">requested</span>
                                <span className="font-semibold text-yellow-900">{request.durationHours} hours</span>
                              </div>
                              <div className="mt-3 space-y-1 bg-white/50 p-3 rounded-md">
                                <div className="text-sm text-gray-700 flex items-center space-x-2">
                                  <Clock size={14} className="text-gray-500" />
                                  <span className="font-medium">
                                    {formatDate(new Date(request.startDate), 'EEEE, MMMM d, yyyy')} at {request.startTime}
                                  </span>
                                  <span className="text-gray-500">→</span>
                                  <span className="font-medium">
                                    {formatDate(new Date(request.endDate), 'EEEE, MMMM d, yyyy')} at {request.endTime}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600">
                                  <strong>Employee:</strong> {request.createdBy}
                                </div>
                                {request.createdAt && (
                                  <div className="text-xs text-gray-500">
                                    <strong>Requested:</strong> {formatDate(new Date(request.createdAt), 'MMM d, yyyy h:mm a')}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          {contextIsAdmin && (
                            <div className="flex items-center space-x-2 pt-4 border-t border-yellow-200">
                              <button
                                onClick={() => handleApproveOvertimeRequest(request.id)}
                                className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors font-medium"
                              >
                                <Check size={16} />
                                <span>Approve</span>
                              </button>
                              <button
                                onClick={() => handleRejectOvertimeRequest(request.id)}
                                className="flex-1 flex items-center justify-center space-x-2 px-4 py-2.5 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors font-medium"
                              >
                                <X size={16} />
                                <span>Reject</span>
                              </button>
                            </div>
                          )}
                          {!contextIsAdmin && (
                            <div className="mt-4 text-xs text-gray-600 bg-white/50 p-2 rounded-md">
                              ⏳ Waiting for admin approval
                            </div>
                          )}
                        </motion.div>
                      ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </motion.div>
      )}

      {/* History Tab */}
      {activeRequestTab === 'history' && (() => {
        const allHistory = [
          ...swapRequests
            .filter(req => req.status !== 'pending')
            .map(r => ({
              id: r.id, _type: 'swap',
              employeeName: r.requester || '',
              status: r.status,
              dateTs: r.adminApprovedAt ? new Date(r.adminApprovedAt).getTime() : (r.createdAt ? new Date(r.createdAt).getTime() : 0),
              raw: r,
            })),
          ...freeShiftRequests
            .filter(req => req.status !== 'pending')
            .map(r => ({
              id: r.id, _type: 'freeshift',
              employeeName: r.requesterName || r.employeeName || r.requesterEmail || '',
              status: r.status,
              dateTs: r.adminApprovedAt ? new Date(r.adminApprovedAt).getTime() : (r.createdAt ? new Date(r.createdAt).getTime() : 0),
              raw: r,
            })),
          ...overtimeRequests
            .filter(req => req.status !== 'pending')
            .map(r => ({
              id: r.id, _type: 'overtime',
              employeeName: r.employeeName || '',
              status: r.status,
              dateTs: r.adminApprovedAt ? new Date(r.adminApprovedAt).getTime() : (r.createdAt ? new Date(r.createdAt).getTime() : 0),
              raw: r,
            })),
        ];

        let filtered = allHistory;
        if (historyFilterStatus) filtered = filtered.filter(i => i.status === historyFilterStatus);
        if (historyFilterType) filtered = filtered.filter(i => i._type === historyFilterType);
        if (historyFilterEmployee) {
          const q = historyFilterEmployee.toLowerCase();
          filtered = filtered.filter(i => i.employeeName.toLowerCase().includes(q));
        }
        if (historyFilterDateFrom) {
          const from = new Date(historyFilterDateFrom).getTime();
          filtered = filtered.filter(i => i.dateTs >= from);
        }
        if (historyFilterDateTo) {
          const to = new Date(historyFilterDateTo).getTime() + 86399999;
          filtered = filtered.filter(i => i.dateTs <= to);
        }

        filtered = [...filtered].sort((a, b) => {
          let av, bv;
          if (historySortField === 'date') { av = a.dateTs; bv = b.dateTs; }
          else if (historySortField === 'employee') { av = a.employeeName.toLowerCase(); bv = b.employeeName.toLowerCase(); }
          else if (historySortField === 'status') { av = a.status; bv = b.status; }
          else { av = a._type; bv = b._type; }
          if (av < bv) return historySortDir === 'asc' ? -1 : 1;
          if (av > bv) return historySortDir === 'asc' ? 1 : -1;
          return 0;
        });

        const SortBtn = ({ field, label }) => (
          <button
            onClick={() => {
              if (historySortField === field) setHistorySortDir(d => d === 'asc' ? 'desc' : 'asc');
              else { setHistorySortField(field); setHistorySortDir('desc'); }
            }}
            className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
              historySortField === field ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {label}
            {historySortField === field && (historySortDir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
          </button>
        );

        return (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Sort + Filter Toolbar */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-700 mr-1">Sort:</span>
                <SortBtn field="date" label="Date" />
                <SortBtn field="employee" label="Employee" />
                <SortBtn field="status" label="Status" />
                <SortBtn field="type" label="Type" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-700 mr-1">Filter:</span>
                <select
                  value={historyFilterStatus}
                  onChange={e => setHistoryFilterStatus(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Statuses</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
                <select
                  value={historyFilterType}
                  onChange={e => setHistoryFilterType(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Types</option>
                  <option value="swap">Swap</option>
                  <option value="overtime">Overtime</option>
                </select>
                <div className="relative">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Employee name…"
                    value={historyFilterEmployee}
                    onChange={e => setHistoryFilterEmployee(e.target.value)}
                    className="text-sm border border-gray-300 rounded-md pl-7 pr-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
                  />
                </div>
                <input
                  type="date"
                  value={historyFilterDateFrom}
                  onChange={e => setHistoryFilterDateFrom(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-gray-500 text-xs">to</span>
                <input
                  type="date"
                  value={historyFilterDateTo}
                  onChange={e => setHistoryFilterDateTo(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {(historyFilterStatus || historyFilterType || historyFilterEmployee || historyFilterDateFrom || historyFilterDateTo) && (
                  <button
                    onClick={() => {
                      setHistoryFilterStatus('');
                      setHistoryFilterType('');
                      setHistoryFilterEmployee('');
                      setHistoryFilterDateFrom('');
                      setHistoryFilterDateTo('');
                    }}
                    className="text-sm px-3 py-1.5 bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                <RefreshCw className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Request History</h3>
                <p className="text-gray-500">
                  {allHistory.length === 0 ? 'Completed requests will appear here.' : 'No results match the current filters.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filtered.map(item => {
                  if (item._type === 'overtime') {
                    const request = item.raw;
                    return (
                      <div key={item.id} className="bg-gradient-to-r from-yellow-50 to-amber-50 rounded-lg border-2 border-yellow-200 p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <div className={`text-white text-xs font-bold px-2 py-1 rounded-full ${request.status === 'approved' ? 'bg-green-600' : 'bg-red-600'}`}>
                                {request.status === 'approved' ? 'APPROVED' : 'REJECTED'}
                              </div>
                              <span className="text-xs font-semibold text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full">OVERTIME</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <User size={16} className="text-yellow-600" />
                              <span className="font-semibold text-yellow-900">{request.employeeName}</span>
                              <span className="text-gray-600">requested</span>
                              <span className="font-semibold text-yellow-900">{request.durationHours} hours</span>
                            </div>
                            <div className="mt-3 space-y-1 bg-white/50 p-3 rounded-md text-sm">
                              <div className="text-gray-700 flex items-center space-x-2">
                                <Clock size={14} className="text-gray-500" />
                                <span>
                                  {formatDate(new Date(request.startDate), 'MMM d, yyyy')} at {request.startTime}
                                  <span className="text-gray-500 mx-1">→</span>
                                  {formatDate(new Date(request.endDate), 'MMM d, yyyy')} at {request.endTime}
                                </span>
                              </div>
                              {request.adminApprovedAt && (
                                <div className="text-xs text-gray-500">
                                  <strong>{request.status === 'approved' ? 'Admin approved by' : 'Rejected by'}:</strong>{' '}
                                  <span className="text-blue-600">{request.adminApprovedBy || request.updatedBy || '—'}</span>
                                  {' · '}{formatDate(new Date(request.adminApprovedAt), 'MMM d, yyyy h:mm a')}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (item._type === 'freeshift') {
                    const request = item.raw;
                    return (
                      <div key={item.id} className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200 p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <span className="px-2 py-0.5 text-xs font-semibold bg-green-600 text-white rounded">OPEN SHIFT</span>
                              <span className="text-sm text-gray-600">claimed by</span>
                              <span className="font-semibold text-green-900">{request.employeeName || request.requesterEmail}</span>
                            </div>
                            <div className="mt-3 space-y-1 bg-white/50 p-3 rounded-md">
                              <div className="text-sm text-gray-700 flex items-center space-x-2">
                                <Calendar size={14} className="text-gray-500" />
                                <span className="font-medium">
                                  {formatDate(new Date(request.date), 'EEEE, MMMM d, yyyy')}
                                </span>
                              </div>
                              <div className="text-sm text-gray-700">
                                <strong>Shift:</strong> {getShiftEmoji(request.shiftType)} {getShiftDisplayName(request.shiftType)}
                              </div>
                              {request.createdAt && (
                                <div className="text-xs text-gray-500">
                                  <strong>Requested:</strong> {formatDate(new Date(request.createdAt), 'MMM d, yyyy h:mm a')}
                                </div>
                              )}
                            </div>
                            {request.adminApprovedBy && request.adminApprovedAt && (
                              <div className="mt-2 pt-2 border-t border-green-200">
                                <div className="text-xs">
                                  <div className="font-medium text-gray-900">
                                    {request.status === 'approved' ? 'Admin approved by' : 'Rejected by'}: <span className="text-blue-600">{request.adminApprovedBy}</span>
                                  </div>
                                  <div className="text-gray-500 mt-0.5">
                                    {formatDate(new Date(request.adminApprovedAt), 'MMM d, yyyy h:mm a')}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          <span className={`px-2 py-1 text-xs rounded-full whitespace-nowrap ${request.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                          </span>
                        </div>
                      </div>
                    );
                  }
                  // swap
                  const request = item.raw;
                  return (
                    <div key={item.id} className="bg-white rounded-lg border border-gray-200 p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <User size={16} className="text-gray-400" />
                            <span className="font-medium">{request.requester}</span>
                            <ArrowRightLeft size={16} className="text-gray-400" />
                            <span className="font-medium">{request.targetEmployee}</span>
                          </div>
                          <div className="mt-2 space-y-1">
                            <div className="text-xs text-gray-500">
                              Requested by: <span className="font-medium">{request.createdBy || request.requesterEmail || ''}</span>
                            </div>
                            {request.createdAt && (
                              <div className="text-xs text-gray-400">
                                {formatDate(new Date(request.createdAt), 'MMM d, yyyy h:mm a')}
                              </div>
                            )}
                          </div>
                          {request.employeeApproved && request.employeeApprovedBy && (
                            <div className="mt-2 pt-2 border-t border-gray-200">
                              <div className="text-xs">
                                <div className="font-medium text-gray-900">
                                  Employee approved by: <span className="text-blue-600">{request.employeeApprovedBy}</span>
                                </div>
                                {request.employeeApprovedAt && (
                                  <div className="text-gray-500 mt-0.5">
                                    {formatDate(new Date(request.employeeApprovedAt), 'MMM d, yyyy h:mm a')}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {(request.adminApprovedBy || request.updatedBy) && request.adminApprovedAt && (
                            <div className="mt-2 pt-2 border-t border-gray-200">
                              <div className="text-xs">
                                <div className="font-medium text-gray-900">
                                  {request.status === 'approved' ? 'Admin approved by' : 'Rejected by'}: <span className="text-blue-600">{request.adminApprovedBy || request.updatedBy}</span>
                                </div>
                                <div className="text-gray-500 mt-0.5">
                                  {formatDate(new Date(request.adminApprovedAt), 'MMM d, yyyy h:mm a')}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        <span className={`px-2 py-1 text-xs rounded-full whitespace-nowrap ${request.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">
                        {formatDate(new Date(request.originalShift.date))} {getShiftEmoji(request.originalShift.shift_type)} {getShiftDisplayName(request.originalShift.shift_type)} ↔{' '}
                        {formatDate(new Date(request.targetShift.date))} {getShiftEmoji(request.targetShift.shift_type)} {getShiftDisplayName(request.targetShift.shift_type)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        );
      })()}
    </div>
  );
}
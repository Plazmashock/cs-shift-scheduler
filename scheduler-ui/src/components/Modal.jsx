/**
 * Modal component for shift details and actions
 * Displays full shift information with options to reassign or modify
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { X, Clock, User, Calendar, AlertCircle, Trash2, CheckCircle as CheckCircleIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, formatTimeRange } from '../utils/dateHelpers';

/**
 * Modal Component
 * @param {Object} props - Component props  
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {Function} props.onClose - Close modal handler
 * @param {Object} props.shift - Shift assignment data
 * @param {Function} props.onReassign - Reassign shift handler
 * @param {Function} props.onDelete - Delete shift handler
 * @param {Function} props.onAddLeave - Add leave handler (admin only)
 * @param {Function} props.onDeleteLeave - Delete leave handler (admin only)
 * @param {Array} props.leaves - Array of leave records
 * @param {Object} props.directLeave - Leave record pre-resolved by caller (e.g. MyPage) — overrides leaves lookup
 * @param {Object} props.holidayInfo - Holiday info if shift is on a holiday (optional)
 * @param {Function} props.onSaveNotes - Save notes handler (admin only)
 * @param {string} props.shiftNotes - Current notes for the shift
 */
export default function Modal({ 
  isOpen, 
  onClose, 
  shift, 
  onReassign, 
  onDelete,
  onAddLeave,
  onDeleteLeave,
  leaves = [],
  directLeave = null,
  holidayInfo = null,
  onSaveNotes = null,
  shiftNotes = '',
  disableContentScroll = false
}) {
  // Hooks must be called unconditionally at the top of the component
  const { isAdmin } = useAuth();
  const [notes, setNotes] = useState(shiftNotes || '');
  const [saveStatus, setSaveStatus] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // Prevent background scroll when modal is open (only when content scroll is disabled)
  useEffect(() => {
    if (isOpen && !disableContentScroll) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = 'unset'; };
    }
    document.body.style.overflow = 'unset';
    return undefined;
  }, [isOpen, disableContentScroll]);

  // Update notes when shift changes
  useEffect(() => {
    setNotes(shiftNotes || '');
    setSaveStatus('');
  }, [shift, shiftNotes, isOpen]);

  // Handle save notes
  const handleSaveNotes = async () => {
    if (!onSaveNotes) return;
    
    setIsSavingNotes(true);
    try {
      await onSaveNotes(shift, notes);
      setSaveStatus('✓ Saved');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (error) {
      console.error('Error saving notes:', error);
      setSaveStatus('✗ Error');
      setTimeout(() => setSaveStatus(''), 2000);
    } finally {
      setIsSavingNotes(false);
    }
  };

  if (!shift) return null;

  // Get leave data for this shift — directLeave takes priority (set by MyPage which has full month scope)
  // ✅ Also matches imported leaves (source='external') that don't have shift_type
  const shiftLeave = directLeave || leaves.find(leave => {
    // Priority 1: Match by shift_id (most precise)
    if (shift.shift_id && leave.shift_id && leave.shift_id === shift.shift_id) {
      return true;
    }

    // Priority 2: Match by shift_type (legacy exact match)
    if (!shift.shift_id && !leave.shift_id &&
        leave.employee_id === shift.employee_id &&
        leave.date === shift.date &&
        leave.shift_type === shift.shift_type) {
      return true;
    }

    // Priority 3: Match by (employee_id, date) only — for imported leaves without shift_type
    if (!shift.shift_id && !leave.shift_id &&
        !leave.shift_type &&  // Leave has no shift_type (external import)
        leave.employee_id === shift.employee_id &&
        leave.date === shift.date) {
      return true;
    }

    return false;
  });

  // Calculate hours if leave exists
  // Hardcoded shift durations (8 paid hours per shift)
  const SHIFT_HOURS = {
    morning: 8,    // 04:00-13:00
    day: 8,        // 10:00-19:00
    afternoon: 8,  // 15:00-00:00
    night: 8       // 19:00-04:00
  };

  const calculateLeaveHours = () => {
    if (!shiftLeave) return null;

    const shiftPaidHours = SHIFT_HOURS[shift.shift_type] || 8;
    let leaveHours = 0;

    if (shiftLeave.timeframe === 'all-day') {
      leaveHours = shiftPaidHours;
    } else if (shiftLeave.timeframe === 'first-half' || shiftLeave.timeframe === 'second-half') {
      leaveHours = shiftPaidHours / 2;
    } else if (shiftLeave.timeframe === 'other' && shiftLeave.custom_start && shiftLeave.custom_end) {
      try {
        const leaveStart = new Date(`${shiftLeave.date}T${shiftLeave.custom_start}`);
        const leaveEnd = new Date(`${shiftLeave.date}T${shiftLeave.custom_end}`);
        leaveHours = (leaveEnd - leaveStart) / (1000 * 60 * 60);
      } catch (err) {
        console.warn('Error calculating custom leave hours:', err);
      }
    }

    const workedHours = shiftPaidHours - leaveHours;

    return {
      total: shiftPaidHours,
      worked: Math.round(workedHours * 10) / 10,
      leave: Math.round(leaveHours * 10) / 10
    };
  };

  const hours = calculateLeaveHours();

  // Hardcoded shift time ranges (9 hours total including 1-hour break)
  const SHIFT_TIMES = {
    morning: { start: '04:00', end: '13:00' },    // 04:00-13:00 (9h)
    day: { start: '10:00', end: '19:00' },        // 10:00-19:00 (9h)
    afternoon: { start: '15:00', end: '00:00' },  // 15:00-00:00 (9h)
    night: { start: '19:00', end: '04:00' }       // 19:00-04:00 (9h)
  };

  const shiftTime = SHIFT_TIMES[shift.shift_type];

  // Get leave type display name
  const getLeaveTypeDisplay = () => {
    const leaveTypeMap = {
      annual: '🔵 Annual Leave',
      maternity: '🟣 Maternity Leave',
      sick: '🟢 Sick Leave',
      unpaid: '🔴 Unpaid Leave'
    };
    return leaveTypeMap[shiftLeave.leave_type] || shiftLeave.leave_type;
  };

  // Get timeframe display name
  const getTimeframeDisplay = () => {
    const timeframeMap = {
      'all-day': 'All Day',
      'first-half': 'First Half',
      'second-half': 'Second Half',
      'other': 'Custom'
    };
    return timeframeMap[shiftLeave.timeframe] || shiftLeave.timeframe;
  };

  // Close modal on escape key
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      onClose();
    }
  };

  // Use the same color classes as ShiftCard for visual consistency
  const shiftConfig = {
    morning: { label: 'Morning', icon: '🌅', bgClass: 'bg-orange-100', borderClass: 'border-orange-500', textClass: 'text-orange-800' },
    day:    { label: 'Day',    icon: '☀️', bgClass: 'bg-yellow-100', borderClass: 'border-yellow-500', textClass: 'text-yellow-800' },
    afternoon: { label: 'Afternoon', icon: '🌇', bgClass: 'bg-purple-100', borderClass: 'border-purple-500', textClass: 'text-purple-800' },
    night:  { label: 'Night',  icon: '🌙', bgClass: 'bg-blue-100', borderClass: 'border-blue-500', textClass: 'text-blue-800' },
    overtime: { label: 'Overtime', icon: '⚡', bgClass: 'bg-red-100', borderClass: 'border-red-500', textClass: 'text-red-800' },
    custom: { label: 'Custom', icon: '💫', bgClass: 'bg-pink-100', borderClass: 'border-pink-500', textClass: 'text-pink-800' },
  };

  const config = shiftConfig[shift.shift_type] || { bgClass: 'bg-gray-50', borderClass: 'border-gray-200', textClass: 'text-gray-900' };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
            onKeyDown={handleKeyDown}
          >
            <div 
              className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-title"
            >
              {/* Header */}
              <div className={`flex items-center justify-between p-6 border-b ${config.borderClass} ${config.bgClass} dark:bg-gray-700 dark:border-gray-600`}>
                <div className="flex items-center space-x-3">
                  <span className="text-2xl" role="img" aria-hidden="true">
                    {config.icon}
                  </span>
                  <div>
                    <h2 id="modal-title" className={`text-lg font-semibold ${config.textClass}`}>
                      {config.label} Shift
                    </h2>
                  </div>
                </div>
                
                <button
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-md hover:bg-gray-100"
                  aria-label="Close modal"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {/* Employee Information */}
                <div className="flex items-center space-x-3 p-4 bg-gray-50 rounded-lg">
                  <div className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center font-medium">
                    {shift.employee_name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <User size={16} className="text-gray-500" />
                      <span className="font-medium text-gray-900">
                        {shift.employee_name}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      Employee ID: {shift.employee_id}
                    </p>
                  </div>
                </div>

                {/* Shift Details */}
                <div className="space-y-4">
                  <h3 className="font-medium text-gray-900 border-b pb-2">
                    Shift Information
                  </h3>
                  
                  {/* Date */}
                  <div className="flex items-center space-x-3">
                    <Calendar size={16} className="text-gray-500 flex-shrink-0" />
                    <div>
                      <span className="text-sm text-gray-600">Date:</span>
                      <span className="ml-2 font-medium text-gray-900">
                        {formatDate(shift.date, 'EEEE, MMMM d, yyyy')}
                      </span>
                    </div>
                  </div>

                  {/* Time */}
                  <div className="flex items-center space-x-3">
                    <Clock size={16} className="text-gray-500 flex-shrink-0" />
                    <div>
                      <span className="text-sm text-gray-600">Time:</span>
                      <span className="ml-2 font-medium text-gray-900">
                        {shiftTime ? `${shiftTime.start}-${shiftTime.end}` : formatTimeRange(shift.start_datetime, shift.end_datetime)}
                      </span>
                    </div>
                  </div>

                  {/* Duration */}
                  <div className="flex items-center space-x-3">
                    <AlertCircle size={16} className="text-gray-500 flex-shrink-0" />
                    <div>
                      <span className="text-sm text-gray-600">Duration:</span>
                      <span className="ml-2 font-medium text-gray-900">
                        {shift.shift_type === 'overtime' 
                          ? (() => {
                              const totalHours = shift.duration_hours || 0;
                              const hours = Math.floor(totalHours);
                              const minutes = Math.round((totalHours - hours) * 60);
                              return `${hours}h ${minutes}m (no break deduction)`;
                            })()
                          : '8 hours paid (9h shift incl. 1h break)'
                        }
                      </span>
                    </div>
                  </div>

                  {/* Holiday indicator */}
                  {holidayInfo && (
                    <div className="flex items-center space-x-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <span className="text-xl">🎉</span>
                      <div>
                        <span className="text-sm text-amber-700 font-medium">Holiday:</span>
                        <span className="ml-2 font-medium text-amber-900">
                          {holidayInfo.name}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Notes section - Visible to all, editable by admin only */}
                  {(isAdmin || notes) && (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-yellow-700 font-medium">Notes:</span>
                        {saveStatus && (
                          <span className="text-xs font-medium text-yellow-600">{saveStatus}</span>
                        )}
                      </div>
                      {isAdmin ? (
                        <>
                          <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Add shift notes..."
                            className="w-full px-3 py-2 text-sm border border-yellow-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none"
                            rows="3"
                          />
                          <button
                            onClick={handleSaveNotes}
                            disabled={isSavingNotes}
                            className="w-full px-3 py-1 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 transition-colors"
                          >
                            {isSavingNotes ? 'Saving...' : 'Save Notes'}
                          </button>
                        </>
                      ) : (
                        <div className="px-3 py-2 text-sm bg-white border border-yellow-300 rounded text-gray-700 whitespace-pre-wrap">
                          {notes || '(no notes)'}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Leave Information */}
                {shiftLeave && hours && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
                    <h3 className="font-medium text-gray-900 border-b pb-2">
                      Leave Information
                    </h3>
                    
                    {/* Leave Type */}
                    <div className="flex items-center space-x-3">
                      <Calendar size={16} className="text-red-500 flex-shrink-0" />
                      <div>
                        <span className="text-sm text-gray-600">Leave Type:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {getLeaveTypeDisplay()}
                        </span>
                      </div>
                    </div>

                    {/* Timeframe */}
                    <div className="flex items-center space-x-3">
                      <Clock size={16} className="text-red-500 flex-shrink-0" />
                      <div>
                        <span className="text-sm text-gray-600">Timeframe:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {getTimeframeDisplay()}
                          {shiftLeave.timeframe === 'other' && shiftLeave.custom_start && shiftLeave.custom_end && (
                            <span className="text-sm text-gray-600 ml-2">
                              ({shiftLeave.custom_start} - {shiftLeave.custom_end})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Hours breakdown */}
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-red-200">
                      <div className="text-center">
                        <span className="text-sm text-gray-600 block">Worked Hours</span>
                        <span className="text-lg font-semibold text-green-700">{hours.worked}h</span>
                      </div>
                      <div className="text-center">
                        <span className="text-sm text-gray-600 block">Leave Hours</span>
                        <span className="text-lg font-semibold text-red-700">{hours.leave}h</span>
                      </div>
                    </div>

                    {/* Remove Leave button - Admin only */}
                    {isAdmin && onDeleteLeave && (
                      <button
                        onClick={() => onDeleteLeave && onDeleteLeave(shift, shiftLeave)}
                        className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                      >
                        <Trash2 size={16} />
                        <span>Remove Leave</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="space-y-3">
                  <h3 className="font-medium text-gray-900 border-b pb-2">
                    Actions
                  </h3>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {/* Request Reassignment - Hide for overtime shifts */}
                    {shift.shift_type !== 'overtime' && (
                      <button
                        onClick={() => onReassign && onReassign(shift)}
                        className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                      >
                        <User size={16} />
                        <span>Request Reassignment</span>
                      </button>
                    )}

                    {/* Add Leave button - Admin only */}
                    {isAdmin && onAddLeave && (
                      <button
                        onClick={() => onAddLeave(shift)}
                        className="flex items-center justify-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                      >
                        <Calendar size={16} />
                        <span>Add Leave</span>
                      </button>
                    )}

                    {/* Only show Remove button to admins */}
                    {isAdmin && (
                      <button
                        onClick={() => onDelete && onDelete(shift)}
                        className="flex items-center justify-center space-x-2 px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                      >
                        <X size={16} />
                        <span>Remove Shift</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Notes removed as requested */}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Generic Modal Component
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {Function} props.onClose - Close modal handler
 * @param {string} props.title - Modal title
 * @param {React.ReactNode} props.children - Modal content
 */
export function GenericModal({ 
  isOpen, 
  onClose, 
  title,
  children,
  maxWidthClass = 'max-w-md',
  disableContentScroll = false
}) {
  // Close modal on escape key
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      onClose();
    }
  };

  // Prevent background scroll when modal is open
  if (isOpen) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = 'unset';
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
            onKeyDown={handleKeyDown}
            tabIndex={-1}
          >
            <div 
              className={`bg-white rounded-lg shadow-xl ${maxWidthClass} w-full ${disableContentScroll ? '' : 'max-h-[90vh] overflow-hidden'}`}
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-600">
                <h2 className="text-lg font-semibold text-gray-900">
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className={disableContentScroll ? 'p-4' : 'p-4 overflow-y-auto max-h-[80vh] custom-scrollbar'}>
                {children}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Confirmation Modal for destructive actions
 */
export function ConfirmationModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'warning' 
}) {
  const typeConfig = {
    warning: {
      icon: AlertCircle,
      iconColor: 'text-yellow-600',
      confirmButton: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
    },
    danger: {
      icon: AlertCircle,
      iconColor: 'text-red-600', 
      confirmButton: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    },
  };

  const config = typeConfig[type];
  const Icon = config.icon;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
          >
            {/* Delete Confirm Dialog */}
            <div 
              className="bg-white rounded-lg shadow-xl max-w-sm w-full"
              role="dialog"
              aria-modal="true"
            >
              <div className="p-6">
                <div className="flex items-center space-x-3 mb-4">
                  <Icon className={`${config.iconColor}`} size={24} />
                  <h3 className="text-lg font-semibold text-gray-900">
                    {title}
                  </h3>
                </div>
                
                <p className="text-sm text-gray-600 mb-6">
                  {message}
                </p>

                <div className="flex space-x-3 justify-end">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {cancelText}
                  </button>
                  <button
                    onClick={() => {
                      onConfirm();
                      onClose();
                    }}
                    className={`px-4 py-2 text-white rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${config.confirmButton}`}
                  >
                    {confirmText}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Alert Modal Component
 * Replaces window.alert() with a custom modal
 */
export function AlertModal({ 
  isOpen, 
  onClose, 
  title = 'Notice', 
  message,
  type = 'info' // 'info', 'success', 'warning', 'error'
}) {
  const typeConfig = {
    info: {
      icon: AlertCircle,
      iconColor: 'text-blue-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      buttonColor: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
    },
    success: {
      icon: CheckCircleIcon,
      iconColor: 'text-green-600',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
      buttonColor: 'bg-green-600 hover:bg-green-700 focus:ring-green-500',
    },
    warning: {
      icon: AlertCircle,
      iconColor: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200',
      buttonColor: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
    },
    error: {
      icon: AlertCircle,
      iconColor: 'text-red-600',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      buttonColor: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    },
  };

  const config = typeConfig[type] || typeConfig.info;
  const Icon = config.icon;

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
          >
            <div 
              className="bg-white rounded-lg shadow-xl max-w-md w-full"
              role="alertdialog"
              aria-modal="true"
            >
              <div className={`flex items-start space-x-3 p-6 rounded-t-lg ${config.bgColor} ${config.borderColor} border-b`}>
                <Icon className={`${config.iconColor} flex-shrink-0 mt-0.5`} size={24} />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {title}
                  </h3>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {message}
                  </p>
                </div>
              </div>

              <div className="p-4 flex justify-end">
                <button
                  onClick={onClose}
                  className={`px-4 py-2 text-white rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${config.buttonColor}`}
                  autoFocus
                >
                  OK
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Leave Modal Component
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {Function} props.onClose - Close modal handler
 * @param {Object} props.shift - Shift assignment data
 * @param {Function} props.onSubmit - Submit leave handler
 */
export function LeaveModal({ isOpen, onClose, shift, onSubmit }) {
  const [leaveType, setLeaveType] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const leaveTypes = [
    { id: 'annual', label: 'Annual Leave', icon: '🔵', colorClass: 'border-blue-500 bg-blue-50' },
    { id: 'maternity', label: 'Maternity Leave', icon: '🟣', colorClass: 'border-purple-500 bg-purple-50' },
    { id: 'sick', label: 'Sick Leave', icon: '🟢', colorClass: 'border-green-500 bg-green-50' },
    { id: 'unpaid', label: 'Unpaid Leave', icon: '🔴', colorClass: 'border-red-500 bg-red-50' },
  ];

  const timeframes = [
    { id: 'all-day', label: 'All Day' },
    { id: 'first-half', label: 'First Half' },
    { id: 'second-half', label: 'Second Half' },
    { id: 'other', label: 'Other (Custom)' },
  ];

  const handleSubmit = () => {
    const leaveData = {
      leaveType,
      timeframe,
      customStart: timeframe === 'other' ? customStart : null,
      customEnd: timeframe === 'other' ? customEnd : null,
    };
    onSubmit(leaveData);
    // Reset form
    setLeaveType('');
    setTimeframe('');
    setCustomStart('');
    setCustomEnd('');
    onClose();
  };

  const isFormValid = leaveType && timeframe && (timeframe !== 'other' || (customStart && customEnd));

  if (!shift) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
          >
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b bg-purple-50 dark:bg-gray-700 border-purple-200 dark:border-gray-600">
                <div>
                  <h2 className="text-lg font-semibold text-purple-900">Add Leave</h2>
                  <p className="text-sm text-purple-600">{shift.employee_name}</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-md hover:bg-gray-100"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {/* Leave Type Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Select Leave Type
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {leaveTypes.map((type) => (
                      <button
                        key={type.id}
                        onClick={() => setLeaveType(type.id)}
                        className={`p-4 border-2 rounded-lg transition-all ${
                          leaveType === type.id
                            ? type.colorClass
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="text-2xl mb-1">{type.icon}</div>
                        <div className="text-sm font-medium text-gray-900">{type.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Timeframe Selection */}
                {leaveType && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Select Timeframe
                    </label>
                    <div className="space-y-2">
                      {timeframes.map((tf) => (
                        <button
                          key={tf.id}
                          onClick={() => setTimeframe(tf.id)}
                          className={`w-full p-3 border-2 rounded-lg text-left transition-all ${
                            timeframe === tf.id
                              ? 'border-purple-500 bg-purple-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="font-medium text-gray-900">{tf.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom Time Range */}
                {timeframe === 'other' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Custom Time Range (24-hour format)
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">From</label>
                        <input
                          type="time"
                          value={customStart}
                          onChange={(e) => setCustomStart(e.target.value)}
                          step="60"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">To</label>
                        <input
                          type="time"
                          value={customEnd}
                          onChange={(e) => setCustomEnd(e.target.value)}
                          step="60"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Use 24-hour format: 00:00 for midnight, 13:00 for 1:00 PM, etc.</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!isFormValid}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Submit Leave
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

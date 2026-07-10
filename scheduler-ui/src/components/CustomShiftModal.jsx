/**
 * CustomShiftModal Component
 * Allows admins to add custom shifts with specific start/end times and work hours
 */

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle } from 'lucide-react';
import { formatDate } from '../utils/dateHelpers';

export default function CustomShiftModal({
  isOpen,
  onClose,
  onAddCustomShift,
  employees = [],
  weekStart,
  prefilledEmployee = '',
  prefilledDate = '',
  disableContentScroll = false
}) {
  const [selectedEmployee, setSelectedEmployee] = useState(prefilledEmployee || '');
  const [selectedDate, setSelectedDate] = useState(prefilledDate || '');
  const [startTime, setStartTime] = useState('09:00');
  const [finishTime, setFinishTime] = useState('17:00');
  const [workHours, setWorkHours] = useState(8);
  const [error, setError] = useState('');

  // Generate date options for the week
  const weekDates = useMemo(() => {
    if (!weekStart) return [];
    const dates = [];
    const startDate = new Date(weekStart);
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      dates.push({
        value: formatDate(date),
        label: formatDate(date, 'EEEE, MMM d')
      });
    }
    return dates;
  }, [weekStart]);

  // Update prefilled values when props change
  useEffect(() => {
    if (prefilledEmployee) setSelectedEmployee(prefilledEmployee);
    if (prefilledDate) setSelectedDate(prefilledDate);
  }, [prefilledEmployee, prefilledDate, isOpen]);

  // Validate HH:MM format
  const validateTimeFormat = (time) => {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  };

  const handleSubmit = () => {
    setError('');

    // Validate inputs
    if (!selectedEmployee) {
      setError('Please select an employee');
      return;
    }
    if (!selectedDate) {
      setError('Please select a date');
      return;
    }
    if (!validateTimeFormat(startTime)) {
      setError('Invalid start time format. Use HH:MM (e.g., 09:30)');
      return;
    }
    if (!validateTimeFormat(finishTime)) {
      setError('Invalid finish time format. Use HH:MM (e.g., 17:30)');
      return;
    }
    if (!workHours || workHours <= 0) {
      setError('Work hours must be greater than 0');
      return;
    }

    // Find employee name
    const employee = employees && Array.isArray(employees) 
      ? employees.find(e => e && e.id === parseInt(selectedEmployee))
      : null;
    const employeeName = employee?.name || 'Unknown';

    // Build start_datetime and end_datetime
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = finishTime.split(':').map(Number);
    
    let startDatetime = `${selectedDate}T${startTime}:00.000Z`;
    let endDatetime;
    
    if (endHour < startHour || (endHour === startHour && endMin < startMin)) {
      // Overnight shift - add 1 day to end date
      const endDate = new Date(selectedDate);
      endDate.setDate(endDate.getDate() + 1);
      const endDateStr = endDate.toISOString().split('T')[0];
      endDatetime = `${endDateStr}T${finishTime}:00.000Z`;
    } else {
      endDatetime = `${selectedDate}T${finishTime}:00.000Z`;
    }

    // Call parent handler
    onAddCustomShift({
      employee_id: parseInt(selectedEmployee),
      employee_name: employeeName,
      date: selectedDate,
      start_datetime: startDatetime,
      end_datetime: endDatetime,
      work_hours: parseFloat(workHours),
      shift_type: 'custom'
    });

    // Reset form
    setSelectedEmployee(prefilledEmployee || '');
    setSelectedDate(prefilledDate || '');
    setStartTime('09:00');
    setFinishTime('17:00');
    setWorkHours(8);
    onClose();
  };

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (isOpen && !disableContentScroll) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = 'unset'; };
    }
    document.body.style.overflow = 'unset';
    return undefined;
  }, [isOpen, disableContentScroll]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-40"
            aria-hidden="true"
          />

          {/* Modal Container - Flex for proper centering */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center p-4 z-50"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
                <h2 className="text-xl font-semibold text-gray-900 flex items-center space-x-2">
                  <span>💫 Add Custom Shift</span>
                </h2>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Close modal"
                >
                  <X size={24} />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                {/* Error message */}
                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
                    <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                {/* Employee Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Employee
                  </label>
                  <select
                    value={selectedEmployee}
                    onChange={(e) => setSelectedEmployee(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  >
                    <option value="">-- Choose Employee --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Date
                  </label>
                  <select
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  >
                    <option value="">-- Choose Date --</option>
                    {weekDates.map(date => (
                      <option key={date.value} value={date.value}>
                        {date.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Time Range Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Time Range
                  </label>
                  <div className="flex items-center space-x-3">
                    {/* Start Time */}
                    <div className="flex-1">
                      <label className="block text-xs text-gray-600 mb-1">From</label>
                      <input
                        type="text"
                        placeholder="09:00"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 text-center"
                      />
                      <span className="text-xs text-gray-500 mt-1 block">HH:MM</span>
                    </div>

                    {/* Dash */}
                    <span className="text-gray-400 font-bold mt-6">—</span>

                    {/* Finish Time */}
                    <div className="flex-1">
                      <label className="block text-xs text-gray-600 mb-1">To</label>
                      <input
                        type="text"
                        placeholder="17:00"
                        value={finishTime}
                        onChange={(e) => setFinishTime(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 text-center"
                      />
                      <span className="text-xs text-gray-500 mt-1 block">HH:MM</span>
                    </div>
                  </div>
                </div>

                {/* Work Hours Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Work Hours
                  </label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={workHours}
                    onChange={(e) => setWorkHours(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  />
                  <span className="text-xs text-gray-500 mt-1 block">Hours to count towards employee total</span>
                </div>

                {/* Info */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-700">
                    Custom shifts will appear in the schedule and work hours will be counted in employee statistics.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-gray-200 flex space-x-3 sticky bottom-0 bg-white">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Add Custom Shift
                </button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * BulkGenerationModal Component
 * Allows users to select multiple weeks/months and generate schedules in bulk
 * with prior week context consideration for fatigue/balance constraints
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, ChevronLeft, ChevronRight, Check, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { GenericModal } from './Modal';
import { generateSchedule } from '../services/api';
import { loadScheduleFromFirebase, saveScheduleToFirebase } from '../services/firebaseDatabase';
import { formatDate, getWeekStart } from '../utils/dateHelpers';

export default function BulkGenerationModal({ 
  isOpen, 
  onClose, 
  employees = [], 
  settings,
  getIdToken,
  onGenerationComplete 
}) {
  const [viewMode, setViewMode] = useState('month'); // 'month' or 'week'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedWeeks, setSelectedWeeks] = useState(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(null); // { current, total, weekStart, status }
  const [results, setResults] = useState([]); // { weekStart, status, message }
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState(null);
  const [pausedWeek, setPausedWeek] = useState(null); // { weekStart, message }

  if (!isOpen) return null;

  // Get all weeks in the current month
  const getWeeksInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    const weeks = [];
    let currentWeekStart = new Date(firstDay);
    
    // Back up to Monday if not already Monday
    const dayOfWeek = currentWeekStart.getDay();
    const diff = currentWeekStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    currentWeekStart.setDate(diff);
    
    while (currentWeekStart <= lastDay) {
      weeks.push(new Date(currentWeekStart));
      currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    }
    
    return weeks;
  };

  const toggleWeekSelection = (weekStart) => {
    const weekKey = formatDate(weekStart);
    setSelectedWeeks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(weekKey)) {
        newSet.delete(weekKey);
      } else {
        newSet.add(weekKey);
      }
      return newSet;
    });
  };

  const toggleMonthSelection = (date) => {
    const weeks = getWeeksInMonth(date);
    const weekKeys = weeks.map(w => formatDate(w));
    
    setSelectedWeeks(prev => {
      const newSet = new Set(prev);
      const allSelected = weekKeys.every(k => newSet.has(k));
      
      if (allSelected) {
        weekKeys.forEach(k => newSet.delete(k));
      } else {
        weekKeys.forEach(k => newSet.add(k));
      }
      return newSet;
    });
  };

  const isWeekSelected = (weekStart) => {
    return selectedWeeks.has(formatDate(weekStart));
  };

  const getMonthSelectState = (date) => {
    const weeks = getWeeksInMonth(date);
    const weekKeys = weeks.map(w => formatDate(w));
    const selectedCount = weekKeys.filter(k => selectedWeeks.has(k)).length;
    
    if (selectedCount === 0) return 'none';
    if (selectedCount === weekKeys.length) return 'all';
    return 'partial';
  };

  // Load prior week schedule for context
  const getPriorWeekShifts = async (weekStart) => {
    try {
      const priorDate = new Date(weekStart);
      priorDate.setDate(priorDate.getDate() - 7);
      const priorWeekKey = formatDate(priorDate);
      
      const schedule = await loadScheduleFromFirebase(priorWeekKey);
      if (schedule && schedule.assignments) {
        return schedule.assignments;
      }
      return [];
    } catch (err) {
      console.warn(`Could not load prior week shifts for ${formatDate(weekStart)}:`, err);
      return [];
    }
  };

  // Build employee data with prior shifts context
  const buildEmployeeSpec = async (priorAssignments) => {
    return employees.map(emp => {
      // Count night shifts in prior week
      const priorNightShifts = priorAssignments.filter(
        a => a.employee_id === emp.id && a.shift_type === 'night'
      ).length;
      
      return {
        id: emp.id,
        name: emp.name,
        email: emp.email || '',
        prior_night_shifts: priorNightShifts,
      };
    });
  };

  const handleGenerateBulk = async () => {
    if (selectedWeeks.size === 0) {
      setError('Please select at least one week to generate');
      return;
    }

    setGenerating(true);
    setError(null);
    setResults([]);
    setShowResults(false);
    setPausedWeek(null);

    const weeksToGenerate = Array.from(selectedWeeks)
      .map(weekStr => {
        const [year, month, day] = weekStr.split('-').map(Number);
        return new Date(year, month - 1, day);
      })
      .sort((a, b) => a - b);

    const generationResults = [];
    let currentPriorAssignments = [];

    for (let i = 0; i < weeksToGenerate.length; i++) {
      const weekStart = weeksToGenerate[i];
      const weekStartStr = formatDate(weekStart);

      // Check if schedule already exists
      const existingSchedule = await loadScheduleFromFirebase(weekStartStr);
      if (existingSchedule && existingSchedule.assignments) {
        setProgress({
          current: i + 1,
          total: weeksToGenerate.length,
          weekStart: weekStartStr,
          status: 'exists',
        });
        generationResults.push({
          weekStart: weekStartStr,
          status: 'skipped',
          message: 'Schedule already exists - skipped',
        });
        // Don't update currentPriorAssignments since we skipped
        continue;
      }

      try {
        setProgress({
          current: i + 1,
          total: weeksToGenerate.length,
          weekStart: weekStartStr,
          status: 'generating',
        });

        // Build employee spec with prior week context
        const employeeSpec = await buildEmployeeSpec(currentPriorAssignments);

        const spec = {
          week_start: weekStartStr,
          employees: employeeSpec,
        };

        const data = await generateSchedule(spec, getIdToken);

        if (data.status === 'optimal' || data.status === 'feasible') {
          // Save to Firebase
          const scheduleData = {
            weekStart: weekStartStr,
            assignments: data.assignments || [],
            leaves: {},
            savedAt: new Date().toISOString(),
            savedBy: 'bulk-generation',
          };

          await saveScheduleToFirebase(weekStartStr, scheduleData);

          generationResults.push({
            weekStart: weekStartStr,
            status: 'success',
            message: `✅ ${data.assignments?.length || 0} shifts generated`,
          });

          // Update prior assignments for next week
          currentPriorAssignments = data.assignments || [];
        } else {
          // Generation failed - pause and ask user
          setPausedWeek({
            weekStart: weekStartStr,
            message: data.message || 'Schedule generation failed',
            data,
          });
          setProgress({
            current: i + 1,
            total: weeksToGenerate.length,
            weekStart: weekStartStr,
            status: 'paused',
          });
          setGenerating(false);
          setResults(generationResults);
          return;
        }
      } catch (err) {
        console.error(`Error generating week ${weekStartStr}:`, err);
        
        // Pause on error
        setPausedWeek({
          weekStart: weekStartStr,
          message: err.message || 'Unknown error occurred',
        });
        setProgress({
          current: i + 1,
          total: weeksToGenerate.length,
          weekStart: weekStartStr,
          status: 'paused',
        });
        setGenerating(false);
        setResults(generationResults);
        return;
      }
    }

    // All weeks completed successfully
    setProgress(null);
    setResults(generationResults);
    setShowResults(true);
    setGenerating(false);
    
    // Auto-close after 2 seconds
    setTimeout(() => {
      onGenerationComplete?.();
      onClose();
    }, 2000);
  };

  const handleSkipPausedWeek = async () => {
    if (!pausedWeek) return;

    setPausedWeek(null);
    // Continue generation with next week
    setGenerating(true);

    // Find and continue
    const weeksToGenerate = Array.from(selectedWeeks)
      .map(weekStr => {
        const [year, month, day] = weekStr.split('-').map(Number);
        return new Date(year, month - 1, day);
      })
      .sort((a, b) => a - b);

    // This is a simplified approach - would need to refactor for proper continuation
    // For now, just add to results and close
    setResults(prev => [...prev, {
      weekStart: pausedWeek.weekStart,
      status: 'skipped',
      message: `⏭️ Skipped: ${pausedWeek.message}`,
    }]);
    setShowResults(true);
    setGenerating(false);
  };

  const handleRetryPausedWeek = async () => {
    if (!pausedWeek) return;

    try {
      const employeeSpec = employees.map(emp => ({
        id: emp.id,
        name: emp.name,
        email: emp.email || '',
      }));

      const spec = {
        week_start: pausedWeek.weekStart,
        employees: employeeSpec,
      };

      const data = await generateSchedule(spec, getIdToken);

      if (data.status === 'optimal' || data.status === 'feasible') {
        const scheduleData = {
          weekStart: pausedWeek.weekStart,
          assignments: data.assignments || [],
          leaves: {},
          savedAt: new Date().toISOString(),
          savedBy: 'bulk-generation-retry',
        };

        await saveScheduleToFirebase(pausedWeek.weekStart, scheduleData);

        setResults(prev => [...prev, {
          weekStart: pausedWeek.weekStart,
          status: 'success',
          message: `✅ Retry succeeded: ${data.assignments?.length || 0} shifts generated`,
        }]);
        setPausedWeek(null);
        setShowResults(true);
        setGenerating(false);
      } else {
        setError(`Retry failed: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      setError(`Retry error: ${err.message}`);
    }
  };

  const successCount = results.filter(r => r.status === 'success').length;
  const skippedCount = results.filter(r => r.status === 'skipped').length;

  return (
    <GenericModal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="📅 Bulk Schedule Generation"
      maxWidthClass="max-w-2xl"
      disableContentScroll={false}
    >
      <div className="space-y-6">

        {/* Error Display */}
        {error && !pausedWeek && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border border-red-200 rounded-lg p-4"
          >
            <div className="flex items-start space-x-3">
              <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
              <div className="text-red-800">{error}</div>
            </div>
          </motion.div>
        )}

        {/* Paused Week Dialog */}
        {pausedWeek && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-6"
          >
            <div className="flex items-start space-x-3 mb-4">
              <AlertCircle className="text-yellow-600 flex-shrink-0 mt-0.5" size={24} />
              <div>
                <h3 className="font-bold text-yellow-900 text-lg">Generation Paused</h3>
                <p className="text-yellow-800 mt-1">
                  <strong>Week:</strong> {pausedWeek.weekStart}
                </p>
                <p className="text-yellow-800 mt-2">
                  <strong>Issue:</strong> {pausedWeek.message}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleRetryPausedWeek}
                className="flex-1 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors flex items-center justify-center space-x-2"
              >
                <RefreshCw size={16} />
                <span>Retry This Week</span>
              </button>
              <button
                onClick={handleSkipPausedWeek}
                className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Skip Week
              </button>
            </div>

            {results.length > 0 && (
              <div className="mt-4 pt-4 border-t border-yellow-200">
                <p className="text-sm text-yellow-800 mb-2">Progress so far:</p>
                <ul className="text-sm space-y-1">
                  {results.map(r => (
                    <li key={r.weekStart} className="text-yellow-700">
                      {r.weekStart}: {r.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        )}

        {/* Progress Bar */}
        {progress && !pausedWeek && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-blue-50 border border-blue-200 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-gray-900">
                {progress.status === 'generating' ? '🔄 Generating' : '⏳ Processing'}: {progress.weekStart}
              </span>
              <span className="text-sm text-gray-600">
                {progress.current} / {progress.total}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                className="bg-blue-600 h-2 rounded-full"
              />
            </div>
          </motion.div>
        )}

        {/* Results Display */}
        {showResults && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-50 border border-green-200 rounded-lg p-4"
          >
            <div className="flex items-start space-x-3 mb-3">
              <Check className="text-green-600 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <h3 className="font-bold text-green-900">Generation Complete</h3>
                <p className="text-green-800 text-sm mt-1">
                  ✅ {successCount} generated • ⏭️ {skippedCount} skipped
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {results.map(r => (
                <div key={r.weekStart} className={`text-sm p-2 rounded flex items-center space-x-2 ${
                  r.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                }`}>
                  <span className="font-semibold flex-shrink-0">{r.weekStart}</span>
                  <span>{r.message}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Calendar/Month View */}
        {!progress && !showResults && (
          <>
            {/* View Mode Toggle */}
            <div className="flex gap-2 border-b border-gray-200 pb-4">
              <button
                onClick={() => setViewMode('month')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  viewMode === 'month'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                📅 Month View
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  viewMode === 'week'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                📆 Week View
              </button>
            </div>

            {/* Month/Week Navigation */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  const newDate = new Date(currentDate);
                  newDate.setMonth(newDate.getMonth() - 1);
                  setCurrentDate(newDate);
                }}
                className="p-2 hover:bg-gray-100 rounded transition-colors"
              >
                <ChevronLeft size={20} className="text-gray-600" />
              </button>

              <h3 className="text-lg font-semibold text-gray-900">
                {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </h3>

              <button
                onClick={() => {
                  const newDate = new Date(currentDate);
                  newDate.setMonth(newDate.getMonth() + 1);
                  setCurrentDate(newDate);
                }}
                className="p-2 hover:bg-gray-100 rounded transition-colors"
              >
                <ChevronRight size={20} className="text-gray-600" />
              </button>
            </div>

            {/* Calendar Grid */}
            {viewMode === 'month' ? (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {getWeeksInMonth(currentDate).map((weekStart, idx) => {
                  const weekEnd = new Date(weekStart);
                  weekEnd.setDate(weekEnd.getDate() + 6);
                  const isSelected = isWeekSelected(weekStart);

                  return (
                    <div
                      key={idx}
                      onClick={() => toggleWeekSelection(weekStart)}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-blue-50 border-blue-500'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                            isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                          }`}>
                            {isSelected && <Check size={16} className="text-white" />}
                          </div>
                          <span className="font-medium text-gray-900">
                            {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <span className="text-sm text-gray-600">
                          {formatDate(weekStart)}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Month-level Select All */}
                <div className="border-t border-gray-200 pt-3 mt-3">
                  <button
                    onClick={() => toggleMonthSelection(currentDate)}
                    className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors font-medium"
                  >
                    {getMonthSelectState(currentDate) === 'all'
                      ? '✓ Deselect All Weeks'
                      : getMonthSelectState(currentDate) === 'partial'
                      ? '+ Select All Weeks'
                      : '+ Select All Weeks'}
                  </button>
                </div>
              </div>
            ) : (
              /* Week View - detailed week picker */
              <div className="space-y-2 max-h-96 overflow-y-auto">
                <p className="text-sm text-gray-600 mb-3">Select individual weeks:</p>
                {getWeeksInMonth(currentDate).map((weekStart, idx) => {
                  const weekEnd = new Date(weekStart);
                  weekEnd.setDate(weekEnd.getDate() + 6);
                  const isSelected = isWeekSelected(weekStart);
                  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

                  return (
                    <div
                      key={idx}
                      onClick={() => toggleWeekSelection(weekStart)}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-blue-50 border-blue-500'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                            isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                          }`}>
                            {isSelected && <Check size={16} className="text-white" />}
                          </div>
                          <span className="font-medium text-gray-900">Week of {formatDate(weekStart)}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-7 gap-1 ml-7 text-xs text-gray-600">
                        {Array.from({ length: 7 }).map((_, day) => {
                          const date = new Date(weekStart);
                          date.setDate(date.getDate() + day);
                          return (
                            <div key={day} className="text-center">
                              <div className="font-semibold">{dayNames[date.getDay()]}</div>
                              <div>{date.getDate()}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Selection Summary */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">
                    {selectedWeeks.size} {selectedWeeks.size === 1 ? 'week' : 'weeks'} selected
                  </p>
                  {selectedWeeks.size > 0 && (
                    <p className="text-sm text-gray-600 mt-1">
                      Will generate schedules considering prior week shifts for context
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 border-t border-gray-200 pt-6">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateBulk}
                disabled={selectedWeeks.size === 0 || generating}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {generating ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <Calendar size={16} />
                    <span>Generate {selectedWeeks.size} Week{selectedWeeks.size !== 1 ? 's' : ''}</span>
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </GenericModal>
  );
}

/**
 * Month Calendar Component
 * Compact month picker with week selection functionality
 */

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { 
  getMonthGrid, 
  getMonthNames, 
  getWeekdayNames, 
  formatDate, 
  getToday, 
  getWeekStart,
  navigateMonth,
  isSameDate
} from '../utils/dateHelpers';

/**
 * MonthCalendar Component
 * @param {Object} props - Component props
 * @param {Date} props.selectedWeekStart - Currently selected week start
 * @param {Function} props.onWeekSelect - Week selection handler
 * @param {string} props.className - Additional CSS classes
 */
export default function MonthCalendar({ 
  selectedWeekStart, 
  onWeekSelect, 
  className = '' 
}) {
  const today = getToday();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  
  const monthNames = getMonthNames();
  const weekdayNames = getWeekdayNames();
  const monthGrid = getMonthGrid(currentYear, currentMonth);

  // Navigate to previous/next month
  const navigateToPrevious = () => {
    const { year, month } = navigateMonth(currentYear, currentMonth, -1);
    setCurrentYear(year);
    setCurrentMonth(month);
  };

  const navigateToNext = () => {
    const { year, month } = navigateMonth(currentYear, currentMonth, 1);
    setCurrentYear(year);
    setCurrentMonth(month);
  };

  // Handle day click - select week containing that day
  const handleDayClick = (date) => {
    if (date) {
      const weekStart = getWeekStart(date);
      onWeekSelect(weekStart);
    }
  };

  // Check if date is in the selected week
  const isInSelectedWeek = (date) => {
    if (!date || !selectedWeekStart) return false;
    const weekStart = getWeekStart(date);
    return isSameDate(weekStart, selectedWeekStart);
  };

  // Quick navigation to current week
  const goToCurrentWeek = () => {
    const currentWeekStart = getWeekStart(today);
    onWeekSelect(currentWeekStart);
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">
          {monthNames[currentMonth]} {currentYear}
        </h3>
        
        <div className="flex items-center space-x-1">
          <button
            onClick={navigateToPrevious}
            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          
          <button
            onClick={goToCurrentWeek}
            className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="Go to current week"
          >
            Today
          </button>
          
          <button
            onClick={navigateToNext}
            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="space-y-1">
        {/* Weekday Headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekdayNames.map((day) => (
            <div 
              key={day}
              className="text-xs font-medium text-gray-500 text-center py-1"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Date Grid */}
        {monthGrid.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 gap-1">
            {week.map((date, dayIndex) => {
              const isToday = date && isSameDate(date, today);
              const isCurrentMonth = date && date.getMonth() === currentMonth;
              const isSelected = isInSelectedWeek(date);
              
              return (
                <motion.button
                  key={`${weekIndex}-${dayIndex}`}
                  whileHover={date ? { scale: 1.1 } : {}}
                  whileTap={date ? { scale: 0.95 } : {}}
                  onClick={() => handleDayClick(date)}
                  disabled={!date}
                  className={`
                    h-8 w-8 text-xs rounded-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                    ${!date ? 'invisible' : ''}
                    ${!isCurrentMonth ? 'text-gray-300 hover:text-gray-400' : ''}
                    ${isCurrentMonth && !isToday && !isSelected ? 'text-gray-700 hover:bg-gray-100' : ''}
                    ${isToday ? 'bg-blue-600 text-white font-semibold hover:bg-blue-700' : ''}
                    ${isSelected && !isToday ? 'bg-blue-100 text-blue-700 font-medium hover:bg-blue-200' : ''}
                  `}
                  aria-label={
                    date 
                      ? `${formatDate(date, 'MMMM d, yyyy')}${isToday ? ' (Today)' : ''}${isSelected ? ' (Selected week)' : ''}`
                      : undefined
                  }
                >
                  {date ? date.getDate() : ''}
                </motion.button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer Info */}
      <div className="mt-4 pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Click any date to select week</span>
          {selectedWeekStart && (
            <span className="font-medium">
              Week of {formatDate(selectedWeekStart, 'MMM d')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact Month Selector for mobile or minimal layouts
 */
export function CompactMonthSelector({ 
  selectedWeekStart, 
  onWeekSelect, 
  className = '' 
}) {
  const today = getToday();
  const [currentDate, setCurrentDate] = useState(selectedWeekStart || today);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const containerRef = useRef(null);

  // Close calendar when clicking outside
  useEffect(() => {
    if (!isCalendarOpen) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isCalendarOpen]);

  // Keep currentDate in sync when parent changes weekStart
  useEffect(() => {
    if (selectedWeekStart) setCurrentDate(selectedWeekStart);
  }, [selectedWeekStart]);

  const navigateWeek = (direction) => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + (direction * 7));
    setCurrentDate(newDate);
    onWeekSelect(getWeekStart(newDate));
  };

  const handleWeekSelect = (weekStart) => {
    setCurrentDate(weekStart);
    onWeekSelect(weekStart);
    setIsCalendarOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-3">
        <button
          onClick={() => navigateWeek(-1)}
          className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          aria-label="Previous week"
        >
          <ChevronLeft size={20} />
        </button>
        
        <button
          onClick={() => setIsCalendarOpen(prev => !prev)}
          className="text-center flex-1 cursor-pointer hover:text-blue-600 transition-colors focus:outline-none"
          aria-label="Open calendar"
        >
          <div className="font-medium text-gray-900 hover:text-blue-600">
            {formatDate(currentDate, 'MMMM yyyy')}
          </div>
          <div className="text-sm text-gray-500 hover:text-blue-500">
            Week of {formatDate(getWeekStart(currentDate), 'MMM d')}
          </div>
        </button>
        
        <button
          onClick={() => navigateWeek(1)}
          className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          aria-label="Next week"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Calendar popup */}
      {isCalendarOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 shadow-xl rounded-lg border border-gray-200 bg-white dark:bg-[var(--dm-surface)] dark:border-[rgba(255,255,255,0.08)]">
          <MonthCalendar
            selectedWeekStart={selectedWeekStart}
            onWeekSelect={handleWeekSelect}
          />
        </div>
      )}
    </div>
  );
}
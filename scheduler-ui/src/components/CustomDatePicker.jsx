import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Custom Date Picker Component
 * Keeps calendar open while navigating months, only closes on date selection or click outside
 */
export default function CustomDatePicker({ 
  value = '', 
  onChange, 
  min = '', 
  max = '', 
  className = '' 
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => {
    if (value) {
      const date = new Date(value + 'T00:00:00');
      return new Date(date.getFullYear(), date.getMonth(), 1);
    }
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  });
  const pickerRef = useRef(null);
  const inputRef = useRef(null);

  // Parse min/max dates
  const minDate = min ? new Date(min + 'T00:00:00') : null;
  const maxDate = max ? new Date(max + 'T00:00:00') : null;

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const isDateDisabled = (date) => {
    if (minDate && date < minDate) return true;
    if (maxDate && date > maxDate) return true;
    return false;
  };

  const isDateSelected = (date) => {
    if (!value) return false;
    // Compare dates in YYYY-MM-DD format to avoid timezone issues
    const selectedDate = new Date(value + 'T12:00:00'); // Use noon
    const selectedStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return dateStr === selectedStr;
  };

  const handleDateClick = (day) => {
    // Create date in local timezone to avoid UTC conversion issues
    const year = displayMonth.getFullYear();
    const month = displayMonth.getMonth();
    const selectedDate = new Date(year, month, day, 12, 0, 0); // Use noon to avoid timezone edge cases
    
    if (!isDateDisabled(selectedDate)) {
      // Format as YYYY-MM-DD using local date components
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      onChange({ target: { value: dateStr } });
      setIsOpen(false);
    }
  };

  const handlePrevMonth = () => {
    const prevMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1);
    if (!minDate || prevMonth >= new Date(minDate.getFullYear(), minDate.getMonth(), 1)) {
      setDisplayMonth(prevMonth);
    }
  };

  const handleNextMonth = () => {
    const nextMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1);
    if (!maxDate || nextMonth <= new Date(maxDate.getFullYear(), maxDate.getMonth(), 1)) {
      setDisplayMonth(nextMonth);
    }
  };

  const daysInMonth = getDaysInMonth(displayMonth);
  const firstDay = getFirstDayOfMonth(displayMonth);
  const monthName = displayMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const days = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  return (
    <div className="relative w-full" ref={pickerRef}>
      {/* Input field */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onClick={() => setIsOpen(!isOpen)}
        readOnly
        placeholder="Pick a date"
        className={`${className} cursor-pointer`}
      />

      {/* Calendar dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 p-4 w-80">
          {/* Month/Year header with navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={handlePrevMonth}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
              title="Previous month"
            >
              <ChevronLeft size={20} className="text-gray-600" />
            </button>
            <h3 className="text-base font-semibold text-gray-900 text-center flex-1">
              {monthName}
            </h3>
            <button
              onClick={handleNextMonth}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
              title="Next month"
            >
              <ChevronRight size={20} className="text-gray-600" />
            </button>
          </div>

          {/* Day names header */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, index) => {
              if (day === null) {
                return <div key={`empty-${index}`} className="p-2" />;
              }

              const dateObj = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day);
              const isDisabled = isDateDisabled(dateObj);
              const isSelected = isDateSelected(dateObj);

              return (
                <button
                  key={day}
                  onClick={() => handleDateClick(day)}
                  disabled={isDisabled}
                  className={`
                    p-2 text-sm font-medium rounded transition-colors
                    ${isDisabled 
                      ? 'text-gray-300 cursor-not-allowed bg-gray-50' 
                      : isSelected
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'text-gray-900 hover:bg-blue-50'
                    }
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

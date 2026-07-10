/**
 * Individual shift card component
 * Displays shift information with type-specific styling and interactions
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { formatTimeRange } from '../utils/dateHelpers';

// Shift type configurations with more distinct colors
const SHIFT_CONFIG = {
  morning: {
    label: 'Morning',
    icon: '🌅',
    colorClasses: 'bg-orange-100 border-l-orange-500 text-orange-800',
    darkColorClasses: 'dark:bg-[#20252b] dark:border-l-orange-400 dark:text-orange-300',
    chipDarkColorClasses: 'dark:bg-orange-500/10 dark:text-orange-300',
    hoverClasses: 'hover:bg-orange-200 hover:shadow-orange-500/30',
    darkHoverClasses: 'dark:hover:bg-[#252b33]',
    start_hour: 4,
    start_minute: 0,
    end_hour: 13,
    end_minute: 0
  },
  day: {
    label: 'Day', 
    icon: '☀️',
    colorClasses: 'bg-yellow-100 border-l-yellow-500 text-yellow-800',
    darkColorClasses: 'dark:bg-[#20252b] dark:border-l-yellow-400 dark:text-yellow-300',
    chipDarkColorClasses: 'dark:bg-yellow-500/10 dark:text-yellow-300',
    hoverClasses: 'hover:bg-yellow-200 hover:shadow-yellow-500/30',
    darkHoverClasses: 'dark:hover:bg-[#252b33]',
    start_hour: 10,
    start_minute: 0,
    end_hour: 19,
    end_minute: 0
  },
  afternoon: {
    label: 'Afternoon',
    icon: '🌇', 
    colorClasses: 'bg-purple-100 border-l-purple-500 text-purple-800',
    darkColorClasses: 'dark:bg-[#20252b] dark:border-l-purple-400 dark:text-purple-300',
    chipDarkColorClasses: 'dark:bg-purple-500/10 dark:text-purple-300',
    hoverClasses: 'hover:bg-purple-200 hover:shadow-purple-500/30',
    darkHoverClasses: 'dark:hover:bg-[#252b33]',
    start_hour: 15,
    start_minute: 0,
    end_hour: 0,
    end_minute: 0,
    nextDay: true // Ends at midnight next day
  },
  night: {
    label: 'Night',
    icon: '🌙',
    colorClasses: 'bg-blue-100 border-l-blue-500 text-blue-800',
    darkColorClasses: 'dark:bg-[#20252b] dark:border-l-blue-400 dark:text-blue-300',
    chipDarkColorClasses: 'dark:bg-blue-500/10 dark:text-blue-300',
    hoverClasses: 'hover:bg-blue-200 hover:shadow-blue-500/30',
    darkHoverClasses: 'dark:hover:bg-[#252b33]',
    start_hour: 19,
    start_minute: 0,
    end_hour: 4,
    end_minute: 0,
    nextDay: true // Ends at 4am next day
  },
  overtime: {
    label: 'Overtime',
    icon: '⚡',
    colorClasses: 'bg-red-100 border-l-red-500 text-red-800',
    darkColorClasses: 'dark:bg-[#20252b] dark:border-l-red-400 dark:text-red-300',
    chipDarkColorClasses: 'dark:bg-red-500/10 dark:text-red-300',
    hoverClasses: 'hover:bg-red-200 hover:shadow-red-500/30',
    darkHoverClasses: 'dark:hover:bg-[#252b33]',
  },
  custom: {
    label: 'Custom',
    icon: '💫',
    colorClasses: 'bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100 border-l-pink-500 text-gray-800',
    darkColorClasses: 'dark:bg-[#20252b] dark:from-[#20252b] dark:via-[#20252b] dark:to-[#20252b] dark:border-l-pink-400 dark:text-gray-200',
    chipDarkColorClasses: 'dark:bg-pink-500/10 dark:text-pink-300',
    hoverClasses: 'hover:from-pink-200 hover:via-purple-200 hover:to-blue-200 hover:shadow-pink-500/30 hover:shadow-lg',
    darkHoverClasses: 'dark:hover:bg-[#252b33] dark:hover:from-[#252b33] dark:hover:via-[#252b33] dark:hover:to-[#252b33]',
  },
};

/**
 * ShiftCard Component
 * @param {Object} props - Component props
 * @param {Object} props.assignment - Shift assignment data
 * @param {Object} props.leaveData - Leave data for this shift (optional)
 * @param {boolean} props.hasMultipleLeavesOnSameDay - Whether employee has multiple leaves on same day (data issue)
 * @param {Function} props.onClick - Click handler for shift details
 * @param {boolean} props.isClickable - Whether card is interactive
 * @param {string} props.className - Additional CSS classes
 * @param {boolean} props.isDraggable - Whether card can be dragged
 * @param {Function} props.onDragStart - Drag start handler
 * @param {Function} props.onDragEnd - Drag end handler
 * @param {boolean} props.isBulkDeleteMode - Whether in bulk delete mode
 * @param {Function} props.onDelete - Delete handler (called when card is clicked in delete mode)
 */
export default function ShiftCard({ 
  assignment,
  leaveData,
  hasMultipleLeavesOnSameDay = false,
  onClick, 
  isClickable = true, 
  className = '',
  isDraggable = false,
  onDragStart,
  onDragEnd,
  isBulkDeleteMode = false,
  onDelete
}) {
  const config = SHIFT_CONFIG[assignment.shift_type];

  const rawComment =
    assignment?.comment ??
    assignment?.notes ??
    assignment?.note ??
    assignment?.comments ??
    '';
  const commentText = typeof rawComment === 'string' ? rawComment.trim() : rawComment ? String(rawComment) : '';

  const [isHoveringComment, setIsHoveringComment] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const tooltipRef = useRef(null);
  const [tooltipSize, setTooltipSize] = useState({ width: 0, height: 0 });
  
  if (!config) {
    console.warn(`Unknown shift type: ${assignment.shift_type}`);
    return null;
  }

  useEffect(() => {
    if (!isHoveringComment) return;
    const id = requestAnimationFrame(() => {
      const rect = tooltipRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipSize({ width: rect.width, height: rect.height });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [isHoveringComment, commentText]);

  // Hardcoded shift time ranges (9 hours total including 1-hour break)
  const SHIFT_TIMES = {
    morning: { start: '04:00', end: '13:00' },    // 04:00-13:00 (9h)
    day: { start: '10:00', end: '19:00' },        // 10:00-19:00 (9h)
    afternoon: { start: '15:00', end: '00:00' },  // 15:00-00:00 (9h)
    night: { start: '19:00', end: '04:00' }       // 19:00-04:00 (9h)
  };

  const shiftTime = SHIFT_TIMES[assignment.shift_type];
  
  // Determine time range display
  let timeRange;
  if (assignment.shift_type === 'custom') {
    // Custom shifts use start_datetime and end_datetime
    if (assignment.start_datetime && assignment.end_datetime) {
      timeRange = formatTimeRange(assignment.start_datetime, assignment.end_datetime);
    } else {
      timeRange = 'Custom Time';
    }
  } else if (shiftTime) {
    timeRange = `${shiftTime.start}-${shiftTime.end}`;
  } else if (assignment.start_datetime && assignment.end_datetime) {
    timeRange = formatTimeRange(assignment.start_datetime, assignment.end_datetime);
  } else {
    console.warn('⚠️ No time data available for shift:', assignment);
    timeRange = 'Time TBD';
  }

  const handleClick = (e) => {
    // Don't trigger click if we're dragging
    if (e.defaultPrevented) return;
    
    // Handle bulk delete mode
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
  
  const handleDragStart = (e) => {
    if (!isDraggable || !onDragStart) return;
    
    // Set drag data
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify(assignment));
    
    // Visual feedback
    e.currentTarget.style.opacity = '0.5';
    
    if (onDragStart) {
      onDragStart(assignment);
    }
  };
  
  const handleDragEnd = (e) => {
    if (!isDraggable) return;
    
    // Reset visual feedback
    e.currentTarget.style.opacity = '1';
    
    if (onDragEnd) {
      onDragEnd();
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

  // Hardcoded shift durations (8 paid hours per shift, 9 hours total with break)
  const SHIFT_PAID_HOURS = {
    morning: 8,    // 04:00-13:00 (9h total, 8h paid)
    day: 8,        // 10:00-19:00 (9h total, 8h paid)
    afternoon: 8,  // 15:00-00:00 (9h total, 8h paid)
    night: 8       // 19:00-04:00 (9h total, 8h paid)
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isClickable ? { y: -2, scale: 1.02 } : {}}
      whileTap={isClickable ? { scale: 0.98 } : {}}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseEnter={() => {
        if (commentText) setIsHoveringComment(true);
      }}
      onMouseMove={(e) => {
        if (!commentText) return;
        setCursorPosition({ x: e.clientX, y: e.clientY });
      }}
      onMouseLeave={() => {
        setIsHoveringComment(false);
      }}
      className={`
        relative border-l-4 rounded-r-md p-4 transition-all duration-200 overflow-hidden
        ${leaveData ? 'border-l-red-600' : ''}
        ${config.colorClasses}
        ${config.darkColorClasses}
        ${isBulkDeleteMode ? 'cursor-pointer ring-2 ring-red-400 ring-offset-1 dark:ring-offset-gray-900 hover:bg-red-200 dark:hover:bg-red-900/30 hover:opacity-90' : ''}
        ${isClickable && !isBulkDeleteMode ? `cursor-pointer ${config.hoverClasses} ${config.darkHoverClasses} focus:outline-none focus:ring-2 focus:ring-offset-1` : ''}
        ${isDraggable && !isBulkDeleteMode ? 'cursor-move' : ''}
        ${className}
      `}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={isClickable ? 0 : -1}
      role={isClickable ? 'button' : 'presentation'}
      aria-label={
        isBulkDeleteMode
          ? `${config.label} shift for ${assignment.employee_name}, ${timeRange}. Click to delete.`
          : isClickable 
            ? `${config.label} shift for ${assignment.employee_name}, ${timeRange}. Click for details.`
            : `${config.label} shift, ${timeRange}`
      }
    >
      {isHoveringComment && commentText && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            className="fixed z-[9999] pointer-events-none max-w-[320px] rounded-md bg-gray-900/95 px-3 py-2 text-xs text-white shadow-lg border border-white/10"
            style={(() => {
              const offset = 14;
              const padding = 8;
              const viewportWidth = window.innerWidth || 0;
              const viewportHeight = window.innerHeight || 0;

              let left = cursorPosition.x + offset;
              let top = cursorPosition.y + offset;

              if (left + tooltipSize.width + padding > viewportWidth) {
                left = cursorPosition.x - offset - tooltipSize.width;
              }
              if (top + tooltipSize.height + padding > viewportHeight) {
                top = cursorPosition.y - offset - tooltipSize.height;
              }

              left = Math.max(padding, Math.min(viewportWidth - tooltipSize.width - padding, left));
              top = Math.max(padding, Math.min(viewportHeight - tooltipSize.height - padding, top));

              return { left, top };
            })()}
          >
            <div className="whitespace-pre-wrap break-words">{commentText}</div>
          </div>,
          document.body
        )}
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
      {/* Shift type indicator */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center space-x-1">
          <span className="text-sm" role="img" aria-hidden="true">
            {config.icon}
          </span>
          <span className="font-medium text-sm">{config.label}</span>
        </div>
        
        <div className="flex items-center space-x-1">
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
          
          {/* Optional priority indicator */}
          {assignment.priority && (
            <span 
              className="w-2 h-2 bg-red-500 rounded-full" 
              title="High priority shift"
              aria-label="High priority"
            />
          )}
        </div>
      </div>

      {/* Time range or overtime duration or custom shift time */}
      <div className="text-xs font-mono text-gray-600 truncate">
        {assignment.shift_type === 'overtime' 
          ? formatTimeRange(assignment.start_datetime, assignment.end_datetime)
          : assignment.shift_type === 'custom'
          ? `${assignment.start_time}-${assignment.finish_time}`
          : timeRange}
      </div>

      {/* Employee name (shown in compact view) */}
      {assignment.showEmployeeName && (
        <div className="text-xs text-gray-500 mt-1 truncate">
          {assignment.employee_name}
        </div>
      )}
      </div>

      {/* Hover effect overlay */}
      {isClickable && (
        <div className="absolute inset-0 rounded-r-md bg-white/0 hover:bg-white/10 transition-colors duration-200 pointer-events-none" />
      )}
    </motion.div>
  );
}

/**
 * Compact shift indicator for small spaces
 * Used in summary views or mobile layouts
 */
export function ShiftIndicator({ shiftType, count, className = '' }) {
  const config = SHIFT_CONFIG[shiftType];
  
  if (!config) return null;

  return (
    <div 
      className={`
        inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs
        ${config.colorClasses} ${config.chipDarkColorClasses || config.darkColorClasses} ${className}
      `}
      title={`${count} ${config.label} shift${count !== 1 ? 's' : ''}`}
    >
      <span role="img" aria-hidden="true">{config.icon}</span>
      <span>{count}</span>
    </div>
  );
}

/**
 * Empty shift placeholder
 * Shown in cells with no assigned shifts
 */
export function EmptyShiftSlot({ onAdd, employeeName, date, className = '' }) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className={`
        border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-md p-3 text-center
        hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200
        ${onAdd ? 'cursor-pointer' : ''}
        ${className}
      `}
      onClick={onAdd}
      role={onAdd ? 'button' : 'presentation'}
      tabIndex={onAdd ? 0 : -1}
      aria-label={onAdd ? `Add shift for ${employeeName} on ${date}` : 'No shift assigned'}
    >
      <div className="text-gray-400 text-xs">
        {onAdd ? (
          <>
            <span className="block">+</span>
            <span>Add shift</span>
          </>
        ) : (
          'No shift'
        )}
      </div>
    </motion.div>
  );
}

/**
 * Free shift slot component
 * Displays available open shifts that employees can claim
 */
export function FreeShiftSlot({ shiftType, date, onClick, className = '' }) {
  const config = SHIFT_CONFIG[shiftType];
  
  if (!config) return null;

  // Use hardcoded shift times for consistency
  const SHIFT_TIMES = {
    morning: '04:00-13:00',
    day: '10:00-19:00',
    afternoon: '15:00-00:00',
    night: '19:00-04:00'
  };

  const timeRange = SHIFT_TIMES[shiftType] || '00:00-00:00';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`
        relative border-l-4 border-dotted rounded-r-md p-4 transition-all duration-200
        cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1
        bg-green-100 dark:bg-gray-800 border-green-500 dark:border-green-400 text-green-800 dark:text-green-300
        hover:bg-green-200 dark:hover:bg-gray-700 hover:shadow-md hover:shadow-green-500/30
        ${className}
      `}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Claim available ${config.label} shift on ${date}`}
    >
      {/* Availability badge */}
      <div className="absolute top-1.5 right-1.5 bg-green-600 text-white text-[8px] font-bold px-1 py-0.5 rounded-full leading-none">
        OPEN
      </div>

      {/* Content */}
      <div>
        {/* Shift type */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center space-x-1">
            <span className="text-sm" role="img" aria-hidden="true">
              {config.icon}
            </span>
            <span className="font-medium text-sm">{config.label}</span>
          </div>
        </div>

        {/* Time range */}
        <div className="text-xs font-mono text-gray-600">
          {timeRange}
        </div>
      </div>

      {/* Hover effect overlay */}
      <div className="absolute inset-0 rounded-r-md bg-white/0 hover:bg-white/10 transition-colors duration-200 pointer-events-none" />
    </motion.div>
  );
}

// Helper to get shift config (start/end times)
const getShiftConfig = (shiftType) => {
  const configs = {
    morning: { start_hour: 4, start_minute: 0, end_hour: 13, end_minute: 0 },
    day: { start_hour: 10, start_minute: 0, end_hour: 19, end_minute: 0 },
    afternoon: { start_hour: 15, start_minute: 0, end_hour: 0, end_minute: 0 },
    night: { start_hour: 19, start_minute: 0, end_hour: 4, end_minute: 0 },
  };
  return configs[shiftType] || null;
};
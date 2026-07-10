/**
 * Schedule Export/Import Utilities
 * Handles CSV export and import for weekly schedules
 */

/**
 * Calculate leave hours based on timeframe and custom times
 * @param {string} timeframe - Leave timeframe type (all-day, first-half, second-half, other)
 * @param {string} customStart - Custom leave start time (HH:MM format)
 * @param {string} customEnd - Custom leave end time (HH:MM format)
 * @param {number} shiftHours - Default shift hours (8)
 * @returns {number} Leave hours
 */
function calculateLeaveHours(timeframe, customStart = null, customEnd = null, shiftHours = 8) {
  switch (timeframe) {
    case 'all-day':
      return shiftHours;
    case 'first-half':
    case 'second-half':
      return shiftHours / 2;
    case 'other':
      // Calculate from custom_start and custom_end if available
      if (customStart && customEnd) {
        const [startHour, startMin] = customStart.split(':').map(Number);
        const [endHour, endMin] = customEnd.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        let endMinutes = endHour * 60 + endMin;
        // Handle overnight times
        if (endMinutes < startMinutes) {
          endMinutes += 24 * 60;
        }
        return (endMinutes - startMinutes) / 60;
      }
      return 4; // Default half-day
    default:
      return shiftHours;
  }
}

/**
 * Default work hours for each shift type (used in Data Tab calculations)
 */
const SHIFT_WORK_HOURS = {
  morning: 8,
  day: 8,
  afternoon: 8,
  night: 8,
  custom: 0, // Custom shifts must have explicit work_hours
  overtime: 0
};

/**
 * Calculate work hours for a shift
 * @param {Object} assignment - Shift assignment
 * @param {Object} leave - Leave data with leave_hours (optional)
 * @returns {number} Work hours
 */
function calculateWorkHours(assignment, leave = null) {
  // Custom shifts have explicit work_hours field
  if (assignment.shift_type === 'custom') {
    return assignment.work_hours || 0;
  }

  // Get default work hours for shift type (8 hours for standard shifts)
  const defaultHours = SHIFT_WORK_HOURS[assignment.shift_type] || 8;

  // If there's leave, subtract leave hours from default
  if (leave && leave.leave_hours) {
    return Math.max(0, defaultHours - leave.leave_hours);
  }

  // No leave = full work hours
  return defaultHours;
}

/**
 * Export assignments to CSV file
 * @param {Array} assignments - Array of assignment objects
 * @param {Date} weekStart - Start date of the week
 * @param {Array} leaves - Array of leave objects (optional)
 */
export function exportScheduleToCSV(assignments, weekStart, leaves = []) {
  if (!assignments || (assignments.length === 0 && (!leaves || leaves.length === 0))) {
    alert('No shifts or leaves to export');
    return;
  }

  // Filter assignments for this week
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  
  const weekAssignments = assignments.filter(a => {
    const date = a.date || (a.start_datetime ? a.start_datetime.split('T')[0] : '');
    return date >= formatDateForCSV(weekStart) && date <= formatDateForCSV(weekEnd);
  });

  // Filter leaves for this week
  const weekLeaves = (leaves || []).filter(l => {
    const date = l.date || '';
    return date >= formatDateForCSV(weekStart) && date <= formatDateForCSV(weekEnd);
  });

  if (weekAssignments.length === 0 && weekLeaves.length === 0) {
    alert('No shifts or leaves scheduled for this week');
    return;
  }

  // CSV header - use only start_datetime and end_datetime for all shifts
  const headers = ['employee_id', 'employee_name', 'date', 'shift_type', 'start_datetime', 'end_datetime', 'work_hours', 'leave_type', 'leave_hours', 'timeframe', 'notes'];
  
  // Group leaves by (employee_id, date) for easy lookup
  const leaveMap = {};
  weekLeaves.forEach(l => {
    const key = `${l.employee_id}_${l.date}`;
    leaveMap[key] = l;
  });

  // Build rows: merge each shift with its corresponding leave if it exists
  const allRows = weekAssignments.map(a => {
    const leaveKey = `${a.employee_id}_${a.date}`;
    const leave = leaveMap[leaveKey];
    
    // Calculate leave hours with custom times if available
    const leaveHours = leave ? calculateLeaveHours(
      leave.timeframe,
      leave.custom_start,
      leave.custom_end
    ) : 0;
    
    // Calculate work hours for this shift
    const workHours = calculateWorkHours(a, leave ? { leave_hours: leaveHours } : null);
    
    return {
      employee_id: a.employee_id || '',
      employee_name: a.employee_name || '',
      date: a.date || '',
      shift_type: a.shift_type || '',
      start_datetime: a.start_datetime || '',
      end_datetime: a.end_datetime || '',
      work_hours: workHours ? workHours.toFixed(2) : '',
      leave_type: leave ? (leave.leave_type || '') : '',
      leave_hours: leaveHours ? leaveHours.toFixed(2) : '',
      timeframe: leave ? (leave.timeframe || '') : '',
      notes: a.notes || ''
    };
  });

  // Add leaves that don't have a corresponding shift
  const shiftDates = new Set(weekAssignments.map(a => `${a.employee_id}_${a.date}`));
  weekLeaves.forEach(l => {
    const key = `${l.employee_id}_${l.date}`;
    if (!shiftDates.has(key)) {
      const leaveHours = calculateLeaveHours(l.timeframe, l.custom_start, l.custom_end);
      allRows.push({
        employee_id: l.employee_id || '',
        employee_name: l.employee_name || '',
        date: l.date || '',
        shift_type: '',
        start_datetime: '',
        end_datetime: '',
        work_hours: '',
        leave_type: l.leave_type || '',
        leave_hours: leaveHours ? leaveHours.toFixed(2) : '',
        timeframe: l.timeframe || '',
        notes: ''
      });
    }
  });

  // Sort by date then employee_id
  const sorted = allRows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.employee_id - b.employee_id;
  });

  // Build CSV content
  let csv = headers.join(',') + '\n';
  sorted.forEach(row => {
    const csvRow = [
      row.employee_id,
      `"${(row.employee_name).replace(/"/g, '""')}"`, // Escape quotes
      row.date,
      row.shift_type,
      row.start_datetime,
      row.end_datetime,
      row.work_hours,
      row.leave_type,
      row.leave_hours,
      row.timeframe,
      `"${(row.notes || '').replace(/"/g, '""')}"` // Escape quotes in notes
    ];
    csv += csvRow.join(',') + '\n';
  });

  // Download file
  const weekStartStr = formatDateForFileName(weekStart);
  const filename = `schedule_${weekStartStr}.csv`;
  downloadCSV(csv, filename);
}

/**
 * Import assignments from CSV file
 * @param {File} file - CSV file to import
 * @returns {Promise<Array>} Array of imported assignments
 */
export async function importScheduleFromCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const csv = event.target.result;
        const lines = csv.trim().split('\n');
        
        if (lines.length < 2) {
          reject(new Error('CSV file is empty or invalid'));
          return;
        }

        // Parse header
        const headers = lines[0].split(',').map(h => h.trim());
        
        // Validate required columns
        const requiredColumns = ['employee_id', 'employee_name', 'date', 'shift_type'];
        const hasRequiredColumns = requiredColumns.every(col => headers.includes(col));
        
        if (!hasRequiredColumns) {
          reject(new Error(`CSV must contain columns: ${requiredColumns.join(', ')}`));
          return;
        }

        // Check for optional columns
        const hasStartDateTime = headers.includes('start_datetime');
        const hasEndDateTime = headers.includes('end_datetime');
        const hasWorkHours = headers.includes('work_hours');
        const hasLeaveType = headers.includes('leave_type');
        const hasLeaveHours = headers.includes('leave_hours');
        const hasTimeframe = headers.includes('timeframe');
        const hasNotes = headers.includes('notes');
        
        console.log('🔍 CSV IMPORT - Headers detected:', headers);

        // Parse rows
        const assignments = [];
        const leaves = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const assignment = parseCSVLine(line, headers);
          
          // Validate required fields
          if (!assignment.employee_id || !assignment.employee_name || !assignment.date) {
            console.warn(`Skipping invalid row ${i + 1}:`, line);
            continue;
          }

          // Store work_hours if available
          if (hasWorkHours && assignment.work_hours) {
            assignment.work_hours = parseFloat(assignment.work_hours);
          }

          // Extract leave data if present in CSV
          if (hasLeaveType && assignment.leave_type && assignment.leave_type.trim()) {
            console.log(`🔍 CSV IMPORT - Found leave for ${assignment.employee_name} on ${assignment.date}:`, assignment.leave_type, 'timeframe:', assignment.timeframe);
            leaves.push({
              employee_id: parseInt(assignment.employee_id, 10),
              employee_name: assignment.employee_name,
              date: assignment.date,
              shift_type: assignment.shift_type,
              leave_type: assignment.leave_type,
              leave_hours: assignment.leave_hours ? parseFloat(assignment.leave_hours) : null,
              timeframe: assignment.timeframe || 'all-day',
              custom_start: assignment.custom_start || null,
              custom_end: assignment.custom_end || null
            });
          }

          assignments.push(assignment);
        }

        if (assignments.length === 0) {
          reject(new Error('No valid assignments found in CSV'));
          return;
        }

        // Attach leaves data to assignments for caller to process
        assignments._leaves = leaves;
        console.log('🔍 CSV IMPORT - Total assignments:', assignments.length, 'Total leaves:', leaves.length);
        console.log('🔍 CSV IMPORT - Leaves extracted:', leaves);
        resolve(assignments);
      } catch (error) {
        reject(new Error(`Failed to parse CSV: ${error.message}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsText(file);
  });
}

/**
 * Parse a CSV line with proper quote handling
 * @param {string} line - CSV line to parse
 * @param {Array} headers - Column headers
 * @returns {Object} Parsed row object
 */
function parseCSVLine(line, headers) {
  const values = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());

  // Build object
  const row = {};
  headers.forEach((header, index) => {
    let value = values[index] || '';
    // Remove surrounding quotes if present
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    row[header] = value;
  });

  return row;
}

/**
 * Download CSV content to file
 * @param {string} csv - CSV content
 * @param {string} filename - Filename for download
 */
function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Format date for CSV filename (YYYY-MM-DD)
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDateForFileName(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format date for CSV comparison (YYYY-MM-DD)
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDateForCSV(date) {
  return formatDateForFileName(date);
}

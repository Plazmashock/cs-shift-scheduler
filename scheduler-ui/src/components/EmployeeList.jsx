/**
 * Employee List Component
 * Manages employee visibility, search, and selection for the schedule view
 */

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Eye, EyeOff, User, Users, Save, AlertCircle } from 'lucide-react';
import { saveAs } from 'file-saver';
import Papa from 'papaparse';
import { saveTeamMembers, loadTeamMembers } from '../services/firebaseService';

// Default employee list as specified
const DEFAULT_EMPLOYEES = [
  { id: 1, name: 'Nia Kavtaradze', email: '' },
  { id: 2, name: 'Tamuna Janelidze', email: '' },
  { id: 3, name: 'Nino Beridze', email: '' },
  { id: 4, name: 'Eka Tsiklauri', email: '' },
  { id: 5, name: 'Mari Kutaladze', email: '' },
  { id: 6, name: 'Tako Kvirikashvili', email: '' },
  { id: 7, name: 'Teona Abashidze', email: '' },
  { id: 8, name: 'Luka Japaridze', email: '' },
  { id: 9, name: 'Tamta Gabunia', email: '' },
  { id: 10, name: 'Gvantsa Barbakadze', email: '' },
];

/**
 * Generate initials from full name
 */
function getInitials(name) {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Generate consistent avatar color based on name
 */
function getAvatarColor(name) {
  const colors = [
    'bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500',
    'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-gray-500'
  ];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

/**
 * EmployeeList Component
 * @param {Object} props - Component props
 * @param {Array} props.employees - Employee data array
 * @param {Array} props.visibleEmployeeIds - IDs of visible employees
 * @param {Function} props.onVisibilityChange - Handler for visibility changes
 * @param {number} props.selectedEmployeeId - ID of selected/highlighted employee
 * @param {Function} props.onEmployeeSelect - Handler for employee selection
 * @param {Object} props.scheduleData - Current schedule data for badges
 * @param {string} props.className - Additional CSS classes
 */
export default function EmployeeList({
  employees = [],
  visibleEmployeeIds = [],
  onVisibilityChange,
  onEmployeesChange,
  selectedEmployeeId,
  onEmployeeSelect,
  scheduleData,
  className = ''
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAll, setShowAll] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'success', 'error', null
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  // Auto-save employees to Firebase whenever they change
  useEffect(() => {
    if (!autoSaveEnabled || employees.length === 0) return;

    const saveTimer = setTimeout(async () => {
      try {
        setIsSaving(true);
        await saveTeamMembers(employees);
        setSaveStatus('success');
        setTimeout(() => setSaveStatus(null), 3000);
      } catch (error) {
        console.error('Failed to auto-save employees:', error);
        setSaveStatus('error');
      } finally {
        setIsSaving(false);
      }
    }, 1000); // Debounce saves by 1 second

    return () => clearTimeout(saveTimer);
  }, [employees, autoSaveEnabled]);

  // Filter employees based on search term
  const filteredEmployees = useMemo(() => {
    if (!searchTerm.trim()) return employees;
    
    const term = searchTerm.toLowerCase();
    return employees.filter(employee =>
      employee.name.toLowerCase().includes(term)
    );
  }, [employees, searchTerm]);

  // Toggle employee visibility
  const toggleEmployeeVisibility = (employeeId) => {
    const isVisible = visibleEmployeeIds.includes(employeeId);
    let newVisibleIds;
    
    if (isVisible) {
      newVisibleIds = visibleEmployeeIds.filter(id => id !== employeeId);
    } else {
      newVisibleIds = [...visibleEmployeeIds, employeeId];
    }
    
    onVisibilityChange(newVisibleIds);
  };

  // Toggle all employees visibility
  const toggleAllVisibility = () => {
    if (showAll) {
      onVisibilityChange([]);
    } else {
      onVisibilityChange(filteredEmployees.map(emp => emp.id));
    }
    setShowAll(!showAll);
  };

  // Get employee's night shift count from schedule data (for badges)
  const getNightShiftCount = (employeeId) => {
    if (!scheduleData?.assignments) return 0;
    
    return scheduleData.assignments.filter(
      assignment => 
        assignment.employee_id === employeeId && 
        assignment.shift_type === 'night'
    ).length;
  };

  const handleExportCSV = () => {
    // Filter out undefined/null employees and extract only the fields we need
    const cleanEmployees = employees
      .filter(emp => emp && emp.id && emp.name)
      .map(emp => ({
        id: emp.id,
        name: emp.name,
        email: emp.email || ''
      }));
    
    const csvData = Papa.unparse(cleanEmployees);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, 'team_members.csv');
  };

  const handleImportCSV = (event) => {
    const file = event.target.files[0];
    if (file) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const importedEmployees = results.data.map((row, index) => ({
            id: index + 1,
            name: row.name || row.Name || row.employee || row.Employee,
            email: (row.email || row.Email || '').trim(),
          })).filter(emp => {
            // Only include employees with both name and email
            const hasName = emp.name && emp.name.trim();
            const hasEmail = emp.email && emp.email.trim();
            if (!hasEmail && hasName) {
              console.warn(`Skipping employee "${emp.name}" - missing email address`);
            }
            return hasName && hasEmail;
          });
          
          if (importedEmployees.length > 0) {
            // Update state
            if (onEmployeesChange) {
              onEmployeesChange(importedEmployees);
            }
            // Make all imported employees visible
            onVisibilityChange(importedEmployees.map(emp => emp.id));
            
            // Save to Firebase
            try {
              setIsSaving(true);
              await saveTeamMembers(importedEmployees);
              setSaveStatus('success');
              setTimeout(() => setSaveStatus(null), 3000);
              
              // Show success message with count
              alert(`✅ Successfully imported ${importedEmployees.length} employees with email addresses.`);
            } catch (error) {
              console.error('Failed to save imported employees:', error);
              setSaveStatus('error');
              alert(`❌ Failed to save employees: ${error.message}`);
            } finally {
              setIsSaving(false);
            }
          } else {
            alert('❌ No valid employees found in the CSV file. Each employee must have both a name and email address.');
          }
        },
        error: (error) => {
          console.error('Error parsing CSV:', error);
          alert('Error importing CSV file. Please check the file format.');
        }
      });
    }
    // Reset input
    event.target.value = '';
  };

  return (
    <div className={`bg-white border border-gray-200 rounded-lg ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
            <Users size={18} />
            <span>Team Members</span>
          </h3>

          <div className="flex items-center space-x-2">
            {isSaving && (
              <Save className="animate-spin text-blue-500" size={16} />
            )}
            {saveStatus === 'success' && (
              <div className="text-xs text-green-600 flex items-center space-x-1">
                <span>✓ Saved</span>
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="text-xs text-red-600 flex items-center space-x-1">
                <AlertCircle size={14} />
                <span>Save failed</span>
              </div>
            )}
            <div className="text-sm text-gray-500">
              {visibleEmployeeIds.length}/{employees.length} shown
            </div>
          </div>
        </div>

        {/* Export and Import Buttons */}
        <div className="flex space-x-2 mb-3">
          <button
            onClick={handleExportCSV}
            className="px-3 py-2 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Export as CSV
          </button>
          <label className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">
            Import from CSV
            <input
              type="file"
              accept=".csv"
              onChange={handleImportCSV}
              className="hidden"
            />
          </label>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Search employees..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Show/Hide All Toggle */}
        <button
          onClick={toggleAllVisibility}
          className="w-full flex items-center justify-center space-x-2 px-3 py-2 text-sm bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {showAll ? <EyeOff size={16} /> : <Eye size={16} />}
          <span>{showAll ? 'Hide All' : 'Show All'}</span>
        </button>
      </div>

      {/* Employee List */}
      <div className="overflow-hidden">
        <AnimatePresence>
          {filteredEmployees.map((employee) => {
            const isVisible = visibleEmployeeIds.includes(employee.id);
            const isSelected = selectedEmployeeId === employee.id;
            const nightShiftCount = getNightShiftCount(employee.id);
            const initials = getInitials(employee.name);
            const avatarColor = getAvatarColor(employee.name);

            return (
              <motion.div
                key={employee.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`
                  p-3 border-b border-gray-100 transition-all duration-150 cursor-pointer
                  ${isSelected ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50'}
                `}
                onClick={() => onEmployeeSelect(employee.id)}
              >
                <div className="flex items-center space-x-3">
                  {/* Avatar */}
                  <div className={`
                    w-8 h-8 ${avatarColor} text-white text-xs font-semibold 
                    rounded-full flex items-center justify-center flex-shrink-0
                  `}>
                    {initials}
                  </div>

                  {/* Employee Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className={`
                        text-sm font-medium truncate
                        ${isSelected ? 'text-blue-900' : 'text-gray-900'}
                      `}>
                        {employee.name}
                      </span>
                      
                      {/* Night shift badge */}
                      {nightShiftCount > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
                          🌙 {nightShiftCount}
                        </span>
                      )}
                    </div>
                    
                    <div className="text-xs text-gray-500">
                      ID: {employee.id}
                    </div>
                  </div>

                  {/* Visibility Toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleEmployeeVisibility(employee.id);
                    }}
                    className={`
                      p-1 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500
                      ${isVisible 
                        ? 'text-blue-600 hover:text-blue-700 hover:bg-blue-50' 
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                      }
                    `}
                    aria-label={`${isVisible ? 'Hide' : 'Show'} ${employee.name} in schedule`}
                  >
                    {isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Empty State */}
        {filteredEmployees.length === 0 && (
          <div className="p-6 text-center text-gray-500">
            <User size={24} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No employees found</p>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="text-blue-600 hover:text-blue-700 text-xs mt-1"
              >
                Clear search
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
        <div className="flex justify-between items-center">
          <span>
            {filteredEmployees.length} employee{filteredEmployees.length !== 1 ? 's' : ''}
          </span>
          <span>
            {visibleEmployeeIds.length} visible
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact Employee Selector for mobile layouts
 */
export function CompactEmployeeSelector({ 
  employees = [], 
  selectedEmployeeId, 
  onEmployeeSelect,
  className = ''
}) {
  const selectedEmployee = employees.find(emp => emp && emp.id === selectedEmployeeId);

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-3 ${className}`}>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Select Employee
      </label>
      
      <select
        value={selectedEmployeeId || ''}
        onChange={(e) => onEmployeeSelect(parseInt(e.target.value))}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="">All Employees</option>
        {employees.filter(employee => employee && employee.id).map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employee.name}
          </option>
        ))}
      </select>
    </div>
  );
}
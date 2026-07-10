/**
 * Free Shift Request Modal
 * Allows employees to request assignment to available open shifts
 */

import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Clock, AlertCircle } from 'lucide-react';
import { formatDate } from '../utils/dateHelpers';

const SHIFT_CONFIG = {
  morning: {
    label: 'Morning',
    icon: '🌅',
    time: '04:00–13:00',
    colorClasses: 'bg-orange-100 border-orange-500 text-orange-800',
  },
  day: {
    label: 'Day', 
    icon: '☀️',
    time: '10:00–19:00',
    colorClasses: 'bg-yellow-100 border-yellow-500 text-yellow-800',
  },
  afternoon: {
    label: 'Afternoon',
    icon: '🌇',
    time: '15:00–00:00',
    colorClasses: 'bg-purple-100 border-purple-500 text-purple-800',
  },
  night: {
    label: 'Night',
    icon: '🌙',
    time: '19:00–04:00',
    colorClasses: 'bg-blue-100 border-blue-500 text-blue-800',
  },
};

export default function FreeShiftRequestModal({ 
  isOpen, 
  onClose, 
  shiftType, 
  date, 
  onRequestShift,
  isSubmitting = false
}) {
  if (!shiftType || !date) return null;

  const config = SHIFT_CONFIG[shiftType];
  if (!config) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onRequestShift({ shiftType, date });
  };

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
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div 
              className="bg-white rounded-lg shadow-xl max-w-md w-full pointer-events-auto overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 px-6 py-4 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="text-2xl">{config.icon}</div>
                    <div>
                      <h2 className="text-lg font-semibold">Request Open Shift</h2>
                      <p className="text-sm text-green-100">Available for assignment</p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="text-white/80 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
                    aria-label="Close modal"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Content */}
              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {/* Shift Details */}
                <div className="space-y-4">
                  {/* Shift Type */}
                  <div className={`border-l-4 rounded-r-md p-4 ${config.colorClasses}`}>
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-lg">{config.icon}</span>
                      <span className="font-semibold text-lg">{config.label} Shift</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-gray-700">
                      <Clock size={14} />
                      <span className="font-mono">{config.time}</span>
                    </div>
                  </div>

                  {/* Date */}
                  <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-md">
                    <Calendar size={18} className="text-gray-600" />
                    <div>
                      <div className="text-xs text-gray-500 uppercase font-medium">Date</div>
                      <div className="font-medium text-gray-900">
                        {formatDate(new Date(date), 'EEEE, MMMM d, yyyy')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Info Message */}
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                  <div className="flex items-start space-x-3">
                    <AlertCircle size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-900">
                      <p className="font-medium mb-1">Request Process</p>
                      <p className="text-blue-700">
                        Your request will be reviewed by an admin. You'll be notified once it's approved or if there are any conflicts with your existing schedule.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors font-medium"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        <span>Submitting...</span>
                      </>
                    ) : (
                      <>
                        <span>Request Shift</span>
                        <span>→</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

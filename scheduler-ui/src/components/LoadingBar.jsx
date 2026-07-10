/**
 * LoadingBar Component
 * Shows animated progress bar for schedule generation
 * Uses fake progress animation to provide user feedback
 */

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function LoadingBar({ isVisible, message = 'Generating schedule...' }) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('preparing');

  useEffect(() => {
    if (!isVisible) {
      setProgress(0);
      setStage('preparing');
      return;
    }

    // Fake progress animation with stages
    const stages = [
      { name: 'preparing', end: 30, duration: 1000, label: 'Preparing data...' },
      { name: 'solving', end: 70, duration: 2000, label: 'Solving constraints...' },
      { name: 'finalizing', end: 95, duration: 1000, label: 'Finalizing schedule...' },
    ];

    let currentStageIndex = 0;
    let currentProgress = 0;

    const animate = () => {
      if (currentStageIndex >= stages.length) return;

      const currentStage = stages[currentStageIndex];
      setStage(currentStage.label);

      const increment = (currentStage.end - currentProgress) / (currentStage.duration / 50);
      
      const interval = setInterval(() => {
        currentProgress += increment;
        
        if (currentProgress >= currentStage.end) {
          currentProgress = currentStage.end;
          setProgress(currentProgress);
          clearInterval(interval);
          currentStageIndex++;
          
          if (currentStageIndex < stages.length) {
            setTimeout(animate, 100);
          }
        } else {
          setProgress(currentProgress);
        }
      }, 50);

      return () => clearInterval(interval);
    };

    animate();
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md px-4"
    >
      <div className="bg-white rounded-lg shadow-lg border border-blue-200 p-4">
        <div className="flex items-center space-x-3 mb-3">
          <Loader2 className="animate-spin text-blue-600" size={20} />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">{message}</p>
            <p className="text-xs text-gray-500">{stage}</p>
          </div>
          <span className="text-sm font-semibold text-blue-600">{Math.round(progress)}%</span>
        </div>
        
        {/* Progress bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Skeleton loader for schedule grid
 */
export function ScheduleSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      {/* Header skeleton */}
      <div className="flex space-x-4">
        <div className="w-32 h-10 bg-gray-200 rounded"></div>
        <div className="w-32 h-10 bg-gray-200 rounded"></div>
        <div className="w-32 h-10 bg-gray-200 rounded"></div>
      </div>
      
      {/* Grid skeleton */}
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex space-x-2">
            <div className="w-32 h-20 bg-gray-200 rounded"></div>
            {[1, 2, 3, 4, 5, 6, 7].map((col) => (
              <div key={col} className="flex-1 h-20 bg-gray-100 rounded"></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Simple loading spinner for inline use
 */
export function LoadingSpinner({ size = 20, className = '' }) {
  return (
    <Loader2 className={`animate-spin ${className}`} size={size} />
  );
}

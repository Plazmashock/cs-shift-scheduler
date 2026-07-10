/**
 * EmailJS Configuration
 * Replace these values with your actual EmailJS credentials
 */

export const EMAILJS_CONFIG = {
  // Get these from your EmailJS dashboard
  PUBLIC_KEY: import.meta.env.VITE_EMAILJS_PUBLIC_KEY || 'YOUR_EMAILJS_PUBLIC_KEY',
  SERVICE_ID: import.meta.env.VITE_EMAILJS_SERVICE_ID || 'YOUR_EMAILJS_SERVICE_ID',
  
  // Template IDs
  TEMPLATE_IDS: {
    SWAP_REQUEST_APPROVAL: 'YOUR_EMAILJS_TEMPLATE_ID' // All notifications (Request, Approval, Review, Finalization)
  }
};

export default EMAILJS_CONFIG;

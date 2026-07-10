import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
const App = React.lazy(() => import('./App.jsx'))
import { AuthProvider } from './contexts/AuthContext.jsx'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <Suspense fallback={<div className="h-screen w-full flex items-center justify-center">Loading...</div>}>
        <App />
      </Suspense>
    </AuthProvider>
  </React.StrictMode>,
)
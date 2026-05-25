import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SimulacionProvider } from './contexts/SimulacionContext';
import Login from './components/auth/Login';
import Register from './components/auth/Register';
import Dashboard from './pages/Dashboard';
import SimulationWizard from './pages/SimulationWizard';
import SimulationView from './pages/SimulationView';
import Profile from './pages/Profile';
import CompareSimulations from './pages/CompareSimulations';
import { PrivateRoute } from './components/common/PrivateRoute';
import AppNotifications from './components/AppNotifications';
import './styles/globals.css';

function App() {
  return (
    <AuthProvider>
      <SimulacionProvider>
        <AppNotifications />
        <Router>
          <Routes>
            {/* Rutas públicas */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* Rutas privadas */}
            <Route
              path="/dashboard"
              element={
                <PrivateRoute>
                  <Dashboard />
                </PrivateRoute>
              }
            />
            <Route
              path="/simulation/new"
              element={
                <PrivateRoute>
                  <SimulationWizard />
                </PrivateRoute>
              }
            />
            <Route
              path="/simulation/:id"
              element={
                <PrivateRoute>
                  <SimulationView />
                </PrivateRoute>
              }
            />
            <Route
              path="/compare"
              element={
                <PrivateRoute>
                  <CompareSimulations />
                </PrivateRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <PrivateRoute>
                  <Profile />
                </PrivateRoute>
              }
            />

            {/* Redirección por defecto */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Router>
      </SimulacionProvider>
    </AuthProvider>
  );
}

export default App;

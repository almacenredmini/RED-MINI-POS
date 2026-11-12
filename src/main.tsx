import './startOnPos';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import '@fontsource-variable/inter/index.css';
import '@/styles/global.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { DeviceProvider } from '@/contexts/DeviceContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { applyTheme, getTheme } from '@/services/theme';
import { SyncRunner } from '@/components/layout/SyncRunner';
import { UpdatePrompt } from '@/components/layout/UpdatePrompt';
import { router } from './router';

applyTheme(getTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <DeviceProvider>
        <AuthProvider>
          <SyncRunner />
          {/* Fuera del login: el modo sin Internet se instala apenas se abre la app. */}
          <UpdatePrompt />
          <RouterProvider router={router} />
        </AuthProvider>
      </DeviceProvider>
    </ToastProvider>
  </StrictMode>,
);

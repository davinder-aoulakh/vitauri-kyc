import React from 'react';
import { AlertTriangle } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';

const UserNotRegisteredError = () => {
  return (
    <AuthLayout
      icon={AlertTriangle}
      title="Access Restricted"
      subtitle="You are not registered to use this application."
    >
      <div className="text-center">
        <p className="text-slate-600 mb-6">
          Please contact the app administrator to request access.
        </p>
        <div className="p-4 bg-slate-50 rounded-2xl text-sm text-slate-600 text-left">
          <p>If you believe this is an error, you can:</p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Verify you are logged in with the correct account</li>
            <li>Contact the app administrator for access</li>
            <li>Try logging out and back in again</li>
          </ul>
        </div>
      </div>
    </AuthLayout>
  );
};

export default UserNotRegisteredError;
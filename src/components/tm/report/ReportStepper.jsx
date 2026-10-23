import React from 'react';
import { buildSteps } from '@/lib/fiuReport';
import Stepper from '@/components/tm/kit/Stepper';

export default function ReportStepper({ report }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3 mb-5">
      <Stepper steps={buildSteps(report)} />
    </div>
  );
}

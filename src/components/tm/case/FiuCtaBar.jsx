import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function FiuCtaBar({ caseId }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-purple-600 text-white px-5 py-3.5 mb-5">
      <div>
        <div className="text-sm font-semibold">Ready to report?</div>
        <div className="text-xs text-purple-100">Collect the accepted evidence into a draft FIU report for review.</div>
      </div>
      <Button size="sm" className="bg-white text-purple-700 hover:bg-purple-50" onClick={() => navigate(`/tm/case/${caseId}/fiu-report`)}>
        ✦ Prepare FIU report
      </Button>
    </div>
  );
}
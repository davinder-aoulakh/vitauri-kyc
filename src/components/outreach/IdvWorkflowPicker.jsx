import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { workflowsOfType, defaultWorkflow, effectiveWorkflow } from '@/lib/outreachItems';

/**
 * Shows which Didit workflow a verification item will run and lets the user pick another one.
 * value: the chosen workflow_id ('' = the template's or tenant default). onChange({ idv_workflow_id, idv_workflow_name }).
 * templateWorkflowId: the workflow set on the library template, shown as the starting point.
 */
export default function IdvWorkflowPicker({ tenant, item, value, templateWorkflowId = '', onChange, compact = false }) {
  const type = item?.field_type === 'kyb_verification' ? 'kyb' : 'kyc';
  const list = workflowsOfType(tenant, type);
  const def = defaultWorkflow(tenant, type);
  const { workflow, source } = effectiveWorkflow(tenant, { ...item, idv_workflow_id: value || templateWorkflowId || '' });
  const fromTemplate = !value && templateWorkflowId && source === 'item';
  const templateWf = templateWorkflowId && list.find((w) => w.workflow_id === templateWorkflowId);
  const emptyLabel = templateWf ? `As set on the template — ${templateWf.name}` : `Tenant default${def ? ` — ${def.name}` : ''}`;

  if (!list.length) {
    return (
      <p className="text-[11px] text-amber-700">
        No Didit {type === 'kyb' ? 'KYB' : 'identity'} workflow is configured. Ask your Vitauri Ops administrator to add one.
      </p>
    );
  }

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-1.5' : 'space-y-1'}>
      <label className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <ShieldCheck className="h-3 w-3" /> Didit workflow
      </label>
      <select
        value={value || ''}
        onChange={(e) => {
          const wf = list.find((w) => w.workflow_id === e.target.value);
          onChange({ idv_workflow_id: e.target.value, idv_workflow_name: wf?.name || '' });
        }}
        onClick={(e) => e.stopPropagation()}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label="Didit workflow"
      >
        <option value="">{emptyLabel}</option>
        {list.map((w) => (
          <option key={w.id || w.workflow_id} value={w.workflow_id}>{w.name}{w.description ? ` — ${w.description}` : ''}</option>
        ))}
      </select>
      {workflow && (
        <span className="text-[11px] text-muted-foreground">
          Runs: <span className="font-medium text-foreground">{workflow.name}</span>
          {fromTemplate ? ' (from template)' : source === 'default' ? ' (tenant default)' : ''}
        </span>
      )}
    </div>
  );
}

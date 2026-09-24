import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';

interface InfoSection {
  label: string;
  text: string;
}

interface InfoPopoverProps {
  title: string;
  sections: InfoSection[];
}

export function InfoPopover({ title, sections }: InfoPopoverProps) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Explication : ${title}`}
          className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-full border cursor-pointer transition-colors hover:brightness-125"
          style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)' }}
        >
          <HelpCircle className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="max-w-xs space-y-2 p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
          {title}
        </div>
        {sections.map((s) => (
          <div key={s.label} className="space-y-0.5">
            <div className="text-[9px] font-bold" style={{ color: 'var(--accent-warning)' }}>
              {s.label}
            </div>
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {s.text}
            </div>
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

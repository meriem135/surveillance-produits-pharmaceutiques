import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'shadow-sm',
        secondary: '',
        destructive: '',
        outline: 'border',
        success: '',
        warning: '',
        info: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, style, ...props }: BadgeProps) {
  const variantStyle = !variant || variant === 'default'
    ? { background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))', color: '#fff' }
    : variant === 'secondary'
    ? { background: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)', color: 'var(--text-secondary)' }
    : variant === 'destructive'
    ? { background: 'color-mix(in srgb, var(--accent-red) 20%, transparent)', color: 'var(--accent-red)' }
    : variant === 'outline'
    ? { borderColor: 'var(--border)', color: 'var(--text-primary)' }
    : variant === 'success'
    ? { background: 'color-mix(in srgb, var(--accent-success) 15%, transparent)', color: 'var(--accent-success)' }
    : variant === 'warning'
    ? { background: 'color-mix(in srgb, var(--accent-orange) 15%, transparent)', color: 'var(--accent-orange)' }
    : variant === 'info'
    ? { background: 'color-mix(in srgb, var(--accent-purple) 15%, transparent)', color: 'var(--accent-purple)' }
    : {};
  return (
    <div
      className={cn(badgeVariants({ variant }), className)}
      style={{ ...variantStyle, ...style }}
      {...props}
    />
  );
}

export { Badge, badgeVariants };

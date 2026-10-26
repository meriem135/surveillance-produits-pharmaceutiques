import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 ',
  {
    variants: {
      variant: {
        default:
          'shadow-sm hover:brightness-110',
        destructive:
          'shadow-sm hover:brightness-110',
        outline:
          'border hover:bg-[var(--bg-subtle)]',
        secondary:
          'hover:brightness-95',
        ghost: 'hover:bg-[var(--bg-subtle)]',
        link: 'underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-6 text-base',
        icon: 'h-9 w-9 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, style, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const baseStyle = variant === 'default' || !variant
      ? { background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }
      : variant === 'destructive'
      ? { background: 'var(--accent-danger)', color: '#fff' }
      : variant === 'outline'
      ? { borderColor: 'var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }
      : variant === 'secondary'
      ? { background: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', color: 'var(--accent-primary)' }
      : { color: 'var(--text-primary)' };
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        style={{ ...baseStyle, ...style }}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };

import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

/*
 * Bouton shadcn.
 *
 * Les variantes reprennent les mêmes jetons que le `.btn` maison : les deux
 * familles de boutons se ressemblent donc à l'écran, malgré deux systèmes de
 * style différents. C'est ce qui permet d'introduire shadcn écran par écran
 * sans que l'application paraisse mi-refaite.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold ' +
    'transition-[background-color,border-color,box-shadow,transform] duration-150 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 ' +
    'active:scale-[0.98] [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground border border-primary hover:bg-primary/90',
        outline: 'border border-border bg-card text-foreground hover:border-muted-foreground hover:shadow-sm',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        destructive: 'text-destructive hover:bg-destructive/10',
        subtle: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
      },
      size: {
        default: 'h-9 px-3.5 py-2',
        sm: 'h-8 px-2.5 text-[13px]',
        lg: 'h-10 px-5',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'outline', size: 'default' },
  }
);

const Button = forwardRef(function Button(
  { className, variant, size, asChild = false, ...props },
  ref
) {
  const Composant = asChild ? Slot : 'button';
  return (
    <Composant className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
  );
});

export { Button, buttonVariants };

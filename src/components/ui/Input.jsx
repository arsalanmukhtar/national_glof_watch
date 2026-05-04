import { forwardRef } from 'react';
import { cn } from '@/utils/cn';

const Input = forwardRef(function Input({ className, type = 'text', ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn('input-base', className)}
      {...props}
    />
  );
});

export default Input;

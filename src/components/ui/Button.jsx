import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/utils/cn';

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  light: 'btn-light',
  dark: 'btn-dark',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  icon: 'btn-icon btn-ghost',
};

const SIZES = {
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg',
};

const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    type = 'button',
    className,
    children,
    asChild = false,
    ...props
  },
  ref,
) {
  const variantClass = VARIANTS[variant] ?? VARIANTS.primary;
  const sizeClass = variant === 'icon' ? '' : SIZES[size] ?? SIZES.md;

  return (
    <motion.button
      ref={ref}
      type={type}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(variantClass, sizeClass, className)}
      {...props}
    >
      {children}
    </motion.button>
  );
});

export default Button;

import { cn } from '@/utils/cn';

export default function Card({ className, children, as: Tag = 'div', ...props }) {
  return (
    <Tag className={cn('card-base', className)} {...props}>
      {children}
    </Tag>
  );
}

import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/utils/cn';

export default function Sidebar({
  collapsed,
  onToggle,
  className,
  children,
  title = 'Layers',
}) {
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 56 : 320 }}
      transition={{ type: 'spring', stiffness: 200, damping: 28 }}
      className={cn(
        'card-base hidden lg:flex flex-col overflow-hidden shrink-0',
        className,
      )}
    >
      <div className="panel-header px-3 mb-0 pb-2 pt-3">
        {!collapsed && (
          <h2 className="text-sm font-semibold">{title}</h2>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="btn-icon btn-ghost ml-auto"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <ChevronsLeft className="h-4 w-4" />
          )}
        </button>
      </div>
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-3 pb-3">{children}</div>
      )}
    </motion.aside>
  );
}

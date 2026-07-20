import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps extends React.ComponentProps<"div"> {
  icon: LucideIcon;
  message: string;
}

function EmptyState({
  icon: Icon,
  message,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "glass flex flex-col items-center gap-3 rounded-[2rem] p-8 text-center",
        className
      )}
      {...props}
    >
      <Icon aria-hidden className="size-6 text-white/20" strokeWidth={1.5} />
      <p className="text-sm text-white/50">{message}</p>
    </div>
  );
}

export { EmptyState };

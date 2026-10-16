import { ArrowLeft } from "lucide-react";

function cn(...parts: (string | false | undefined | null)[]) {
  return parts.filter(Boolean).join(" ");
}

export type LabHubBackLinkProps = {
  href: string;
  className?: string;
  label?: string;
};

/** Standard pill link back to Lab Hub — shared across satellite apps. */
export function LabHubBackLink({ href, className, label = "Lab Hub" }: LabHubBackLinkProps) {
  return (
    <a href={href} className={cn("hub-back-pill", className)}>
      <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </a>
  );
}

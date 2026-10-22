const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export type IconName = "home" | "brand" | "plus" | "search" | "sidebar" | "grid" | "arrow-up" | "film" | "ratio" | "layout" | "template" | "agent" | "settings" | "import" | "trash" | "x" | "chevron";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M4 11l8-7 8 7v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  brand: (
    <>
      <path d="M5 5h9v14H5z" />
      <path d="M14 8l5 1.5-2.4 9.5L14 18.4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  "arrow-up": <path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" />,
  film: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <path d="M9 5v14M15 5v14M4 12h16" />
    </>
  ),
  ratio: <rect x="4" y="7" width="16" height="10" rx="2" />,
  layout: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M4 10h16M10 10v10" />
    </>
  ),
  template: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="4" rx="1.5" />
      <rect x="13" y="11" width="7" height="9" rx="1.5" />
      <rect x="4" y="14" width="7" height="6" rx="1.5" />
    </>
  ),
  agent: (
    <>
      <path d="M9 4.5l1.4 3.3L14 9l-3.6 1.2L9 13.5l-1.4-3.3L4 9l3.6-1.2z" />
      <path d="M17 12.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6" />
    </>
  ),
  import: <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />,
  trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12h8.4L17 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M7 10l5 5 5-5" />,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      {PATHS[name]}
    </svg>
  );
}

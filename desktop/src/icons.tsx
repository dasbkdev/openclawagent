// Inline SVG icons (Lucide-style, stroke-based) — no dependency, crisp at any size.
// Emoji-as-icons look amateurish and render inconsistently; these are the real thing.

type P = { size?: number; className?: string };
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconSparkle = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8L12 3z" />
    <path d="M19 15l.7 1.9L21.6 18l-1.9.7L19 21l-.7-2.3L16.4 18l1.9-.6L19 15z" />
  </svg>
);

export const IconPlus = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconWand = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M15 4V2M15 10V8M12.5 5.5H10.5M19.5 5.5h-2M6 20l11-11-2-2L4 18l2 2zM17 5l0 0" />
  </svg>
);

export const IconPaperclip = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M21 8.5l-9.2 9.2a4 4 0 01-5.7-5.7l9.2-9.2a2.7 2.7 0 013.8 3.8l-9.2 9.2a1.3 1.3 0 01-1.9-1.9l8.5-8.5" />
  </svg>
);

export const IconTerminal = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z" />
    <path d="M7 9l3 3-3 3M13 15h4" />
  </svg>
);

export const IconSettings = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z" />
  </svg>
);

export const IconSend = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

export const IconStop = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconCamera = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 8a2 2 0 012-2h1.5l1-1.5h5l1 1.5H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
    <circle cx="12" cy="12.5" r="3.2" />
  </svg>
);

export const IconTrash = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />
  </svg>
);

export const IconX = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconCopy = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 012-2h8" />
  </svg>
);

export const IconMinimize = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14" />
  </svg>
);

export const IconMaximize = ({ size = 13, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);

export const IconTasks = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 6h1M4 12h1M4 18h1M9 6h11M9 12h11M9 18h11" />
  </svg>
);

export const IconChevron = ({ size = 14, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconUser = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M5 20a7 7 0 0114 0" />
  </svg>
);

export const IconRefresh = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 4v5h5M20 20v-5h-5" />
    <path d="M19 9a8 8 0 00-14-2.5L4 9M5 15a8 8 0 0014 2.5l1-2.5" />
  </svg>
);

export const IconMic = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0014 0M12 18v3" />
  </svg>
);

export const IconVolume = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M16 9a3 3 0 010 6M18.5 7a6 6 0 010 10" />
  </svg>
);

export const IconEye = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconClock = ({ size = 15, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

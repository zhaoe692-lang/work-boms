import type { SVGProps } from "react";

export type IconName =
  // artifact / node kinds
  | "video"
  | "image"
  | "audio"
  | "doc"
  | "character"
  | "prop"
  | "scene"
  | "vfx"
  | "diamond"
  | "folder"
  | "trendup"
  // nav
  | "dashboard"
  | "graph"
  | "search"
  | "board"
  | "trash"
  | "settings"
  | "plus"
  // metrics
  | "layers"
  | "check"
  | "alert"
  | "clock"
  // actions / titlebar
  | "star"
  | "more"
  | "open"
  | "eye"
  | "wand"
  | "bookmark"
  | "bell"
  | "moon"
  | "repair";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };

  switch (name) {
    case "video":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2.5" />
          <path d="M10 9.4v5.2l4.4-2.6z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "image":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <circle cx="8.5" cy="10" r="1.6" />
          <path d="M21 16l-5-5-8 8" />
        </svg>
      );
    case "audio":
      return (
        <svg {...common}>
          <path d="M9 17V5l11-2v12" />
          <circle cx="6" cy="17" r="3" />
          <circle cx="17" cy="15" r="3" />
        </svg>
      );
    case "doc":
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 16.5h4" />
        </svg>
      );
    case "character":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.6" />
          <path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" />
        </svg>
      );
    case "prop":
      return (
        <svg {...common}>
          <path d="M14.6 6.4a3.8 3.8 0 0 0-5 4.9L4 16.9V20h3.1l5.6-5.6a3.8 3.8 0 0 0 4.9-5l-2.4 2.4-1.9-.4-.4-1.9z" />
        </svg>
      );
    case "scene":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <circle cx="8" cy="9.5" r="1.4" />
          <path d="M3 16l5-4.5 4 3.2 3-2.6 6 4.9" />
        </svg>
      );
    case "vfx":
      return (
        <svg {...common}>
          <path d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4z" fill="currentColor" stroke="none" />
          <path d="M18.5 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "diamond":
      return (
        <svg {...common}>
          <path d="M12 3l9 9-9 9-9-9z" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case "trendup":
      return (
        <svg {...common}>
          <path d="M4 14l5-5 3 3 6-6" />
          <path d="M14 6h5v5" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
        </svg>
      );
    case "graph":
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="2.4" />
          <circle cx="18" cy="6" r="2.4" />
          <circle cx="18" cy="18" r="2.4" />
          <path d="M8.2 10.9l7.5-3.6M8.2 13.1l7.5 3.6" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.2-4.2" />
        </svg>
      );
    case "board":
      return (
        <svg {...common}>
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 13H4a2 2 0 0 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 3.6V4a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V11a2 2 0 0 1 0 2.5z" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="M12 3l9 5-9 5-9-5z" />
          <path d="M3 13l9 5 9-5" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.3 12.4l2.5 2.5 4.7-5.3" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M10.3 3.9l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4.5M12 17h.01" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5.2l3.2 2" />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <path d="M12 3.2l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.2 6.9 18.8l1-5.6-4.1-4 5.7-.8z" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "open":
      return (
        <svg {...common}>
          <path d="M14 4h6v6M20 4l-8.5 8.5" />
          <path d="M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "wand":
      return (
        <svg {...common}>
          <path d="M6 21l9-9" />
          <path d="M14 6l4 4" />
          <path d="M15 3l.7 1.6L17.3 5l-1.6.7L15 7.3l-.7-1.6L12.7 5l1.6-.4z" fill="currentColor" stroke="none" />
          <path d="M20 9l.5 1.2 1.2.5-1.2.5L20 12.4l-.5-1.2-1.2-.5 1.2-.5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "bookmark":
      return (
        <svg {...common}>
          <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M18 8a6 6 0 0 0-12 0c0 6-2.5 8-2.5 8h17S18 14 18 8" />
          <path d="M10.3 21a2 2 0 0 0 3.4 0" />
        </svg>
      );
    case "moon":
      return (
        <svg {...common}>
          <path d="M21 12.5A9 9 0 1 1 11.5 3 7 7 0 0 0 21 12.5z" />
        </svg>
      );
    case "repair":
      return (
        <svg {...common}>
          <path d="M14.6 6.4a3.8 3.8 0 0 0-5 4.9L4 16.9V20h3.1l5.6-5.6a3.8 3.8 0 0 0 4.9-5l-2.4 2.4-1.9-.4-.4-1.9z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

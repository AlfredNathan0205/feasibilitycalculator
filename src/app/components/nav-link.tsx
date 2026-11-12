"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, React.ReactNode> = {
  briefs: (
    <path d="M5 3.5h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm2 4h6m-6 3h6m-6 3h3" />
  ),
  new: <path d="M10 4.5v11M4.5 10h11" />,
  niche: (
    <path d="M10 3.5 12.2 8l4.8.7-3.5 3.4.8 4.9L10 14.7 5.7 17l.8-4.9L3 8.7 7.8 8 10 3.5Z" />
  ),
  approvals: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  dashboard: <path d="M4 16V9m4 7V4m4 12v-5m4 5V7" />,
  rules: <path d="M4 6h8m3 0h1M4 14h1m3 0h8M12 4v4M8 12v4" />,
  frameworks: <path d="M4 5.5h12M4 10h12M4 14.5h7" />,
  people: (
    <path d="M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M13 8.5a2 2 0 1 0 0-4M14 12c1.7.3 3 1.6 3 4" />
  ),
  verify: (
    <path d="M10 3.5 4.5 6v4c0 3.2 2.3 5.6 5.5 6.5 3.2-.9 5.5-3.3 5.5-6.5V6L10 3.5Zm-2.2 6.5 1.7 1.7 3-3.2" />
  ),
};

export function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: keyof typeof ICONS;
  children: React.ReactNode;
}) {
  const path = usePathname() ?? "";
  const active =
    href === "/briefs"
      ? path === "/briefs" ||
        (path.startsWith("/briefs/") && !path.startsWith("/briefs/new"))
      : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      prefetch={false}
      className={`shell-nav-link${active ? " shell-nav-link-active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <svg
        viewBox="0 0 20 20"
        width="18"
        height="18"
        aria-hidden="true"
        className="nav-icon"
      >
        {ICONS[icon]}
      </svg>
      {children}
    </Link>
  );
}

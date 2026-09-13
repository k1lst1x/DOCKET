"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/groups", label: "Groups" },
  { href: "/places", label: "Places" },
  { href: "/chat", label: "Chat" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex items-center gap-0.5 sm:gap-1.5">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex h-10 items-center rounded-full px-3 text-base font-medium transition-colors sm:px-4 ${
                active ? "bg-ink text-white" : "text-ink hover:bg-ink/5"
              }`}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

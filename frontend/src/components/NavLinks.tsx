"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/groups", label: "Groups" },
  { href: "/places", label: "Places" },
  { href: "/news", label: "News" },
  { href: "/chat", label: "Chat" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    // Four links, the theme toggle and the account button must fit a 380px screen: tighter padding and type below sm.
    <ul className="flex items-center gap-0 sm:gap-1.5">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex h-10 items-center rounded-full px-1.5 text-[0.9375rem] font-medium transition-colors min-[400px]:px-2 sm:px-4 sm:text-base ${
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

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { List } from '@phosphor-icons/react';
import { RailsMark } from './rails-mark';
import { HeaderMeta } from './header-meta';
import type { User } from '@supabase/supabase-js';

interface HeaderProps {
  user: User | null;
}

/**
 * The nav register.
 *
 * `.agents/skills/industrial-brutalist-ui` §3.2 puts metadata, navigation and
 * unit IDs in monospace, uppercase and generously tracked at a fixed small
 * size. The header was the last surface still in sentence-case sans at body
 * weight, so signing in changed the app's identity: an instrument panel below,
 * a web app header above it.
 */
const NAV_ITEM =
  'font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors duration-200';

export function Header({ user }: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();

  /**
   * Which nav entry the current URL belongs to.
   *
   * startsWith, not equality: /pedals/abc and /pedals/new are still the Pedals
   * section, and an exact match would leave the header blank on every detail
   * page - the pages where "where am I" is the actual question.
   */
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  const userInitials = user?.email
    ? user.email.substring(0, 2).toUpperCase()
    : '?';

  const navLinks = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/pedals', label: 'Pedals' },
    { href: '/boards', label: 'Boards' },
    { href: '/amps', label: 'Amps' },
  ];

  // h-11 goes on the HEADER, not just the inner row. The border-b used to land
  // outside the measured height, making this a pixel taller than it measured
  // while the editor shell subtracts the nominal height - so the shell was a
  // pixel taller than the viewport, the document scrolled, and the bottom of
  // the right panel was cut off. Tailwind's preflight sets box-sizing:
  // border-box, so with the height here the border is part of the 44.
  //
  // ANY CHANGE TO THIS HEIGHT MUST BE MIRRORED in the editor shell's
  // h-[calc(100dvh-2.75rem)] (editor-client.tsx). They are the same number
  // written twice and there is no way to make the CSS derive one from the
  // other.
  //
  // Full-opacity border, not border-border/40: the editor's HUD box sits
  // directly beneath it and needs a definite edge to sit against.
  return (
    <header className="sticky top-0 z-50 h-11 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center gap-4 px-4">
        {/* Mobile menu button */}
        {user && (
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-2 md:hidden px-2">
                <List className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-r border-border bg-card px-0 pt-12">
              <div className="border-b border-border px-5 pb-4">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Navigate workspace
                </p>
              </div>
              <nav className="flex flex-col">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    aria-current={isCurrent(link.href) ? 'page' : undefined}
                    className={`border-b border-border px-5 py-4 ${NAV_ITEM} ${
                      isCurrent(link.href)
                        ? 'text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        )}

        {/* Wordmark. A unit ID, not a logotype. */}
        <div className="flex shrink-0">
          <Link href={user ? '/dashboard' : '/'} className="flex items-center gap-2">
            <RailsMark />
            <span className="font-mono text-xs font-semibold uppercase tracking-[0.2em]">
              PedalSchema
            </span>
          </Link>
        </div>

        {/* Desktop nav */}
        {user && (
          <nav className="hidden items-center gap-[18px] md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isCurrent(link.href) ? 'page' : undefined}
                className={`relative flex h-11 items-center ${NAV_ITEM} ${
                  isCurrent(link.href)
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {link.label}
                {/* The tick under the current section. An instrument panel
                    marks its selected channel with a rule, not a pill. */}
                {isCurrent(link.href) && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-px h-px bg-primary"
                  />
                )}
              </Link>
            ))}
          </nav>
        )}

        {/* Right side */}
        <div className="flex flex-1 items-center justify-end gap-3">
          {/* Renders only inside the editor - see header-meta. */}
          <HeaderMeta />
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative size-[26px] rounded-full p-0">
                  <Avatar className="size-[26px]">
                    <AvatarFallback className="bg-secondary text-[11px]">{userInitials}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="flex items-center justify-start gap-2 p-2">
                  <div className="flex flex-col space-y-1 leading-none">
                    <p className="text-sm text-muted-foreground truncate max-w-[200px]">{user.email}</p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard">Dashboard</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-3">
              <Link href="/login" className={`${NAV_ITEM} text-muted-foreground hover:text-foreground`}>
                Log in
              </Link>
              <Link
                href="/signup"
                className="bg-primary px-3 py-[5px] font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary-foreground"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

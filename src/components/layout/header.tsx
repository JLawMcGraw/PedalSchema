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
import type { User } from '@supabase/supabase-js';

interface HeaderProps {
  user: User | null;
}

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

  // h-14 goes on the HEADER, not just the inner row. The border-b used to land
  // outside the measured height, making this 57px while the editor shell
  // subtracts 3.5rem (56px) - so the shell was a pixel taller than the
  // viewport, the document scrolled, and the bottom of the right panel was cut
  // off. Tailwind's preflight sets box-sizing: border-box, so with the height
  // here the border is part of the 56.
  return (
    <header className="sticky top-0 z-50 h-14 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center px-4">
        {/* Mobile menu button */}
        {user && (
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="mr-2 md:hidden px-2">
                <List className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 pt-12">
              <nav className="flex flex-col gap-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    aria-current={isCurrent(link.href) ? 'page' : undefined}
                    className={`text-lg font-medium transition-colors duration-200 ${
                      isCurrent(link.href)
                        ? 'text-primary'
                        : 'text-foreground/60 hover:text-foreground/90'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        )}

        {/* Logo */}
        <div className="mr-4 flex shrink-0">
          <Link href={user ? '/dashboard' : '/'} className="flex items-center space-x-2">
            <span className="font-bold text-lg">PedalSchema</span>
          </Link>
        </div>

        {/* Desktop nav */}
        {user && (
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isCurrent(link.href) ? 'page' : undefined}
                className={`relative py-4 transition-colors duration-200 ${
                  isCurrent(link.href)
                    ? 'text-primary'
                    : 'text-foreground/60 hover:text-foreground/90'
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
        <div className="flex flex-1 items-center justify-end space-x-2">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{userInitials}</AvatarFallback>
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
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Get started</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

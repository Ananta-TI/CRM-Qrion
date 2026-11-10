"use client";

import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { signOut } from "@/app/actions/auth";
import { useHeader } from "@/components/header-context";
import { IconClose, IconLogout, IconMenu } from "@/components/icons";
import { NotificationBell, NotificationProvider } from "@/components/notification-bell";
import { QrionLogo } from "@/components/qrion-logo";
import { Avatar } from "@/components/ui";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  exact?: boolean;
  match?: string[];
};

/** The document's spring values. */
const pillSpring = { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.7 };

/**
 * Subscribes to a media query the way React intends: the query is the external
 * store, so an effect never has to push state.
 */
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false, // server snapshot — assume desktop, matching lib default
  );
}

export function AppShell({
  children,
  profile,
  nav,
}: {
  children: React.ReactNode;
  profile: {
    full_name: string;
    email: string;
    role: string;
    avatar_tint: string | null;
    username?: string | null;
  };
  nav: NavItem[];
}) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const isMobile = useMediaQuery("(max-width: 1099px)");
  const { spec } = useHeader();
  const staff = profile.role === "admin";

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [, startTransition] = useTransition();
  const headerRef = useRef<HTMLElement>(null);

  // The drawer only exists below the desktop breakpoint. Deriving this avoids
  // pushing state from an effect when the viewport crosses the boundary.
  const showDrawer = isMobile && drawerOpen;

  const isActive = (item: NavItem) => {
    // Segment-aware: `/dashboard/ticketsX` must not light up "Tiket Saya".
    const owns = (prefix: string) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`);

    if (item.exact) return pathname === item.href;
    return owns(item.href) || (item.match ?? []).some(owns);
  };

  // Split nav into "main" and "general" groups the way the reference does.
  const main = nav.filter((n) => !n.href.startsWith("/settings") && !n.href.startsWith("/admin"));
  const general = nav.filter((n) => !main.includes(n));

  // Drawer: lock body scroll and close on Esc.
  useEffect(() => {
    if (!showDrawer) return;
    document.body.classList.add("sidebar-open");
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("sidebar-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [showDrawer]);

  // Publish the header height so in-page sticky elements can dock under it.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--phead-h",
        `${el.offsetHeight}px`,
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const navGroup = (label: string, items: NavItem[], groupId: string) => (
    <nav className="sidenav" aria-label={label}>
      <p className="sidenav__label">{label}</p>
      <LayoutGroup id={groupId}>
        {items.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              className="sidenav__item"
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={() => setDrawerOpen(false)}
            >
              {active && !reduce && (
                <motion.span
                  layoutId={`${groupId}-pill`}
                  className="sidenav__pill"
                  transition={pillSpring}
                  initial={false}
                />
              )}
              {active && reduce && <span className="sidenav__pill" />}
              <span className="sidenav__ico" aria-hidden="true">
                {item.icon}
              </span>
              <span className="sidenav__text">{item.label}</span>
              {item.badge ? <span className="sidenav__dot">{item.badge}</span> : null}
            </Link>
          );
        })}
      </LayoutGroup>
    </nav>
  );

  const header = (
    <header className="phead" ref={headerRef}>
      <div className="phead__lead">
        {spec?.crumbs && spec.crumbs.length > 0 ? (
          <nav className="crumbs" aria-label="Breadcrumb">
            {spec.crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`}>
                {c.href ? (
                  <Link href={c.href}>{c.label}</Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
                {i < spec.crumbs!.length - 1 && " › "}
              </span>
            ))}
          </nav>
        ) : !spec ? (
          // Only while the page has not published a header yet. Showing this
          // after mount left a permanent grey bar above every title.
          <div className="skel skel--crumbs" />
        ) : null}
        <h1 className="top__title">{spec?.title ?? <span className="skel skel--title" />}</h1>
        {spec?.sub && <p className="phead__sub">{spec.sub}</p>}
      </div>

      <div className="phead__actions">
        {spec?.actions}
        <div className="phead__tools">
          <NotificationBell staff={staff} />
        </div>
      </div>
    </header>
  );

  return (
    <NotificationProvider>
      <header className="mobilebar">
        <button
          className="icon-btn"
          type="button"
          aria-label="Buka menu"
          aria-expanded={showDrawer}
          onClick={() => setDrawerOpen(true)}
        >
          <IconMenu />
        </button>
        <Link className="brand" href="/" aria-label="Qrion — beranda">
          <QrionLogo />
        </Link>
        <NotificationBell staff={staff} />
      </header>

      {showDrawer && (
        <div
          className="sidebar__scrim"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`sidebar${showDrawer ? " sidebar--open" : ""}`}
        aria-label="Navigasi utama"
      >
        <div className="sidebar__top">
          <Link className="brand" href="/" aria-label="Qrion — beranda">
            <QrionLogo />
          </Link>
          <button
            className="icon-btn sidebar__close"
            type="button"
            aria-label="Tutup menu"
            onClick={() => setDrawerOpen(false)}
          >
            <IconClose />
          </button>
        </div>

        <div className="sidebar__navs">
          {navGroup("Menu", main, "app-nav")}
          {navGroup("Umum", general, "app-nav-general")}
        </div>

        <div className="sideuser">
          <Avatar
            name={profile.full_name}
            tint={profile.avatar_tint}
            size="sm"
          />
          <div className="sideuser__body">
            <p className="sideuser__name">{profile.full_name}</p>
            <p className="sideuser__mail" title={profile.email}>
              {profile.username ? `@${profile.username}` : profile.email}
            </p>
          </div>
          <button
            className="icon-btn icon-btn--soft"
            type="button"
            aria-label="Keluar"
            title="Keluar"
            onClick={() => startTransition(() => void signOut())}
          >
            <IconLogout />
          </button>
        </div>
      </aside>

      <div className="app">
        <main className="main view page-enter" id="main" tabIndex={-1}>
          {header}
          {children}
        </main>
      </div>
    </NotificationProvider>
  );
}



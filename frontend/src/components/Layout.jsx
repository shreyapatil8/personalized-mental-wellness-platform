import { BookOpenText, CalendarCheck, ClipboardList, HeartPulse, LogOut, Menu, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth.js";

export default function Layout() {
  const { user, logout } = useAuth();
  if (user?.role === "student") return <StudentLayout logout={logout} />;

  return (
    <div className="min-h-screen bg-mist text-ink">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-sea text-white shadow-lift"><HeartPulse size={22} aria-hidden="true" /></div>
            <div><p className="section-kicker">College Wellness</p><h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">Wellspace</h1></div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-right sm:block">
              <p className="break-words text-sm font-semibold">{user?.name}</p>
              <p className="text-xs font-bold uppercase text-slate-500">{user?.role}</p>
            </div>
            <button className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-coral hover:bg-red-50 hover:text-coral" onClick={logout} title="Sign out" type="button">
              <LogOut size={18} aria-hidden="true" /><span className="sr-only">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 md:grid-cols-[244px_1fr] md:gap-7">
        <nav aria-label="Workspace navigation" className="surface h-fit p-3 md:sticky md:top-24">
          <NavItem to="/" label="Dashboard" icon={<HeartPulse size={18} />} />
          {user?.role === "counsellor" && <NavItem to="/counselling" label="Counselling" icon={<CalendarCheck size={18} />} />}
          {user?.role === "admin" && <NavItem to="/admin" label="Admin" icon={<ShieldCheck size={18} />} />}
          <NavItem to="/profile" label="Profile" icon={<UserRound size={18} />} />
          {user?.role !== "admin" && <NavItem to="/feedback" label="Research feedback" icon={<ClipboardList size={18} />} />}
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            <BookOpenText className="mt-0.5 shrink-0" size={15} aria-hidden="true" />Student wellness details stay role-protected across counsellor and admin workspaces.
          </div>
        </nav>
        <main className="min-w-0"><Outlet /></main>
      </div>
    </div>
  );
}
function StudentLayout({ logout }) {
  const { pathname, search } = useLocation();
  const menu = useRef(null);


  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname, search]);

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (menu.current && !menu.current.contains(event.target)) menu.current.open = false;
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  const primaryLinks = [["Home", "/"], ["Assistant", "/assistant"], ["Mood", "/tracking?tab=mood"], ["Journal", "/tracking?tab=journal"], ["Counselling", "/counselling"]];
  const links = [["Wellness Overview", "/wellness-overview"], ["Profile & sharing", "/profile"], ["Complete / update assessment", "/wellness-assessment"], ["Feedback", "/feedback"]];
  const currentPath = pathname === "/tracking" ? `/tracking?tab=${new URLSearchParams(search).get("tab") || "mood"}` : pathname;

  return (
    <div className="student-space min-h-screen bg-mist text-slate-800">
      <a href="#student-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-4">Skip to content</a>
      <header className="border-b border-slate-200/70 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Link to="/" aria-label="Wellspace home" className="inline-flex min-h-11 items-center gap-2.5 text-xl font-bold tracking-tight text-teal-900 sm:text-2xl"><span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-700 text-white"><HeartPulse size={19} aria-hidden="true" /></span>Wellspace</Link>
          <details ref={menu} className="relative" onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              menu.current.open = false;
              menu.current.querySelector("summary").focus();
            }
          }}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden"><Menu size={18} aria-hidden="true" /> More</summary>
            <nav aria-label="Student menu" className="absolute right-0 top-full z-30 mt-2 max-h-[calc(100dvh-6rem)] w-64 max-w-[calc(100vw-2.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-soft">
              {links.map(([label, to]) => <Link key={to} to={to} aria-current={`${pathname}${search}` === to ? "page" : undefined} className="student-menu-link" onClick={() => { menu.current.open = false; }}>{label}</Link>)}
              <div className="mt-2 border-t border-slate-100 pt-2"><button className="student-menu-link w-full text-left" onClick={logout} type="button">Sign out</button></div>
            </nav>
          </details>
        </div>
        <nav aria-label="Primary navigation" className="mx-auto grid max-w-6xl grid-cols-3 gap-1 px-4 pb-3 min-[360px]:flex min-[360px]:justify-between sm:justify-start sm:px-8">
          {primaryLinks.map(([label, to]) => <Link key={to} to={to} aria-current={currentPath === to ? "page" : undefined} className="primary-nav-link">{label}</Link>)}
        </nav>
      </header>
      <main id="student-content" tabIndex={-1} className="mx-auto min-w-0 max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
function NavItem({ to, label, icon }) {
  return (
    <NavLink
      className={({ isActive }) =>
        `mb-1 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold transition ${
          isActive ? "bg-teal-800 text-white shadow-sm" : "text-slate-600 hover:bg-teal-50 hover:text-ink"
        }`
      }
      to={to}
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}



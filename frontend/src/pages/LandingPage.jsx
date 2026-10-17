import { ArrowRight, BookHeart, HeartPulse, Leaf, MessageCircleHeart } from "lucide-react";
import { Link } from "react-router-dom";

export default function LandingPage() {
  return (
    <div className="min-h-screen text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <Link to="/" aria-label="Wellspace home" className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-sea text-white"><HeartPulse size={24} aria-hidden="true" /></span>
          <span className="text-xl font-bold tracking-tight">Wellspace</span>
        </Link>
        <Link className="btn-secondary" to="/login">Login</Link>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-10 sm:px-8">
        <section className="grid items-center gap-8 py-8 lg:grid-cols-2 lg:gap-12 lg:py-14" aria-labelledby="welcome-title">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-sea">
              <Leaf size={15} aria-hidden="true" /> A little space for your wellbeing
            </p>
            <h1 id="welcome-title" className="max-w-xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Student life is a lot.<br /><span className="text-sea">Make room for you.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-slate-600">
              Welcome to Wellspace. Check in with yourself, build everyday wellness habits, and find support as you navigate campus life.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link className="btn-primary inline-flex items-center justify-center gap-3 px-8 py-3.5 text-base" to="/register">
                Register <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link className="btn-secondary inline-flex items-center justify-center px-8 py-3.5 text-base" to="/login">Login</Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">Just the basics to begin. Explore wellness at your own pace.</p>
          </div>
          <figure className="overflow-hidden rounded-3xl border border-teal-100 bg-[#e6f1ed] shadow-soft">
            <img src="/images/student-wellness.svg" width="640" height="560" className="h-auto w-full" alt="Two students taking a peaceful break together in a leafy campus garden, with a journal and a warm drink." />
            <figcaption className="px-6 pb-6 text-center text-sm font-medium text-teal-900">Small moments of care. Space to grow.</figcaption>
          </figure>
        </section>
        <section aria-label="Support for your student journey" className="grid gap-4 border-t border-slate-200 pt-8 sm:grid-cols-3">
          <Feature icon={BookHeart} title="Check in with yourself" description="Reflect on your mood and make space for your thoughts." />
          <Feature icon={Leaf} title="Understand your wellbeing" description="Explore your patterns through wellness assessments and tracking." />
          <Feature icon={MessageCircleHeart} title="Connect with support" description="Find counselling and conversations when you need them." />
        </section>
      </main>
      <footer className="mx-auto max-w-6xl px-5 pb-6 text-sm text-slate-500 sm:px-8">Wellspace · Student mental wellness</footer>
    </div>
  );
}

function Feature({ icon: Icon, title, description }) {
  return (
    <div className="py-3 sm:pr-4">
      <Icon size={23} className="mb-3 text-sea" aria-hidden="true" />
      <h2 className="font-bold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}

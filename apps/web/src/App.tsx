import { useEffect, type ReactNode } from "react";
import "./styles.css";

interface AppProps {
  readonly path?: string;
}

interface PageFrameProps {
  readonly children: ReactNode;
  readonly title: string;
}

const safeTenantSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function PageFrame({ children, title }: PageFrameProps) {
  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <a className="brand" href="/" aria-label="calenolav home">
          <span className="brand-mark" aria-hidden="true">c</span>
          <span>calenolav</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="/book">Book</a>
          <a className="nav-owner" href="/owner">Owner workspace</a>
        </nav>
      </header>
      <main id="main-content">{children}</main>
      <footer className="site-footer">
        <span>Private by design.</span>
        <span>Calendar details stay behind the scheduling boundary.</span>
      </footer>
    </div>
  );
}

function HomePage() {
  return (
    <PageFrame title="calenolav | Private scheduling">
      <section className="hero" aria-labelledby="home-heading">
        <div className="hero-copy">
          <p className="eyebrow">Calm calendars. Clear decisions.</p>
          <h1 id="home-heading">Scheduling, without the back-and-forth</h1>
          <p className="hero-summary">
            Share the times that actually work. Visitors see availability,
            never the private details behind it.
          </p>
          <div className="action-row">
            <a className="button button-primary" href="/book">Schedule an appointment</a>
            <a className="button button-secondary" href="/owner">Manage my calendar</a>
          </div>
          <ul className="trust-list" aria-label="Scheduling safeguards">
            <li>Live conflict checks</li>
            <li>Private calendar details</li>
            <li>Instant confirmation</li>
          </ul>
        </div>
        <div className="hero-visual" aria-label="A calm weekly schedule illustration">
          <div className="visual-heading">
            <span>This week</span>
            <span className="status-pill">3 openings</span>
          </div>
          <div className="day-row">
            <span>Mon</span><span className="time-chip">9:30</span><span className="time-chip">14:00</span>
          </div>
          <div className="day-row muted-row">
            <span>Tue</span><span className="busy-line" aria-label="No published openings" />
          </div>
          <div className="day-row">
            <span>Wed</span><span className="time-chip accent-chip">11:30</span>
          </div>
          <p className="visual-note">Busy event details remain hidden.</p>
        </div>
      </section>
      <section className="principles" aria-label="How calenolav works">
        <article><span>01</span><h2>Set your rhythm</h2><p>Define weekly windows, notice, and a booking horizon.</p></article>
        <article><span>02</span><h2>Share one link</h2><p>Visitors choose only from fresh, conflict-free times.</p></article>
        <article><span>03</span><h2>Stay in control</h2><p>Every booking is rechecked before an event is created.</p></article>
      </section>
    </PageFrame>
  );
}

function BookingLandingPage() {
  return (
    <PageFrame title="Book an appointment | calenolav">
      <section className="centered-panel">
        <p className="eyebrow">Visitor scheduling</p>
        <h1>Open your booking link</h1>
        <p>Use the private link shared by the calendar owner to see current availability.</p>
        <a className="text-link" href="/">Return home</a>
      </section>
    </PageFrame>
  );
}

function VisitorBookingPage({ slug }: { readonly slug: string }) {
  const tenantName = slug.replaceAll("-", " ");
  return (
    <PageFrame title="Book an appointment | calenolav">
      <section className="booking-layout">
        <aside className="booking-context">
          <p className="eyebrow">Appointment with</p>
          <p className="tenant-name">{tenantName}</p>
          <h1>Book an appointment</h1>
          <p>Times are shown in your local time zone and checked again before confirmation.</p>
          <div className="privacy-card">
            <span className="privacy-icon" aria-hidden="true">&#10022;</span>
            <div><strong>Privacy-safe availability</strong><p>You will never see calendar event details.</p></div>
          </div>
        </aside>
        <section className="booking-card" aria-labelledby="choose-time-heading">
          <div className="step-label">Step 1 of 2</div>
          <h2 id="choose-time-heading">Choose a time</h2>
          <p className="subtle-copy">Available appointments will appear here.</p>
          <div className="slot-skeleton" aria-hidden="true"><span /><span /><span /></div>
          <p className="booking-hint">Select a time to continue with your details.</p>
        </section>
      </section>
    </PageFrame>
  );
}

function OwnerPage() {
  return (
    <PageFrame title="Owner workspace | calenolav">
      <section className="owner-layout">
        <div className="owner-intro">
          <p className="eyebrow">Owner workspace</p>
          <h1>Manage your calendar</h1>
          <p>Connect Google Calendar, publish your weekly rhythm, and review connection status from one private workspace.</p>
          <div className="owner-proof"><span aria-hidden="true">&#10003;</span> Session-protected tenant access</div>
        </div>
        <section className="sign-in-card" aria-labelledby="sign-in-heading">
          <p className="card-kicker">Welcome back</p>
          <h2 id="sign-in-heading">Sign in to continue</h2>
          <form>
            <label htmlFor="owner-email">Email address</label>
            <input id="owner-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" />
            <label htmlFor="owner-password">Password</label>
            <input id="owner-password" name="password" type="password" autoComplete="current-password" />
            <button className="button button-primary full-width" type="submit">Sign in securely</button>
          </form>
          <p className="form-note">Credentials are sent only to calenolav over your secured connection.</p>
        </section>
      </section>
    </PageFrame>
  );
}

function NotFoundPage() {
  return (
    <PageFrame title="Page not found | calenolav">
      <section className="centered-panel">
        <p className="error-code">404</p>
        <h1>Page not found</h1>
        <p>This scheduling link is unavailable or no longer valid.</p>
        <a className="button button-primary" href="/">Return home</a>
      </section>
    </PageFrame>
  );
}

export function App({ path }: AppProps) {
  const currentPath = path ?? (typeof window === "undefined" ? "/" : window.location.pathname);
  if (currentPath === "/") return <HomePage />;
  if (currentPath === "/book") return <BookingLandingPage />;
  if (currentPath === "/owner") return <OwnerPage />;

  const bookingMatch = /^\/book\/([^/]+)$/.exec(currentPath);
  const slug = bookingMatch?.[1];
  if (slug !== undefined && safeTenantSlugPattern.test(slug)) {
    return <VisitorBookingPage slug={slug} />;
  }
  return <NotFoundPage />;
}

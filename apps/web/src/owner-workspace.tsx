import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ApiClientError,
  type AvailabilityPolicyResult,
  type GoogleConnectionStatus,
  type OwnerSession,
  type SignInInput,
  type SignInResult,
} from "./api-client.js";
import {
  OwnerManagement,
  type OwnerManagementClient,
} from "./owner-management.js";

export interface OwnerWorkspaceClient extends Partial<OwnerManagementClient> {
  getAvailabilityPolicy(tenantId: string): Promise<AvailabilityPolicyResult>;
  getGoogleConnectionStatus(tenantId: string): Promise<GoogleConnectionStatus>;
  getSession(): Promise<OwnerSession>;
  signIn(input: SignInInput): Promise<SignInResult>;
  signOut(): Promise<void>;
}

function supportsOwnerManagement(
  client: OwnerWorkspaceClient,
): client is OwnerWorkspaceClient & OwnerManagementClient {
  return (
    client.disconnectGoogleCalendar !== undefined &&
    client.getGoogleAuthorizationUrl !== undefined &&
    client.replaceAvailabilityPolicy !== undefined
  );
}

interface OwnerWorkspaceProps {
  readonly client: OwnerWorkspaceClient;
}

type OwnerState =
  | { readonly kind: "checking" }
  | { readonly kind: "signedOut"; readonly error?: string }
  | { readonly kind: "noOwner" }
  | { readonly kind: "unavailable" }
  | {
      readonly connection: GoogleConnectionStatus;
      readonly kind: "ready";
      readonly policyResult: AvailabilityPolicyResult;
      readonly session: OwnerSession;
      readonly tenantId: string;
    };

export function OwnerWorkspace({ client }: OwnerWorkspaceProps) {
  const [state, setState] = useState<OwnerState>({ kind: "checking" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const restoreSession = useCallback(async () => {
    setState({ kind: "checking" });
    let session: OwnerSession;
    try {
      session = await client.getSession();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setState({ kind: "signedOut" });
      } else {
        setState({ kind: "unavailable" });
      }
      return;
    }

    const membership = session.memberships.find(({ role }) => role === "owner");
    if (membership === undefined) {
      setState({ kind: "noOwner" });
      return;
    }

    try {
      const [connection, policyResult] = await Promise.all([
        client.getGoogleConnectionStatus(membership.tenantId),
        client.getAvailabilityPolicy(membership.tenantId),
      ]);
      setState({
        connection,
        kind: "ready",
        policyResult,
        session,
        tenantId: membership.tenantId,
      });
    } catch {
      setState({ kind: "unavailable" });
    }
  }, [client]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const form = new FormData(event.currentTarget);
    const input = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };

    setIsSubmitting(true);
    try {
      await client.signIn(input);
      await restoreSession();
    } catch (error) {
      setState({
        error:
          error instanceof ApiClientError && error.code === "invalid_credentials"
            ? "Email or password is incorrect."
            : "Sign in is temporarily unavailable. Please try again.",
        kind: "signedOut",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function signOut() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await client.signOut();
      setState({ kind: "signedOut" });
    } catch {
      setState({ kind: "unavailable" });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (state.kind === "checking") {
    return <p className="owner-status" role="status">Checking your session...</p>;
  }

  if (state.kind === "signedOut") {
    return (
      <section className="sign-in-card" aria-labelledby="sign-in-heading">
        <p className="card-kicker">Welcome back</p>
        <h2 id="sign-in-heading">Sign in to continue</h2>
        {state.error !== undefined && <p className="booking-alert" role="alert">{state.error}</p>}
        <form onSubmit={(event) => void signIn(event)}>
          <label htmlFor="owner-email">Email address</label>
          <input id="owner-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
          <label htmlFor="owner-password">Password</label>
          <input id="owner-password" name="password" type="password" autoComplete="current-password" required />
          <button className="button button-primary full-width" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in securely"}
          </button>
        </form>
        <p className="form-note">Credentials are sent only to calenolav over your secured connection.</p>
      </section>
    );
  }

  if (state.kind === "noOwner") {
    return <p className="owner-status" role="alert">No owner workspace is available for this account.</p>;
  }

  if (state.kind === "unavailable") {
    return (
      <div className="owner-status">
        <p role="alert">The owner workspace is temporarily unavailable. Please try again.</p>
        <button className="button button-secondary" type="button" onClick={() => void restoreSession()}>
          Try again
        </button>
      </div>
    );
  }

  const policy = state.policyResult.policy;
  return (
    <section className="workspace-card" aria-labelledby="workspace-heading">
      <header className="workspace-header">
        <div>
          <p className="card-kicker">Authenticated owner</p>
          <h2 id="workspace-heading">Your scheduling workspace</h2>
          <p className="owner-email">{state.session.email}</p>
        </div>
        <button className="button button-secondary" type="button" disabled={isSubmitting} onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <div className="workspace-summary">
        <article>
          <p className="summary-label">Calendar connection</p>
          <strong>{state.connection.connected ? "Google Calendar connected" : "Google Calendar disconnected"}</strong>
          <p>{state.connection.connected ? "Busy times stay private." : "Connect a calendar before publishing live slots."}</p>
        </article>
        <article>
          <p className="summary-label">Availability policy</p>
          {policy === null ? (
            <strong>No availability policy published</strong>
          ) : (
            <>
              <strong>{policy.timeZone}</strong>
              <p>{policy.slotDurationMinutes}-minute appointments</p>
            </>
          )}
        </article>
      </div>
      {supportsOwnerManagement(client) && (
        <OwnerManagement
          client={client}
          connection={state.connection}
          policyResult={state.policyResult}
          tenantId={state.tenantId}
          onConnectionChange={(connection) =>
            setState((current) =>
              current.kind === "ready" ? { ...current, connection } : current,
            )
          }
          onPolicyChange={(policyResult) =>
            setState((current) =>
              current.kind === "ready" ? { ...current, policyResult } : current,
            )
          }
        />
      )}
    </section>
  );
}

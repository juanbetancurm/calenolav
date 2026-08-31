import { useState, type FormEvent } from "react";
import {
  ApiClientError,
  type AvailabilityPolicy,
  type AvailabilityPolicyResult,
  type AvailabilityWindow,
  type GoogleConnectionStatus,
} from "./api-client.js";

export interface OwnerManagementClient {
  disconnectGoogleCalendar(tenantId: string): Promise<void>;
  getGoogleAuthorizationUrl(tenantId: string): string;
  getGoogleConnectionStatus(tenantId: string): Promise<GoogleConnectionStatus>;
  replaceAvailabilityPolicy(
    tenantId: string,
    policy: AvailabilityPolicy,
  ): Promise<AvailabilityPolicyResult>;
}

interface OwnerManagementProps {
  readonly client: OwnerManagementClient;
  readonly connection: GoogleConnectionStatus;
  readonly onConnectionChange: (connection: GoogleConnectionStatus) => void;
  readonly onPolicyChange: (policyResult: AvailabilityPolicyResult) => void;
  readonly policyResult: AvailabilityPolicyResult;
  readonly tenantId: string;
}

interface ManagementMessage {
  readonly kind: "error" | "success";
  readonly text: string;
}

const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function createDefaultPolicy(): AvailabilityPolicy {
  return {
    bookingWindowDays: 60,
    minimumNoticeMinutes: 120,
    slotDurationMinutes: 30,
    timeZone: "UTC",
    windows: [],
  };
}

function minuteToTime(minute: number): string {
  const hours = Math.floor(minute / 60).toString().padStart(2, "0");
  const minutes = (minute % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function timeToMinute(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function OwnerManagement({
  client,
  connection,
  onConnectionChange,
  onPolicyChange,
  policyResult,
  tenantId,
}: OwnerManagementProps) {
  const [draftPolicy, setDraftPolicy] = useState<AvailabilityPolicy>(
    policyResult.policy ?? createDefaultPolicy(),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<ManagementMessage>();

  async function disconnectGoogleCalendar() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setMessage(undefined);
    try {
      await client.disconnectGoogleCalendar(tenantId);
      onConnectionChange(await client.getGoogleConnectionStatus(tenantId));
    } catch {
      setMessage({
        kind: "error",
        text: "Google Calendar could not be disconnected. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function updatePolicyField(
    field:
      | "bookingWindowDays"
      | "minimumNoticeMinutes"
      | "slotDurationMinutes"
      | "timeZone",
    value: string,
  ) {
    setDraftPolicy((current) => ({
      ...current,
      [field]: field === "timeZone" ? value : Number(value),
    }));
    setMessage(undefined);
  }

  function addWindow() {
    setDraftPolicy((current) => ({
      ...current,
      windows: [
        ...current.windows,
        { endMinute: 1020, startMinute: 540, weekday: 1 },
      ],
    }));
    setMessage(undefined);
  }

  function updateWindow(
    index: number,
    field: keyof AvailabilityWindow,
    value: number,
  ) {
    setDraftPolicy((current) => ({
      ...current,
      windows: current.windows.map((window, windowIndex) =>
        windowIndex === index ? { ...window, [field]: value } : window,
      ),
    }));
    setMessage(undefined);
  }

  function removeWindow(index: number) {
    setDraftPolicy((current) => ({
      ...current,
      windows: current.windows.filter((_, windowIndex) => windowIndex !== index),
    }));
    setMessage(undefined);
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setMessage(undefined);
    try {
      const result = await client.replaceAvailabilityPolicy(tenantId, draftPolicy);
      setDraftPolicy(result.policy ?? createDefaultPolicy());
      onPolicyChange(result);
      setMessage({ kind: "success", text: "Availability policy saved." });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof ApiClientError && error.status === 400
            ? "Availability policy could not be saved. Review the schedule and try again."
            : "Availability policy could not be saved. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {message !== undefined && (
        <p
          className={message.kind === "error" ? "booking-alert" : "management-success"}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}

      <div className="connection-actions">
        {connection.connected ? (
          <button
            className="button button-secondary"
            type="button"
            disabled={isSubmitting}
            onClick={() => void disconnectGoogleCalendar()}
          >
            Disconnect Google Calendar
          </button>
        ) : (
          <a
            className="button button-primary"
            href={client.getGoogleAuthorizationUrl(tenantId)}
          >
            Connect Google Calendar
          </a>
        )}
      </div>

      <form className="policy-editor" onSubmit={(event) => void savePolicy(event)}>
        <div className="policy-editor-heading">
          <div>
            <p className="summary-label">Weekly availability</p>
            <h3>Edit availability policy</h3>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={addWindow}
            disabled={isSubmitting}
          >
            Add weekly window
          </button>
        </div>

        <div className="policy-settings">
          <label>
            Time zone
            <input
              type="text"
              value={draftPolicy.timeZone}
              onChange={(event) => updatePolicyField("timeZone", event.currentTarget.value)}
              required
            />
          </label>
          <label>
            Appointment length (minutes)
            <input
              type="number"
              min="5"
              max="480"
              step="5"
              value={draftPolicy.slotDurationMinutes}
              onChange={(event) =>
                updatePolicyField("slotDurationMinutes", event.currentTarget.value)
              }
              required
            />
          </label>
          <label>
            Minimum notice (minutes)
            <input
              type="number"
              min="0"
              step="5"
              value={draftPolicy.minimumNoticeMinutes}
              onChange={(event) =>
                updatePolicyField("minimumNoticeMinutes", event.currentTarget.value)
              }
              required
            />
          </label>
          <label>
            Booking horizon (days)
            <input
              type="number"
              min="1"
              value={draftPolicy.bookingWindowDays}
              onChange={(event) =>
                updatePolicyField("bookingWindowDays", event.currentTarget.value)
              }
              required
            />
          </label>
        </div>

        <div className="weekly-window-list">
          {draftPolicy.windows.length === 0 && (
            <p className="empty-windows">
              No weekly windows. Public availability will be empty.
            </p>
          )}
          {draftPolicy.windows.map((window, index) => {
            const weekdayName = weekdays[window.weekday - 1] ?? "Weekly";
            return (
              <fieldset className="weekly-window" key={index}>
                <legend>{weekdayName} window {index + 1}</legend>
                <label>
                  Weekday
                  <select
                    value={window.weekday}
                    onChange={(event) =>
                      updateWindow(index, "weekday", Number(event.currentTarget.value))
                    }
                  >
                    {weekdays.map((name, weekdayIndex) => (
                      <option key={name} value={weekdayIndex + 1}>{name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Start time
                  <input
                    type="time"
                    step="300"
                    value={minuteToTime(window.startMinute)}
                    onChange={(event) =>
                      updateWindow(index, "startMinute", timeToMinute(event.currentTarget.value))
                    }
                  />
                </label>
                <label>
                  End time
                  <input
                    type="time"
                    step="300"
                    value={minuteToTime(window.endMinute)}
                    onChange={(event) =>
                      updateWindow(index, "endMinute", timeToMinute(event.currentTarget.value))
                    }
                  />
                </label>
                <button
                  className="button button-secondary remove-window"
                  type="button"
                  disabled={isSubmitting}
                  aria-label={`Remove ${weekdayName} window ${index + 1}`}
                  onClick={() => removeWindow(index)}
                >
                  Remove
                </button>
              </fieldset>
            );
          })}
        </div>

        <button
          className="button button-primary policy-save"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving availability..." : "Save availability"}
        </button>
      </form>
    </>
  );
}
